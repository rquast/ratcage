import { Command } from 'commander';
import chalk from 'chalk';
import { createInterface } from 'readline';
import { ClaudeAPIProvider } from '../providers/claude-api';
import type { Provider } from '../types/provider';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

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

export class CLI {
  public program: Command;
  private provider?: Provider;
  private config: Record<string, unknown> = {};

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

      const response = this.provider.query(prompt, {
        stream: options.stream ?? true, // Default to streaming for full experience
        session: options.session
          ? { id: options.session, messages: [], state: {} }
          : session,
      });

      let fullResponse = '';
      let inCodeBlock = false;

      for await (const chunk of response) {
        if (options.stream) {
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
      if (options.stream && inCodeBlock) {
        process.stdout.write(chalk.blue('\n```\n'));
      }

      if (!options.stream) {
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

    console.log(chalk.green('🤖 CageTools Chat - Enhanced Interactive Mode'));
    console.log(
      chalk.gray(
        '💡 Type "exit" to quit, "clear" to clear conversation history'
      )
    );
    console.log(
      chalk.gray('✨ Conversation context is preserved across messages')
    );
    console.log(
      chalk.gray('🚀 Press ESC to stop current response, then continue typing')
    );
    console.log();

    await this.initializeProvider(options?.provider ?? 'claude-code');

    const session = this.provider?.createSession();

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

    const showPrompt = () => {
      if (!isProcessing) {
        process.stdout.write(chalk.cyan('> ') + currentInput);
      }
    };

    const clearCurrentLine = () => {
      process.stdout.write('\r\x1b[K');
    };

    const processInput = async (input: string) => {
      if (input.toLowerCase() === 'exit') {
        rl.close();
        return;
      }

      if (input.toLowerCase() === 'clear') {
        console.clear();
        // Clear the session to reset conversation history
        if (session) {
          session.messages = [];
          session.state = {};
        }
        showPrompt();
        return;
      }

      if (this.provider) {
        isProcessing = true;
        currentResponseController = new AbortController();

        clearCurrentLine();
        console.log();

        try {
          const response = this.provider.query(input, {
            session,
            stream: true,
          });
          let inCodeBlock = false;

          for await (const chunk of response) {
            // Check if we should abort
            if (currentResponseController?.signal.aborted) {
              console.log();
              console.log(chalk.yellow('🛑 Response interrupted'));
              console.log();
              break;
            }

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
          }

          // Close any open code block
          if (inCodeBlock) {
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

      // ESC key (27) - stop current response
      if (keyCode === 27) {
        if (isProcessing && currentResponseController) {
          currentResponseController.abort();
        }
        return;
      }

      // Ctrl+C (3) - exit completely
      if (keyCode === 3) {
        console.log();
        console.log(chalk.yellow('👋 Goodbye!'));
        rl.close();
        return;
      }

      // Don't process input if we're currently processing a response
      if (isProcessing) {
        return;
      }

      // Enter key (13) - send message
      if (keyCode === 13) {
        if (currentInput.trim()) {
          processInput(currentInput.trim()).catch((error: Error) => {
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
