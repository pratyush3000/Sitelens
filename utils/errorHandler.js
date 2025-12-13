import fs from "fs";
import path from "path";

// Error logging configuration
const ERROR_LOG_FILE = path.join(process.cwd(), "error_logs.json");

// Error severity levels
export const ERROR_LEVELS = {
  LOW: "low",
  MEDIUM: "medium", 
  HIGH: "high",
  CRITICAL: "critical"
};

// Enhanced error logging
export function logError(error, context = {}, severity = ERROR_LEVELS.MEDIUM) {
  const errorEntry = {
    timestamp: new Date().toISOString(),
    severity,
    message: error.message,
    stack: error.stack,
    context,
    type: error.constructor.name
  };

  try {
    let existing = [];
    if (fs.existsSync(ERROR_LOG_FILE)) {
      existing = JSON.parse(fs.readFileSync(ERROR_LOG_FILE, "utf8"));
    }
    
    existing.push(errorEntry);
    
    // Keep only last 1000 errors to prevent file from growing too large
    if (existing.length > 1000) {
      existing = existing.slice(-1000);
    }
    
    fs.writeFileSync(ERROR_LOG_FILE, JSON.stringify(existing, null, 2));
    
    console.error(`❌ [${severity.toUpperCase()}] ${error.message}`, context);
  } catch (logError) {
    console.error("Failed to log error:", logError.message);
  }
}

// Retry logic with exponential backoff
export async function retryOperation(operation, maxRetries = 3, baseDelay = 1000) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      if (attempt === maxRetries) {
        logError(error, { 
          operation: operation.name || 'unknown',
          attempts: maxRetries 
        }, ERROR_LEVELS.HIGH);
        throw error;
      }
      
      const delay = baseDelay * Math.pow(2, attempt - 1);
      console.warn(`⚠️ Attempt ${attempt} failed, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

// Safe file operations with backup
export function safeFileOperation(operation, backupPath = null) {
  return async (...args) => {
    try {
      return await operation(...args);
    } catch (error) {
      logError(error, { 
        operation: operation.name,
        args: args.length 
      }, ERROR_LEVELS.MEDIUM);
      
      // Attempt backup recovery if backup path provided
      if (backupPath && fs.existsSync(backupPath)) {
        try {
          console.log("🔄 Attempting backup recovery...");
          const backupData = fs.readFileSync(backupPath, "utf8");
          // Restore from backup logic would go here
          return JSON.parse(backupData);
        } catch (backupError) {
          logError(backupError, { backupPath }, ERROR_LEVELS.HIGH);
        }
      }
      
      throw error;
    }
  };
}

// Circuit breaker pattern for external services
export class CircuitBreaker {
  constructor(threshold = 5, timeout = 60000) {
    this.failureThreshold = threshold;
    this.timeout = timeout;
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
  }

  async execute(operation) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error('Circuit breaker is OPEN - service unavailable');
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  onSuccess() {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      logError(new Error('Circuit breaker opened'), { 
        failureCount: this.failureCount 
      }, ERROR_LEVELS.HIGH);
    }
  }
}

// Health check function
export function performHealthCheck() {
  const health = {
    timestamp: new Date().toISOString(),
    status: 'healthy',
    services: {},
    errors: []
  };

  // Check if log files are accessible
  try {
    const logFile = path.join(process.cwd(), "monitor_logs.json");
    if (fs.existsSync(logFile)) {
      fs.accessSync(logFile, fs.constants.R_OK | fs.constants.W_OK);
      health.services.logFile = 'healthy';
    } else {
      health.services.logFile = 'missing';
    }
  } catch (error) {
    health.services.logFile = 'error';
    health.errors.push(`Log file access error: ${error.message}`);
  }

  // Check error log
  try {
    if (fs.existsSync(ERROR_LOG_FILE)) {
      const errorData = JSON.parse(fs.readFileSync(ERROR_LOG_FILE, "utf8"));
      const recentErrors = errorData.filter(e => 
        new Date(e.timestamp) > new Date(Date.now() - 3600000) // Last hour
      );
      health.services.errorLog = recentErrors.length > 0 ? 'warnings' : 'healthy';
    } else {
      health.services.errorLog = 'healthy';
    }
  } catch (error) {
    health.services.errorLog = 'error';
    health.errors.push(`Error log access error: ${error.message}`);
  }

  if (health.errors.length > 0) {
    health.status = 'degraded';
  }

  return health;
}
