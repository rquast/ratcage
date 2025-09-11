import type { ChildProcess } from 'child_process';
import { spawn } from 'child_process';
import type {
  Provider,
  ProviderCapabilities,
  ProviderConfig,
  ProviderSession,
  StreamChunk,
  Tool,
  ToolResult,
} from '../types/provider';

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

  async initialize(config: ProviderConfig): Promise<void> {
    // Store config for use in query method
    this.config = config;

    // Check if claude CLI is available
    return new Promise((resolve, reject) => {
      const checkProcess = spawn('which', ['claude']);
      checkProcess.on('close', code => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error('Claude Code CLI not found. Please install it first.')
          );
        }
      });
    });
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
    // Use text output for now since JSON output might not include system info
    const args = ['--print'];

    // Add tool restrictions if specified
    if (options?.allowedTools) {
      args.push('--allowed-tools', options.allowedTools.join(','));
    }
    if (options?.disallowedTools) {
      args.push('--disallowed-tools', options.disallowedTools.join(','));
    }

    // Add the prompt as the last argument
    args.push(prompt);

    const claudeProcess = spawn('claude', args, {
      stdio: ['inherit', 'pipe', 'pipe'],
      env: { ...process.env },
      timeout: this.config?.timeout, // Use timeout from config
    });

    if (options?.stream) {
      // Stream text output directly
      if (!claudeProcess.stdout) {
        throw new Error('stdout stream not available');
      }
      for await (const chunk of claudeProcess.stdout) {
        yield {
          content: Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk),
          type: 'text',
          metadata: {},
        };
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

      // Return the text output directly
      yield {
        content: output,
        type: 'text',
        metadata: {},
      };
    }
  }

  createSession(): ProviderSession {
    const session = {
      id: `claude-code-${Date.now()}`,
      messages: [],
      state: {},
    };
    // Track session creation
    this.sessions.set(session.id, { created: new Date() });
    return session;
  }

  private sessions = new Map<string, { created: Date }>();

  async destroySession(sessionId: string): Promise<void> {
    // Track session for debugging/metrics
    if (this.sessions.has(sessionId)) {
      this.sessions.delete(sessionId);
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
  }
}
