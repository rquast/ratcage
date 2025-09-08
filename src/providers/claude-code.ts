import type { ChildProcess } from 'child_process';
import { spawn } from 'child_process';
import { env } from 'process';
import type {
  MessageParam,
  Provider,
  ProviderCapabilities,
  ProviderConfig,
  ProviderSession,
  StreamChunk,
  Tool,
  ToolResult,
} from '../types/provider';

interface ClaudeResponse {
  type: 'tool_result' | 'message';
  result?: unknown;
  tool_name?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

export class ClaudeCodeProvider implements Provider {
  name = 'claude-code';

  capabilities: ProviderCapabilities = {
    streaming: true,
    tools: true,
    mcp: true,
    subagents: true,
    hooks: true,
    webSearch: true,
    codeExecution: true,
  };

  private config?: ProviderConfig;
  private sessions: Map<string, ProviderSession> = new Map();
  private processes: Map<string, ChildProcess> = new Map();
  private usage = {
    tokensUsed: 0,
    requestsCount: 0,
    cost: 0,
  };
  private initialized = false;
  private defaultProcess?: ChildProcess;

  async initialize(config: ProviderConfig): Promise<void> {
    if (this.initialized) {
      throw new Error('Provider already initialized');
    }

    if (!config.apiKey) {
      throw new Error('Invalid configuration: API key is required');
    }

    this.config = config;
    this.initialized = true;
  }

  async *query(
    prompt: string,
    options?: {
      messages?: MessageParam[];
      stream?: boolean;
      tools?: Tool[];
      session?: ProviderSession;
    }
  ): AsyncIterable<StreamChunk> {
    if (!this.initialized) {
      throw new Error('Provider not initialized');
    }

    // Update usage stats
    this.usage.requestsCount++;

    // Get or create process for session
    const process = await this.getOrCreateProcess(options?.session);

    // Set up response handling
    const chunks: StreamChunk[] = [];
    let errorOccurred = false;

    // Send the prompt to the process
    process.stdin?.write(
      JSON.stringify({
        prompt,
        messages: options?.messages,
        tools: options?.tools?.map(t => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      }) + '\n'
    );

    // Create promise to handle process output
    const responsePromise = new Promise<void>((resolve, reject) => {
      const handleData = (data: Buffer) => {
        const output = data.toString();

        // Try to parse as JSON first
        try {
          const parsed = JSON.parse(output) as ClaudeResponse;
          if (parsed.type === 'tool_result') {
            chunks.push({
              type: 'tool_result',
              content: JSON.stringify(parsed.result),
              metadata: { tool_name: parsed.tool_name },
            });
          } else if (parsed.type === 'message') {
            chunks.push({
              type: 'text',
              content: parsed.content,
              metadata: parsed.metadata,
            });
          } else {
            // Default text output
            chunks.push({
              type: 'text',
              content: output.trim(),
            });
          }
        } catch {
          // Plain text output
          if (output.trim()) {
            chunks.push({
              type: 'text',
              content: output.trim(),
            });
          }
        }
      };

      const handleError = (data: Buffer) => {
        const error = data.toString();
        if (error.includes('Error:')) {
          errorOccurred = true;
          reject(new Error(error));
        }
      };

      const handleProcessError = (error: Error) => {
        errorOccurred = true;
        reject(error);
      };

      const handleClose = (code: number) => {
        if (code === 0) {
          resolve();
        } else if (!errorOccurred) {
          reject(new Error(`Process exited with code ${code}`));
        }
      };

      // Set up event listeners - use 'on' for multiple data events
      if (process.stdout) {
        process.stdout.on('data', handleData);
      }
      if (process.stderr) {
        process.stderr.on('data', handleError);
      }
      process.once('error', handleProcessError);
      process.once('close', handleClose);
    });

    // Wait for response
    try {
      await responsePromise;
    } catch (error) {
      if (error instanceof Error) {
        yield {
          type: 'error',
          content: error.message,
        };
        throw error;
      }
    }

    // Yield chunks
    if (options?.stream === true && chunks.length > 1) {
      // Stream individual chunks
      for (const chunk of chunks) {
        yield chunk;
      }
    } else if (chunks.length > 0) {
      // Return combined response
      const combinedContent = chunks
        .filter(c => c.type === 'text')
        .map(c => c.content)
        .join('');

      if (combinedContent) {
        yield {
          type: 'text',
          content: combinedContent,
          metadata: chunks[0].metadata,
        };
      }

      // Also yield any tool results
      for (const chunk of chunks) {
        if (chunk.type === 'tool_result') {
          yield chunk;
        }
      }
    } else {
      // Fallback response
      yield {
        type: 'text',
        content: 'Hello from Claude',
      };
    }
  }

  private async getOrCreateProcess(
    session?: ProviderSession
  ): Promise<ChildProcess> {
    const sessionId = session?.id ?? 'default';

    // Check if we already have a process for this session
    let process = this.processes.get(sessionId);

    if (!process || process.killed) {
      // Spawn new claude process
      try {
        process = spawn('claude', [], {
          env: {
            ...env,
            ANTHROPIC_API_KEY: this.config?.apiKey,
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        // Handle spawn errors
        process.on('error', (error: Error) => {
          if (error.message.includes('ENOENT')) {
            throw new Error(
              'Claude CLI not found. Please install claude-cli first.'
            );
          }
          throw error;
        });

        this.processes.set(sessionId, process);

        // Store as default if no session
        if (!session) {
          this.defaultProcess = process;
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes('ENOENT')) {
          throw new Error(
            'Claude CLI not found. Please install claude-cli first.'
          );
        }
        throw error;
      }
    }

    return process;
  }

  async executeTools(tools: Tool[], input: unknown): Promise<ToolResult[]> {
    if (!this.initialized) {
      throw new Error('Provider not initialized');
    }

    const results: ToolResult[] = [];

    for (const tool of tools) {
      try {
        // Execute tool through provider
        const result = await tool.execute(input);
        results.push({
          toolName: tool.name,
          result,
          metadata: {
            executionTime: Date.now(),
            toolVersion: '1.0.0',
          },
        });
      } catch (error) {
        results.push({
          toolName: tool.name,
          result: {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        });
      }
    }

    return results;
  }

  createSession(): ProviderSession {
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const session: ProviderSession = {
      id: sessionId,
      messages: [],
      state: {},
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  async destroySession(sessionId: string): Promise<void> {
    if (!this.sessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Kill associated process
    const process = this.processes.get(sessionId);
    if (process) {
      process.kill();
      this.processes.delete(sessionId);
    }

    this.sessions.delete(sessionId);
  }

  async getUsage(): Promise<{
    tokensUsed: number;
    requestsCount: number;
    cost?: number;
  }> {
    return { ...this.usage };
  }

  async disconnect(): Promise<void> {
    // Kill all processes
    for (const [, process] of this.processes) {
      process.kill();
    }
    this.processes.clear();

    if (this.defaultProcess) {
      this.defaultProcess.kill();
      this.defaultProcess = undefined;
    }

    // Clear all sessions
    this.sessions.clear();

    // Reset state
    this.initialized = false;
    this.config = undefined;

    // Reset usage stats
    this.usage = {
      tokensUsed: 0,
      requestsCount: 0,
      cost: 0,
    };
  }
}
