import fs from "fs";
import path from "path";
import { MONITORING_CONFIG } from "../config.js";
import { logError, ERROR_LEVELS } from "./errorHandler.js";

// Data cleanup utilities
export class DataCleanup {
  constructor(logFile) {
    this.logFile = logFile;
    this.cleanupRunning = false;
  }

  // Clean old data based on time and entry limits
  async cleanupData() {
    if (this.cleanupRunning) {
      console.log("🔄 Cleanup already running, skipping...");
      return;
    }

    this.cleanupRunning = true;
    
    try {
      console.log("🧹 Starting data cleanup...");
      
      if (!fs.existsSync(this.logFile)) {
        console.log("📝 No log file found, skipping cleanup");
        return;
      }

      const logs = JSON.parse(fs.readFileSync(this.logFile, "utf8"));
      const cutoffDate = new Date(Date.now() - (MONITORING_CONFIG.dataRetentionDays * 24 * 60 * 60 * 1000));
      
      console.log(`🗑️ Removing data older than ${MONITORING_CONFIG.dataRetentionDays} days (before ${cutoffDate.toISOString()})`);
      
      // Filter out old entries
      const recentLogs = logs.filter(log => {
        const logDate = new Date(log.timestamp);
        return logDate > cutoffDate;
      });

      // Group by website and limit entries per site
      const grouped = {};
      for (const log of recentLogs) {
        const site = log.website || "unknown";
        if (!grouped[site]) grouped[site] = [];
        grouped[site].push(log);
      }

      // Limit entries per site and sort by timestamp (newest first)
      const cleanedLogs = [];
      for (const site in grouped) {
        const siteLogs = grouped[site]
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
          .slice(0, MONITORING_CONFIG.maxEntriesPerSite);
        
        cleanedLogs.push(...siteLogs);
      }

      // Sort all logs by timestamp
      cleanedLogs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      // Write cleaned data back
      fs.writeFileSync(this.logFile, JSON.stringify(cleanedLogs, null, 2));
      
      const removedCount = logs.length - cleanedLogs.length;
      console.log(`✅ Cleanup completed: Removed ${removedCount} old entries, kept ${cleanedLogs.length} recent entries`);
      
      // Log cleanup stats
      for (const site in grouped) {
        const siteCount = grouped[site].length;
        const keptCount = Math.min(siteCount, MONITORING_CONFIG.maxEntriesPerSite);
        console.log(`📊 ${site}: ${keptCount}/${siteCount} entries kept`);
      }

    } catch (error) {
      logError(error, { operation: 'dataCleanup' }, ERROR_LEVELS.MEDIUM);
      console.error("❌ Data cleanup failed:", error.message);
    } finally {
      this.cleanupRunning = false;
    }
  }

  // Get cleanup statistics
  getCleanupStats() {
    try {
      if (!fs.existsSync(this.logFile)) {
        return { totalEntries: 0, sites: {}, oldestEntry: null, newestEntry: null };
      }

      const logs = JSON.parse(fs.readFileSync(this.logFile, "utf8"));
      const grouped = {};
      
      for (const log of logs) {
        const site = log.website || "unknown";
        if (!grouped[site]) grouped[site] = [];
        grouped[site].push(log);
      }

      const timestamps = logs.map(log => new Date(log.timestamp));
      const oldestEntry = timestamps.length > 0 ? new Date(Math.min(...timestamps)) : null;
      const newestEntry = timestamps.length > 0 ? new Date(Math.max(...timestamps)) : null;

      return {
        totalEntries: logs.length,
        sites: Object.keys(grouped).reduce((acc, site) => {
          acc[site] = grouped[site].length;
          return acc;
        }, {}),
        oldestEntry: oldestEntry?.toISOString(),
        newestEntry: newestEntry?.toISOString(),
        retentionDays: MONITORING_CONFIG.dataRetentionDays,
        maxEntriesPerSite: MONITORING_CONFIG.maxEntriesPerSite
      };
    } catch (error) {
      logError(error, { operation: 'getCleanupStats' }, ERROR_LEVELS.LOW);
      return { error: error.message };
    }
  }

  // Archive old data before cleanup
  async archiveOldData() {
    try {
      if (!fs.existsSync(this.logFile)) return;

      const logs = JSON.parse(fs.readFileSync(this.logFile, "utf8"));
      const cutoffDate = new Date(Date.now() - (MONITORING_CONFIG.dataRetentionDays * 24 * 60 * 60 * 1000));
      
      const oldLogs = logs.filter(log => {
        const logDate = new Date(log.timestamp);
        return logDate <= cutoffDate;
      });

      if (oldLogs.length > 0) {
        const archiveFile = `./archives/monitor_logs_${Date.now()}.json`;
        
        // Create archives directory if it doesn't exist
        const archivesDir = path.dirname(archiveFile);
        if (!fs.existsSync(archivesDir)) {
          fs.mkdirSync(archivesDir, { recursive: true });
        }

        fs.writeFileSync(archiveFile, JSON.stringify(oldLogs, null, 2));
        console.log(`📦 Archived ${oldLogs.length} old entries to ${archiveFile}`);
      }
    } catch (error) {
      logError(error, { operation: 'archiveOldData' }, ERROR_LEVELS.LOW);
      console.error("❌ Archive failed:", error.message);
    }
  }
}

// Auto-cleanup scheduler
export function startCleanupScheduler(cleanup) {
  console.log(`⏰ Starting cleanup scheduler (every ${MONITORING_CONFIG.cleanupInterval / 60000} minutes)`);
  
  // Run cleanup immediately
  cleanup.cleanupData();
  
  // Schedule regular cleanup
  setInterval(() => {
    cleanup.cleanupData();
  }, MONITORING_CONFIG.cleanupInterval);
}
