import * as fs from 'fs';
import * as path from 'path';

export class Logger {
  private static instance: Logger | undefined;
  private logFile: string;
  private isStdioMode: boolean = false;

  private constructor() {
    const date = new Date().toISOString().split('T')[0];
    const sessionId = Math.random().toString(36).substring(2, 8);
    this.logFile = path.join('/tmp', `.log.nexus.${date}-${sessionId}`);

    // Create log file if it doesn't exist
    this.ensureLogFile();
  }

  static getInstance(): Logger {
    Logger.instance ??= new Logger();
    return Logger.instance;
  }

  setStdioMode(enabled: boolean): void {
    this.isStdioMode = enabled;
  }

  private ensureLogFile(): void {
    try {
      if (!fs.existsSync(this.logFile)) {
        fs.writeFileSync(
          this.logFile,
          `[${new Date().toISOString()}] Project Nexus MCP Server Log Started\n`,
        );
      }
    } catch {
      // Fallback to stderr if we can't create log file
      if (!this.isStdioMode) {
        console.error('Failed to create log file, falling back to stderr');
      }
    }
  }

  private writeToFile(level: string, message: string, ...args: unknown[]): void {
    try {
      const timestamp = new Date().toISOString();
      const formattedMessage =
        args.length > 0
          ? `${message} ${args
              .map((arg) =>
                typeof arg === 'object' && arg !== null
                  ? JSON.stringify(arg, null, 2)
                  : String(arg),
              )
              .join(' ')}`
          : message;

      const logLine = `[${timestamp}] [${level}] ${formattedMessage}\n`;
      fs.appendFileSync(this.logFile, logLine);
    } catch {
      // Silent fail - don't pollute stderr in STDIO mode
      if (!this.isStdioMode) {
        console.error('Failed to write to log file');
      }
    }
  }

  log(message: string, ...args: unknown[]): void {
    if (this.isStdioMode) {
      this.writeToFile('INFO', message, ...args);
    } else {
      console.log(message, ...args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.isStdioMode) {
      this.writeToFile('ERROR', message, ...args);
    } else {
      console.error(message, ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.isStdioMode) {
      this.writeToFile('WARN', message, ...args);
    } else {
      console.warn(message, ...args);
    }
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.isStdioMode) {
      this.writeToFile('DEBUG', message, ...args);
    } else {
      console.debug(message, ...args);
    }
  }

  getLogFile(): string {
    return this.logFile;
  }
}

// Global logger instance
export const logger = Logger.getInstance();
