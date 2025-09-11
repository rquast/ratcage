import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
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

      if (argv.length === 0) {
        this.program.help();
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

  private async handleQuery(
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

      const response = this.provider.query(prompt, {
        stream: options.stream,
        session: options.session
          ? { id: options.session, messages: [], state: {} }
          : undefined,
      });

      let fullResponse = '';
      for await (const chunk of response) {
        if (options.stream) {
          process.stdout.write(chunk.content);
        } else {
          fullResponse += chunk.content;
        }
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

    console.log(chalk.green('Starting interactive chat mode...'));
    console.log(chalk.gray('Type "exit" to quit, "clear" to clear history'));

    await this.initializeProvider(options?.provider ?? 'claude-code');

    const session = this.provider?.createSession();

    while (true) {
      const { prompt } = await inquirer.prompt<{ prompt: string }>([
        {
          type: options?.multiline ? 'editor' : 'input',
          name: 'prompt',
          message: chalk.cyan('>'),
        },
      ]);

      if (prompt.toLowerCase() === 'exit') {
        break;
      }

      if (prompt.toLowerCase() === 'clear') {
        console.clear();
        continue;
      }

      if (this.provider) {
        const response = this.provider.query(prompt, { session });
        for await (const chunk of response) {
          process.stdout.write(chunk.content);
        }
        console.log(); // New line after response
      }
    }

    if (session && this.provider) {
      await this.provider.destroySession(session.id);
    }
    console.log(chalk.green('Chat ended.'));
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
