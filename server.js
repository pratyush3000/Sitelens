// server.js
import express from "express";
import fs from "fs";
import path from "path";
import cors from "cors";

import { connectDB } from "./db.js";
import Log from "./models/Log.js";
import Site from "./models/Site.js";
import User from "./models/User.js";

import { MONITORING_CONFIG, validateEnvironment } from "./config.js";
import { logError, performHealthCheck, ERROR_LEVELS } from "./utils/errorHandler.js";
import { DataCleanup, startCleanupScheduler } from "./utils/dataCleanup.js";
import { authenticateToken, generateToken } from "./utils/auth.js";
import { checkBrandVisibility } from "./utils/aiVisibility.js";
import cleanupOrphanedData from "./utils/orphanCleanup.js";
import { sendAlertEmail } from "./utils/emailAlerts.js";

import monitorModule, { addNewWebsite, removeWebsite } from "./monitor.js"; // importing monitor starts monitoring in that module
import AIVisibilityLog from "./models/AIVisibilityLog.js";
import AIVisibilityMonitor from "./models/AIVisibilityMonitor.js";
import PDFDocument from "pdfkit";
// Connect DB and validate
await connectDB();
validateEnvironment();

// Verify API keys for AI visibility
const geminiKey = process.env.GEMINI_API_KEY;
const openrouterKey = process.env.OPENROUTER_API_KEY;
console.log("\n🔐 [STARTUP] API Key Check:");
console.log(`   GEMINI_API_KEY: ${geminiKey ? "✅ Loaded (" + geminiKey.length + " chars)" : "❌ NOT SET"}`);
console.log(`   OPENROUTER_API_KEY: ${openrouterKey ? "✅ Loaded (" + openrouterKey.length + " chars)" : "❌ NOT SET"}`);
if (!openrouterKey) {
  console.warn("⚠️  [STARTUP] OpenRouter API key not configured - Llama checks will fail");
}
console.log();

const app = express();
const PORT = MONITORING_CONFIG.serverPort;

app.use(express.json());
app.use(cors({ credentials: true, origin: true }));

// Serve dashboard static files (if you have web UI in /dashboard)
// Serve dashboard static files (if you have web UI in /dashboard)
app.use("/dashboard", express.static("dashboard"));

// Also serve the dashboard at root so GET / returns the UI (avoids 404 on '/').
app.use(express.static(path.join(process.cwd(), "dashboard")));
app.get("/", (req, res) => {
  res.sendFile(path.join(process.cwd(), "dashboard", "index.html"));
});

// ==================== AUTHENTICATION ROUTES ====================

// Sign up
app.post("/api/auth/signup", async (req, res) => {
  try {
    if (process.env.SIGNUPS_ENABLED !== "true") {
      return res.status(403).json({ success: false, message: "Signups are currently closed." });
    }

    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ success: false, message: "Username, email, and password are required" });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
    }

    // Check if user exists
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.status(400).json({ success: false, message: "User already exists" });
    }

    // Create user
    const user = await User.create({ username, email, password });
    const token = generateToken(user._id);

    res.json({
      success: true,
      message: "User created successfully",
      token,
      user: { id: user._id, username: user.username, email: user.email }
    });
  } catch (err) {
    logError(err, { operation: "signup" }, ERROR_LEVELS.MEDIUM);
    res.status(500).json({ success: false, message: "Failed to create user" });
  }
});

// Login
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }

    // Find user
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    // Check password
    const isValid = await user.comparePassword(password);
    if (!isValid) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    const token = generateToken(user._id);

    res.json({
      success: true,
      message: "Login successful",
      token,
      user: { id: user._id, username: user.username, email: user.email }
    });
  } catch (err) {
    logError(err, { operation: "login" }, ERROR_LEVELS.MEDIUM);
    res.status(500).json({ success: false, message: "Login failed" });
  }
});

// Get current user (verify token)
app.get("/api/auth/me", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("-password");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    res.json({ success: true, user: { id: user._id, username: user.username, email: user.email } });
  } catch (err) {
    logError(err, { operation: "getUser" }, ERROR_LEVELS.MEDIUM);
    res.status(500).json({ success: false, message: "Failed to get user" });
  }
});

// Delete user (cascade deletes all sites, logs, and monitors)
app.delete("/api/auth/user", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    await user.deleteOne();

    res.json({ success: true, message: "User and all associated data deleted successfully" });
  } catch (err) {
    logError(err, { operation: "deleteUser" }, ERROR_LEVELS.MEDIUM);
    res.status(500).json({ success: false, message: "Failed to delete user" });
  }
});

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
app.get("/stats", authenticateToken, async (req, res) => {
  try {
    // load logs for this user only (limit to recent logs for performance)
    const limit = parseInt(req.query.limit) || 1000;
    const logs = await Log.find({ userId: req.userId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();

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
        downtimeTimestamps: [],
        dnsResolutionTimes: []
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
        if (log.sslExpiryDays !== undefined && log.sslExpiryDays !== null) {
          stats.sslExpiryDays = log.sslExpiryDays;
        }
        if (typeof log.dnsResolutionTime === "number") {
          stats.dnsResolutionTimes.push(log.dnsResolutionTime);
        }
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
        lastRating,
        avgDnsTime: stats.dnsResolutionTimes.length > 0
          ? Math.round(stats.dnsResolutionTimes.reduce((a, b) => a + b, 0) / stats.dnsResolutionTimes.length)
          : null
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
app.post("/api/add-site", authenticateToken, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, message: "URL is required" });

    const result = await addNewWebsite(url, req.userId);
    if (!result.success) return res.status(400).json(result);

    res.json(result);
  } catch (err) {
    logError(err, { operation: "addSite" }, ERROR_LEVELS.MEDIUM);
    res.status(500).json({ success: false, message: "Failed to add site" });
  }
});

// Remove site endpoint - stops future monitoring for that URL
app.post("/api/remove-site", authenticateToken, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, message: "URL is required" });

    const result = await removeWebsite(url, req.userId);
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

// Cleanup orphaned records (for users deleted directly in MongoDB)
app.post("/cleanup-orphans", async (req, res) => {
  try {
    await cleanupOrphanedData();
    res.json({ message: "Orphan cleanup completed successfully" });
  } catch (error) {
    logError(error, { operation: "orphanCleanup" }, ERROR_LEVELS.MEDIUM);
    res.status(500).json({ error: "Orphan cleanup failed" });
  }
});

// Trigger AI visibility checks manually (used by external cron services)
app.post("/trigger-ai-checks", async (req, res) => {
  try {
    // Optional: Verify API key if set in environment
    const cronKey = process.env.CRON_API_KEY;
    if (cronKey && req.headers["x-cron-key"] !== cronKey) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    await runAIVisibilityChecks();
    res.json({ success: true, message: "AI visibility checks triggered successfully" });
  } catch (error) {
    logError(error, { operation: "triggerAIChecks" }, ERROR_LEVELS.MEDIUM);
    res.status(500).json({ success: false, error: "Failed to trigger AI checks" });
  }
});

// ==================== AI SEARCH VISIBILITY ====================
// ==================== AI SEARCH VISIBILITY ====================
app.post("/api/ai-visibility", authenticateToken, async (req, res) => {
  try {
    const { brandName, keyword, aliases = [] } = req.body;

    if (!brandName || !keyword) {
      return res.status(400).json({
        success: false,
        message: "brandName and keyword are required"
      });
    }

    const allNames = [brandName, ...aliases.map(a => a.trim()).filter(a => a !== "")];

    const prompt = `You are a helpful assistant. A user asks: "What are the best ${keyword} options available right now?" Provide a numbered list of exactly 5 top recommendations with a brief reason for each. Format strictly as:
1. BrandName: reason
2. BrandName: reason
3. BrandName: reason
4. BrandName: reason
5. BrandName: reason`;

    const results = {};
    const models = ["gemini", "llama"];

    for (const model of models) {
      try {
        if (!model || model === "undefined") {
          console.error(`❌ [VALIDATION] Invalid model name: "${model}"`);
          results[model] = { status: "ERROR", error: "Invalid model name" };
          continue;
        }

        const result = await checkBrandVisibility(prompt, model, allNames);

        // Validate result has proper model field
        if (!result.model || result.model === "undefined") {
          console.error(`❌ [VALIDATION] Result returned with undefined model: ${JSON.stringify(result).substring(0, 100)}`);
          results[model] = { status: "ERROR", error: "Result has undefined model name" };
          continue;
        }

        results[model] = result;
        console.log(`✅ ${model}: "${brandName}" for "${keyword}" → ${result.status} ${result.rank ? `#${result.rank}` : ""}`);
      } catch (err) {
        console.error(`❌ ${model} check failed:`, err.message);
        results[model] = {
          status: "ERROR",
          error: err.message,
          model: model || "unknown"  // Ensure model field exists even in error
        };
      }
    }

    const checkedAt = new Date();

    // Save logs for models that succeeded (never save undefined keys)
    for (const modelKey of models) {
      const result = results[modelKey];

      if (result.status === "ERROR") {
        console.log(`⏭️  Skipped ${modelKey} (status: ERROR)`);
        continue;
      }

      try {
        // CRITICAL GUARD: Never save with undefined model key
        if (!modelKey || modelKey === "undefined") {
          console.error(`❌ [SAVE] Refusing to save: invalid modelKey "${modelKey}"`);
          continue;
        }
        if (!result.model || result.model === "undefined") {
          console.error(`❌ [SAVE] Refusing to save: result.model is "${result.model}". This entry would create an undefined key.`);
          continue;
        }

        console.log(`💾 [SAVE] Storing ${result.model} result to database`);

        await AIVisibilityLog.create({
          userId: req.userId,
          brandName,
          keyword,
          status: result.status,
          rank: result.rank,
          totalRecommendations: result.totalRecommendations,
          mentionSnippet: result.mentionSnippet,
          matchedAs: result.matchedAs,
          model: result.model,  // Use result.model (validated by utility)
          modelSource: result.modelSource || "pinned",  // Track: pinned or auto-router
          rawResponse: result.rawResponse,
          checkedAt
        });
      } catch (saveErr) {
        console.error(`❌ Failed to save ${modelKey} log:`, saveErr.message);
      }
    }

    // Filter out ERROR results and validate keys
    const successfulResults = Object.fromEntries(
      Object.entries(results).filter(([modelName, r]) => {
        if (r.status === "ERROR") return false;
        if (!modelName || modelName === "undefined") {
          console.error(`⚠️  Skipping result with invalid model name: "${modelName}"`);
          return false;
        }
        return true;
      })
    );

    const visibleResults = Object.values(successfulResults).filter(r => r.status === "VISIBLE");
    const bestRank = visibleResults.length > 0 ? Math.min(...visibleResults.map(r => r.rank)) : null;
    const successCount = Object.keys(successfulResults).length;
    const aggregatedStatus = successCount === 0
      ? "No models checked successfully"
      : visibleResults.length > 0
        ? `Visible in ${visibleResults.length} of ${successCount}`
        : `Not visible in any model`;

    res.json({
      success: true,
      brandName,
      keyword,
      status: aggregatedStatus,
      rank: bestRank,
      modelsChecked: successCount,
      modelsAttempted: models.length,
      checkedAt: checkedAt.toISOString(),
      internalDetails: successfulResults
    });

  } catch (err) {
    console.error("AI visibility error:", err.message);
    res.status(500).json({
      success: false,
      message: "AI visibility check failed"
    });
  }
});


// ==================== AI VISIBILITY HISTORY ====================
app.get("/api/ai-visibility/history", authenticateToken, async (req, res) => {
  try {
    const { brandName, keyword } = req.query;

    const filter = { userId: req.userId };
    if (brandName) filter.brandName = new RegExp(brandName, "i");
    if (keyword) filter.keyword = new RegExp(keyword, "i");

    const rawLogs = await AIVisibilityLog.find(filter)
      .sort({ checkedAt: -1 })
      .limit(100)
      .lean();

    // Group by (brandName, keyword, checkedAt) to get batches of model results
    const grouped = {};
    for (const log of rawLogs) {
      const key = `${log.brandName}|${log.keyword}|${log.checkedAt.getTime()}`;
      if (!grouped[key]) {
        grouped[key] = { brandName: log.brandName, keyword: log.keyword, checkedAt: log.checkedAt, models: {} };
      }
      // Validate model name is not undefined or null
      if (!log.model || log.model === "undefined") {
        console.warn(`⚠️  Skipping log entry with invalid model name: "${log.model}"`);
        continue;
      }
      grouped[key].models[log.model] = {
        status: log.status,
        rank: log.rank,
        totalRecommendations: log.totalRecommendations,
        mentionSnippet: log.mentionSnippet,
        matchedAs: log.matchedAs,
        modelSource: log.modelSource || "pinned"  // Track source: pinned or auto-router
      };
    }

    // Create aggregated history
    const history = Object.values(grouped).map(batch => {
      const visibleModels = Object.values(batch.models).filter(m => m.status === "VISIBLE");
      const bestRank = visibleModels.length > 0 ? Math.min(...visibleModels.map(m => m.rank)) : null;
      const visibleCount = visibleModels.length;
      const totalModels = Object.keys(batch.models).length;

      return {
        brandName: batch.brandName,
        keyword: batch.keyword,
        checkedAt: batch.checkedAt,
        status: totalModels === 0
          ? "No successful checks"
          : visibleCount > 0
            ? `Visible in ${visibleCount} of ${totalModels}`
            : "Not visible",
        rank: bestRank,
        modelsChecked: totalModels,
        internalDetails: batch.models
      };
    });

    res.json({ success: true, history });
  } catch (err) {
    console.error("AI visibility history error:", err.message);
    res.status(500).json({ success: false, message: "Failed to fetch history" });
  }
});


// ==================== AI VISIBILITY MONITORS ====================

// Save a brand+keyword pair to auto-monitor
app.post("/api/ai-visibility/monitor", authenticateToken, async (req, res) => {
  try {
    const { brandName, keyword, aliases = [], checkFrequency = "daily", preferredTime = "09:00", preferredDay = "Monday" } = req.body;
    if (!brandName || !keyword) {
      return res.status(400).json({ success: false, message: "brandName and keyword are required" });
    }

    // check if already exists
    const exists = await AIVisibilityMonitor.findOne({
      userId: req.userId,
      brandName: new RegExp(`^${brandName}$`, "i"),
      keyword: new RegExp(`^${keyword}$`, "i")
    });

    if (exists) {
      return res.status(400).json({ success: false, message: "Already monitoring this brand+keyword pair" });
    }

    const monitor = await AIVisibilityMonitor.create({
      userId: req.userId,
      brandName,
      keyword,
      aliases,
      checkFrequency,
      preferredTime,
      preferredDay,
      nextCheckAt: getNextCheckAt(checkFrequency, preferredTime),
    });

    console.log(`✅ AI monitor saved: "${brandName}" + "${keyword}" (${checkFrequency} at ${preferredTime}) for user ${req.userId}`);
    res.json({ success: true, message: "Monitor saved", monitor });
  } catch (err) {
    console.error("Save monitor error:", err.message);
    res.status(500).json({ success: false, message: "Failed to save monitor" });
  }
});

// Get all saved monitors for current user
app.get("/api/ai-visibility/monitors", authenticateToken, async (req, res) => {
  try {
    const monitors = await AIVisibilityMonitor.find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, monitors });
  } catch (err) {
    console.error("Get monitors error:", err.message);
    res.status(500).json({ success: false, message: "Failed to fetch monitors" });
  }
});

// Delete a monitor
app.delete("/api/ai-visibility/monitor/:id", authenticateToken, async (req, res) => {
  try {
    const monitor = await AIVisibilityMonitor.findOneAndDelete({
      _id: req.params.id,
      userId: req.userId // ensure user can only delete their own
    });

    if (!monitor) {
      return res.status(404).json({ success: false, message: "Monitor not found" });
    }

    res.json({ success: true, message: "Monitor removed" });
  } catch (err) {
    console.error("Delete monitor error:", err.message);
    res.status(500).json({ success: false, message: "Failed to delete monitor" });
  }
});

// Cancel next scheduled check for a monitor
app.post("/api/ai-visibility/monitor/:id/cancel-next-check", authenticateToken, async (req, res) => {
  try {
    const monitor = await AIVisibilityMonitor.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { skipNextCheck: true },
      { new: true }
    );

    if (!monitor) {
      return res.status(404).json({ success: false, message: "Monitor not found" });
    }

    res.json({ success: true, message: "Next check cancelled", monitor });
  } catch (err) {
    console.error("Cancel check error:", err.message);
    res.status(500).json({ success: false, message: "Failed to cancel next check" });
  }
});

// Resume monitor (clear skip flag)
app.post("/api/ai-visibility/monitor/:id/resume-check", authenticateToken, async (req, res) => {
  try {
    const monitor = await AIVisibilityMonitor.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { skipNextCheck: false },
      { new: true }
    );

    if (!monitor) {
      return res.status(404).json({ success: false, message: "Monitor not found" });
    }

    res.json({ success: true, message: "Monitor resumed", monitor });
  } catch (err) {
    console.error("Resume check error:", err.message);
    res.status(500).json({ success: false, message: "Failed to resume monitor" });
  }
});

// Run a specific monitor check immediately (for testing/manual trigger)
app.post("/api/ai-visibility/monitor/:id/run-now", authenticateToken, async (req, res) => {
  try {
    const monitor = await AIVisibilityMonitor.findOne({
      _id: req.params.id,
      userId: req.userId
    });

    if (!monitor) {
      return res.status(404).json({ success: false, message: "Monitor not found" });
    }

    const { brandName, keyword, userId, _id, aliases = [], checkFrequency, preferredTime } = monitor;
    const allNames = [brandName, ...aliases.map(a => a.trim()).filter(a => a !== "")];

    const prompt = `You are a helpful assistant. A user asks: "What are the best ${keyword} options available right now?" Provide a numbered list of exactly 5 top recommendations with a brief reason for each. Format strictly as:
1. BrandName: reason
2. BrandName: reason
3. BrandName: reason
4. BrandName: reason
5. BrandName: reason`;

    const results = {};
    const models = ["gemini", "llama"];
    let checksPassed = 0;

    for (const model of models) {
      try {
        const result = await checkBrandVisibility(prompt, model, allNames);
        results[model] = result;
        if (result.status !== "ERROR") checksPassed++;
      } catch (err) {
        console.error(`❌ ${model} check failed:`, err.message);
        results[model] = { status: "ERROR", error: err.message };
      }
    }

    const checkedAt = new Date();

    // Save logs for successful results
    for (const modelKey of models) {
      const result = results[modelKey];
      if (result.status === "ERROR") continue;

      try {
        if (!modelKey || modelKey === "undefined" || !result.model || result.model === "undefined") {
          continue;
        }

        await AIVisibilityLog.create({
          userId,
          brandName,
          keyword,
          status: result.status,
          rank: result.rank,
          totalRecommendations: result.totalRecommendations,
          mentionSnippet: result.mentionSnippet,
          matchedAs: result.matchedAs,
          model: result.model,
          modelSource: result.modelSource || "pinned",
          rawResponse: result.rawResponse,
          checkedAt
        });
      } catch (saveErr) {
        console.error(`❌ Failed to save ${modelKey} log:`, saveErr.message);
      }
    }

    // Update monitor with status
    const updateData = {
      lastCheckedAt: new Date(),
      nextCheckAt: getNextCheckAt(checkFrequency, preferredTime),
      lastRunHour: new Date().getHours(),
      lastRunStatus: checksPassed > 0 ? "success" : "failed",
      lastRunError: checksPassed > 0 ? null : "No models returned results"
    };

    await AIVisibilityMonitor.findByIdAndUpdate(_id, updateData);

    const successfulResults = Object.values(results).filter(r => r.status !== "ERROR");
    const visibleResults = successfulResults.filter(r => r.status === "VISIBLE");
    const bestRank = visibleResults.length > 0 ? Math.min(...visibleResults.map(r => r.rank)) : null;

    res.json({
      success: true,
      message: `Check completed: ${checksPassed}/${models.length} models succeeded`,
      brandName,
      keyword,
      checksRun: checksPassed,
      status: visibleResults.length > 0 ? `Visible in ${visibleResults.length} model(s)` : "Not visible",
      rank: bestRank,
      checkedAt: checkedAt.toISOString(),
      results: successfulResults
    });
  } catch (err) {
    console.error("Run now error:", err.message);
    res.status(500).json({ success: false, error: "Failed to run check", details: err.message });
  }
});

// ==================== AI VISIBILITY SCHEDULER ====================

function getNextCheckAt(frequency, preferredTime = "09:00") {
  const now = new Date();
  const [prefHour, prefMin] = preferredTime.split(":").map(Number);

  let nextCheck = new Date(now);
  nextCheck.setHours(prefHour, prefMin, 0, 0);

  const ms = { "6h": 6, "12h": 12, "daily": 24, "weekly": 168, "monthly": 720 };
  const intervalHours = ms[frequency] ?? 24;

  // If preferred time has already passed today, schedule for next interval
  if (nextCheck <= now) {
    nextCheck.setTime(nextCheck.getTime() + intervalHours * 60 * 60 * 1000);
  }

  return nextCheck;
}

function shouldRunMonitor(monitor, currentHour, currentDay) {
  const [prefHour] = monitor.preferredTime.split(":").map(Number);

  // Skip if user cancelled this check
  if (monitor.skipNextCheck) return false;

  // Check if current hour matches preferred hour
  if (currentHour !== prefHour) return false;

  // Avoid running twice in same hour
  if (monitor.lastRunHour === currentHour) return false;

  // For weekly, check if today is the preferred day
  if (monitor.checkFrequency === "weekly") {
    if (currentDay !== monitor.preferredDay) return false;
  }

  // Check if nextCheckAt is due
  if (new Date() < new Date(monitor.nextCheckAt)) return false;

  return true;
}

function buildAlertHtml({ username, brandName, keyword, model, changeDescription, checkedAt }) {
  return `
<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;background:#f3f4f6;margin:0;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.12);overflow:hidden;">
    <div style="background:#1e293b;padding:20px 24px;">
      <h1 style="color:#fff;margin:0;font-size:18px;">SiteLens AI Visibility Alert</h1>
    </div>
    <div style="padding:24px;">
      <p style="margin:0 0 16px;color:#374151;">Hi <b>${username}</b>,</p>
      <p style="margin:0 0 16px;color:#374151;">
        Your monitored brand <b>${brandName}</b> (keyword: <i>${keyword}</i>)
        has experienced a visibility change on <b>${model}</b>:
      </p>
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:16px;margin:0 0 16px;">
        <p style="margin:0;color:#374151;">${changeDescription}</p>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:14px;color:#374151;">
        <tr>
          <td style="padding:6px 0;color:#6b7280;">Brand</td>
          <td style="padding:6px 0;font-weight:600;">${brandName}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#6b7280;">Keyword</td>
          <td style="padding:6px 0;">${keyword}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#6b7280;">Model</td>
          <td style="padding:6px 0;">${model}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#6b7280;">Detected at</td>
          <td style="padding:6px 0;">${checkedAt}</td>
        </tr>
      </table>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">
      <p style="margin:0;font-size:12px;color:#9ca3af;">
        You are receiving this because you have AI visibility alerts enabled for this monitor.
        Log in to SiteLens to view your full trend history.
      </p>
    </div>
  </div>
</body>
</html>
  `.trim();
}

async function runAIVisibilityChecks() {
  console.log("🤖 Running scheduled AI visibility checks...");

  try {
    const now = new Date();
    const currentHour = now.getHours();
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const currentDay = days[now.getDay()];

    const monitors = await AIVisibilityMonitor.find({ isActive: true });
    const eligibleMonitors = monitors.filter(m => shouldRunMonitor(m, currentHour, currentDay));
    console.log(`📋 Found ${eligibleMonitors.length} monitors due for checking (out of ${monitors.length} active)`);

    for (const monitor of eligibleMonitors) {
      try {
        const { brandName, keyword, userId, _id, aliases = [], checkFrequency, preferredTime } = monitor;
        const allNames = [brandName, ...aliases.map(a => a.trim()).filter(a => a !== "")];

        const prompt = `You are a helpful assistant. A user asks: "What are the best ${keyword} options available right now?" Provide a numbered list of exactly 5 top recommendations with a brief reason for each. Format strictly as:
1. BrandName: reason
2. BrandName: reason
3. BrandName: reason
4. BrandName: reason
5. BrandName: reason`;

        const results = {};
        const models = ["gemini", "llama"];

        for (const model of models) {
          try {
            const result = await checkBrandVisibility(prompt, model, allNames);
            results[model] = result;
          } catch (err) {
            console.error(`❌ ${model} check failed:`, err.message);
            results[model] = { status: "ERROR", error: err.message };
          }
        }

        const checkedAt = new Date();

        // Save logs for models that succeeded (never save undefined keys)
        for (const modelKey of models) {
          const result = results[modelKey];

          if (result.status === "ERROR") {
            console.log(`⏭️  [SCHEDULER] Skipped ${modelKey} (status: ERROR)`);
            continue;
          }

          try {
            // CRITICAL GUARD: Never save with undefined model key
            if (!modelKey || modelKey === "undefined") {
              console.error(`❌ [SCHEDULER] Refusing to save: invalid modelKey "${modelKey}"`);
              continue;
            }
            if (!result.model || result.model === "undefined") {
              console.error(`❌ [SCHEDULER] Refusing to save: result.model is "${result.model}". This would create an undefined key.`);
              continue;
            }

            // ── ALERT: Compare with previous result and send email if status dropped ──
            try {
              if (monitor.alertsEnabled) {
                const prevLog = await AIVisibilityLog.findOne({
                  userId,
                  brandName,
                  keyword,
                  model: modelKey,
                }).sort({ checkedAt: -1 }).lean();

                if (prevLog) {
                  const statusDropped = prevLog.status === "VISIBLE" && result.status === "HIDDEN";
                  const rankWorsened =
                    prevLog.status === "VISIBLE" &&
                    result.status === "VISIBLE" &&
                    typeof prevLog.rank === "number" &&
                    typeof result.rank === "number" &&
                    result.rank > prevLog.rank;

                  if (statusDropped || rankWorsened) {
                    const user = await User.findById(userId).select("email username").lean();
                    if (user && user.email) {
                      const subject = statusDropped
                        ? `[SiteLens] "${brandName}" dropped from AI results (${modelKey})`
                        : `[SiteLens] "${brandName}" rank worsened on ${modelKey}: #${prevLog.rank} → #${result.rank}`;

                      const changeDescription = statusDropped
                        ? `<b>${brandName}</b> was previously <span style="color:#16a34a"><b>VISIBLE</b></span> at rank <b>#${prevLog.rank}</b> but is now <span style="color:#dc2626"><b>HIDDEN</b></span>.`
                        : `<b>${brandName}</b> rank worsened from <span style="color:#16a34a"><b>#${prevLog.rank}</b></span> to <span style="color:#dc2626"><b>#${result.rank}</b></span>.`;

                      const html = buildAlertHtml({
                        username: user.username,
                        brandName,
                        keyword,
                        model: modelKey,
                        changeDescription,
                        checkedAt: checkedAt.toLocaleString(),
                      });

                      await sendAlertEmail(user.email, subject, html);
                    }
                  }
                }
              }
            } catch (alertErr) {
              console.error(`❌ [SCHEDULER] Alert check failed for ${modelKey}: ${alertErr.message}`);
            }
            // ── END ALERT BLOCK ──

            console.log(`💾 [SCHEDULER] Storing ${result.model} result to database`);

            await AIVisibilityLog.create({
              userId,
              brandName,
              keyword,
              status: result.status,
              rank: result.rank,
              totalRecommendations: result.totalRecommendations,
              mentionSnippet: result.mentionSnippet,
              matchedAs: result.matchedAs,
              model: result.model,  // Use result.model (validated by utility)
              modelSource: result.modelSource || "pinned",  // Track: pinned or auto-router
              rawResponse: result.rawResponse,
              checkedAt
            });
          } catch (saveErr) {
            console.error(`❌ Failed to save ${modelKey} log:`, saveErr.message);
          }
        }

        // update lastCheckedAt, nextCheckAt, and lastRunHour based on frequency and preferred time
        await AIVisibilityMonitor.findByIdAndUpdate(_id, {
          lastCheckedAt: new Date(),
          nextCheckAt: getNextCheckAt(checkFrequency, preferredTime),
          lastRunHour: currentHour,
        });

        const successfulResults = Object.values(results).filter(r => r.status !== "ERROR");
        const visibleResults = successfulResults.filter(r => r.status === "VISIBLE");
        const errorCount = models.length - successfulResults.length;
        const status = visibleResults.length > 0 ? `VISIBLE in ${visibleResults.length} of ${successfulResults.length}` : "HIDDEN";
        const errorMsg = errorCount > 0 ? ` [${errorCount} model(s) failed]` : "";
        console.log(`✅ Auto-checked "${brandName}" for "${keyword}" → ${status}${errorMsg}`);

        // wait 2 seconds between checks to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (monitorErr) {
        console.error(`❌ Failed check for monitor ${monitor._id}:`, monitorErr.message);
      }
    }

    console.log("✅ Scheduled AI visibility checks completed");
  } catch (err) {
    console.error("❌ AI visibility scheduler error:", err.message);
  }
}

// Run once on startup, then every 1 hour
runAIVisibilityChecks();
setInterval(runAIVisibilityChecks, 60 * 60 * 1000);

// ==================== AI VISIBILITY TREND ====================
app.get("/api/ai-visibility/trend", authenticateToken, async (req, res) => {
  try {
    const { brandName, keyword } = req.query;

    if (!brandName || !keyword) {
      return res.status(400).json({ success: false, message: "brandName and keyword are required" });
    }

    const logs = await AIVisibilityLog.find({
      userId: req.userId,
      brandName: new RegExp(`^${brandName}$`, "i"),
      keyword: new RegExp(`^${keyword}$`, "i")
    })
      .sort({ checkedAt: 1 })
      .limit(60)
      .lean();

    // Group by timestamp to aggregate model results
    const grouped = {};
    for (const log of logs) {
      const key = log.checkedAt.getTime();
      if (!grouped[key]) {
        grouped[key] = { checkedAt: log.checkedAt, models: [] };
      }
      grouped[key].models.push({ status: log.status, rank: log.rank });
    }

    const trend = Object.values(grouped).map(batch => {
      const visibleModels = batch.models.filter(m => m.status === "VISIBLE");
      const bestRank = visibleModels.length > 0 ? Math.min(...visibleModels.map(m => m.rank)) : null;
      return {
        date: new Date(batch.checkedAt).toLocaleDateString(),
        rank: bestRank,
        status: visibleModels.length > 0 ? "VISIBLE" : "HIDDEN",
        visibleIn: visibleModels.length
      };
    });

    res.json({ success: true, trend, brandName, keyword });
  } catch (err) {
    console.error("Trend error:", err.message);
    res.status(500).json({ success: false, message: "Failed to fetch trend" });
  }
});


// ==================== INCIDENT TIMELINE ====================
app.get("/api/incidents/:site", authenticateToken, async (req, res) => {
  try {
    const site = decodeURIComponent(req.params.site);

    const incidents = await Log.find({
      userId: req.userId,
      website: site,
      messagetype: { $in: ["down", "warn"] }
    })
      .sort({ timestamp: -1 })
      .limit(10)
      .lean();

    // calculate duration between consecutive down events
    const allLogs = await Log.find({
      userId: req.userId,
      website: site
    })
      .sort({ timestamp: 1 })
      .lean();

    // map each incident with duration
    const enriched = incidents.map(incident => {
      const incidentTime = new Date(incident.timestamp);

      // find next "up" log after this incident
      const recovery = allLogs.find(log =>
        log.messagetype === "up" &&
        new Date(log.timestamp) > incidentTime
      );

      let duration = null;
      if (recovery) {
        const ms = new Date(recovery.timestamp) - incidentTime;
        const minutes = Math.floor(ms / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        duration = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
      }

      return {
        timestamp: incident.timestamp,
        errorType: incident.errorType || incident.messagetype,
        error: incident.error || "Unknown error",
        responseTime: incident.responseTime,
        rating: incident.rating,
        duration
      };
    });

    res.json({ success: true, incidents: enriched, site });
  } catch (err) {
    console.error("Incidents error:", err.message);
    res.status(500).json({ success: false, message: "Failed to fetch incidents" });
  }
});

// ==================== SITE REPORT (AGGREGATED STATS) ====================

app.get("/api/report/:site", authenticateToken, async (req, res) => {
  try {
    const site = decodeURIComponent(req.params.site);
    const range = req.query.range || "24h"; // 24h, 7d, 30d

    // Calculate timeframe
    const now = new Date();
    let startTime;
    switch (range) {
      case "7d":
        startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "30d":
        startTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case "24h":
      default:
        startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }

    // Fetch all logs for the site in the timeframe
    const logs = await Log.find({
      userId: req.userId,
      website: site,
      timestamp: { $gte: startTime, $lte: now }
    }).sort({ timestamp: 1 }).lean();

    if (logs.length === 0) {
      return res.json({
        success: true,
        site,
        range,
        timeframeLabel: range === "7d" ? "last 7 days" : range === "30d" ? "last 30 days" : "last 24 hours",
        uptime: 100,
        avgResponseTime: 0,
        minResponseTime: 0,
        maxResponseTime: 0,
        totalIncidents: 0,
        totalDowntime: 0,
        slowRequests: 0,
        serverErrors: 0,
        sslStatus: "unknown",
        summary: `${site} has no data for the selected timeframe.`
      });
    }

    // Calculate metrics
    const totalTime = now.getTime() - startTime.getTime();
    let downtimeMs = 0;
    let isCurrentlyDown = false;
    let downStartTime = null;

    logs.forEach((log, idx) => {
      if (log.messagetype === "down") {
        isCurrentlyDown = true;
        downStartTime = log.timestamp;
      } else if (log.messagetype === "ok" && isCurrentlyDown) {
        if (downStartTime) {
          downtimeMs += log.timestamp.getTime() - downStartTime.getTime();
        }
        isCurrentlyDown = false;
      }
    });

    // If still down, count until now
    if (isCurrentlyDown && downStartTime) {
      downtimeMs += now.getTime() - downStartTime.getTime();
    }

    const uptime = ((totalTime - downtimeMs) / totalTime) * 100;

    // Response time stats
    const responseTimes = logs
      .filter(l => l.response_time_ms && l.messagetype === "ok")
      .map(l => l.response_time_ms);
    const avgResponseTime = responseTimes.length > 0
      ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
      : 0;
    const minResponseTime = responseTimes.length > 0 ? Math.min(...responseTimes) : 0;
    const maxResponseTime = responseTimes.length > 0 ? Math.max(...responseTimes) : 0;

    // Count incidents, slow requests, server errors
    const incidents = logs.filter(l => l.messagetype === "down");
    const slowRequests = logs.filter(l => l.response_time_ms > 2000).length;
    const serverErrors = logs.filter(l => l.status_code >= 500).length;

    // SSL status (most recent)
    const sslStatus = logs[logs.length - 1]?.ssl_status || "unknown";

    // Generate summary
    const timeframeLabel = range === "7d" ? "last 7 days" : range === "30d" ? "last 30 days" : "last 24 hours";
    const summary = `${site} was up ${uptime.toFixed(1)}% over the ${timeframeLabel}, with ${incidents.length} outage${incidents.length !== 1 ? "s" : ""} totaling ${Math.round(downtimeMs / 1000 / 60)} minutes.`;

    res.json({
      success: true,
      site,
      range,
      timeframeLabel,
      uptime: parseFloat(uptime.toFixed(2)),
      avgResponseTime,
      minResponseTime,
      maxResponseTime,
      totalIncidents: incidents.length,
      totalDowntime: Math.round(downtimeMs / 1000 / 60), // minutes
      slowRequests,
      serverErrors,
      sslStatus,
      summary,
      generatedAt: new Date().toISOString()
    });
  } catch (err) {
    console.error("Report error:", err.message);
    res.status(500).json({ success: false, message: "Failed to generate report" });
  }
});

// ==================== SITE REPORT PDF DOWNLOAD ====================

app.get("/api/report/:site/download", authenticateToken, async (req, res) => {
  try {
    const site = decodeURIComponent(req.params.site);
    const range = req.query.range || "24h";

    // Calculate timeframe
    const now = new Date();
    let startTime;
    let rangeLabel = "24h";
    switch (range) {
      case "7d":
        startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        rangeLabel = "7d";
        break;
      case "30d":
        startTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        rangeLabel = "30d";
        break;
      default:
        startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        rangeLabel = "24h";
    }

    // Fetch logs
    const logs = await Log.find({
      userId: req.userId,
      website: site,
      timestamp: { $gte: startTime, $lte: now }
    }).sort({ timestamp: 1 }).lean();

    // Calculate metrics (same as /api/report/:site)
    const totalTime = now.getTime() - startTime.getTime();
    let downtimeMs = 0;
    let isCurrentlyDown = false;
    let downStartTime = null;

    logs.forEach((log) => {
      if (log.messagetype === "down") {
        isCurrentlyDown = true;
        downStartTime = log.timestamp;
      } else if (log.messagetype === "ok" && isCurrentlyDown) {
        if (downStartTime) {
          downtimeMs += log.timestamp.getTime() - downStartTime.getTime();
        }
        isCurrentlyDown = false;
      }
    });

    if (isCurrentlyDown && downStartTime) {
      downtimeMs += now.getTime() - downStartTime.getTime();
    }

    const uptime = ((totalTime - downtimeMs) / totalTime) * 100;
    const responseTimes = logs
      .filter(l => l.response_time_ms && l.messagetype === "ok")
      .map(l => l.response_time_ms);
    const avgResponseTime = responseTimes.length > 0
      ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
      : 0;
    const minResponseTime = responseTimes.length > 0 ? Math.min(...responseTimes) : 0;
    const maxResponseTime = responseTimes.length > 0 ? Math.max(...responseTimes) : 0;
    const incidents = logs.filter(l => l.messagetype === "down");
    const slowRequests = logs.filter(l => l.response_time_ms > 2000).length;
    const serverErrors = logs.filter(l => l.status_code >= 500).length;

    const timeframeLabel = rangeLabel === "7d" ? "last 7 days" : rangeLabel === "30d" ? "last 30 days" : "last 24 hours";
    const summary = `${site} was up ${uptime.toFixed(1)}% over the ${timeframeLabel}, with ${incidents.length} outage${incidents.length !== 1 ? "s" : ""} totaling ${Math.round(downtimeMs / 1000 / 60)} minutes.`;

    // Set response headers for PDF download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${site}-report-${rangeLabel}.pdf"`);

    // Create PDF document
    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);

    // Header
    doc.fontSize(24).font('Helvetica-Bold').text('Site Report', { align: 'center' });
    doc.fontSize(14).font('Helvetica').text(site, { align: 'center' });
    doc.moveDown(0.5);

    // Metadata
    doc.fontSize(10).fillColor('#666');
    doc.text(`Timeframe: ${timeframeLabel.toUpperCase()} | Generated: ${now.toLocaleString()}`);
    doc.moveDown(1);

    // Summary
    doc.fontSize(12).fillColor('#000').font('Helvetica-Bold').text('Summary');
    doc.fontSize(11).font('Helvetica').text(summary);
    doc.moveDown(1);

    // Stats table
    doc.fontSize(12).font('Helvetica-Bold').text('Performance Metrics');
    doc.moveDown(0.3);

    const stats = [
      ['Metric', 'Value'],
      ['Uptime', `${uptime.toFixed(2)}%`],
      ['Avg Response Time', `${avgResponseTime}ms`],
      ['Min Response Time', `${minResponseTime}ms`],
      ['Max Response Time', `${maxResponseTime}ms`],
      ['Total Incidents', `${incidents.length}`],
      ['Total Downtime', `${Math.round(downtimeMs / 1000 / 60)} min`],
      ['Slow Requests (>2s)', `${slowRequests}`],
      ['Server Errors (5xx)', `${serverErrors}`]
    ];

    // Simple table rendering
    const colWidth = 250;
    const rowHeight = 20;
    let y = doc.y;

    stats.forEach((row, idx) => {
      const isHeader = idx === 0;
      const bgColor = isHeader ? '#e0e0e0' : (idx % 2 === 0 ? '#f9f9f9' : '#fff');

      // Draw background
      doc.rect(50, y, colWidth, rowHeight).fill(bgColor);
      doc.fillColor('#000');

      // Draw text
      const font = isHeader ? 'Helvetica-Bold' : 'Helvetica';
      doc.font(font).fontSize(10);
      doc.text(row[0], 60, y + 5, { width: 150 });
      doc.text(row[1], 210, y + 5, { width: 80, align: 'right' });

      y += rowHeight;
    });

    doc.moveDown(2);

    // Footer
    doc.fontSize(9).fillColor('#999').text('SiteLens Monitoring Report', { align: 'center' });

    doc.end();

  } catch (err) {
    console.error("Report PDF error:", err.message);
    res.status(500).json({ success: false, message: "Failed to generate PDF report" });
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

    // Clean up any orphaned data from users deleted outside of Mongoose
    cleanupOrphanedData();
  });
} catch (error) {
  logError(error, { operation: "serverStartup", port: PORT }, ERROR_LEVELS.CRITICAL);
  process.exit(1);
}

export default app;

