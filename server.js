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

import monitorModule, { addNewWebsite, removeWebsite } from "./monitor.js"; // importing monitor starts monitoring in that module
import AIVisibilityLog from "./models/AIVisibilityLog.js";
import AIVisibilityMonitor from "./models/AIVisibilityMonitor.js";
// Connect DB and validate
await connectDB();
validateEnvironment();

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

    // build full list of names to check — brand + all aliases
    const allNames = [brandName, ...aliases.map(a => a.trim()).filter(a => a !== "")];

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        success: false,
        message: "Gemini API key not configured"
      });
    }

    // Build the prompt — ask for numbered list so we can detect rank
    const prompt = `You are a helpful assistant. A user asks: "What are the best ${keyword} options available right now?" Provide a numbered list of exactly 5 top recommendations with a brief reason for each. Format strictly as:
1. BrandName: reason
2. BrandName: reason
3. BrandName: reason
4. BrandName: reason
5. BrandName: reason`;

    // Call Gemini API
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("Gemini API error:", errText);
      return res.status(500).json({
        success: false,
        message: "Gemini API call failed"
      });
    }

    const geminiData = await geminiRes.json();
    const aiResponse = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // ── Rank detection with alias support ──
    const lines = aiResponse.split("\n").filter(l => l.trim() !== "");
    let rank = null;
    let totalRecommendations = 0;
    let mentionSnippet = "Not mentioned";
    let matchedAs = null;

    lines.forEach(line => {
      const numberMatch = line.match(/^(\d+)[.)]/);
      if (numberMatch) {
        totalRecommendations++;
        const position = parseInt(numberMatch[1]);
        // check brand AND all aliases
        for (const name of allNames) {
          if (line.toLowerCase().includes(name.toLowerCase())) {
            rank = position;
            mentionSnippet = line.trim();
            matchedAs = name;
            break;
          }
        }
      }
    });

    // fallback if prompt format wasn't followed strictly
    if (totalRecommendations === 0) totalRecommendations = 5;

    const isVisible = rank !== null;

    console.log(`🤖 AI Visibility — Brand: "${brandName}", Keyword: "${keyword}", Rank: ${rank ?? "not found"}/${totalRecommendations}`);
     
    // Save result to MongoDB
try {
  await AIVisibilityLog.create({
    userId: req.userId,
    brandName,
    keyword,
    status: isVisible ? "VISIBLE" : "HIDDEN",
    rank,
    totalRecommendations,
    mentionSnippet,
    matchedAs,
    checkedAt: new Date()
  });
  console.log(`💾 AI visibility result saved to DB`);
} catch (saveErr) {
  console.error("Failed to save AI visibility log:", saveErr.message);
  // don't fail the request if save fails
}





 res.json({
      success: true,
      brandName,
      keyword,
      status: isVisible ? "VISIBLE" : "HIDDEN",
      rank,
      totalRecommendations,
      mentionSnippet,
      matchedAs,
      rawResponse: aiResponse,
      checkedAt: new Date().toISOString()
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

    // build filter — optionally filter by brand/keyword
    const filter = { userId: req.userId };
    if (brandName) filter.brandName = new RegExp(brandName, "i");
    if (keyword) filter.keyword = new RegExp(keyword, "i");

    const logs = await AIVisibilityLog.find(filter)
      .sort({ checkedAt: -1 })
      .limit(50)
      .lean();

    res.json({ success: true, history: logs });
  } catch (err) {
    console.error("AI visibility history error:", err.message);
    res.status(500).json({ success: false, message: "Failed to fetch history" });
  }
});


// ==================== AI VISIBILITY MONITORS ====================

// Save a brand+keyword pair to auto-monitor
app.post("/api/ai-visibility/monitor", authenticateToken, async (req, res) => {
  try {
    const { brandName, keyword, aliases = [] } = req.body;
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
      aliases
    });

    console.log(`✅ AI monitor saved: "${brandName}" + "${keyword}" for user ${req.userId}`);
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

// ==================== AI VISIBILITY SCHEDULER ====================
async function runAIVisibilityChecks() {
  console.log("🤖 Running scheduled AI visibility checks...");

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("❌ Gemini API key not configured — skipping AI visibility checks");
    return;
  }

  try {
    const monitors = await AIVisibilityMonitor.find({ isActive: true });
    console.log(`📋 Found ${monitors.length} active AI visibility monitors`);

    for (const monitor of monitors) {
      try {
        const { brandName, keyword, userId, _id, aliases = [] } = monitor;
        const allNames = [brandName, ...aliases.map(a => a.trim()).filter(a => a !== "")];

        const prompt = `You are a helpful assistant. A user asks: "What are the best ${keyword} options available right now?" Provide a numbered list of exactly 5 top recommendations with a brief reason for each. Format strictly as:
1. BrandName: reason
2. BrandName: reason
3. BrandName: reason
4. BrandName: reason
5. BrandName: reason`;

        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }]
            })
          }
        );

        if (!geminiRes.ok) {
          console.error(`❌ Gemini failed for "${brandName}+${keyword}"`);
          continue; // skip this one, try next
        }

        const geminiData = await geminiRes.json();
        const aiResponse = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "";

        // rank detection
        const lines = aiResponse.split("\n").filter(l => l.trim() !== "");
        let rank = null;
        let totalRecommendations = 0;
        let mentionSnippet = "Not mentioned";
        let matchedAs = null;

        lines.forEach(line => {
          const numberMatch = line.match(/^(\d+)[.)]/);
          if (numberMatch) {
            totalRecommendations++;
            const position = parseInt(numberMatch[1]);
            for (const name of allNames) {
              if (line.toLowerCase().includes(name.toLowerCase())) {
                rank = position;
                mentionSnippet = line.trim();
                matchedAs = name;
                break;
              }
            }
          }
        });

        if (totalRecommendations === 0) totalRecommendations = 5;
        const isVisible = rank !== null;

        // save result
    await AIVisibilityLog.create({
          userId,
          brandName,
          keyword,
          status: isVisible ? "VISIBLE" : "HIDDEN",
          rank,
          totalRecommendations,
          mentionSnippet,
          matchedAs,
          checkedAt: new Date()
        });

        // update lastCheckedAt
        await AIVisibilityMonitor.findByIdAndUpdate(_id, { lastCheckedAt: new Date() });

        console.log(`✅ Auto-checked "${brandName}" for "${keyword}" → ${isVisible ? `VISIBLE #${rank}` : "HIDDEN"}`);

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

// Run once on startup, then every 24 hours
runAIVisibilityChecks();
setInterval(runAIVisibilityChecks, 24 * 60 * 60 * 1000);

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
      .sort({ checkedAt: 1 }) // oldest first for chart
      .limit(30)
      .lean();

    const trend = logs.map(log => ({
      date: new Date(log.checkedAt).toLocaleDateString(),
      rank: log.rank,
      status: log.status
    }));

    res.json({ success: true, trend, brandName, keyword });
  } catch (err) {
    console.error("Trend error:", err.message);
    res.status(500).json({ success: false, message: "Failed to fetch trend" });
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

