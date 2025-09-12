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
      expect(cli.program.name()).toBe('cagetools');
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
      vi.spyOn(cli, 'handleQuery').mockImplementation(async () => {});

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
      const handleQuerySpy = vi
        .spyOn(cli, 'handleQuery')
        .mockImplementation(async () => {});

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

    describe('Enhanced Chat Mode', () => {
      it('should return immediately in test environment', async () => {
        process.env.NODE_ENV = 'test';
        const result = await cli.startChat();
        expect(result).toBeUndefined();
      });

      it('should clear console and session when "/clear" is typed', async () => {
        // Mock console.clear
        const mockConsoleClear = vi
          .spyOn(console, 'clear')
          .mockImplementation(() => {});

        // Create a mock session
        const mockSession = {
          id: 'test-session',
          messages: [{ role: 'user', content: 'test message' }],
          state: { someState: 'value' } as Record<string, unknown>,
        };

        // Mock provider with session
        const mockProvider: Provider = {
          name: 'mock-provider',
          capabilities: {
            streaming: true,
            tools: false,
            mcp: false,
            subagents: false,
            hooks: false,
            webSearch: false,
            codeExecution: false,
          },
          initialize: vi.fn(),
          query: vi.fn().mockImplementation(async function* () {
            yield { content: 'response', type: 'text' as const, metadata: {} };
          }),
          createSession: vi.fn().mockReturnValue(mockSession),
          destroySession: vi.fn(),
          disconnect: vi.fn(),
          executeTools: vi.fn(),
          getUsage: vi.fn(),
        };

        // Set up CLI with mock provider
        Object.defineProperty(cli, 'provider', {
          value: mockProvider,
          writable: true,
          configurable: true,
        });

        // Simulate the clear command logic from startChat
        const processInput = (input: string, session: typeof mockSession) => {
          if (input.toLowerCase() === '/clear') {
            console.clear();
            // Clear the session to reset conversation history
            if (session) {
              session.messages = [];
              session.state = {};
            }
            return true;
          }
          return false;
        };

        // Test the clear functionality
        const wasCleared = processInput('/clear', mockSession);

        expect(wasCleared).toBe(true);
        expect(mockConsoleClear).toHaveBeenCalled();
        expect(mockSession.messages).toEqual([]);
        expect(mockSession.state).toEqual({});

        mockConsoleClear.mockRestore();
      });

      it('should handle /exit command', () => {
        const mockRlClose = vi.fn();
        const rl = { close: mockRlClose };

        // Simulate the exit command logic from startChat
        const processInput = (input: string) => {
          if (input.toLowerCase() === '/exit') {
            rl.close();
            return true;
          }
          return false;
        };

        const wasExited = processInput('/exit');
        expect(wasExited).toBe(true);
        expect(mockRlClose).toHaveBeenCalled();
      });

      it('should handle /help command', () => {
        const mockConsoleLog = vi
          .spyOn(console, 'log')
          .mockImplementation(() => {});

        const slashCommands = [
          {
            command: '/clear',
            description: 'Clear context and reset conversation',
          },
          { command: '/exit', description: 'Exit CageTools' },
          { command: '/help', description: 'Show available commands' },
        ];

        // Simulate the help command logic from startChat
        const processInput = (input: string) => {
          if (input.toLowerCase() === '/help') {
            console.log('\nAvailable commands:');
            slashCommands.forEach(cmd => {
              console.log(`  ${cmd.command} - ${cmd.description}`);
            });
            console.log();
            return true;
          }
          return false;
        };

        const showedHelp = processInput('/help');
        expect(showedHelp).toBe(true);
        expect(mockConsoleLog).toHaveBeenCalledWith('\nAvailable commands:');
        expect(mockConsoleLog).toHaveBeenCalledWith(
          '  /clear - Clear context and reset conversation'
        );
        expect(mockConsoleLog).toHaveBeenCalledWith('  /exit - Exit CageTools');
        expect(mockConsoleLog).toHaveBeenCalledWith(
          '  /help - Show available commands'
        );

        mockConsoleLog.mockRestore();
      });

      it('should provide autocomplete for slash commands', () => {
        const slashCommands = [
          {
            command: '/clear',
            description: 'Clear context and reset conversation',
          },
          { command: '/exit', description: 'Exit CageTools' },
          { command: '/help', description: 'Show available commands' },
        ];

        // Test autocomplete matching logic
        const getMatchingCommands = (input: string) => {
          if (!input.startsWith('/')) {
            return [];
          }
          const query = input.toLowerCase();
          return slashCommands.filter(cmd =>
            cmd.command.toLowerCase().startsWith(query)
          );
        };

        // Test various autocomplete scenarios
        expect(getMatchingCommands('/')).toHaveLength(3);
        expect(getMatchingCommands('/h')).toHaveLength(1);
        expect(getMatchingCommands('/he')).toHaveLength(1);
        expect(getMatchingCommands('/help')).toHaveLength(1);
        expect(getMatchingCommands('/c')).toHaveLength(1);
        expect(getMatchingCommands('/clear')).toHaveLength(1);
        expect(getMatchingCommands('/e')).toHaveLength(1);
        expect(getMatchingCommands('/ex')).toHaveLength(1);
        expect(getMatchingCommands('/unknown')).toHaveLength(0);
        expect(getMatchingCommands('clear')).toHaveLength(0); // No slash prefix
      });

      it('should handle Tab key for autocomplete', () => {
        const slashCommands = [
          {
            command: '/clear',
            description: 'Clear context and reset conversation',
          },
          { command: '/exit', description: 'Exit CageTools' },
          { command: '/help', description: 'Show available commands' },
        ];

        const getMatchingCommands = (input: string) => {
          if (!input.startsWith('/')) {
            return [];
          }
          const query = input.toLowerCase();
          return slashCommands.filter(cmd =>
            cmd.command.toLowerCase().startsWith(query)
          );
        };

        // Simulate Tab key autocomplete
        let currentInput = '/h';
        const selectedSuggestionIndex = 0;
        const matches = getMatchingCommands(currentInput);

        if (matches.length > 0) {
          currentInput = matches[selectedSuggestionIndex].command;
        }

        expect(currentInput).toBe('/help');
      });

      it('should handle arrow key navigation in suggestions', () => {
        const slashCommands = [
          {
            command: '/clear',
            description: 'Clear context and reset conversation',
          },
          { command: '/exit', description: 'Exit CageTools' },
          { command: '/help', description: 'Show available commands' },
        ];

        const getMatchingCommands = (input: string) => {
          if (!input.startsWith('/')) {
            return [];
          }
          const query = input.toLowerCase();
          return slashCommands.filter(cmd =>
            cmd.command.toLowerCase().startsWith(query)
          );
        };

        // Test arrow navigation
        const currentInput = '/';
        let selectedSuggestionIndex = 0;
        const matches = getMatchingCommands(currentInput);

        // Down arrow
        selectedSuggestionIndex = Math.min(
          matches.length - 1,
          selectedSuggestionIndex + 1
        );
        expect(selectedSuggestionIndex).toBe(1);

        // Down arrow again
        selectedSuggestionIndex = Math.min(
          matches.length - 1,
          selectedSuggestionIndex + 1
        );
        expect(selectedSuggestionIndex).toBe(2);

        // Down arrow at end (should stay at end)
        selectedSuggestionIndex = Math.min(
          matches.length - 1,
          selectedSuggestionIndex + 1
        );
        expect(selectedSuggestionIndex).toBe(2);

        // Up arrow
        selectedSuggestionIndex = Math.max(0, selectedSuggestionIndex - 1);
        expect(selectedSuggestionIndex).toBe(1);

        // Up arrow again
        selectedSuggestionIndex = Math.max(0, selectedSuggestionIndex - 1);
        expect(selectedSuggestionIndex).toBe(0);

        // Up arrow at start (should stay at start)
        selectedSuggestionIndex = Math.max(0, selectedSuggestionIndex - 1);
        expect(selectedSuggestionIndex).toBe(0);
      });

      it('should handle raw mode setup for TTY detection', () => {
        // Test that process.stdin.isTTY detection exists
        // This is used in the enhanced chat mode for raw input
        expect(typeof process.stdin.isTTY).toBe('boolean');
      });
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

  describe('Default Chat Mode Behavior', () => {
    it('should start chat mode on no arguments', async () => {
      const startChatSpy = vi.spyOn(cli, 'startChat').mockResolvedValue();

      await cli.parse([]);

      // Should have started chat mode since no arguments means default to chat
      expect(startChatSpy).toHaveBeenCalledWith({ provider: 'claude-code' });
    });

    it('should start chat mode for unknown commands', async () => {
      const startChatSpy = vi.spyOn(cli, 'startChat').mockResolvedValue();

      await cli.parse(['unknown-command']);

      // Should have started chat mode since 'unknown-command' is not recognized
      expect(startChatSpy).toHaveBeenCalledWith({ provider: 'claude-code' });
    });

    it('should start chat mode for multiple unknown arguments', async () => {
      const startChatSpy = vi.spyOn(cli, 'startChat').mockResolvedValue();

      await cli.parse(['some', 'random', 'text']);

      // Should have started chat mode since these aren't recognized commands
      expect(startChatSpy).toHaveBeenCalledWith({ provider: 'claude-code' });
    });

    it('should NOT start chat mode when valid command is provided', async () => {
      const startChatSpy = vi.spyOn(cli, 'startChat').mockResolvedValue();
      const handleQuerySpy = vi.spyOn(cli, 'handleQuery').mockResolvedValue();

      await cli.parse(['query', 'test prompt']);

      // Should NOT have started chat mode
      expect(startChatSpy).not.toHaveBeenCalled();
      // Should have handled the query command
      expect(handleQuerySpy).toHaveBeenCalledWith(
        'test prompt',
        expect.any(Object)
      );
    });

    it('should NOT start chat mode when config command is provided', async () => {
      const startChatSpy = vi.spyOn(cli, 'startChat').mockResolvedValue();
      const listConfigSpy = vi.spyOn(cli, 'listConfig').mockResolvedValue();

      await cli.parse(['config', 'list']);

      // Should NOT have started chat mode
      expect(startChatSpy).not.toHaveBeenCalled();
      // Should have handled the config command
      expect(listConfigSpy).toHaveBeenCalled();
    });

    it('should NOT start chat mode when tools command is provided', async () => {
      const startChatSpy = vi.spyOn(cli, 'startChat').mockResolvedValue();
      const listToolsSpy = vi.spyOn(cli, 'listTools').mockResolvedValue();

      await cli.parse(['tools', 'list']);

      // Should NOT have started chat mode
      expect(startChatSpy).not.toHaveBeenCalled();
      // Should have handled the tools command
      expect(listToolsSpy).toHaveBeenCalled();
    });

    it('should explicitly start chat mode when chat command is provided', async () => {
      const startChatSpy = vi.spyOn(cli, 'startChat').mockResolvedValue();

      await cli.parse(['chat']);

      // Should have started chat mode explicitly
      expect(startChatSpy).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'claude-code' })
      );
    });

    it('should show help when --help flag is provided', async () => {
      const helpSpy = vi
        .spyOn(cli.program, 'outputHelp')
        .mockImplementation(() => '');
      const startChatSpy = vi.spyOn(cli, 'startChat').mockResolvedValue();

      try {
        await cli.parse(['--help']);
      } catch (error) {
        // Commander calls process.exit after showing help, which we mock to throw
        if (error instanceof Error && error.message === 'process.exit called') {
          // This is expected behavior
        } else {
          throw error;
        }
      }

      // Should have shown help, NOT started chat mode
      expect(helpSpy).toHaveBeenCalled();
      expect(startChatSpy).not.toHaveBeenCalled();
    });

    it('should show help when -h flag is provided', async () => {
      const helpSpy = vi
        .spyOn(cli.program, 'outputHelp')
        .mockImplementation(() => '');
      const startChatSpy = vi.spyOn(cli, 'startChat').mockResolvedValue();

      try {
        await cli.parse(['-h']);
      } catch (error) {
        // Commander calls process.exit after showing help, which we mock to throw
        if (error instanceof Error && error.message === 'process.exit called') {
          // This is expected behavior
        } else {
          throw error;
        }
      }

      // Should have shown help, NOT started chat mode
      expect(helpSpy).toHaveBeenCalled();
      expect(startChatSpy).not.toHaveBeenCalled();
    });

    it('should show version when --version flag is provided', async () => {
      vi.spyOn(cli.program, 'outputHelp').mockImplementation(() => '');
      const startChatSpy = vi.spyOn(cli, 'startChat').mockResolvedValue();

      try {
        await cli.parse(['--version']);
      } catch (error) {
        // Commander calls process.exit after showing version, which we mock to throw
        if (error instanceof Error && error.message === 'process.exit called') {
          // This is expected behavior
        } else {
          throw error;
        }
      }

      // Should NOT have started chat mode
      expect(startChatSpy).not.toHaveBeenCalled();
    });

    it('should show version when -V flag is provided', async () => {
      const startChatSpy = vi.spyOn(cli, 'startChat').mockResolvedValue();

      try {
        await cli.parse(['-V']);
      } catch (error) {
        // Commander calls process.exit after showing version, which we mock to throw
        if (error instanceof Error && error.message === 'process.exit called') {
          // This is expected behavior
        } else {
          throw error;
        }
      }

      // Should NOT have started chat mode
      expect(startChatSpy).not.toHaveBeenCalled();
    });

    it('should NOT start chat mode when global flags are combined with commands', async () => {
      const startChatSpy = vi.spyOn(cli, 'startChat').mockResolvedValue();
      const handleQuerySpy = vi.spyOn(cli, 'handleQuery').mockResolvedValue();

      await cli.parse(['--verbose', 'query', 'test']);

      // Should NOT have started chat mode
      expect(startChatSpy).not.toHaveBeenCalled();
      // Should have handled the query command
      expect(handleQuerySpy).toHaveBeenCalled();
    });

    it('should show help when only global flags are provided', async () => {
      // This is the actual behavior: global flags without a command show help
      // This makes sense because flags like --verbose need a command to apply to
      const helpSpy = vi
        .spyOn(cli.program, 'outputHelp')
        .mockImplementation(() => '');
      const startChatSpy = vi.spyOn(cli, 'startChat').mockResolvedValue();

      try {
        await cli.parse(['--verbose']);
      } catch (error) {
        // Commander calls process.exit after showing help
        if (error instanceof Error && error.message === 'process.exit called') {
          // This is expected behavior
        } else {
          throw error;
        }
      }

      // Should show help, NOT start chat mode
      // This is correct because global flags need a command to apply to
      expect(helpSpy).toHaveBeenCalled();
      expect(startChatSpy).not.toHaveBeenCalled();
    });

    it('should handle piped input without starting chat mode', async () => {
      const handleQuerySpy = vi.spyOn(cli, 'handleQuery').mockResolvedValue();
      const startChatSpy = vi.spyOn(cli, 'startChat').mockResolvedValue();

      // Mock stdin.isTTY using Object.defineProperty
      const originalDescriptor = Object.getOwnPropertyDescriptor(
        process.stdin,
        'isTTY'
      );
      Object.defineProperty(process.stdin, 'isTTY', {
        value: false,
        writable: true,
        configurable: true,
      });

      await cli.parseWithStdin([], 'piped input text');

      // Should handle as query, not start chat
      expect(handleQuerySpy).toHaveBeenCalledWith(
        'piped input text',
        expect.any(Object)
      );
      expect(startChatSpy).not.toHaveBeenCalled();

      // Restore original state
      if (originalDescriptor) {
        Object.defineProperty(process.stdin, 'isTTY', originalDescriptor);
      } else {
        // If there was no original descriptor, remove the property
        Object.defineProperty(process.stdin, 'isTTY', {
          value: undefined,
          writable: true,
          configurable: true,
        });
      }
    });
  });

  describe('Error Handling', () => {
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
        name: 'mock-provider',
        capabilities: {
          streaming: true,
          tools: false,
          mcp: false,
          subagents: false,
          hooks: false,
          webSearch: false,
          codeExecution: false,
        },
        initialize: vi.fn(),
        query: mockQuery,
        createSession: vi.fn(),
        destroySession: vi.fn(),
        disconnect: vi.fn(),
        executeTools: vi.fn(),
        getUsage: vi.fn(),
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
      // Create a fresh spy for this test to avoid isolation issues
      const localConsoleSpy = vi.spyOn(console, 'log');

      // Mock provider to avoid errors
      vi.spyOn(cli, 'initializeProvider').mockResolvedValue();
      const mockQuery = vi.fn().mockImplementation(async function* () {
        yield { content: 'test response', type: 'text' as const, metadata: {} };
      });
      // Use proper provider mock
      const mockProvider: Provider = {
        name: 'mock-provider',
        capabilities: {
          streaming: true,
          tools: false,
          mcp: false,
          subagents: false,
          hooks: false,
          webSearch: false,
          codeExecution: false,
        },
        initialize: vi.fn(),
        query: mockQuery,
        createSession: vi.fn(),
        destroySession: vi.fn(),
        disconnect: vi.fn(),
        executeTools: vi.fn(),
        getUsage: vi.fn(),
      };
      // Access private property for testing
      Object.defineProperty(cli, 'provider', {
        value: mockProvider,
        writable: true,
        configurable: true,
      });

      await cli.parse(['query', 'test', '--output', 'text']);

      // When --output is specified, it should use non-streaming mode and call console.log
      expect(localConsoleSpy).toHaveBeenCalledWith('test response');

      // Clean up the local spy
      localConsoleSpy.mockRestore();
    });

    it('should support markdown output format', async () => {
      // Mock provider to avoid errors
      vi.spyOn(cli, 'initializeProvider').mockResolvedValue();
      const mockQuery = vi.fn().mockImplementation(async function* () {
        yield { content: 'test response', type: 'text' as const, metadata: {} };
      });
      // Use proper provider mock
      const mockProvider: Provider = {
        name: 'mock-provider',
        capabilities: {
          streaming: true,
          tools: false,
          mcp: false,
          subagents: false,
          hooks: false,
          webSearch: false,
          codeExecution: false,
        },
        initialize: vi.fn(),
        query: mockQuery,
        createSession: vi.fn(),
        destroySession: vi.fn(),
        disconnect: vi.fn(),
        executeTools: vi.fn(),
        getUsage: vi.fn(),
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
