import { Command } from 'commander';
import { Chalk } from 'chalk';

// Force chalk to use colors - fixes issue where chalk.level is 0
// and marked-terminal doesn't apply formatting
const chalk = new Chalk({ level: 3 });
import { createInterface } from 'readline';
import { ClaudeAPIProvider } from '../providers/claude-api';
import type { Provider } from '../types/provider';
import { readFileSync, promises as fs } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { marked } from 'marked';
import type { MarkedExtension } from 'marked';
import { markedTerminal } from 'marked-terminal';

// ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface QueryOptions {
  provider: string;
  stream?: boolean;
  output?: string;
  session?: string;
}

interface ChatOptions {
  provider?: string;
  multiline?: boolean;
}

interface PackageJson {
  version: string;
  name?: string;
  description?: string;
}

// Configure marked with terminal renderer using the modern plugin API
// We need to use our forced-color chalk instance
// The type definitions for marked-terminal are outdated - it actually returns a valid MarkedExtension
marked.use(
  markedTerminal({
    showSectionPrefix: false,
    width: process.stdout.columns || 120,
    reflowText: false, // Don't reflow text - preserve original formatting
    tab: 2,
    // Style configuration - should be chalk styles directly (not functions)
    firstHeading: chalk.bold.cyan,
    heading: chalk.bold.green,
    strong: chalk.bold, // Default bold for strong text
    em: chalk.italic,
    codespan: chalk.yellow,
    del: chalk.strikethrough,
    link: chalk.blue,
    href: chalk.blue.underline,
    blockquote: chalk.gray.italic,
  }) as MarkedExtension
);

export class CLI {
  public program: Command;
  private provider?: Provider;
  private config: Record<string, unknown> = {};
  private formatMarkdownOutput = true; // Default to formatted markdown

  constructor() {
    this.program = new Command();
    this.setupProgram();
  }

  private setupProgram(): void {
    // Read package.json for version
    const packageJson = JSON.parse(
      readFileSync(join(__dirname, '../../package.json'), 'utf-8')
    ) as PackageJson;

    this.program
      .name('cagetools')
      .description('CageTools - A universal coding agent CLI wrapper')
      .version(packageJson.version);

    // Global options
    this.program
      .option('-v, --verbose', 'Enable verbose output')
      .option(
        '-q, --quiet',
        'Run in quiet mode to suppress non-essential output'
      )
      .option('--no-color', 'Disable colored output')
      .option('-c, --config <path>', 'Path to config file');

    // Query command
    this.program
      .command('query [prompt...]')
      .description('Send a query to the AI provider')
      .option('-p, --provider <provider>', 'AI provider to use', 'claude-code')
      .option('-s, --stream', 'Stream the response in real-time')
      .option(
        '-o, --output <format>',
        'Specify the output format (json, text, markdown)',
        'text'
      )
      .option(
        '--session <id>',
        'Use a specific session ID for context persistence'
      )
      .action(async (prompt: string[], options: QueryOptions) => {
        await this.handleQuery(prompt?.join(' '), options);
      });

    // Chat command
    this.program
      .command('chat')
      .description('Start interactive chat mode')
      .option('-p, --provider <provider>', 'AI provider to use', 'claude-code')
      .option('-m, --multiline', 'Enable multiline input mode')
      .action(async (options: ChatOptions) => {
        await this.startChat(options);
      });

    // Config command
    const configCmd = this.program
      .command('config')
      .description('Manage configuration');

    configCmd
      .command('get <key>')
      .description('Get a configuration value')
      .action(async (key: string) => {
        await this.getConfig(key);
      });

    configCmd
      .command('set <key> <value>')
      .description('Set a configuration value')
      .action(async (key: string, value: string) => {
        await this.setConfig(key, value);
      });

    configCmd
      .command('list')
      .description('List all configuration values')
      .action(async () => {
        await this.listConfig();
      });

    // Tools command
    const toolsCmd = this.program.command('tools').description('Manage tools');

    toolsCmd
      .command('list')
      .description('List available tools')
      .action(async () => {
        await this.listTools();
      });

    toolsCmd
      .command('enable <tool>')
      .description('Enable a tool')
      .action(async (tool: string) => {
        await this.enableTool(tool);
      });

    toolsCmd
      .command('disable <tool>')
      .description('Disable a tool')
      .action(async (tool: string) => {
        await this.disableTool(tool);
      });
  }

  async parse(args: string[]): Promise<void> {
    try {
      // Remove 'node' and script name if present
      const argv = args.length > 0 ? args : process.argv.slice(2);

      // If no arguments provided, start chat mode by default
      if (argv.length === 0) {
        await this.startChat({ provider: 'claude-code' });
        return;
      }

      // Check if the user is asking for help or version
      if (
        argv.includes('--help') ||
        argv.includes('-h') ||
        argv.includes('--version') ||
        argv.includes('-V')
      ) {
        await this.program.parseAsync(['node', 'cagetools', ...argv]);
        return;
      }

      // Check if the first argument is a known command
      const knownCommands = ['query', 'chat', 'config', 'tools'];
      const firstArg = argv[0];

      // If first argument is not a command or flag, start chat mode
      if (!firstArg.startsWith('-') && !knownCommands.includes(firstArg)) {
        await this.startChat({ provider: 'claude-code' });
        return;
      }

      await this.program.parseAsync(['node', 'cagetools', ...argv]);
    } catch (error) {
      // Check if it's a Commander error
      if (error instanceof Error && error.message.includes('unknown command')) {
        console.error(chalk.red(`error: ${error.message}`));
      } else if (error instanceof Error) {
        console.error(chalk.red(`Error: ${error.message}`));
      } else {
        console.error(chalk.red('An unknown error occurred'));
      }

      // Don't exit in test environment
      if (process.env.NODE_ENV !== 'test') {
        process.exit(1);
      }
      throw error;
    }
  }

  async parseWithStdin(args: string[], stdin: string): Promise<void> {
    // Handle piped input
    if (!process.stdin.isTTY && stdin) {
      await this.handleQuery(stdin, { provider: 'claude-code' });
    } else {
      await this.parse(args);
    }
  }

  async handleQuery(
    prompt: string | undefined,
    options: QueryOptions
  ): Promise<void> {
    try {
      if (!prompt) {
        console.error(chalk.red('No prompt provided'));
        return;
      }

      await this.initializeProvider(options.provider);

      if (!this.provider) {
        throw new Error('Provider not initialized');
      }

      // Always create a session for consistent experience
      const session = { id: 'single-query-session', messages: [], state: {} };

      // Determine if we should use streaming based on the output format
      const useStreaming = options.stream ?? options.output === undefined;

      const response = this.provider.query(prompt, {
        stream: useStreaming,
        session: options.session
          ? { id: options.session, messages: [], state: {} }
          : session,
      });

      let fullResponse = '';
      let inCodeBlock = false;

      for await (const chunk of response) {
        if (useStreaming) {
          switch (chunk.type) {
            case 'thinking':
              // Show thinking in real-time exactly like Claude Code CLI
              process.stdout.write(chalk.gray(chunk.content));
              break;
            case 'code_snippet':
              if (!inCodeBlock) {
                process.stdout.write(
                  chalk.blue('\n```' + (chunk.language ?? '') + '\n')
                );
                inCodeBlock = true;
              }
              process.stdout.write(chalk.cyan(chunk.content));
              if (chunk.isComplete) {
                process.stdout.write(chalk.blue('\n```\n'));
                inCodeBlock = false;
              }
              break;
            case 'partial_code':
              process.stdout.write(chalk.cyan(chunk.content));
              break;
            case 'tool_use':
              process.stdout.write(
                chalk.yellow(
                  `[Tool: ${chunk.metadata?.toolName ?? 'unknown'}] `
                )
              );
              process.stdout.write(chunk.content);
              break;
            case 'tool_result':
              process.stdout.write(chalk.green(`[Result] ${chunk.content}`));
              break;
            case 'error':
              process.stdout.write(chalk.red(`[Error] ${chunk.content}`));
              break;
            case 'text':
            default:
              process.stdout.write(chunk.content);
              break;
          }
        } else {
          fullResponse += chunk.content;
        }
      }

      // Close any open code block in streaming mode
      if (useStreaming && inCodeBlock) {
        process.stdout.write(chalk.blue('\n```\n'));
      }

      if (!useStreaming) {
        this.outputResponse(fullResponse, options.output ?? 'text');
      }
    } catch (error) {
      if (error instanceof Error) {
        console.error(chalk.red(`Error: ${error.message}`));
      }
    }
  }

  async startChat(options?: ChatOptions): Promise<void> {
    // In test environment, return immediately to avoid hanging
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    // Load markdown preference from config
    const formatMarkdownConfig = this.config['formatMarkdown'];
    if (formatMarkdownConfig !== undefined) {
      this.formatMarkdownOutput = formatMarkdownConfig === 'true';
    }

    console.log(chalk.green('🤖 CageTools'));
    console.log(
      chalk.gray('💡 Commands: /exit to quit, /clear to reset context')
    );
    console.log(chalk.gray('🚀 Press ESC to stop current response'));
    console.log();

    await this.initializeProvider(options?.provider ?? 'claude-code');

    let session = this.provider?.createSession();

    // Set up custom readline interface for continuous typing
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.cyan('> '),
    });

    // Enable raw mode for key handling
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    let currentInput = '';
    let isProcessing = false;
    let currentResponseController: AbortController | null = null;
    let showingSuggestions = false;
    let selectedSuggestionIndex = 0;

    // Available slash commands
    const slashCommands = [
      {
        command: '/clear',
        description: 'Clear context and reset conversation',
      },
      { command: '/exit', description: 'Exit CageTools' },
      { command: '/help', description: 'Show available commands' },
      { command: '/resume', description: 'Resume a previous session' },
      { command: '/markdown', description: 'Toggle markdown formatting' },
    ];

    const getMatchingCommands = () => {
      if (!currentInput.startsWith('/')) {
        return [];
      }
      const query = currentInput.toLowerCase();
      return slashCommands.filter(cmd =>
        cmd.command.toLowerCase().startsWith(query)
      );
    };

    // Track the number of suggestions currently shown
    let currentSuggestionCount = 0;

    const showPrompt = () => {
      if (!isProcessing) {
        clearCurrentLine();

        // Clear previous suggestions if any
        if (showingSuggestions && currentSuggestionCount > 0) {
          for (let i = 0; i < currentSuggestionCount; i++) {
            process.stdout.write('\n\x1b[K');
          }
          process.stdout.write(`\x1b[${currentSuggestionCount}A`);
        }

        // Show current input
        process.stdout.write(chalk.cyan('> ') + currentInput);

        // Show suggestions if typing a slash command
        const matches = getMatchingCommands();
        if (
          matches.length > 0 &&
          currentInput.length > 0 &&
          currentInput.startsWith('/')
        ) {
          showingSuggestions = true;
          currentSuggestionCount = matches.length;

          // Ensure selected index is valid
          if (selectedSuggestionIndex >= matches.length) {
            selectedSuggestionIndex = matches.length - 1;
          }
          if (selectedSuggestionIndex < 0) {
            selectedSuggestionIndex = 0;
          }

          matches.forEach((cmd, index) => {
            const isSelected = index === selectedSuggestionIndex;
            const prefix = isSelected ? chalk.bgCyan.black(' ▶ ') : '   ';
            const cmdText = isSelected
              ? chalk.bold.cyan(cmd.command)
              : chalk.gray(cmd.command);
            const descText = chalk.dim(` - ${cmd.description}`);
            process.stdout.write(`\n${prefix} ${cmdText}${descText}`);
          });

          // Move cursor back to input line
          process.stdout.write(`\x1b[${matches.length}A`);
          process.stdout.write('\r');
          process.stdout.write(chalk.cyan('> ') + currentInput);
        } else {
          showingSuggestions = false;
          currentSuggestionCount = 0;
          selectedSuggestionIndex = 0;
        }
      }
    };

    const clearCurrentLine = () => {
      process.stdout.write('\r\x1b[K');
    };

    // Function to handle session resume
    const handleSessionResume = async () => {
      console.log(chalk.cyan('\n📋 Fetching available sessions...'));

      // Get the project directory path for Claude sessions
      const cwd = process.cwd();
      const projectPath = cwd.replace(/\//g, '-');
      const sessionsDir = join(homedir(), '.claude', 'projects', projectPath);

      try {
        // Read all session files
        const files = await fs.readdir(sessionsDir);
        const sessionFiles = files.filter(f => f.endsWith('.jsonl'));

        if (sessionFiles.length === 0) {
          console.log(
            chalk.yellow('No previous sessions found for this project')
          );
          showPrompt();
          return;
        }

        // Parse session metadata
        const sessions: Array<{
          id: string;
          time: Date;
          preview: string;
          filename: string;
        }> = [];

        for (const file of sessionFiles) {
          const sessionId = file.replace('.jsonl', '');
          const filePath = join(sessionsDir, file);
          const stats = await fs.stat(filePath);

          // Read first line to get initial message
          const content = await fs.readFile(filePath, 'utf-8');
          const firstLine = content.split('\n')[0];

          if (firstLine) {
            try {
              const data = JSON.parse(firstLine) as {
                message?: { content?: string };
              };
              const preview =
                data.message?.content?.substring(0, 60) ??
                'No preview available';

              sessions.push({
                id: sessionId,
                time: stats.mtime,
                preview: preview.replace(/\n/g, ' '),
                filename: file,
              });
            } catch {
              // Skip invalid JSON lines
            }
          }
        }

        // Sort by most recent first
        sessions.sort((a, b) => b.time.getTime() - a.time.getTime());

        if (sessions.length === 0) {
          console.log(chalk.yellow('No valid sessions found'));
          showPrompt();
          return;
        }

        // Show session selection UI
        console.log(chalk.green(`\nFound ${sessions.length} session(s):`));
        console.log(
          chalk.gray(
            'Use arrow keys to select, Enter to resume, ESC to cancel\n'
          )
        );

        let selectedSessionIndex = 0;
        const maxDisplayCount = 15; // Show up to 15 sessions at once
        let scrollOffset = 0; // Track scrolling position

        const showSessions = () => {
          // Clear previous session list display including scroll indicator
          const displayCount = Math.min(sessions.length, maxDisplayCount);
          const linesToClear =
            sessions.length > maxDisplayCount ? displayCount + 1 : displayCount;

          // Move to top of display area
          process.stdout.write(`\x1b[${linesToClear}A`);

          // Calculate what sessions to show based on scroll position
          const startIndex = scrollOffset;
          const endIndex = Math.min(
            startIndex + maxDisplayCount,
            sessions.length
          );
          const displaySessions = sessions.slice(startIndex, endIndex);

          displaySessions.forEach((session, displayIndex) => {
            const actualIndex = startIndex + displayIndex;
            const isSelected = actualIndex === selectedSessionIndex;
            const prefix = isSelected ? chalk.bgCyan.black(' ▶ ') : '   ';
            const timeStr = session.time.toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            });
            const sessionText = isSelected
              ? chalk.bold.cyan(`${timeStr} - ${session.preview}`)
              : chalk.gray(`${timeStr} - ${session.preview}`);
            process.stdout.write(`\r\x1b[K${prefix} ${sessionText}\n`);
          });

          // Clear any remaining lines if we're showing fewer sessions
          for (let i = displaySessions.length; i < displayCount; i++) {
            process.stdout.write(`\r\x1b[K\n`);
          }

          // Show scroll indicator on its own line if there are more sessions
          if (sessions.length > maxDisplayCount) {
            const currentPos = selectedSessionIndex + 1;
            const scrollInfo = chalk.dim(
              `  [${currentPos}/${sessions.length}] - Use ↑↓ to navigate`
            );
            process.stdout.write(`\r\x1b[K${scrollInfo}\n`);
          } else {
            // Clear the scroll indicator line if not needed
            process.stdout.write(`\r\x1b[K\n`);
          }
        };

        // Initial display - make space for sessions and scroll indicator
        const displayCount = Math.min(sessions.length, maxDisplayCount);
        const totalLines =
          sessions.length > maxDisplayCount ? displayCount + 1 : displayCount;
        for (let i = 0; i < totalLines; i++) {
          console.log();
        }
        showSessions();

        // Store original stdin mode handlers
        const originalDataListeners = process.stdin.listeners('data');
        process.stdin.removeAllListeners('data');

        return new Promise<void>(resolve => {
          const handleSessionKey = (key: Buffer) => {
            const keyCode = key[0];

            // ESC key - cancel
            if (keyCode === 27 && key.length === 1) {
              process.stdin.removeListener('data', handleSessionKey);
              // Restore original listeners
              originalDataListeners.forEach(listener => {
                process.stdin.on('data', listener as (chunk: Buffer) => void);
              });
              console.log(chalk.yellow('\nSession selection cancelled'));
              showPrompt();
              resolve();
              return;
            }

            // Arrow keys
            if (key.length === 3 && key[0] === 27 && key[1] === 91) {
              if (key[2] === 65) {
                // Up arrow
                if (selectedSessionIndex > 0) {
                  selectedSessionIndex--;
                  // Adjust scroll offset if needed
                  if (selectedSessionIndex < scrollOffset) {
                    scrollOffset = selectedSessionIndex;
                  }
                  showSessions();
                }
              } else if (key[2] === 66) {
                // Down arrow
                if (selectedSessionIndex < sessions.length - 1) {
                  selectedSessionIndex++;
                  // Adjust scroll offset if needed
                  if (selectedSessionIndex >= scrollOffset + maxDisplayCount) {
                    scrollOffset = selectedSessionIndex - maxDisplayCount + 1;
                  }
                  showSessions();
                }
              }
              return;
            }

            // Enter key - select session
            if (keyCode === 13) {
              process.stdin.removeListener('data', handleSessionKey);

              const selectedSession = sessions[selectedSessionIndex];
              console.log(
                chalk.green(
                  `\n✓ Resuming session from ${selectedSession.time.toLocaleString()}`
                )
              );
              console.log(chalk.gray(`Session ID: ${selectedSession.id}`));
              console.log();

              // Restore original listeners
              originalDataListeners.forEach(listener => {
                process.stdin.on('data', listener as (chunk: Buffer) => void);
              });

              // Hijack the current session to use the resumed session ID
              if (this.provider && 'activeSessions' in this.provider) {
                const provider = this.provider as {
                  activeSessions: Map<
                    string,
                    {
                      sessionId: string;
                      isFirst: boolean;
                      isResumed?: boolean;
                    }
                  >;
                };

                // Clear any existing mappings
                provider.activeSessions.clear();

                // Map our current session to the resumed session ID
                if (session?.id) {
                  provider.activeSessions.set(session.id, {
                    sessionId: selectedSession.id,
                    isFirst: false, // Session already exists, use --resume not --session-id
                    isResumed: true, // Track that this is a resumed session
                  });
                }

                console.log(
                  chalk.cyan('Session resumed. Continue your conversation:\n')
                );
              }

              showPrompt();
              resolve();
              return;
            }
          };

          process.stdin.on('data', handleSessionKey);
        });
      } catch (error) {
        const err = error as { code?: string; message?: string };
        if (err.code === 'ENOENT') {
          console.log(chalk.yellow('No sessions found for this project'));
        } else {
          console.log(chalk.red('❌ Failed to read sessions'));
          console.log(
            chalk.gray('Error: ' + ((err as Error).message ?? 'Unknown error'))
          );
        }
        showPrompt();
      }
    };

    const processInput = async (input: string) => {
      // Handle slash commands
      if (input.toLowerCase() === '/exit') {
        rl.close();
        return;
      }

      if (input.toLowerCase() === '/clear') {
        console.clear();
        // Clear the session to reset conversation history
        if (session && this.provider) {
          // Destroy the old session to clear provider's internal state
          await this.provider.destroySession(session.id);
          // Create a fresh session
          session = this.provider.createSession();
        }
        console.log(chalk.green('✨ Context cleared'));
        console.log();
        showPrompt();
        return;
      }

      if (input.toLowerCase() === '/help') {
        console.log(chalk.cyan('\nAvailable commands:'));
        slashCommands.forEach(cmd => {
          console.log(
            `  ${chalk.green(cmd.command)} - ${chalk.gray(cmd.description)}`
          );
        });
        console.log();
        showPrompt();
        return;
      }

      if (input.toLowerCase() === '/resume') {
        // Handle session resume
        await handleSessionResume();
        return;
      }

      if (input.toLowerCase() === '/markdown') {
        this.formatMarkdownOutput = !this.formatMarkdownOutput;
        // Save the preference
        await this.setConfig(
          'formatMarkdown',
          String(this.formatMarkdownOutput)
        );
        console.log(
          chalk.cyan(
            `\nMarkdown formatting: ${this.formatMarkdownOutput ? chalk.green('ON') : chalk.yellow('OFF')}`
          )
        );
        console.log(
          chalk.gray(
            this.formatMarkdownOutput
              ? 'Responses will be formatted for better readability'
              : 'Responses will be shown as raw markdown'
          )
        );
        console.log();
        showPrompt();
        return;
      }

      if (this.provider) {
        isProcessing = true;
        currentResponseController = new AbortController();

        clearCurrentLine();
        console.log();

        // Debug: Check session state
        if (process.env.DEBUG) {
          console.log(chalk.yellow('[DEBUG] Session ID:', session?.id));
          if ('activeSessions' in this.provider) {
            const provider = this.provider as {
              activeSessions: Map<string, unknown>;
            };
            console.log(
              chalk.yellow(
                '[DEBUG] Active sessions:',
                Array.from(provider.activeSessions.entries())
              )
            );
          }
        }

        try {
          const queryOptions = {
            session,
            stream: true,
            ...(currentResponseController?.signal && {
              signal: currentResponseController.signal,
            }),
          };
          const response = this.provider.query(input, queryOptions);
          let inCodeBlock = false;
          let fullResponse = '';

          for await (const chunk of response) {
            // Check if we should abort
            if (currentResponseController?.signal.aborted) {
              console.log();
              console.log(chalk.yellow('🛑 Response interrupted'));
              console.log();
              break;
            }

            // If markdown formatting is enabled, collect all text chunks
            if (this.formatMarkdownOutput) {
              // Only collect text content for markdown rendering
              if (chunk.type === 'text' || chunk.type === undefined) {
                fullResponse += chunk.content;
              }
              // Still show tool use, errors, etc. immediately
              else if (chunk.type === 'tool_result') {
                process.stdout.write(chalk.green(`[Result] ${chunk.content}`));
              } else if (chunk.type === 'error') {
                process.stdout.write(chalk.red(`[Error] ${chunk.content}`));
              }
            } else {
              // Normal streaming output when markdown formatting is off
              switch (chunk.type) {
                case 'thinking':
                  process.stdout.write(chalk.gray(chunk.content));
                  break;
                case 'code_snippet':
                  if (!inCodeBlock) {
                    process.stdout.write(
                      chalk.blue('\n```' + (chunk.language ?? '') + '\n')
                    );
                    inCodeBlock = true;
                  }
                  process.stdout.write(chalk.cyan(chunk.content));
                  if (chunk.isComplete) {
                    process.stdout.write(chalk.blue('\n```\n'));
                    inCodeBlock = false;
                  }
                  break;
                case 'partial_code':
                  process.stdout.write(chalk.cyan(chunk.content));
                  break;
                case 'tool_use':
                  process.stdout.write(
                    chalk.yellow(
                      `[Tool: ${chunk.metadata?.toolName ?? 'unknown'}] `
                    )
                  );
                  process.stdout.write(chunk.content);
                  break;
                case 'tool_result':
                  process.stdout.write(
                    chalk.green(`[Result] ${chunk.content}`)
                  );
                  break;
                case 'error':
                  process.stdout.write(chalk.red(`[Error] ${chunk.content}`));
                  break;
                case 'text':
                default:
                  process.stdout.write(chunk.content);
                  break;
              }
            }
          }

          // If markdown formatting is enabled, render the complete response
          if (this.formatMarkdownOutput && fullResponse) {
            try {
              const rendered = marked.parse(fullResponse) as string;
              process.stdout.write(rendered);
            } catch {
              // Fallback to raw output if rendering fails
              process.stdout.write(fullResponse);
            }
          } else if (!this.formatMarkdownOutput && inCodeBlock) {
            // Close any open code block for non-markdown mode
            process.stdout.write(chalk.blue('\n```\n'));
          }

          console.log(); // New line after response
        } catch (error) {
          if (!currentResponseController?.signal.aborted) {
            console.log();
            console.log(
              chalk.red(
                `Error: ${error instanceof Error ? error.message : String(error)}`
              )
            );
            console.log();
          }
        } finally {
          isProcessing = false;
          currentResponseController = null;
          currentInput = '';
          showPrompt();
        }
      }
    };

    // Handle key input
    process.stdin.on('data', key => {
      const keyStr = key.toString();
      const keyCode = key[0];

      // Check for arrow keys first: ESC [ A (up) or ESC [ B (down)
      if (key.length === 3 && key[0] === 27 && key[1] === 91) {
        const matches = getMatchingCommands();
        if (matches.length > 0 && showingSuggestions) {
          if (key[2] === 65) {
            // Up arrow (ESC [ A)
            selectedSuggestionIndex =
              selectedSuggestionIndex > 0
                ? selectedSuggestionIndex - 1
                : matches.length - 1; // Wrap to bottom
            showPrompt();
            return;
          } else if (key[2] === 66) {
            // Down arrow (ESC [ B)
            selectedSuggestionIndex =
              selectedSuggestionIndex < matches.length - 1
                ? selectedSuggestionIndex + 1
                : 0; // Wrap to top
            showPrompt();
            return;
          }
        }
        // Still return for any escape sequence to prevent them from being added to input
        return;
      }

      // ESC key (27) - stop current response (check AFTER arrow keys)
      if (keyCode === 27 && key.length === 1) {
        if (isProcessing && currentResponseController) {
          currentResponseController.abort();
        }
        return;
      }

      // Ctrl+C (3) - show exit instruction
      if (keyCode === 3) {
        console.log();
        console.log(chalk.yellow('👋 Use /exit to quit or press Ctrl+C again'));
        return;
      }

      // Don't process input if we're currently processing a response
      if (isProcessing) {
        return;
      }

      // Tab key (9) - autocomplete
      if (keyCode === 9) {
        const matches = getMatchingCommands();
        if (matches.length > 0 && showingSuggestions) {
          currentInput = matches[selectedSuggestionIndex].command;
          showPrompt();
        }
        return;
      }

      // Enter key (13) - send message
      if (keyCode === 13) {
        // Clear suggestions before processing
        if (showingSuggestions && currentSuggestionCount > 0) {
          for (let i = 0; i < currentSuggestionCount; i++) {
            process.stdout.write('\n\x1b[K');
          }
          process.stdout.write(`\x1b[${currentSuggestionCount}A`);
          showingSuggestions = false;
          currentSuggestionCount = 0;
        }

        if (currentInput.trim()) {
          const inputToProcess = currentInput.trim();
          currentInput = ''; // Reset input immediately after capturing it
          selectedSuggestionIndex = 0;
          clearCurrentLine();
          console.log(); // Move to next line after input
          processInput(inputToProcess).catch((error: Error) => {
            console.error(
              chalk.red(`Error processing input: ${error.message}`)
            );
          });
        } else {
          clearCurrentLine();
          showPrompt();
        }
        return;
      }

      // Backspace (127) - delete character
      if (keyCode === 127) {
        if (currentInput.length > 0) {
          currentInput = currentInput.slice(0, -1);
          clearCurrentLine();
          showPrompt();
        }
        return;
      }

      // Regular characters
      if (keyCode >= 32 && keyCode <= 126) {
        currentInput += keyStr;
        clearCurrentLine();
        showPrompt();
      }
    });

    // Handle readline close
    rl.on('close', () => {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }

      if (session && this.provider) {
        this.provider.destroySession(session.id).catch(() => {
          // Ignore errors during cleanup
        });
      }

      console.log(
        chalk.green(
          '\n👋 Chat session ended. Your conversation has been saved in Claude Code.'
        )
      );
      process.exit(0);
    });

    // Show initial prompt
    showPrompt();

    // Keep the process alive
    return new Promise(() => {
      // This promise never resolves, keeping the chat session alive
      // until the user exits manually
    });
  }

  async initializeProvider(providerName: string): Promise<void> {
    switch (providerName) {
      case 'claude-api': {
        this.provider = new ClaudeAPIProvider();
        // Pass any configured API key, but the provider will also check
        // Claude Code's credentials file and env vars as fallbacks
        const apiKey = this.config.apiKey as string | undefined;
        await this.provider.initialize({ apiKey });
        break;
      }
      case 'claude-code': {
        // Claude Code CLI doesn't need an API key, it uses the local installation
        const { ClaudeCodeProvider } = await import('../providers/claude-code');
        this.provider = new ClaudeCodeProvider();
        await this.provider.initialize({});
        break;
      }
      default:
        throw new Error(`Unknown provider: ${providerName}`);
    }
  }

  async getConfig(key: string): Promise<void> {
    const value = this.config[key];
    if (value !== undefined) {
      console.log(`${key}: ${value}`);
    } else {
      console.log(`${key}: <not set>`);
    }
  }

  async setConfig(key: string, value: string): Promise<void> {
    this.config[key] = value;
    console.log(chalk.green(`Set ${key} = ${value}`));
  }

  async listConfig(): Promise<void> {
    if (Object.keys(this.config).length === 0) {
      console.log('No configuration values set');
    } else {
      for (const [key, value] of Object.entries(this.config)) {
        console.log(`${key}: ${value}`);
      }
    }
  }

  async listTools(): Promise<void> {
    const tools = [
      'BashTool - Execute shell commands',
      'FileTool - Read/write files',
      'SearchTool - Search files',
      'WebTool - Web search and fetch',
      'GitTool - Git operations',
    ];
    console.log(chalk.cyan('Available tools:'));
    tools.forEach(tool => console.log(`  - ${tool}`));
  }

  async enableTool(tool: string): Promise<void> {
    console.log(chalk.green(`Enabled tool: ${tool}`));
  }

  async disableTool(tool: string): Promise<void> {
    console.log(chalk.yellow(`Disabled tool: ${tool}`));
  }

  private outputResponse(response: string, format: string): void {
    switch (format) {
      case 'json':
        console.log(JSON.stringify({ response }, null, 2));
        break;
      case 'markdown':
        console.log(`# Response\n\n${response}`);
        break;
      case 'text':
      default:
        console.log(response);
        break;
    }
  }
}
