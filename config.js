import dotenv from "dotenv";
dotenv.config();

// Website monitoring configuration
export const WEBSITES = [];


// Monitoring settings
export const MONITORING_CONFIG = {
  // Check interval in milliseconds (30 seconds)
  interval: parseInt(process.env.MONITOR_INTERVAL) || 20000,
  
  // Slow request threshold in milliseconds
  slowThreshold: parseInt(process.env.SLOW_THRESHOLD) || 2000,
  
  // Request timeout in milliseconds
  requestTimeout: parseInt(process.env.REQUEST_TIMEOUT) || 10000,
  
  // Daily report time (24-hour format)
  reportHour: parseInt(process.env.REPORT_HOUR) || 21,
  reportMinute: parseInt(process.env.REPORT_MINUTE) || 13 ,
  
  // Server settings
  serverPort: parseInt(process.env.PORT) || 3000,
  collectEndpoint: process.env.COLLECT_ENDPOINT || "http://127.0.0.1:3000/collect",
  
  // Data retention settings
  dataRetentionDays: parseInt(process.env.DATA_RETENTION_DAYS) || 7, // Keep data for 7 days
  maxEntriesPerSite: parseInt(process.env.MAX_ENTRIES_PER_SITE) || 1000, // Max entries per website
  cleanupInterval: parseInt(process.env.CLEANUP_INTERVAL) || 3600000 // Cleanup every hour
};

// Email configuration
export const EMAIL_CONFIG = {
  user: process.env.EMAIL_USER,
  pass: process.env.EMAIL_PASS,
  reportEmail: process.env.REPORT_EMAIL,
  service: process.env.EMAIL_SERVICE || "gmail"
};

// Performance thresholds for rating system
export const PERFORMANCE_THRESHOLDS = {
  excellent: { maxResponseTime: 300, maxStatusCode: 299 },
  acceptable: { maxResponseTime: 800, maxStatusCode: 399 },
  concerning: { maxResponseTime: 1500, maxStatusCode: 499 },
  critical: { maxResponseTime: Infinity, maxStatusCode: Infinity }
};

// Validate required environment variables
export function validateEnvironment() {
  const required = ['EMAIL_USER', 'EMAIL_PASS', 'REPORT_EMAIL'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  
  console.log("✅ Environment validation passed");
}

// Get website configuration with optional overrides
export function getWebsiteConfig(website) {
  return {
    url: website,
    enabled: true,
    // Add per-website custom settings here if needed
    customTimeout: null,
    customThresholds: null
  };
}
