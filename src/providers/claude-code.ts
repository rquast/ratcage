import type { ChildProcess } from 'child_process';
import { spawn, execSync } from 'child_process';
import { existsSync } from 'fs';
import { homedir, platform } from 'os';
import { join } from 'path';
import type {
  Provider,
  ProviderCapabilities,
  ProviderConfig,
  ProviderSession,
  StreamChunk,
  Tool,
  ToolResult,
} from '../types/provider.js';

export class ClaudeCodeProvider implements Provider {
  name = 'claude-code';

  capabilities: ProviderCapabilities = {
    streaming: true,
    tools: true,
    mcp: false,
    subagents: false,
    hooks: false,
    webSearch: false,
    codeExecution: true,
  };

  private claudeProcess?: ChildProcess;
  private config?: ProviderConfig;
  private claudePath?: string;
  private activeSessions = new Map<
    string,
    { sessionId: string; isFirst: boolean }
  >();

  async initialize(config: ProviderConfig): Promise<void> {
    // Store config for use in query method
    this.config = config;

    // Try to find Claude Code in various locations
    this.claudePath = await this.findClaudePath();

    if (!this.claudePath) {
      throw new Error(
        'Claude Code CLI not found. Please install it first. ' +
          'Visit https://docs.anthropic.com/en/docs/claude-code/setup for installation instructions.'
      );
    }
  }

  private async findClaudePath(): Promise<string | undefined> {
    const home = homedir();
    const isWindows = platform() === 'win32';

    // Common installation paths to check
    const pathsToCheck: string[] = [
      // Check if 'claude' is directly in PATH first
      'claude',

      // Local installation (new standard location after migration)
      join(home, '.claude', 'local', 'claude'),

      // User bin directories (standard installer locations)
      join(home, '.local', 'bin', 'claude'),

      // NPM global installations
      join(home, '.npm-global', 'bin', 'claude'),

      // Common system paths
      '/usr/local/bin/claude',
      '/usr/bin/claude',
      '/opt/claude/bin/claude',

      // Homebrew on macOS
      '/opt/homebrew/bin/claude',
      '/usr/local/Homebrew/bin/claude',
    ];

    // Check CLAUDE_CONFIG_DIR environment variable
    const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    if (claudeConfigDir) {
      pathsToCheck.unshift(join(claudeConfigDir, 'local', 'claude'));
    }

    // First, try the simple 'which' command for PATH-accessible claude
    try {
      const whichResult = execSync('which claude', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();
      if (whichResult && existsSync(whichResult)) {
        return whichResult;
      }
    } catch {
      // 'which' failed, continue checking other locations
    }

    // Check each potential path
    for (const path of pathsToCheck) {
      if (path === 'claude') {
        continue; // Skip, already checked with 'which'
      }

      if (existsSync(path)) {
        // Verify it's executable by trying to get version
        try {
          execSync(`"${path}" --version`, {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore'],
            timeout: 5000,
          });
          return path;
        } catch {
          // Not executable or not valid Claude binary
          continue;
        }
      }
    }

    // Check shell configuration files for aliases (Mac/Linux)
    if (!isWindows) {
      const shellConfigs = [
        '.zshrc',
        '.bashrc',
        '.bash_profile',
        '.profile',
        '.config/fish/config.fish',
      ];

      for (const configFile of shellConfigs) {
        const configPath = join(home, configFile);
        if (existsSync(configPath)) {
          try {
            const content = execSync(`cat "${configPath}"`, {
              encoding: 'utf8',
            });

            // Look for alias definitions
            const aliasMatch = content.match(
              /alias\s+claude=["']?([^"'\n]+)["']?/m
            );
            if (aliasMatch) {
              let aliasPath = aliasMatch[1];
              // Expand ~ to home directory
              aliasPath = aliasPath.replace(/^~/, home);
              // Remove any shell variables like $HOME
              aliasPath = aliasPath.replace(/\$HOME/g, home);

              if (existsSync(aliasPath)) {
                try {
                  execSync(`"${aliasPath}" --version`, {
                    encoding: 'utf8',
                    stdio: ['pipe', 'pipe', 'ignore'],
                    timeout: 5000,
                  });
                  return aliasPath;
                } catch {
                  // Not valid Claude binary
                }
              }
            }

            // Look for PATH exports that might contain claude
            const pathMatches = content.match(
              /export\s+PATH=["']?([^"'\n]+)["']?/gm
            );
            if (pathMatches) {
              for (const pathMatch of pathMatches) {
                const pathValue = pathMatch
                  .replace(/export\s+PATH=["']?/, '')
                  .replace(/["']?$/, '');
                const paths = pathValue.split(':');
                for (let pathDir of paths) {
                  // Expand variables
                  pathDir = pathDir
                    .replace(/^~/, home)
                    .replace(/\$HOME/g, home);
                  if (pathDir.includes('$PATH')) {
                    continue; // Skip PATH references
                  }

                  const claudeInPath = join(pathDir, 'claude');
                  if (existsSync(claudeInPath)) {
                    try {
                      execSync(`"${claudeInPath}" --version`, {
                        encoding: 'utf8',
                        stdio: ['pipe', 'pipe', 'ignore'],
                        timeout: 5000,
                      });
                      return claudeInPath;
                    } catch {
                      // Not valid
                    }
                  }
                }
              }
            }
          } catch {
            // Error reading config file, continue
          }
        }
      }
    }

    return undefined;
  }

  async *query(
    prompt: string,
    options?: {
      stream?: boolean;
      tools?: Tool[];
      session?: ProviderSession;
      allowedTools?: string[];
      disallowedTools?: string[];
    }
  ): AsyncIterableIterator<StreamChunk> {
    const args = ['--print'];

    // Always use streaming JSON format for full Claude Code experience
    args.push(
      '--output-format=stream-json',
      '--include-partial-messages',
      '--verbose'
    );

    // Handle session continuity for chat-like experience
    if (options?.session) {
      const sessionData = this.activeSessions.get(options.session.id);
      if (sessionData) {
        // Continue existing conversation
        if (!sessionData.isFirst) {
          args.push('--continue');
        } else {
          // First message in session, use session ID
          args.push('--session-id', sessionData.sessionId);
          sessionData.isFirst = false;
        }
      } else {
        // New session - generate UUID for Claude Code
        const sessionId = this.generateUUID();
        args.push('--session-id', sessionId);
        this.activeSessions.set(options.session.id, {
          sessionId,
          isFirst: false,
        });
      }
    }

    // Add tool restrictions if specified
    if (options?.allowedTools) {
      args.push('--allowed-tools', options.allowedTools.join(','));
    }
    if (options?.disallowedTools) {
      args.push('--disallowed-tools', options.disallowedTools.join(','));
    }

    // Add the prompt as the last argument
    args.push(prompt);

    const claudeProcess = spawn(this.claudePath ?? 'claude', args, {
      stdio: ['inherit', 'pipe', 'pipe'],
      env: { ...process.env },
      timeout: this.config?.timeout,
    });

    if (options?.stream) {
      // Stream JSON output with proper parsing
      if (!claudeProcess.stdout) {
        throw new Error('stdout stream not available');
      }

      let buffer = '';

      for await (const chunk of claudeProcess.stdout) {
        const rawContent = Buffer.isBuffer(chunk)
          ? chunk.toString()
          : String(chunk);
        buffer += rawContent;

        // Process complete JSON lines
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? ''; // Keep incomplete line in buffer

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) {
            continue;
          }

          try {
            const event = JSON.parse(trimmedLine) as {
              type: string;
              event?: {
                type: string;
                delta?: {
                  type: string;
                  text?: string;
                };
                content_block?: {
                  type: string;
                  name?: string;
                  input?: unknown;
                };
              };
              subtype?: string;
              session_id?: string;
              metadata?: Record<string, unknown>;
            };

            // Handle Claude Code's actual JSON format
            if (event.type === 'stream_event' && event.event) {
              const streamEvent = event.event;

              // Handle text content deltas (real-time streaming)
              if (
                streamEvent.type === 'content_block_delta' &&
                streamEvent.delta?.type === 'text_delta'
              ) {
                yield {
                  type: 'text',
                  content: streamEvent.delta.text ?? '',
                  isComplete: false,
                  metadata: { session_id: event.session_id },
                };
              }

              // Handle tool use events
              else if (
                streamEvent.type === 'content_block_start' &&
                streamEvent.content_block?.type === 'tool_use'
              ) {
                const toolName = streamEvent.content_block.name;
                const toolInput = streamEvent.content_block.input as Record<
                  string,
                  unknown
                >;

                // Show comprehensive tool call information
                let toolDescription = `\n🔧 TOOL CALL: ${toolName}\n`;
                toolDescription += `┌─────────────────────────────────────\n`;

                if (toolInput && Object.keys(toolInput).length > 0) {
                  for (const [key, value] of Object.entries(toolInput)) {
                    let valueStr: string;
                    if (typeof value === 'string') {
                      valueStr = value;
                    } else if (typeof value === 'object' && value !== null) {
                      valueStr = JSON.stringify(value, null, 2);
                    } else {
                      valueStr = String(value);
                    }

                    // Show full value, don't truncate
                    const lines = valueStr.split('\n');
                    toolDescription += `│ ${key}:\n`;
                    for (const line of lines) {
                      toolDescription += `│   ${line}\n`;
                    }
                    toolDescription += `│\n`;
                  }
                } else {
                  toolDescription += `│ (no parameters)\n`;
                }

                toolDescription += `└─────────────────────────────────────\n`;

                yield {
                  type: 'tool_use',
                  content: toolDescription,
                  metadata: {
                    toolName: toolName,
                    toolInput: toolInput,
                    session_id: event.session_id,
                  },
                };
              }
            }

            // Handle system messages (including thinking-like content)
            else if (event.type === 'system' && event.subtype === 'init') {
              // This is session initialization, we can ignore or use for metadata
            }
          } catch {
            // If JSON parsing fails, treat as raw text
            yield {
              type: 'text',
              content: trimmedLine + '\n',
              metadata: {},
            };
          }
        }
      }

      // Process any remaining buffer content
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer.trim()) as {
            content?: string;
            metadata?: Record<string, unknown>;
          };
          if (event.content) {
            yield {
              type: 'text',
              content: event.content,
              metadata: event.metadata ?? {},
            };
          }
        } catch {
          yield {
            type: 'text',
            content: buffer,
            metadata: {},
          };
        }
      }
    } else {
      // Non-streaming mode: collect all output
      let output = '';
      let error = '';

      claudeProcess.stdout?.on('data', (chunk: Buffer | string) => {
        output += Buffer.isBuffer(chunk) ? chunk.toString() : chunk;
      });

      claudeProcess.stderr?.on('data', (chunk: Buffer | string) => {
        error += Buffer.isBuffer(chunk) ? chunk.toString() : chunk;
      });

      await new Promise<void>((resolve, reject) => {
        claudeProcess.on('close', code => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Claude Code exited with code ${code}: ${error}`));
          }
        });
      });

      yield {
        content: output,
        type: 'text',
        metadata: {},
      };
    }
  }

  createSession(): ProviderSession {
    const sessionId = this.generateUUID();
    const session = {
      id: sessionId,
      messages: [],
      state: {},
      startTime: new Date(),
    };
    // Initialize session tracking but don't mark as used yet
    this.activeSessions.set(sessionId, { sessionId, isFirst: true });
    return session;
  }

  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  async destroySession(sessionId: string): Promise<void> {
    // Clean up our session tracking
    if (this.activeSessions.has(sessionId)) {
      this.activeSessions.delete(sessionId);
    }
    // Claude Code CLI manages actual session cleanup internally
  }

  async executeTools(tools: Tool[], input: unknown): Promise<ToolResult[]> {
    // TODO: Implement tool execution by converting to Claude Code's tool format
    // For now, return empty results for empty tool list, error otherwise
    if (tools.length === 0) {
      return [];
    }

    // Log what tools were requested for debugging
    const toolNames = tools.map(t => t.name).join(', ');
    throw new Error(
      `Custom tools not yet implemented for Claude Code provider. Requested tools: ${toolNames}, with input: ${JSON.stringify(input)}`
    );
  }

  async getUsage(): Promise<{
    tokensUsed: number;
    requestsCount: number;
    cost?: number;
  }> {
    // Claude Code doesn't expose usage metrics
    return {
      tokensUsed: 0,
      requestsCount: 0,
    };
  }

  async disconnect(): Promise<void> {
    return this.dispose();
  }

  async dispose(): Promise<void> {
    if (this.claudeProcess) {
      this.claudeProcess.kill();
      this.claudeProcess = undefined;
    }
    // Clear all active sessions
    this.activeSessions.clear();
  }
}
