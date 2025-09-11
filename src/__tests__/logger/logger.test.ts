import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { LogLevel, LogOutput } from '../../logger';
import { Logger } from '../../logger';
import type { LoggerConfig } from '../../types/logger';
import chalk from 'chalk';

describe('Logger', () => {
  let logger: Logger;
  let mockConsoleLog: ReturnType<typeof vi.spyOn>;
  let mockConsoleError: ReturnType<typeof vi.spyOn>;
  let mockConsoleWarn: ReturnType<typeof vi.spyOn>;
  let mockConsoleInfo: ReturnType<typeof vi.spyOn>;
  let mockConsoleDebug: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockConsoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockConsoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {});
    // console.debug might not exist in some environments, create it if needed
    if (!console.debug) {
      console.debug = console.log;
    }
    mockConsoleDebug = vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Logger Initialization', () => {
    it('should create logger with default config', () => {
      logger = new Logger();

      expect(logger).toBeDefined();
      expect(logger.getLevel()).toBe('info');
      expect(logger.getFormat()).toBe('text');
    });

    it('should create logger with custom config', () => {
      const config: LoggerConfig = {
        level: 'debug',
        format: 'json',
        colors: false,
        timestamps: true,
      };

      logger = new Logger(config);

      expect(logger.getLevel()).toBe('debug');
      expect(logger.getFormat()).toBe('json');
    });

    it('should validate log level', () => {
      expect(() => {
        new Logger({ level: 'invalid' as LogLevel });
      }).toThrow('Invalid log level');
    });
  });

  describe('Log Levels', () => {
    beforeEach(() => {
      logger = new Logger({ level: 'info' });
    });

    it('should log error messages', () => {
      logger.error('Error message');
      expect(mockConsoleError).toHaveBeenCalled();
    });

    it('should log warn messages', () => {
      logger.warn('Warning message');
      expect(mockConsoleWarn).toHaveBeenCalled();
    });

    it('should log info messages', () => {
      logger.info('Info message');
      expect(mockConsoleInfo).toHaveBeenCalled();
    });

    it('should not log debug messages when level is info', () => {
      logger.debug('Debug message');
      expect(mockConsoleDebug).not.toHaveBeenCalled();
    });

    it('should log debug messages when level is debug', () => {
      logger.setLevel('debug');
      logger.debug('Debug message');
      expect(mockConsoleDebug).toHaveBeenCalled();
    });

    it('should not log trace messages when level is debug', () => {
      logger.setLevel('debug');
      logger.trace('Trace message');
      expect(mockConsoleLog).not.toHaveBeenCalled();
    });

    it('should log trace messages when level is trace', () => {
      logger.setLevel('trace');
      logger.trace('Trace message');
      expect(mockConsoleLog).toHaveBeenCalled();
    });

    it('should respect log level hierarchy', () => {
      logger.setLevel('warn');

      logger.error('Should log');
      logger.warn('Should log');
      logger.info('Should not log');
      logger.debug('Should not log');

      expect(mockConsoleError).toHaveBeenCalledTimes(1);
      expect(mockConsoleWarn).toHaveBeenCalledTimes(1);
      expect(mockConsoleInfo).not.toHaveBeenCalled();
      expect(mockConsoleDebug).not.toHaveBeenCalled();
    });
  });

  describe('Log Formatting', () => {
    it('should format logs as text', () => {
      logger = new Logger({ format: 'text', timestamps: false, colors: false });

      logger.info('Test message');

      expect(mockConsoleInfo).toHaveBeenCalledWith(
        expect.stringContaining('[INFO] Test message')
      );
    });

    it('should format logs as JSON', () => {
      logger = new Logger({ format: 'json', timestamps: false });

      logger.info('Test message');

      const call = mockConsoleInfo.mock.calls[0][0] as string;
      const parsed = JSON.parse(call);

      expect(parsed.level).toBe('info');
      expect(parsed.message).toBe('Test message');
    });

    it('should include timestamps when enabled', () => {
      logger = new Logger({ format: 'text', timestamps: true, colors: false });

      logger.info('Test message');

      const call = mockConsoleInfo.mock.calls[0][0];
      // Should contain ISO timestamp
      expect(call).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should apply colors when enabled', () => {
      logger = new Logger({ format: 'text', colors: true, timestamps: false });

      logger.error('Error');
      logger.warn('Warning');
      logger.info('Info');

      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining(chalk.red('[ERROR]'))
      );
      expect(mockConsoleWarn).toHaveBeenCalledWith(
        expect.stringContaining(chalk.yellow('[WARN]'))
      );
      expect(mockConsoleInfo).toHaveBeenCalledWith(
        expect.stringContaining(chalk.blue('[INFO]'))
      );
    });

    it('should format with pretty print', () => {
      logger = new Logger({ format: 'pretty', colors: true });

      logger.info('Test', { key: 'value', nested: { data: true } });

      const call = mockConsoleInfo.mock.calls[0][0];
      expect(call).toContain('Test');
      expect(call).toContain('key');
      expect(call).toContain('value');
    });
  });

  describe('Log Context', () => {
    it('should log with additional context', () => {
      logger = new Logger({ format: 'json' });

      logger.info('User action', { userId: '123', action: 'login' });

      const call = mockConsoleInfo.mock.calls[0][0] as string;
      const parsed = JSON.parse(call);

      expect(parsed.message).toBe('User action');
      expect(parsed.context.userId).toBe('123');
      expect(parsed.context.action).toBe('login');
    });

    it('should log errors with stack traces', () => {
      logger = new Logger({ format: 'json' });

      const error = new Error('Test error');
      logger.error('Operation failed', { error });

      const call = mockConsoleError.mock.calls[0][0] as string;
      const parsed = JSON.parse(call);

      expect(parsed.message).toBe('Operation failed');
      expect(parsed.context.error).toContain('Test error');
      expect(parsed.stack).toBeDefined();
    });

    it('should handle circular references in context', () => {
      logger = new Logger({ format: 'json' });

      interface CircularRef extends Record<string, unknown> {
        a: number;
        self?: CircularRef;
      }

      const circular: CircularRef = { a: 1 };
      circular.self = circular;

      expect(() => {
        logger.info('Circular test', circular);
      }).not.toThrow();
    });
  });

  describe('Multiple Outputs', () => {
    it('should support multiple output targets', () => {
      const outputs: LogOutput[] = [
        { type: 'console', level: 'info' },
        { type: 'file', level: 'error', path: './test.log' },
      ];

      logger = new Logger({ outputs });

      expect(logger.getOutputs()).toHaveLength(2);
    });

    it('should respect output-specific log levels', () => {
      const mockFileWrite = vi.fn();

      const outputs: LogOutput[] = [
        { type: 'console', level: 'debug' },
        {
          type: 'custom',
          level: 'error',
          handler: mockFileWrite,
        },
      ];

      logger = new Logger({ outputs });

      logger.info('Info message');
      logger.error('Error message');

      // Console should get both
      expect(mockConsoleInfo).toHaveBeenCalled();
      expect(mockConsoleError).toHaveBeenCalled();

      // Custom handler should only get error
      expect(mockFileWrite).toHaveBeenCalledTimes(1);
      expect(mockFileWrite).toHaveBeenCalledWith(
        expect.objectContaining({ level: 'error' })
      );
    });
  });

  describe('Child Loggers', () => {
    it('should create child logger with prefix', () => {
      logger = new Logger({ format: 'text', colors: false, timestamps: false });

      const child = logger.child('[Module]');
      child.info('Child message');

      expect(mockConsoleInfo).toHaveBeenCalledWith(
        expect.stringContaining('[INFO] [Module] Child message')
      );
    });

    it('should inherit parent configuration', () => {
      logger = new Logger({ level: 'debug', format: 'json' });

      const child = logger.child('[Child]');

      expect(child.getLevel()).toBe('debug');
      expect(child.getFormat()).toBe('json');
    });

    it('should allow child to override configuration', () => {
      logger = new Logger({ level: 'info' });

      const child = logger.child('[Child]', { level: 'debug' });

      expect(child.getLevel()).toBe('debug');
      expect(logger.getLevel()).toBe('info'); // Parent unchanged
    });
  });

  describe('Performance', () => {
    it('should measure and log execution time', async () => {
      logger = new Logger({ level: 'debug', format: 'json' });

      const timer = logger.time('operation');

      await new Promise(resolve => setTimeout(resolve, 50));

      timer.end();

      const call = mockConsoleDebug.mock.calls[0][0] as string;
      const parsed = JSON.parse(call);

      expect(parsed.message).toContain('operation');
      expect(parsed.duration).toBeGreaterThanOrEqual(50);
    });

    it('should support nested timers', () => {
      logger = new Logger({ level: 'debug' });

      const outer = logger.time('outer');
      const inner = logger.time('inner');

      inner.end();
      outer.end();

      expect(mockConsoleDebug).toHaveBeenCalledTimes(2);
    });
  });

  describe('Log Filtering', () => {
    it('should filter logs by pattern', () => {
      logger = new Logger({
        filter: log => !log.message.includes('skip'),
      });

      logger.info('Show this');
      logger.info('skip this');
      logger.info('Show this too');

      expect(mockConsoleInfo).toHaveBeenCalledTimes(2);
    });

    it('should filter logs by metadata', () => {
      logger = new Logger({
        format: 'json',
        filter: log => log.context?.important === true,
      });

      logger.info('Not important', { important: false });
      logger.info('Important', { important: true });

      expect(mockConsoleInfo).toHaveBeenCalledTimes(1);
    });
  });

  describe('Global Logger', () => {
    it('should provide singleton instance', () => {
      const logger1 = Logger.getInstance();
      const logger2 = Logger.getInstance();

      expect(logger1).toBe(logger2);
    });

    it('should allow global configuration', () => {
      Logger.configure({ level: 'trace' });

      const instance = Logger.getInstance();
      expect(instance.getLevel()).toBe('trace');
    });
  });
});
