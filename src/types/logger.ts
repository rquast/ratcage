/**
 * Log levels in order of severity
 */
export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

/**
 * Log output format types
 */
export type LogFormat = 'text' | 'json' | 'pretty';

/**
 * Log output target configuration
 */
export interface LogOutput {
  type: 'console' | 'file' | 'syslog' | 'custom';
  level?: LogLevel;
  path?: string;
  maxSize?: string;
  maxFiles?: number;
  handler?: (log: LogEntry) => void;
}

/**
 * Logger configuration
 */
export interface LoggerConfig {
  level?: LogLevel;
  format?: LogFormat;
  outputs?: LogOutput[];
  colors?: boolean;
  timestamps?: boolean;
  filter?: (log: LogEntry) => boolean;
}

/**
 * Log entry structure
 */
export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp?: Date;
  context?: Record<string, unknown>;
  stack?: string;
  prefix?: string;
  duration?: number;
}

/**
 * Timer interface for performance measurement
 */
export interface Timer {
  end(): void;
  elapsed(): number;
}
