// server.js
import express from "express";
import fs from "fs";
import path from "path";
import cors from "cors";

import { connectDB } from "./db.js";
import Log from "./models/Log.js";
import Site from "./models/Site.js";

import { MONITORING_CONFIG, validateEnvironment } from "./config.js";
import { logError, performHealthCheck, ERROR_LEVELS } from "./utils/errorHandler.js";
import { DataCleanup, startCleanupScheduler } from "./utils/dataCleanup.js";

import monitorModule, { addNewWebsite, removeWebsite } from "./monitor.js"; // importing monitor starts monitoring in that module

// Connect DB and validate
await connectDB();
validateEnvironment();

const app = express();
const PORT = MONITORING_CONFIG.serverPort;

app.use(express.json());
app.use(cors());

// Serve dashboard static files (if you have web UI in /dashboard)
app.use("/dashboard", express.static("dashboard"));

// Data cleanup init
const LOG_FILE = path.join(process.cwd(), "monitor_logs.json"); // kept for compatibility if any old code uses it
const dataCleanup = new DataCleanup(LOG_FILE);

// Health endpoint
app.get("/health", (req, res) => {
  try {
    const health = performHealthCheck();
    res.json(health);
  } catch (error) {
    logError(error, { operation: "healthCheck" }, ERROR_LEVELS.MEDIUM);
    res.status(500).json({ status: "error", message: "Health check failed" });
  }
});

// Backwards-compatible collect endpoint (if you ever POST logs instead of monitor writing to DB)
app.post("/collect", async (req, res) => {
  try {
    const payload = { ...req.body };
    if (!payload.website) {
      return res.status(400).json({ error: "website is required" });
    }
    payload.timestamp = payload.timestamp ? new Date(payload.timestamp) : new Date();
    const entry = new Log(payload);
    await entry.save();
    res.json({ message: "Log collected" });
  } catch (err) {
    logError(err, { operation: "collectLog", body: req.body }, ERROR_LEVELS.MEDIUM);
    console.error("❌ Error saving log:", err.message);
    res.status(500).json({ error: "Failed to save log" });
  }
});

// Stats endpoint: aggregate logs per site and return computed metrics
app.get("/stats", async (req, res) => {
  try {
    // load logs (you can paginate / filter by query params later)
    const logs = await Log.find().sort({ timestamp: 1 }).lean();

    // group logs by site
    const grouped = {};
    for (const log of logs) {
      const site = log.website || "unknown";
      if (!grouped[site]) grouped[site] = [];
      grouped[site].push(log);
    }

    // reuse calculateStats logic (kept inline)
    function calculateStats(logsArr) {
      const stats = {
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
        downtimeTimestamps: []
      };

      let lastDownTime = null;
      for (const log of logsArr) {
        stats.totalChecks++;
        if (log.messagetype === "up" || log.success === true) {
          stats.successes++;
          if (lastDownTime) {
            stats.totalDowntime += new Date(log.timestamp) - new Date(lastDownTime);
            lastDownTime = null;
          }
        } else {
          stats.failures++;
          if (!lastDownTime) {
            stats.downtimeEvents++;
            stats.downtimeTimestamps.push(log.timestamp);
            lastDownTime = log.timestamp;
          }
        }
        if (typeof log.responseTime === "number") {
          stats.responseTimes.push(log.responseTime);
          stats.latencyHistory.push({ time: log.timestamp, latency: log.responseTime });
          if (log.responseTime > 2000) stats.slowRequests++;
        }
        if (log.statusCode) {
          stats.statusCodes[log.statusCode] = (stats.statusCodes[log.statusCode] || 0) + 1;
          if (log.statusCode >= 500) stats.serverErrors++;
        }
        if (log.sslExpiryDays !== undefined && log.sslExpiryDays !== null) stats.sslExpiryDays = log.sslExpiryDays;
      }
      return stats;
    }

    const result = {};
    for (const site in grouped) {
      const stats = calculateStats(grouped[site]);
      const responseTimes = stats.responseTimes;
      const lastLatency = stats.latencyHistory.length > 0 ? stats.latencyHistory[stats.latencyHistory.length - 1].latency : null;
      const avgLatency = responseTimes.length > 0 ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) : null;
      const minLatency = responseTimes.length > 0 ? Math.min(...responseTimes) : null;
      const maxLatency = responseTimes.length > 0 ? Math.max(...responseTimes) : null;
      const lastLog = grouped[site][grouped[site].length - 1];
      const lastRating = lastLog?.rating || null;

      result[site] = {
        totalChecks: stats.totalChecks,
        successes: stats.successes,
        failures: stats.failures,
        downtimeEvents: stats.downtimeEvents,
        uptimePercent: stats.totalChecks > 0 ? ((stats.successes / stats.totalChecks) * 100).toFixed(2) : null,
        lastResponseTime: lastLatency,
        averageResponseTime: avgLatency,
        minResponseTime: minLatency,
        maxResponseTime: maxLatency,
        slowRequests: stats.slowRequests,
        serverErrors: stats.serverErrors,
        sslExpiryDays: stats.sslExpiryDays,
        statusCodes: stats.statusCodes,
        recentDowntimes: stats.downtimeTimestamps.slice(-5),
        latencyHistory: stats.latencyHistory.slice(-50), // send some history for sparklines
        lastRating
      };
    }

    res.json(result);
  } catch (err) {
    logError(err, { operation: "getStats" }, ERROR_LEVELS.MEDIUM);
    console.error("❌ Error reading stats:", err.message);
    res.status(500).json({ error: "Failed to read stats" });
  }
});

// Add site endpoint - used by dashboard to start monitoring immediately
app.post("/api/add-site", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, message: "URL is required" });

    const result = await addNewWebsite(url);
    if (!result.success) return res.status(400).json(result);

    res.json(result);
  } catch (err) {
    logError(err, { operation: "addSite" }, ERROR_LEVELS.MEDIUM);
    res.status(500).json({ success: false, message: "Failed to add site" });
  }
});

// Remove site endpoint - stops future monitoring for that URL
app.post("/api/remove-site", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, message: "URL is required" });

    const result = await removeWebsite(url);
    // Always return success (removeWebsite handles edge cases gracefully)
    res.json(result);
  } catch (err) {
    logError(err, { operation: "removeSite" }, ERROR_LEVELS.MEDIUM);
    res.status(500).json({ success: false, message: "Failed to remove site" });
  }
});

// Cleanup endpoints (unchanged)
app.get("/cleanup-stats", (req, res) => {
  try {
    const stats = dataCleanup.getCleanupStats();
    res.json(stats);
  } catch (error) {
    logError(error, { operation: "cleanupStats" }, ERROR_LEVELS.MEDIUM);
    res.status(500).json({ error: "Failed to get cleanup stats" });
  }
});

app.post("/cleanup", async (req, res) => {
  try {
    await dataCleanup.cleanupData();
    res.json({ message: "Cleanup completed successfully" });
  } catch (error) {
    logError(error, { operation: "manualCleanup" }, ERROR_LEVELS.MEDIUM);
    res.status(500).json({ error: "Cleanup failed" });
  }
});

// Start Express
try {
  app.listen(PORT, () => {
    console.log(`✅ Server running on http://127.0.0.1:${PORT}`);
    console.log(`📊 Health check available at http://127.0.0.1:${PORT}/health`);
    console.log(`🧹 Cleanup stats available at http://127.0.0.1:${PORT}/cleanup-stats`);

    // Start automatic data cleanup
    startCleanupScheduler(dataCleanup);
  });
} catch (error) {
  logError(error, { operation: "serverStartup", port: PORT }, ERROR_LEVELS.CRITICAL);
  process.exit(1);
}

export default app;

