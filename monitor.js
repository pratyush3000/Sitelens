// monitor.js
import axios from "axios";
import nodemailer from "nodemailer";
import sslChecker from "ssl-checker";
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

import { connectDB } from "./db.js";
import Log from "./models/Log.js";
import Site from "./models/Site.js";

import {
  WEBSITES,
  MONITORING_CONFIG,
  EMAIL_CONFIG,
  PERFORMANCE_THRESHOLDS,
  validateEnvironment,
} from "./config.js";

import { logError, retryOperation, CircuitBreaker, ERROR_LEVELS } from "./utils/errorHandler.js";

//
// NOTE: this file can be run standalone (node monitor.js) OR imported by server.js to call addNewWebsite()
//

// --- Setup & initialization ---
await connectDB(); // ensure DB is connected early
validateEnvironment();

// Circuit breakers
const emailCircuitBreaker = new CircuitBreaker(3, 300000);
const sslCircuitBreaker = new CircuitBreaker(5, 600000);

let isShuttingDown = false;
const shutdownHandlers = [];

// In-memory stats map
const dailyStats = {};

// Initialize stats from DB at startup
async function initializeStats() {
  try {
    const sites = await Site.find();
    sites.forEach((s) => {
      const url = s.website;
      if (!dailyStats[url]) {
        dailyStats[url] = createEmptyStat();
      }
    });
    console.log(`📌 Initialized stats for ${Object.keys(dailyStats).length} sites`);
  } catch (err) {
    logError(err, { operation: "initializeStats" }, ERROR_LEVELS.MEDIUM);
    console.error("❌ Failed initializeStats:", err.message);
  }
}

// helper to create empty stat object
function createEmptyStat() {
  return {
    totalChecks: 0,
    successes: 0,
    failures: 0,
    downtimeEvents: 0,
    totalDowntime: 0,
    responseTimes: [],
    slowRequests: 0,
    serverErrors: 0,
    sslExpiryDays: null,
    latencyHistory: [],
    statusCodes: {},
    downtimeTimestamps: [],
    lastRating: null,
  };
}

// Graceful shutdown
process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);
process.on("uncaughtException", (err) => {
  logError(err, { type: "uncaughtException" }, ERROR_LEVELS.CRITICAL);
  gracefulShutdown();
});
process.on("unhandledRejection", (reason) => {
  logError(new Error(`Unhandled Rejection: ${reason}`), {}, ERROR_LEVELS.HIGH);
});

async function gracefulShutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log("🔄 Monitor graceful shutdown initiated...");
  try {
    for (const h of shutdownHandlers) await h();
    console.log("✅ Monitor graceful shutdown completed");
    process.exit(0);
  } catch (err) {
    logError(err, { operation: "gracefulShutdown" }, ERROR_LEVELS.HIGH);
    process.exit(1);
  }
}

// ---------------- PDF generation (unchanged logic) ----------------
function generatePDFReport(body, subject) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 30, size: "A4" });
      const fileName = `report_${Date.now()}.pdf`;
      const filePath = path.join("reports", fileName);
      if (!fs.existsSync("reports")) fs.mkdirSync("reports", { recursive: true });

      const stream = fs.createWriteStream(filePath);
      stream.on("finish", () => resolve(filePath));
      stream.on("error", (err) => reject(err));
      doc.pipe(stream);

      // header
      doc.font("Helvetica-Bold").fontSize(18).fillColor("#111827").text("Daily Website Performance Report", { align: "center" });
      doc.moveDown(0.3);
      doc.font("Helvetica").fontSize(10).fillColor("#4b5563").text(`Date: ${new Date().toLocaleString()}`, { align: "center" });
      doc.moveDown(1);

      body = String(body || "").replace(/[^\x20-\x7E\n.:]/g, "");
      const blocks = body.split("\n\n").filter(b => b.trim() !== "");
      blocks.forEach((block) => {
        const lines = block.split("\n").map(l => l.trim()).filter(l => l !== "");
        if (lines.length === 0) return;
        const stats = {};
        lines.forEach(line => {
          const cleanLine = line.replace(/^\+/, "");
          const [key, val] = cleanLine.split(":").map(s => s && s.trim());
          if (key && val) stats[key] = val;
        });
        const drawRow = (metric, value, status) => {
          const y = doc.y;
          doc.font("Helvetica").fontSize(10).fillColor("#111827").text(metric, 50, y);
          doc.text(value || "-", 250, y);
          doc.text(status || "-", 400, y);
          doc.moveDown(0.2);
        };
        Object.entries(stats).forEach(([metric, value]) => {
          let status = "-";
          if (metric.toLowerCase().includes("uptime")) status = parseFloat(String(value)) >= 99.9 ? "Check" : "Check";
          if (metric.toLowerCase().includes("response")) status = parseFloat(String(value)) < 800 ? "Fast" : "Slow";
          if (metric.toLowerCase().includes("ssl")) status = parseFloat(String(value)) > 30 ? "Valid" : "Expiring Soon";
          if (metric.toLowerCase().includes("last rating")) status = String(value).toLowerCase() === "excellent" ? "Excellent" : "Check";
          drawRow(metric, value, status);
        });
        doc.moveDown(0.3);
        doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke("#d1d5db");
        doc.moveDown(0.3);
      });

      // footer
      doc.font("Helvetica-Oblique").fontSize(9).fillColor("#6b7280").text("Report generated by SiteLens", { align: "center" });
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ---------------- Email sending ----------------
const sendEmail = async (subject, body, attachments = []) => {
  try {
    if (isShuttingDown) return console.log("⚠️ Skipping email send - shutting down");

    await emailCircuitBreaker.execute(async () => {
      const pdfPath = await retryOperation(() => generatePDFReport(body, subject), 2, 1000);
      const finalAttachments = [...attachments, { filename: "SiteLens_Report.pdf", path: pdfPath }];

      const transporter = nodemailer.createTransport({
        service: EMAIL_CONFIG.service,
        auth: { user: EMAIL_CONFIG.user, pass: EMAIL_CONFIG.pass },
      });

      try {
        await transporter.verify();
        console.log("📧 SMTP transporter verified for", EMAIL_CONFIG.service);
      } catch (verifyErr) {
        throw new Error(`SMTP verify failed: ${verifyErr.message}`);
      }

      console.log("📧 Sending email...");
      const info = await transporter.sendMail({
        from: `SiteLens Monitor <${EMAIL_CONFIG.user}>`,
        to: EMAIL_CONFIG.reportEmail,
        subject,
        html: `<p>${String(body).replace(/\n/g, "<br>")}</p>`,
        attachments: finalAttachments,
      });
      console.log("✅ Email sent:", info && (info.messageId || info.response || info.accepted) ? (info.messageId || info.response || info.accepted) : JSON.stringify(info));
    });
  } catch (error) {
    logError(error, { subject, bodyLength: String(body || "").length, circuitBreakerState: emailCircuitBreaker.state }, ERROR_LEVELS.MEDIUM);
    console.error("❌ Email failed:", error && error.message ? error.message : error);
  }
};

// ---------------- SSL check ----------------
async function checkSSL(site) {
  try {
    if (isShuttingDown) return null;
    return await sslCircuitBreaker.execute(async () => {
      return await retryOperation(async () => {
        const days = await sslChecker(new URL(site).hostname, { method: "GET" });
        return days.daysRemaining ?? null;
      }, 2, 2000);
    });
  } catch (error) {
    logError(error, { site, operation: "checkSSL" }, ERROR_LEVELS.LOW);
    return null;
  }
}

// ---------------- Response rating ----------------
function evaluateResponse({ responseTime = 0, statusCode = 0 }) {
  const { excellent, acceptable, concerning } = PERFORMANCE_THRESHOLDS;
  if (statusCode >= 500 || responseTime > concerning.maxResponseTime) return "critical";
  if (statusCode >= 400 || responseTime > acceptable.maxResponseTime) return "concerning";
  if (responseTime > excellent.maxResponseTime) return "acceptable";
  return "excellent";
}

// ---------------- Latency chart generation (unchanged) ----------------
import { ChartJSNodeCanvas } from "chartjs-node-canvas";
async function generateLatencyChart() {
  try {
    const chartJSNodeCanvas = new ChartJSNodeCanvas({ width: 800, height: 400 });
    const labels = Object.keys(dailyStats);
    const data = labels.map((site) =>
      dailyStats[site].responseTimes.length
        ? Math.round(dailyStats[site].responseTimes.reduce((a, b) => a + b, 0) / dailyStats[site].responseTimes.length)
        : 0
    );

    const buffer = await chartJSNodeCanvas.renderToBuffer({
      type: "bar",
      data: { labels, datasets: [{ label: "Avg Response Time (ms)", data }] },
      options: {
        scales: {
          y: { beginAtZero: true, title: { display: true, text: "Response Time (ms)" } },
          x: { title: { display: true, text: "Websites" } },
        },
      },
    });

    const filePath = "./daily_report_chart.png";
    fs.writeFileSync(filePath, buffer);
    return filePath;
  } catch (err) {
    console.error("❌ Failed to generate chart:", err.message);
    return null;
  }
}

// ------------------ Website monitoring ------------------
async function monitorWebsite(site, userId) {
  if (isShuttingDown) return;
  if (!site || typeof site !== "string") {
    console.error("❌ Invalid site passed to monitorWebsite:", site);
    return;
  }
  if (!userId) {
    console.error("❌ userId required for monitorWebsite");
    return;
  }

  // defensive: stats object exists (user-specific key)
  const statsKey = `${userId}_${site}`;
  if (!dailyStats[statsKey]) dailyStats[statsKey] = createEmptyStat();

  const stat = dailyStats[statsKey];
  const start = Date.now();
  let logData = {};

  try {
    const response = await retryOperation(() => axios.get(site, { timeout: MONITORING_CONFIG.requestTimeout }), 2, 1000);
    const respTime = Date.now() - start;
    const rating = evaluateResponse({ responseTime: respTime, statusCode: response.status });

    // Update in-memory stats
    stat.totalChecks++;
    stat.successes++;
    stat.responseTimes.push(respTime);
    stat.latencyHistory.push({ time: new Date().toISOString(), latency: respTime });
    if (respTime > MONITORING_CONFIG.slowThreshold) stat.slowRequests++;
    if (response.status >= 500 && response.status < 600) stat.serverErrors++;
    const codeClass = Math.floor(response.status / 100) + "xx";
    stat.statusCodes[codeClass] = (stat.statusCodes[codeClass] || 0) + 1;
    if (!stat.sslExpiryDays) stat.sslExpiryDays = await checkSSL(site);
    stat.lastRating = rating;

    logData = {
      website: site,
      userId,
      messagetype: "up",
      success: true,
      statusCode: response.status,
      responseTime: respTime,
      rating,
      sslExpiryDays: stat.sslExpiryDays,
      timestamp: new Date().toISOString(),
    };
    console.log(`🚦 ${site} → ${rating.toUpperCase()} (${respTime}ms, code ${response.status})`);
  } catch (err) {
    const respTime = Date.now() - start;
    const ts = new Date().toISOString();
    stat.totalChecks++;
    stat.failures++;

    let rating = "critical";
    let label = "DOWN";
    const msg = (err && err.message ? err.message : "").toLowerCase();
    if (msg.includes("timeout") || msg.includes("403") || msg.includes("forbidden") || msg.includes("network") || msg.includes("dns")) {
      rating = "concerning";
      label = "POSSIBLE ISSUE";
    }
    if (rating === "critical") stat.downtimeEvents++;
    stat.downtimeTimestamps.push(ts);
    stat.lastRating = rating;

    logData = {
      website: site,
      userId,
      messagetype: rating === "critical" ? "down" : "warn",
      success: false,
      error: err && err.message ? err.message : String(err),
      responseTime: respTime,
      rating,
      timestamp: ts,
    };

    console.error(`[${label}] ${site}: ${err && err.message ? err.message : err}`);
    logError(err, { site, responseTime: respTime, rating, label }, rating === "critical" ? ERROR_LEVELS.HIGH : ERROR_LEVELS.MEDIUM);

    if (rating === "critical") {
      await sendEmail(`🚨 Website Down Alert: ${site}`, `ALERT: ${site} is DOWN.\nTime: ${ts}\nError: ${err && err.message ? err.message : err}\nResponse time: ${respTime}ms`);
    }
  }

  // ------------------ Save log to MongoDB ------------------
  try {
    // ensure website exists for validation
    if (!logData.website) {
      logError(new Error("Missing website in logData"), { site, logData }, ERROR_LEVELS.MEDIUM);
    } else {
      const logEntry = new Log(logData);
      await logEntry.save();
    }
  } catch (e) {
    logError(e, { site, operation: "MongoDB log save" }, ERROR_LEVELS.MEDIUM);
    console.error("❌ Failed saving log to MongoDB:", e.message);
  }
}

// ------------------ Monitor all websites (dynamic DB-driven) ------------------
async function monitorAllWebsites() {
  if (isShuttingDown) return;

  const sites = await Site.find();
  for (const s of sites) {
    const site = s.website;
    const userId = s.userId;
    if (!site || typeof site !== "string") {
      console.warn("⚠️ Skipping invalid site record:", site);
      continue;
    }
    if (!userId) {
      console.warn("⚠️ Skipping site without userId:", site);
      continue;
    }
    // run but do not await for all concurrently (we await per-site to avoid huge simultaneous load)
    await monitorWebsite(site, userId);
  }
}

// ------------------ addNewWebsite API for server.js ------------------
export async function addNewWebsite(rawUrl, userId) {
  try {
    if (!rawUrl || typeof rawUrl !== "string") {
      return { success: false, message: "Invalid URL" };
    }
    if (!userId) {
      return { success: false, message: "User ID required" };
    }
    let url = rawUrl.trim();
    // normalize
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;

    // validation: try creating URL object
    try {
      new URL(url);
    } catch (err) {
      return { success: false, message: "Invalid URL format" };
    }

    // insert if not exists for this user
    const exists = await Site.findOne({ website: url, userId });
    if (!exists) {
      await Site.create({ website: url, userId });
      console.log("✅ Added site to DB:", url, "for user:", userId);
    } else {
      console.log("ℹ️ Site already in DB for user:", url);
    }

    // init in-memory stats (user-specific key)
    const statsKey = `${userId}_${url}`;
    if (!dailyStats[statsKey]) dailyStats[statsKey] = createEmptyStat();

    // monitor immediately (fire and forget)
    monitorWebsite(url, userId).catch(err => {
      logError(err, { site: url, userId, operation: "immediateMonitor" }, ERROR_LEVELS.MEDIUM);
    });

    return { success: true, message: "Monitoring started", url };
  } catch (err) {
    logError(err, { operation: "addNewWebsite" }, ERROR_LEVELS.MEDIUM);
    return { success: false, message: err.message || "Failed to add site" };
  }
}

// ------------------ removeWebsite API for server.js ------------------
export async function removeWebsite(rawUrl, userId) {
  try {
    if (!rawUrl || typeof rawUrl !== "string") {
      return { success: false, message: "Invalid URL" };
    }
    if (!userId) {
      return { success: false, message: "User ID required" };
    }
    // Build multiple URL variants to avoid trailing-slash / protocol mismatch
    const buildCandidates = (input) => {
      const variants = new Set();
      const trimmed = (input || "").trim();
      if (trimmed) variants.add(trimmed);

      let normalized = trimmed;
      if (normalized && !/^https?:\/\//i.test(normalized)) normalized = "https://" + normalized;

      try {
        const u = new URL(normalized);
        const origin = u.origin;
        const pathname = u.pathname || "/";
        const noTrailingSlash = (origin + pathname).replace(/\/+$/, "");
        const withTrailingSlash = noTrailingSlash + "/";

        variants.add(normalized);
        variants.add(u.href.replace(/\/+$/, ""));
        variants.add(origin);
        variants.add(noTrailingSlash);
        variants.add(withTrailingSlash);
      } catch (err) {
        // if URL parsing fails, we still try with the raw trimmed string
      }

      return Array.from(variants).filter(Boolean);
    };

    const candidates = buildCandidates(rawUrl);
    if (candidates.length === 0) {
      return { success: false, message: "Invalid URL" };
    }

    // remove site records and logs using any of the candidate forms (for this user only)
    const deletedSiteResult = await Site.deleteMany({ website: { $in: candidates }, userId });
    const logResult = await Log.deleteMany({ website: { $in: candidates }, userId });

    // drop in-memory stats variants (user-specific)
    const statsKeyPrefix = `${userId}_`;
    candidates.forEach((c) => {
      delete dailyStats[`${statsKeyPrefix}${c}`];
      delete dailyStats[c]; // fallback for old format
    });

    const removedSite = deletedSiteResult?.deletedCount > 0;
    let removedLogs = logResult?.deletedCount || 0;

    // Fallback: hostname match (covers stored URLs with paths or protocol differences)
    if (!removedSite && removedLogs === 0) {
      try {
        const urlObj = new URL(candidates[0]);
        const host = urlObj.hostname.replace(/\./g, "\\.");
        const hostRegex = new RegExp(`^https?://${host}(/.*)?$`, "i");
        const hostDeletedSites = await Site.deleteMany({ website: { $regex: hostRegex } });
        const hostDeletedLogs = await Log.deleteMany({ website: { $regex: hostRegex } });
        if (hostDeletedSites?.deletedCount) {
          candidates.push(...candidates.map(() => hostRegex)); // for safety clearing map keys is not needed
        }
        removedLogs += hostDeletedLogs?.deletedCount || 0;
      } catch (e) {
        // ignore regex fallback errors
      }
    }

    return {
      success: true,
      message: "Monitoring stopped",
      removedSite,
      removedLogs,
      note: removedSite || removedLogs > 0 ? undefined : "No matching site/logs; treated as removed",
    };
  } catch (err) {
    logError(err, { operation: "removeWebsite" }, ERROR_LEVELS.MEDIUM);
    return { success: false, message: err.message || "Failed to remove site" };
  }
}

// ------------------ Daily report ------------------
async function sendDailyReport() {
  const nowStr = new Date().toLocaleString();
  let summary = `📅 Daily Website Performance Report\nTime: ${nowStr}\n\n`;

  for (const [site, stat] of Object.entries(dailyStats)) {
    const uptimePercent = stat.totalChecks > 0 ? ((stat.successes / stat.totalChecks) * 100).toFixed(2) : "N/A";
    const avgResponse = stat.responseTimes.length ? (stat.responseTimes.reduce((a, b) => a + b, 0) / stat.responseTimes.length).toFixed(2) : "N/A";
    summary += `🌐 ${site}\n + Uptime: ${uptimePercent}%\n + Avg Response: ${avgResponse} ms\n + Last Rating: ${stat.lastRating || "N/A"}\n + SSL Expiry: ${stat.sslExpiryDays || "N/A"} days\n\n`;
  }

  const chartPath = await generateLatencyChart();
  await sendEmail("📊 Daily Website Monitoring Report", summary, chartPath ? [{ filename: "daily_report_chart.png", path: chartPath }] : []);
}

// ------------------ Startup scheduler ------------------
(async function startup() {
  try {
    await initializeStats();
    // initial run
    await monitorAllWebsites();
    // schedule
    setInterval(monitorAllWebsites, MONITORING_CONFIG.interval);

    // daily report scheduler (checks every minute)
    setInterval(() => {
      try {
        const now = new Date();
        if (now.getHours() === MONITORING_CONFIG.reportHour && now.getMinutes() === MONITORING_CONFIG.reportMinute) {
          sendDailyReport();
        }
      } catch (error) {
        logError(error, { operation: "dailyReportScheduler" }, ERROR_LEVELS.MEDIUM);
      }
    }, 60000);

    shutdownHandlers.push(async () => {
      // on shutdown save a final backup of in-memory stats
      try {
        const backupPath = `./backup_stats_${Date.now()}.json`;
        fs.writeFileSync(backupPath, JSON.stringify(dailyStats, null, 2));
        console.log("💾 Stats backed up to", backupPath);
      } catch (e) {
        logError(e, { operation: "saveBackupOnShutdown" }, ERROR_LEVELS.MEDIUM);
      }
    });

    console.log("✅ SiteLens monitoring started with MongoDB logging");
  } catch (err) {
    logError(err, { operation: "monitorStartup" }, ERROR_LEVELS.CRITICAL);
    console.error("❌ Monitor startup failed:", err.message);
    process.exit(1);
  }
})();

export default { monitorAllWebsites, addNewWebsite, removeWebsite, dailyStats };
