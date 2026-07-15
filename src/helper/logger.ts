import * as fs from "fs";
import * as path from "path";

/**
 * Simple file-based logger for MCP server
 * Logs to a file only if LOG_FILE_PATH environment variable is set
 * Otherwise logs to console only
 */
class Logger {
  private logFilePath: string | null;
  private writeStream: fs.WriteStream | null = null;

  constructor() {
    // Only use file logging if user explicitly configures LOG_FILE_PATH
    this.logFilePath = process.env.LOG_FILE_PATH || null;
    this.initializeLogFile();
  }

  /**
   * Initialize the log file and write stream
   * Only creates file stream if logFilePath is configured
   */
  private initializeLogFile(): void {
    if (!this.logFilePath) {
      // No logging at all if LOG_FILE_PATH is not configured
      return;
    }

    try {
      // Ensure the directory exists
      const logDir = path.dirname(this.logFilePath);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      // Create write stream (append mode)
      this.writeStream = fs.createWriteStream(this.logFilePath, { flags: "a" });

      // Add error handler to prevent process crash on write failures
      this.writeStream.on('error', (err) => {
        console.error('Log file write failed:', err.message);
        console.error('Disabling file logging. Logs will only appear in console.');
        // Close the failed stream and disable file logging
        if (this.writeStream) {
          this.writeStream.end();
          this.writeStream = null;
        }
      });

      // Log the initialization
      this.log("INFO", `Logger initialized. Log file: ${this.logFilePath}`);
    } catch (error) {
      // Fallback to console if file logging fails
      console.error("Failed to initialize log file:", error);
      console.error("Falling back to console logging only");
      this.writeStream = null;
    }
  }

  /**
   * Format a log message with timestamp and level
   */
  private formatMessage(level: string, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level}] ${message}\n`;
  }

  /**
   * Write a log message to file and console
   * Does nothing if logging is not configured
   */
  private log(level: string, message: string): void {
    const formattedMessage = this.formatMessage(level, message);

    if (!this.writeStream) {
      if (level === "ERROR" || level === "WARN") {
        process.stderr.write(formattedMessage);
      }
      return;
    }

    process.stderr.write(formattedMessage);
    this.writeStream.write(formattedMessage);
  }

  /**
   * Log an info message
   */
  info(message: string, data?: unknown): void {
    let fullMessage = message;
    if (data !== undefined && data !== null) {
      const dataStr = typeof data === "string" ? data : JSON.stringify(data);
      fullMessage += ` ${dataStr}`;
    }
    this.log("INFO", fullMessage);
  }

  /**
   * Log an error message
   */
  error(message: string, error?: Error | unknown): void {
    let errorMessage = message;
    if (error instanceof Error) {
      errorMessage += ` - ${error.message}`;
      if (error.stack) {
        errorMessage += `\nStack trace: ${error.stack}`;
      }
    } else if (error !== undefined && error !== null) {
      errorMessage += ` - ${String(error)}`;
    }
    this.log("ERROR", errorMessage);
  }

  /**
   * Log a warning message
   */
  warn(message: string, data?: unknown): void {
    let fullMessage = message;
    if (data !== undefined && data !== null) {
      const dataStr = typeof data === "string" ? data : JSON.stringify(data);
      fullMessage += ` ${dataStr}`;
    }
    this.log("WARN", fullMessage);
  }

  /**
   * Log a debug message
   */
  debug(message: string, data?: unknown): void {
    let fullMessage = message;
    if (data !== undefined && data !== null) {
      const dataStr = typeof data === "string" ? data : JSON.stringify(data);
      fullMessage += ` ${dataStr}`;
    }
    this.log("DEBUG", fullMessage);
  }

  /**
   * Get the current log file path (null if file logging is disabled)
   */
  getLogFilePath(): string | null {
    return this.logFilePath;
  }

  /**
   * Close the log file stream
   */
  close(): void {
    if (this.writeStream) {
      this.writeStream.end();
      this.writeStream = null;
    }
  }
}

// Export a singleton instance
export const logger = new Logger();