import { Command } from 'commander';
import { Chalk } from 'chalk';
import UpdateManager from 'stdout-update';

// Force chalk to use colors - fixes issue where chalk.level is 0
// and marked-terminal doesn't apply formatting
const chalk = new Chalk({ level: 3 });
import { createInterface } from 'readline';
import { ClaudeAPIProvider } from '../providers/claude-api';
import type { Provider } from '../types/provider';
import { readFileSync, promises as fs, existsSync } from 'fs';
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

interface SessionEntry {
  timestamp: string;
  type: string;
  content: string;
  metadata?: Record<string, unknown>;
}

interface SessionData {
  sessionId: string;
  provider: string;
  startTime: string;
  endTime?: string;
  entries: SessionEntry[];
}

export class CLI {
  public program: Command;
  private provider?: Provider;
  private config: Record<string, unknown> = {};
  private formatMarkdownOutput = true; // Default to formatted markdown
  private updateManager = UpdateManager.getInstance(); // stdout-update manager
  private isOutputHooked = false; // Track if we've hooked stdout

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
      const session = this.provider.createSession();

      // Initialize session recording
      const sessionData: SessionData = {
        sessionId: session.id,
        provider: this.provider.name,
        startTime: new Date().toISOString(),
        entries: [],
      };

      // Record user message
      sessionData.entries.push({
        timestamp: new Date().toISOString(),
        type: 'user_message',
        content: prompt,
      });

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
      let assistantResponse = '';

      for await (const chunk of response) {
        // Record the raw JSON chunk data - capture ALL chunk types
        try {
          sessionData.entries.push({
            timestamp: new Date().toISOString(),
            type: chunk.type || 'unknown',
            content: JSON.stringify(chunk),
            metadata: chunk.metadata || {},
          });
        } catch (error) {
          console.error('Failed to record chunk:', error);
        }

        // Collect assistant response content for display
        if (chunk.type === 'text' || chunk.type === undefined) {
          assistantResponse += chunk.content;
        }
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

      // All JSON chunks are already recorded in the loop above

      sessionData.endTime = new Date().toISOString();
      await this.saveSessionData(sessionData);
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
      { command: '/sessions', description: 'View session history' },
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

    // Shared selector UI for sessions
    const showSelector = async <T>(
      items: T[],
      displayFunction: (item: T, isSelected: boolean) => string,
      onSelect: (item: T) => Promise<void>,
      title: string,
      emptyMessage: string
    ): Promise<void> => {
      if (items.length === 0) {
        console.log(chalk.yellow(emptyMessage));
        showPrompt();
        return;
      }

      console.log(chalk.green(`\n${title}`));
      console.log(
        chalk.gray('Use arrow keys to select, Enter to choose, ESC to cancel\n')
      );

      let selectedIndex = 0;
      const maxDisplayCount = 15;
      let scrollOffset = 0;

      const showItems = () => {
        // When we have fewer items than maxDisplayCount, only allocate space for actual items
        const actualItemCount = items.length;
        const needsScrollIndicator = actualItemCount > maxDisplayCount;
        const displayableItems = Math.min(actualItemCount, maxDisplayCount);
        const totalLines = needsScrollIndicator
          ? displayableItems + 1
          : displayableItems;

        // Move cursor up to start of display area
        process.stdout.write(`\x1b[${totalLines}A`);

        // Calculate what items to show based on scroll position
        const startIndex = scrollOffset;
        const endIndex = Math.min(
          startIndex + displayableItems,
          actualItemCount
        );
        const displayItems = items.slice(startIndex, endIndex);

        // Display each item
        displayItems.forEach((item, displayIndex) => {
          const actualIndex = startIndex + displayIndex;
          const isSelected = actualIndex === selectedIndex;
          const prefix = isSelected ? chalk.bgCyan.black(' ▶ ') : '   ';
          const itemText = displayFunction(item, isSelected);
          process.stdout.write(`\r\x1b[K${prefix} ${itemText}\n`);
        });

        // Clear any remaining lines (shouldn't happen with correct logic)
        for (let i = displayItems.length; i < displayableItems; i++) {
          process.stdout.write(`\r\x1b[K\n`);
        }

        // Show scroll indicator if needed
        if (needsScrollIndicator) {
          const currentPos = selectedIndex + 1;
          const scrollInfo = chalk.dim(
            `  [${currentPos}/${actualItemCount}] - Use ↑↓ to navigate`
          );
          process.stdout.write(`\r\x1b[K${scrollInfo}\n`);
        }
      };

      // Initial display - allocate space for items (and scroll indicator if needed)
      const actualItemCount = items.length;
      const needsScrollIndicator = actualItemCount > maxDisplayCount;
      const displayableItems = Math.min(actualItemCount, maxDisplayCount);
      const totalLines = needsScrollIndicator
        ? displayableItems + 1
        : displayableItems;

      for (let i = 0; i < totalLines; i++) {
        console.log();
      }
      showItems();

      const originalDataListeners = process.stdin.listeners('data');
      process.stdin.removeAllListeners('data');

      return new Promise<void>(resolve => {
        const handleKey = (key: Buffer) => {
          const keyCode = key[0];

          if (keyCode === 27 && key.length === 1) {
            process.stdin.removeListener('data', handleKey);
            originalDataListeners.forEach(listener => {
              process.stdin.on('data', listener as (chunk: Buffer) => void);
            });
            console.log(chalk.yellow('\nSelection cancelled'));
            showPrompt();
            resolve();
            return;
          }

          if (key.length === 3 && key[0] === 27 && key[1] === 91) {
            if (key[2] === 65) {
              // Up arrow
              if (selectedIndex > 0) {
                selectedIndex--;
                // Adjust scroll offset if needed
                if (selectedIndex < scrollOffset) {
                  scrollOffset = selectedIndex;
                }
                showItems();
              }
            } else if (key[2] === 66) {
              // Down arrow
              if (selectedIndex < items.length - 1) {
                selectedIndex++;
                // Adjust scroll offset if needed
                if (selectedIndex >= scrollOffset + maxDisplayCount) {
                  scrollOffset = selectedIndex - maxDisplayCount + 1;
                }
                showItems();
              }
            }
          } else if (keyCode === 13) {
            // Enter
            process.stdin.removeListener('data', handleKey);
            originalDataListeners.forEach(listener => {
              process.stdin.on('data', listener as (chunk: Buffer) => void);
            });
            console.log();
            onSelect(items[selectedIndex]).then(() => resolve());
          }
        };

        process.stdin.on('data', handleKey);
      });
    };

    // Function to handle session viewing
    const handleSessionViewer = async () => {
      console.log(chalk.cyan('\n📁 Loading session files...'));

      const cagetoolsDir = join(process.cwd(), '.cagetools');

      try {
        if (!existsSync(cagetoolsDir)) {
          console.log(
            chalk.yellow('No .cagetools directory found in current directory')
          );
          showPrompt();
          return;
        }

        const files = await fs.readdir(cagetoolsDir);
        const sessionFiles = files.filter(
          f => f.startsWith('session_') && f.endsWith('.json')
        );

        interface CageSession {
          id: string;
          time: Date;
          provider: string;
          userMessages: number;
          assistantMessages: number;
          duration: string;
          filename: string;
        }

        const sessions: CageSession[] = [];

        for (const file of sessionFiles) {
          try {
            const filePath = join(cagetoolsDir, file);
            const stats = await fs.stat(filePath);
            const content = await fs.readFile(filePath, 'utf-8');
            const sessionData = JSON.parse(content) as SessionData;

            const userMessages = sessionData.entries.filter(
              e => e.type === 'user_message'
            ).length;
            // Count various assistant response types (text chunks, assistant messages, etc.)
            const assistantMessages = sessionData.entries.filter(
              e =>
                e.type === 'text' ||
                e.type === 'assistant' ||
                e.type === 'assistant_response'
            ).length;

            const startTime = new Date(sessionData.startTime);
            const endTime = sessionData.endTime
              ? new Date(sessionData.endTime)
              : new Date();
            const durationMs = endTime.getTime() - startTime.getTime();
            const duration = `${Math.round(durationMs / 1000)}s`;

            sessions.push({
              id: sessionData.sessionId,
              time: startTime, // Use actual session start time, not file modification time
              provider: sessionData.provider,
              userMessages,
              assistantMessages,
              duration,
              filename: file,
            });
          } catch (error) {
            console.error(`Failed to parse session file ${file}:`, error);
          }
        }

        sessions.sort((a, b) => b.time.getTime() - a.time.getTime());

        await showSelector(
          sessions,
          (session: CageSession, isSelected: boolean) => {
            const timeStr = session.time.toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            });
            const info = `${timeStr} | ${session.provider} | ${session.userMessages}↑ ${session.assistantMessages}↓ | ${session.duration}`;
            return isSelected ? chalk.bold.cyan(info) : chalk.gray(info);
          },
          async (session: CageSession) => {
            console.log(chalk.green(`\n📄 Session: ${session.id}`));
            console.log(
              chalk.gray(
                `Provider: ${session.provider} | Duration: ${session.duration}`
              )
            );
            console.log(
              chalk.gray(
                `Messages: ${session.userMessages} user, ${session.assistantMessages} assistant\n`
              )
            );

            try {
              const filePath = join(cagetoolsDir, session.filename);
              const content = await fs.readFile(filePath, 'utf-8');
              const sessionData = JSON.parse(content) as SessionData;

              // Process entries and combine streaming chunks
              const combinedMessages: Array<{
                timestamp: string;
                type: 'user_message' | 'assistant_response';
                content: string;
              }> = [];

              let currentAssistantMessage = '';
              let assistantStartTime = '';

              for (const entry of sessionData.entries) {
                if (entry.type === 'user_message') {
                  // If we have a pending assistant message, save it first
                  if (currentAssistantMessage.trim()) {
                    combinedMessages.push({
                      timestamp: assistantStartTime,
                      type: 'assistant_response',
                      content: currentAssistantMessage.trim(),
                    });
                    currentAssistantMessage = '';
                  }

                  combinedMessages.push({
                    timestamp: entry.timestamp,
                    type: 'user_message',
                    content: entry.content,
                  });
                } else {
                  try {
                    const chunkData = JSON.parse(entry.content);
                    if (chunkData.type === 'text' && chunkData.content) {
                      // Start or continue assistant message
                      if (!currentAssistantMessage) {
                        assistantStartTime = entry.timestamp;
                      }
                      currentAssistantMessage += chunkData.content;
                    }
                  } catch {
                    // Skip non-text chunks or malformed data
                  }
                }
              }

              // Add final assistant message if exists
              if (currentAssistantMessage.trim()) {
                combinedMessages.push({
                  timestamp: assistantStartTime,
                  type: 'assistant_response',
                  content: currentAssistantMessage.trim(),
                });
              }

              // First show clean conversation view
              console.log(chalk.yellow('\n=== Conversation View ===\n'));

              // Properly reconstruct text from streaming chunks
              let reconstructedAssistantMessage = '';
              let assistantMessageStartTime = '';
              let isInAssistantMessage = false;

              for (const entry of sessionData.entries) {
                if (entry.type === 'user_message') {
                  // Flush any pending assistant message
                  if (reconstructedAssistantMessage) {
                    const timestamp = new Date(
                      assistantMessageStartTime
                    ).toLocaleTimeString();
                    console.log(chalk.green(`[${timestamp}] Assistant:`));
                    console.log(reconstructedAssistantMessage);
                    console.log();
                    reconstructedAssistantMessage = '';
                    isInAssistantMessage = false;
                  }

                  // Show user message
                  const timestamp = new Date(
                    entry.timestamp
                  ).toLocaleTimeString();
                  console.log(chalk.blue(`[${timestamp}] User:`));
                  console.log(entry.content);
                  console.log();
                } else if (entry.type === 'text') {
                  // Handle text chunks from streaming
                  try {
                    const chunkData = JSON.parse(entry.content);
                    if (chunkData.content) {
                      if (!isInAssistantMessage) {
                        assistantMessageStartTime = entry.timestamp;
                        isInAssistantMessage = true;
                      }
                      reconstructedAssistantMessage += chunkData.content;
                    }
                  } catch {
                    // Not JSON, skip
                  }
                } else if (entry.type === 'assistant') {
                  // Handle complete assistant messages (non-streaming)
                  try {
                    const data = JSON.parse(entry.content);
                    if (data.message?.content?.[0]?.text) {
                      if (!isInAssistantMessage) {
                        assistantMessageStartTime = entry.timestamp;
                        isInAssistantMessage = true;
                      }
                      // For complete messages, add with newline if we have existing content
                      if (
                        reconstructedAssistantMessage &&
                        !reconstructedAssistantMessage.endsWith('\n')
                      ) {
                        reconstructedAssistantMessage += '\n';
                      }
                      reconstructedAssistantMessage +=
                        data.message.content[0].text;
                    }
                  } catch {
                    // Not JSON, skip
                  }
                }
              }

              // Flush final assistant message if exists
              if (reconstructedAssistantMessage) {
                const timestamp = new Date(
                  assistantMessageStartTime
                ).toLocaleTimeString();
                console.log(chalk.green(`[${timestamp}] Assistant:`));
                console.log(reconstructedAssistantMessage);
                console.log();
              }

              // Then show detailed event log
              console.log(chalk.yellow('\n=== Detailed Event Log ===\n'));

              // Helper to format event types with descriptions
              const getEventDescription = (type: string): string => {
                const descriptions: Record<string, string> = {
                  user_message: '💬 User Input',
                  system: '⚙️ System Init (tools, model, config)',
                  stream_event: '📡 API Stream Event',
                  text: '✏️ Text Content',
                  assistant: '🤖 Assistant Message',
                  user: '👤 Tool Result',
                  result: '📊 Final Result (cost, usage, duration)',
                  tool_use: '🔧 Tool Call',
                  thinking: '💭 Thinking Process',
                  error: '❌ Error',
                  unknown: '❓ Unknown Event',
                };
                return descriptions[type] || `📦 ${type}`;
              };

              // Group consecutive text chunks for readability
              let consecutiveTextCount = 0;
              let lastWasText = false;

              for (const entry of sessionData.entries) {
                const timestamp = new Date(
                  entry.timestamp
                ).toLocaleTimeString();

                if (entry.type === 'user_message') {
                  // Always show user messages prominently
                  console.log(chalk.blue.bold(`\n[${timestamp}] 💬 User:`));
                  console.log(chalk.white(entry.content));
                  lastWasText = false;
                  consecutiveTextCount = 0;
                } else if (entry.type === 'text' && lastWasText) {
                  // Group consecutive text chunks
                  consecutiveTextCount++;
                  if (consecutiveTextCount === 1) {
                    console.log(chalk.gray(`  ... (streaming text chunks)`));
                  }
                } else {
                  // Show other event types with parsed content
                  try {
                    const data = JSON.parse(entry.content);
                    const eventDesc = getEventDescription(entry.type);

                    console.log(chalk.cyan(`\n[${timestamp}] ${eventDesc}`));

                    // Show key information based on event type
                    if (entry.type === 'system' && data.subtype === 'init') {
                      console.log(chalk.gray(`  Model: ${data.model}`));
                      console.log(
                        chalk.gray(
                          `  Tools: ${data.tools?.slice(0, 5).join(', ')}${data.tools?.length > 5 ? '...' : ''}`
                        )
                      );
                    } else if (entry.type === 'result') {
                      console.log(
                        chalk.green(`  ✅ Success: ${!data.is_error}`)
                      );
                      console.log(
                        chalk.yellow(
                          `  💰 Cost: $${data.total_cost_usd || '0'}`
                        )
                      );
                      console.log(
                        chalk.gray(`  ⏱️ Duration: ${data.duration_ms}ms`)
                      );
                      if (data.usage) {
                        console.log(
                          chalk.gray(
                            `  📈 Tokens: in=${data.usage.input_tokens}, out=${data.usage.output_tokens}`
                          )
                        );
                      }
                    } else if (entry.type === 'stream_event' && data.event) {
                      const eventType = data.event.type;
                      if (
                        eventType === 'message_start' &&
                        data.event.message?.usage
                      ) {
                        console.log(chalk.gray(`  Event: ${eventType}`));
                        console.log(
                          chalk.gray(
                            `  Tokens: ${JSON.stringify(data.event.message.usage.input_tokens)}`
                          )
                        );
                      } else if (
                        eventType === 'content_block_start' &&
                        data.event.content_block?.type === 'tool_use'
                      ) {
                        console.log(
                          chalk.magenta(
                            `  🔧 Tool: ${data.event.content_block.name}`
                          )
                        );
                      } else {
                        console.log(chalk.gray(`  Event: ${eventType}`));
                      }
                    } else if (entry.type === 'assistant' && data.message) {
                      const msg = data.message;
                      if (msg.content && msg.content[0]?.type === 'text') {
                        console.log(
                          chalk.green(
                            `  Response: "${msg.content[0].text.substring(0, 100)}${msg.content[0].text.length > 100 ? '...' : ''}"`
                          )
                        );
                      } else if (
                        msg.content &&
                        msg.content[0]?.type === 'tool_use'
                      ) {
                        console.log(
                          chalk.magenta(`  Tool Use: ${msg.content[0].name}`)
                        );
                      }
                    } else if (entry.type === 'user' && data.content) {
                      if (data.content[0]?.type === 'tool_result') {
                        console.log(
                          chalk.blue(
                            `  Tool Result: ${data.content[0].content?.substring(0, 100)}${data.content[0].content?.length > 100 ? '...' : ''}`
                          )
                        );
                      }
                    } else if (entry.type === 'text' && data.content) {
                      console.log(
                        chalk.white(
                          `  Text: "${data.content.substring(0, 100)}${data.content.length > 100 ? '...' : ''}"`
                        )
                      );
                      lastWasText = true;
                      continue;
                    }

                    lastWasText = false;
                    consecutiveTextCount = 0;
                  } catch {
                    // For entries that aren't JSON or failed to parse
                    console.log(
                      chalk.cyan(
                        `\n[${timestamp}] ${getEventDescription(entry.type)}`
                      )
                    );
                    if (
                      typeof entry.content === 'string' &&
                      entry.content.length < 200
                    ) {
                      console.log(chalk.gray(`  Content: ${entry.content}`));
                    }
                    lastWasText = false;
                    consecutiveTextCount = 0;
                  }
                }
              }

              console.log(chalk.yellow('\n=== End of Detailed Event Log ==='));
            } catch (error) {
              console.error('Failed to read session content:', error);
            }

            showPrompt();
          },
          `Found ${sessions.length} session(s):`,
          'No session files found in .cagetools directory'
        );
      } catch (error) {
        console.error('Failed to read sessions directory:', error);
        showPrompt();
      }
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

      if (input.toLowerCase() === '/sessions') {
        // Handle session viewer
        await handleSessionViewer();
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

          // Initialize session recording for chat
          const sessionData: SessionData = {
            sessionId: session?.id || 'chat-session',
            provider: this.provider.name,
            startTime: new Date().toISOString(),
            entries: [],
          };

          // Record user message
          sessionData.entries.push({
            timestamp: new Date().toISOString(),
            type: 'user_message',
            content: input,
          });

          const response = this.provider.query(input, queryOptions);
          let inCodeBlock = false;
          let fullResponse = '';
          let renderThrottleTimer: NodeJS.Timeout | null = null;
          const RENDER_THROTTLE_MS = 30; // Throttle re-renders to every 30ms for smoother updates

          // Helper function to render markdown incrementally using stdout-update
          const renderMarkdownIncremental = () => {
            if (!this.formatMarkdownOutput || !fullResponse) {
              return;
            }

            // Initialize stdout hooking for clean updates
            if (!this.isOutputHooked) {
              this.updateManager.hook();
              this.isOutputHooked = true;
            }

            try {
              // Parse and render the markdown
              const rendered = marked.parse(fullResponse) as string;

              // Use stdout-update for clean terminal updates
              const lines = rendered.split('\n');
              // Filter out empty lines at the end
              const filteredLines = rendered.endsWith('\n')
                ? lines.slice(0, -1)
                : lines;

              this.updateManager.update(filteredLines);
            } catch {
              // Fallback: just show raw markdown if parsing fails
              const fallbackLines = fullResponse.split('\n');
              const filteredFallbackLines = fullResponse.endsWith('\n')
                ? fallbackLines.slice(0, -1)
                : fallbackLines;

              this.updateManager.update(filteredFallbackLines);
            }
          };

          for await (const chunk of response) {
            // Check if we should abort
            if (currentResponseController?.signal.aborted) {
              console.log();
              console.log(chalk.yellow('🛑 Response interrupted'));
              console.log();
              break;
            }

            // Record the raw JSON chunk data for chat - capture ALL chunk types
            try {
              sessionData.entries.push({
                timestamp: new Date().toISOString(),
                type: chunk.type || 'unknown',
                content: JSON.stringify(chunk),
                metadata: chunk.metadata || {},
              });
            } catch (error) {
              console.error('Failed to record chat chunk:', error);
            }

            // If markdown formatting is enabled, collect and render incrementally
            if (this.formatMarkdownOutput) {
              // Handle thinking blocks
              if (chunk.type === 'thinking') {
                // Initialize stdout hooking if not already done
                if (!this.isOutputHooked) {
                  this.updateManager.hook();
                  this.isOutputHooked = true;
                }

                // Show thinking content using stdout-update
                const thinkingLines = chunk.content.split('\n');
                const thinkingContent = thinkingLines.map(line =>
                  chalk.gray(line)
                );
                this.updateManager.update(thinkingContent);
              }
              // Only collect text content for markdown rendering
              else if (chunk.type === 'text' || chunk.type === undefined) {
                fullResponse += chunk.content;

                // Throttle rendering to avoid too frequent updates but still be responsive
                if (renderThrottleTimer) {
                  clearTimeout(renderThrottleTimer);
                }
                renderThrottleTimer = setTimeout(() => {
                  renderMarkdownIncremental();
                  renderThrottleTimer = null;
                }, RENDER_THROTTLE_MS);
              }
              // Still show tool use, errors, etc. immediately but also via stdout-update for consistency
              else if (chunk.type === 'tool_result') {
                if (!this.isOutputHooked) {
                  this.updateManager.hook();
                  this.isOutputHooked = true;
                }
                // Show as single line update
                this.updateManager.update([
                  chalk.green(`[Result] ${chunk.content}`),
                ]);
              } else if (chunk.type === 'error') {
                if (!this.isOutputHooked) {
                  this.updateManager.hook();
                  this.isOutputHooked = true;
                }
                // Show as single line update
                this.updateManager.update([
                  chalk.red(`[Error] ${chunk.content}`),
                ]);
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

          // Final render to ensure everything is displayed
          if (this.formatMarkdownOutput && fullResponse) {
            // Clear any pending throttled render
            if (renderThrottleTimer) {
              clearTimeout(renderThrottleTimer);
            }
            // Do one final render to ensure completeness
            renderMarkdownIncremental();

            // Unhook stdout-update to return to normal console behavior
            if (this.isOutputHooked) {
              this.updateManager.unhook();
              this.isOutputHooked = false;
            }
          } else if (!this.formatMarkdownOutput && inCodeBlock) {
            // Close any open code block for non-markdown mode
            process.stdout.write(chalk.blue('\n```\n'));
          }

          console.log(); // New line after response

          // Save chat session data
          sessionData.endTime = new Date().toISOString();
          await this.saveSessionData(sessionData);
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
          // Ensure stdout-update is properly unhooked
          if (this.isOutputHooked) {
            this.updateManager.unhook();
            this.isOutputHooked = false;
          }
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

  private async saveSessionData(sessionData: SessionData): Promise<void> {
    try {
      const cagetoolsDir = join(process.cwd(), '.cagetools');
      if (!existsSync(cagetoolsDir)) {
        await fs.mkdir(cagetoolsDir, { recursive: true });
      }

      const filePath = join(
        cagetoolsDir,
        `session_${sessionData.sessionId}.json`
      );
      await fs.writeFile(
        filePath,
        JSON.stringify(sessionData, null, 2),
        'utf-8'
      );
    } catch (error) {
      console.error('Failed to save session data:', error);
    }
  }
}
