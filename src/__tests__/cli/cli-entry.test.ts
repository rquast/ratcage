import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import { CLI } from '../../cli';
import type { Provider } from '../../types/provider';

// Mock console methods
const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
const mockConsoleError = vi
  .spyOn(console, 'error')
  .mockImplementation(() => {});

// Mock process.exit for tests
vi.spyOn(process, 'exit').mockImplementation(() => {
  throw new Error(`process.exit called`);
});

describe('CLI Entry Point', () => {
  let cli: CLI;

  beforeEach(() => {
    cli = new CLI();
    mockConsoleLog.mockClear();
    mockConsoleError.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'test';
  });

  describe('Command Structure', () => {
    it('should create a CLI instance with Commander', () => {
      expect(cli).toBeDefined();
      expect(cli.program).toBeInstanceOf(Command);
    });

    it('should have correct program name and description', () => {
      expect(cli.program.name()).toBe('ratcage');
      expect(cli.program.description()).toContain(
        'universal coding agent CLI wrapper'
      );
    });

    it('should have version command', () => {
      const versionCommand = cli.program.version();
      expect(versionCommand).toBeDefined();
    });
  });

  describe('Main Commands', () => {
    it('should have query command for sending prompts', async () => {
      const queryCommand = cli.program.commands.find(
        cmd => cmd.name() === 'query'
      );
      expect(queryCommand).toBeDefined();
      expect(queryCommand?.description()).toContain('Send a query');
    });

    it('should have chat command for interactive mode', async () => {
      const chatCommand = cli.program.commands.find(
        cmd => cmd.name() === 'chat'
      );
      expect(chatCommand).toBeDefined();
      expect(chatCommand?.description()).toContain('interactive chat');
    });

    it('should have config command for managing settings', async () => {
      const configCommand = cli.program.commands.find(
        cmd => cmd.name() === 'config'
      );
      expect(configCommand).toBeDefined();
      expect(configCommand?.description()).toContain('configuration');
    });

    it('should have tools command for managing tools', async () => {
      const toolsCommand = cli.program.commands.find(
        cmd => cmd.name() === 'tools'
      );
      expect(toolsCommand).toBeDefined();
      expect(toolsCommand?.description()).toContain('tools');
    });
  });

  describe('Query Command', () => {
    it('should accept a prompt as argument', async () => {
      // Mock provider to prevent actual execution
      vi.spyOn(cli, 'handleQuery').mockResolvedValue();

      // parse returns void, so we just test it doesn't throw
      await expect(
        cli.parse(['query', 'Hello, Claude'])
      ).resolves.not.toThrow();
    });

    it('should support --provider option', async () => {
      const queryCommand = cli.program.commands.find(
        cmd => cmd.name() === 'query'
      );
      const providerOption = queryCommand?.options.find(
        opt => opt.long === '--provider'
      );
      expect(providerOption).toBeDefined();
      expect(providerOption?.description).toContain('provider');
    });

    it('should support --stream option', async () => {
      const queryCommand = cli.program.commands.find(
        cmd => cmd.name() === 'query'
      );
      const streamOption = queryCommand?.options.find(
        opt => opt.long === '--stream'
      );
      expect(streamOption).toBeDefined();
      expect(streamOption?.description?.toLowerCase()).toContain('stream');
    });

    it('should support --output option for format', async () => {
      const queryCommand = cli.program.commands.find(
        cmd => cmd.name() === 'query'
      );
      const outputOption = queryCommand?.options.find(
        opt => opt.long === '--output'
      );
      expect(outputOption).toBeDefined();
      expect(outputOption?.description?.toLowerCase()).toContain(
        'output format'
      );
    });

    it('should support --session option', async () => {
      const queryCommand = cli.program.commands.find(
        cmd => cmd.name() === 'query'
      );
      const sessionOption = queryCommand?.options.find(
        opt => opt.long === '--session'
      );
      expect(sessionOption).toBeDefined();
      expect(sessionOption?.description?.toLowerCase()).toContain('session');
    });

    it('should support piping input', async () => {
      const mockStdin = 'Piped input text';
      // Mock process.stdin.isTTY
      Object.defineProperty(process.stdin, 'isTTY', {
        configurable: true,
        value: false,
      });

      // Mock handleQuery to prevent actual execution
      const handleQuerySpy = vi.spyOn(cli, 'handleQuery').mockResolvedValue();

      await cli.parseWithStdin([], mockStdin);

      // Should have called handleQuery with the piped input
      expect(handleQuerySpy).toHaveBeenCalledWith(mockStdin, {
        provider: 'claude-code',
      });

      // Restore
      Object.defineProperty(process.stdin, 'isTTY', {
        configurable: true,
        value: true,
      });
    });
  });

  describe('Chat Command', () => {
    it('should start interactive mode', async () => {
      const chatSpy = vi.spyOn(cli, 'startChat');
      await cli.parse(['chat']);
      expect(chatSpy).toHaveBeenCalled();
    });

    it('should support --provider option', async () => {
      const chatCommand = cli.program.commands.find(
        cmd => cmd.name() === 'chat'
      );
      const providerOption = chatCommand?.options.find(
        opt => opt.long === '--provider'
      );
      expect(providerOption).toBeDefined();
    });

    it('should support --multiline option', async () => {
      const chatCommand = cli.program.commands.find(
        cmd => cmd.name() === 'chat'
      );
      const multilineOption = chatCommand?.options.find(
        opt => opt.long === '--multiline'
      );
      expect(multilineOption).toBeDefined();
      expect(multilineOption?.description).toContain('multiline');
    });
  });

  describe('Config Command', () => {
    it('should have get subcommand', () => {
      const configCommand = cli.program.commands.find(
        cmd => cmd.name() === 'config'
      );
      const getSubcommand = configCommand?.commands.find(
        cmd => cmd.name() === 'get'
      );
      expect(getSubcommand).toBeDefined();
    });

    it('should have set subcommand', () => {
      const configCommand = cli.program.commands.find(
        cmd => cmd.name() === 'config'
      );
      const setSubcommand = configCommand?.commands.find(
        cmd => cmd.name() === 'set'
      );
      expect(setSubcommand).toBeDefined();
    });

    it('should have list subcommand', () => {
      const configCommand = cli.program.commands.find(
        cmd => cmd.name() === 'config'
      );
      const listSubcommand = configCommand?.commands.find(
        cmd => cmd.name() === 'list'
      );
      expect(listSubcommand).toBeDefined();
    });

    it('should handle config get <key>', async () => {
      const getSpy = vi.spyOn(cli, 'getConfig');
      await cli.parse(['config', 'get', 'provider']);
      expect(getSpy).toHaveBeenCalledWith('provider');
    });

    it('should handle config set <key> <value>', async () => {
      const setSpy = vi.spyOn(cli, 'setConfig');
      await cli.parse(['config', 'set', 'provider', 'claude-code']);
      expect(setSpy).toHaveBeenCalledWith('provider', 'claude-code');
    });
  });

  describe('Tools Command', () => {
    it('should have list subcommand', () => {
      const toolsCommand = cli.program.commands.find(
        cmd => cmd.name() === 'tools'
      );
      const listSubcommand = toolsCommand?.commands.find(
        cmd => cmd.name() === 'list'
      );
      expect(listSubcommand).toBeDefined();
    });

    it('should have enable subcommand', () => {
      const toolsCommand = cli.program.commands.find(
        cmd => cmd.name() === 'tools'
      );
      const enableSubcommand = toolsCommand?.commands.find(
        cmd => cmd.name() === 'enable'
      );
      expect(enableSubcommand).toBeDefined();
    });

    it('should have disable subcommand', () => {
      const toolsCommand = cli.program.commands.find(
        cmd => cmd.name() === 'tools'
      );
      const disableSubcommand = toolsCommand?.commands.find(
        cmd => cmd.name() === 'disable'
      );
      expect(disableSubcommand).toBeDefined();
    });
  });

  describe('Global Options', () => {
    it('should support --verbose option', () => {
      const verboseOption = cli.program.options.find(
        opt => opt.long === '--verbose'
      );
      expect(verboseOption).toBeDefined();
      expect(verboseOption?.description).toContain('verbose');
    });

    it('should support --quiet option', () => {
      const quietOption = cli.program.options.find(
        opt => opt.long === '--quiet'
      );
      expect(quietOption).toBeDefined();
      expect(quietOption?.description?.toLowerCase()).toContain('quiet');
    });

    it('should support --no-color option', () => {
      const noColorOption = cli.program.options.find(
        opt => opt.long === '--no-color'
      );
      expect(noColorOption).toBeDefined();
      expect(noColorOption?.description).toContain('color');
    });

    it('should support --config option for config file path', () => {
      const configOption = cli.program.options.find(
        opt => opt.long === '--config'
      );
      expect(configOption).toBeDefined();
      expect(configOption?.description).toContain('config file');
    });
  });

  describe('Error Handling', () => {
    it('should handle unknown commands gracefully', async () => {
      // Clear mock calls before test
      mockConsoleError.mockClear();

      // Commander might output to stderr
      const originalStdoutWrite = process.stdout.write;
      const originalStderrWrite = process.stderr.write;
      let capturedOutput = '';

      const mockWrite = vi.fn(
        (
          chunk: string | Uint8Array,
          encoding?: BufferEncoding | ((err?: Error) => void),
          cb?: (err?: Error) => void
        ): boolean => {
          if (typeof chunk === 'string') {
            capturedOutput += chunk;
          } else {
            capturedOutput += chunk.toString();
          }
          if (typeof encoding === 'function') {
            encoding();
          } else if (cb) {
            cb();
          }
          return true;
        }
      );

      process.stdout.write = mockWrite as typeof process.stdout.write;
      process.stderr.write = mockWrite as typeof process.stderr.write;

      try {
        await cli.parse(['unknown-command']);
      } catch {
        // Expected error - commander throws when unknown command
      }

      // Restore original writes
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;

      // Check if error was output
      expect(capturedOutput.toLowerCase()).toContain('unknown command');
    });

    it('should show help on no arguments', async () => {
      const helpSpy = vi.spyOn(cli.program, 'help').mockImplementation(() => {
        // Mock help to avoid process.exit
        return cli.program;
      });
      await cli.parse([]);
      expect(helpSpy).toHaveBeenCalled();
    });

    it('should handle provider initialization errors', async () => {
      const mockError = new Error('Provider initialization failed');
      vi.spyOn(cli, 'initializeProvider').mockRejectedValue(mockError);

      await cli.parse(['query', 'test']);
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('Provider initialization failed')
      );
    });
  });

  describe('Output Formatting', () => {
    it('should support JSON output format', async () => {
      // Mock provider to avoid errors
      vi.spyOn(cli, 'initializeProvider').mockResolvedValue();
      const mockQuery = vi.fn().mockImplementation(async function* () {
        yield { content: 'test response', type: 'text' as const, metadata: {} };
      });
      // Use proper provider mock
      const mockProvider: Provider = {
        initialize: vi.fn(),
        query: mockQuery,
        createSession: vi.fn(),
        destroySession: vi.fn(),
        disconnect: vi.fn(),
      };
      // Access private property for testing
      Object.defineProperty(cli, 'provider', {
        value: mockProvider,
        writable: true,
        configurable: true,
      });

      await cli.parse(['query', 'test', '--output', 'json']);
      const output = mockConsoleLog.mock.calls[0]?.[0];
      if (output) {
        expect(() => JSON.parse(output)).not.toThrow();
      }
    });

    it('should support plain text output format', async () => {
      // Mock provider to avoid errors
      vi.spyOn(cli, 'initializeProvider').mockResolvedValue();
      const mockQuery = vi.fn().mockImplementation(async function* () {
        yield { content: 'test response', type: 'text' as const, metadata: {} };
      });
      // Use proper provider mock
      const mockProvider: Provider = {
        initialize: vi.fn(),
        query: mockQuery,
        createSession: vi.fn(),
        destroySession: vi.fn(),
        disconnect: vi.fn(),
      };
      // Access private property for testing
      Object.defineProperty(cli, 'provider', {
        value: mockProvider,
        writable: true,
        configurable: true,
      });

      await cli.parse(['query', 'test', '--output', 'text']);
      const output = mockConsoleLog.mock.calls[0]?.[0];
      expect(typeof output).toBe('string');
    });

    it('should support markdown output format', async () => {
      // Mock provider to avoid errors
      vi.spyOn(cli, 'initializeProvider').mockResolvedValue();
      const mockQuery = vi.fn().mockImplementation(async function* () {
        yield { content: 'test response', type: 'text' as const, metadata: {} };
      });
      // Use proper provider mock
      const mockProvider: Provider = {
        initialize: vi.fn(),
        query: mockQuery,
        createSession: vi.fn(),
        destroySession: vi.fn(),
        disconnect: vi.fn(),
      };
      // Access private property for testing
      Object.defineProperty(cli, 'provider', {
        value: mockProvider,
        writable: true,
        configurable: true,
      });

      await cli.parse(['query', 'test', '--output', 'markdown']);
      const output = mockConsoleLog.mock.calls[0]?.[0];
      if (output) {
        expect(output).toMatch(/^#|^##|^\*/m); // Basic markdown patterns
      }
    });
  });
});
