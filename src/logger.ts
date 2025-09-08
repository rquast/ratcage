import winston from 'winston';
import Transport from 'winston-transport';
import chalk from 'chalk';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import type {
  LoggerConfig,
  LogLevel,
  LogFormat,
  LogOutput,
  LogEntry,
  Timer,
} from './types/logger';

// Custom console transport that calls actual console methods
class ConsoleTransport extends Transport {
  constructor(opts: winston.transport.TransportStreamOptions = {}) {
    super(opts);
  }

  log(info: winston.LogEntry, callback: () => void) {
    setImmediate(() => {
      this.emit('logged', info);
    });

    // Call appropriate console method based on level
    const message =
      (info[Symbol.for('message')] as string) ?? JSON.stringify(info);

    switch (info.level) {
      case 'error':
        console.error(message);
        break;
      case 'warn':
        console.warn(message);
        break;
      case 'info':
        console.info(message);
        break;
      case 'debug':
        if (console.debug) {
          console.debug(message);
        } else {
          console.log(message);
        }
        break;
      case 'trace':
        console.log(message);
        break;
      default:
        console.log(message);
    }

    callback();
  }
}

// Winston level mapping to our custom levels
const WINSTON_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
};

// Color mapping for different log levels
const LEVEL_COLORS = {
  error: chalk.red,
  warn: chalk.yellow,
  info: chalk.blue,
  debug: chalk.gray,
  trace: chalk.gray,
};

export class Logger {
  private winston: winston.Logger;
  private config: Required<LoggerConfig>;
  private static instance?: Logger;
  private prefix?: string;
  private activeTimers = new Map<string, number>();

  constructor(config: LoggerConfig = {}, prefix?: string) {
    this.prefix = prefix;
    this.config = this.mergeDefaultConfig(config);
    this.validateLogLevel(this.config.level);
    this.winston = this.createWinstonLogger();
  }

  private mergeDefaultConfig(config: LoggerConfig): Required<LoggerConfig> {
    return {
      level: config.level ?? 'info',
      format: config.format ?? 'text',
      outputs: config.outputs ?? [{ type: 'console' }],
      colors: config.colors !== false,
      timestamps: config.timestamps !== false,
      filter: config.filter ?? (() => true),
    };
  }

  private createWinstonLogger(): winston.Logger {
    const transports: winston.transport[] = [];

    // Process outputs to create Winston transports
    for (const output of this.config.outputs) {
      switch (output.type) {
        case 'console':
          transports.push(
            new ConsoleTransport({
              level: output.level ?? this.config.level,
              format: this.createWinstonFormat(),
            })
          );
          break;
        case 'file':
          if (output.path) {
            // Ensure directory exists
            const dir = dirname(output.path);
            if (!existsSync(dir)) {
              mkdirSync(dir, { recursive: true });
            }

            transports.push(
              new winston.transports.File({
                filename: output.path,
                level: output.level ?? this.config.level,
                format: winston.format.combine(
                  winston.format.timestamp(),
                  winston.format.json()
                ),
                maxsize: this.parseMaxSize(output.maxSize),
                maxFiles: output.maxFiles ?? 5,
              })
            );
          }
          break;
        case 'custom':
          if (output.handler) {
            // Create a custom transport for the handler
            class CustomHandlerTransport extends Transport {
              private handler: (log: LogEntry) => void;

              constructor(
                opts: winston.transport.TransportStreamOptions & {
                  handler: (log: LogEntry) => void;
                }
              ) {
                super(opts);
                this.handler = opts.handler;
              }

              log(info: winston.LogEntry, callback: () => void) {
                setImmediate(() => {
                  this.emit('logged', info);
                });

                const entry: LogEntry = {
                  level: info.level as LogLevel,
                  message: info.message,
                  timestamp: new Date(info.timestamp as string),
                  context: { ...info },
                };

                this.handler(entry);
                callback();
              }
            }

            transports.push(
              new CustomHandlerTransport({
                level: output.level ?? this.config.level,
                handler: output.handler,
              })
            );
          }
          break;
      }
    }

    return winston.createLogger({
      levels: WINSTON_LEVELS,
      level: this.config.level,
      transports,
      silent: false,
    });
  }

  private createWinstonFormat(): winston.Logform.Format {
    const formats: winston.Logform.Format[] = [];

    if (this.config.timestamps) {
      formats.push(winston.format.timestamp());
    }

    if (this.config.format === 'json') {
      formats.push(winston.format.json());
    } else if (this.config.format === 'pretty') {
      formats.push(
        winston.format.prettyPrint({
          colorize: this.config.colors,
        })
      );
    } else {
      // Text format
      formats.push(
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const levelLabel = `[${level.toUpperCase()}]`;
          const coloredLevel = this.config.colors
            ? LEVEL_COLORS[level as LogLevel](levelLabel)
            : levelLabel;

          const prefix = this.prefix ? ` ${this.prefix}` : '';
          const timestampStr =
            timestamp && this.config.timestamps ? `${timestamp} ` : '';

          const metaStr =
            Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';

          return `${timestampStr}${coloredLevel}${prefix} ${message}${metaStr}`;
        })
      );
    }

    return winston.format.combine(...formats);
  }

  private parseMaxSize(maxSize?: string): number | undefined {
    if (!maxSize) {
      return undefined;
    }

    const match = maxSize.match(/^(\d+)([kmg]?)b?$/i);
    if (!match) {
      return undefined;
    }

    const value = parseInt(match[1]);
    const unit = match[2]?.toLowerCase() ?? '';

    switch (unit) {
      case 'k':
        return value * 1024;
      case 'm':
        return value * 1024 * 1024;
      case 'g':
        return value * 1024 * 1024 * 1024;
      default:
        return value;
    }
  }

  private shouldLog(level: LogLevel): boolean {
    const levelOrder = Object.keys(WINSTON_LEVELS) as LogLevel[];
    const currentLevelIndex = levelOrder.indexOf(this.config.level);
    const messageLevelIndex = levelOrder.indexOf(level);
    return messageLevelIndex <= currentLevelIndex;
  }

  private logWithLevel(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>
  ): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date(),
      context,
      prefix: this.prefix,
    };

    // Apply filter if configured
    if (!this.config.filter(entry)) {
      return;
    }

    // Handle circular references in context
    let safeContext = context;
    if (context) {
      try {
        JSON.stringify(context);
      } catch {
        safeContext = this.sanitizeCircularRefs(context) as Record<
          string,
          unknown
        >;
      }
    }

    // Extract error stack if present
    let stack: string | undefined;
    if (safeContext?.error instanceof Error) {
      stack = safeContext.error.stack;
      safeContext.error = safeContext.error.message;
    }

    const logData: Record<string, unknown> = {
      level,
      message,
      timestamp: entry.timestamp.toISOString(),
    };

    // Add context if present
    if (safeContext && Object.keys(safeContext).length > 0) {
      logData.context = safeContext;
    }

    // Add stack trace if present
    if (stack) {
      logData.stack = stack;
    }

    this.winston.log(logData);
  }

  private sanitizeCircularRefs(obj: unknown, seen = new WeakSet()): unknown {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }
    if (seen.has(obj)) {
      return '[Circular]';
    }

    seen.add(obj);

    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeCircularRefs(item, seen));
    }

    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    const result: Record<string, unknown> = {};
    const objRecord = obj as Record<string, unknown>;
    for (const key in objRecord) {
      if (Object.prototype.hasOwnProperty.call(objRecord, key)) {
        result[key] = this.sanitizeCircularRefs(objRecord[key], seen);
      }
    }

    return result;
  }

  // Public logging methods
  error(message: string, context?: Record<string, unknown>): void {
    this.logWithLevel('error', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.logWithLevel('warn', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.logWithLevel('info', message, context);
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.logWithLevel('debug', message, context);
  }

  trace(message: string, context?: Record<string, unknown>): void {
    this.logWithLevel('trace', message, context);
  }

  // Configuration getters and setters
  getLevel(): LogLevel {
    return this.config.level;
  }

  setLevel(level: LogLevel): void {
    this.validateLogLevel(level);
    this.config.level = level;
    this.winston.level = level;

    // Update transport levels as well
    this.winston.transports.forEach(transport => {
      transport.level = level;
    });
  }

  getFormat(): LogFormat {
    return this.config.format;
  }

  getOutputs(): LogOutput[] {
    return this.config.outputs;
  }

  private validateLogLevel(level: LogLevel): void {
    const validLevels = Object.keys(WINSTON_LEVELS) as LogLevel[];
    if (!validLevels.includes(level)) {
      throw new Error(
        `Invalid log level: ${level}. Valid levels: ${validLevels.join(', ')}`
      );
    }
  }

  // Child logger creation
  child(prefix: string, config?: Partial<LoggerConfig>): Logger {
    const childConfig = config ? { ...this.config, ...config } : this.config;
    return new Logger(childConfig, prefix);
  }

  // Performance timing
  time(label: string): Timer {
    const start = Date.now();
    this.activeTimers.set(label, start);

    return {
      end: () => {
        const startTime = this.activeTimers.get(label);
        if (startTime) {
          const duration = Date.now() - startTime;
          this.activeTimers.delete(label);

          // For JSON format, we need to include duration in the main log data, not just context
          const logData: Record<string, unknown> = {
            level: 'debug',
            message: `${label} completed`,
            timestamp: new Date().toISOString(),
            duration,
          };

          this.winston.log(logData);
        }
      },
      elapsed: () => {
        const startTime = this.activeTimers.get(label);
        return startTime ? Date.now() - startTime : 0;
      },
    };
  }

  // Static methods for global logger
  static getInstance(): Logger {
    Logger.instance ??= new Logger();
    return Logger.instance;
  }

  static configure(config: LoggerConfig): void {
    Logger.instance = new Logger(config);
  }
}

// Export types and level constants for convenience
export { LogLevel, LogFormat, LogOutput } from './types/logger';
export const LOG_LEVELS = Object.keys(WINSTON_LEVELS) as LogLevel[];
