import Anthropic from '@anthropic-ai/sdk';
import type {
  MessageParam as AnthropicMessage,
  MessageStreamEvent,
} from '@anthropic-ai/sdk/resources/messages.js';
import type {
  MessageParam,
  Provider,
  ProviderCapabilities,
  ProviderConfig,
  ProviderSession,
  StreamChunk,
  Tool,
  ToolResult,
} from '../types/provider.js';

export class ClaudeAPIProvider implements Provider {
  name = 'claude-api';

  capabilities: ProviderCapabilities = {
    streaming: true,
    tools: true,
    mcp: false, // MCP would require separate implementation
    subagents: false,
    hooks: true,
    webSearch: false,
    codeExecution: true,
  };

  // Available models as of 2025:
  // - claude-opus-4-1-20250805: Latest Opus 4.1, best for complex coding ($15/$75 per M tokens)
  // - claude-opus-4-20250514: Original Opus 4 ($15/$75 per M tokens)
  // - claude-sonnet-4-20250514: Sonnet 4, fast & capable ($3/$15 per M tokens)

  private client?: Anthropic;
  private config?: ProviderConfig;
  private sessions: Map<string, ProviderSession> = new Map();
  private usage = {
    tokensUsed: 0,
    requestsCount: 0,
    cost: 0,
  };
  private initialized = false;

  async initialize(config: ProviderConfig): Promise<void> {
    if (this.initialized) {
      throw new Error('Provider already initialized');
    }

    let apiKey = config.apiKey;

    // If no API key provided, check environment variable
    apiKey ??= process.env.ANTHROPIC_API_KEY;

    // Note: Claude Code's .credentials.json contains OAuth tokens for Claude.ai,
    // not API keys for the Anthropic API. These are different services.
    // The API requires a proper API key from console.anthropic.com

    if (!apiKey) {
      throw new Error(
        'No API key found. Please provide an ANTHROPIC_API_KEY environment variable or pass apiKey in config. ' +
          'Note: Claude Code uses OAuth tokens which are different from Anthropic API keys.'
      );
    }

    this.config = { ...config, apiKey };

    // Initialize Anthropic client
    this.client = new Anthropic({
      apiKey,
      baseURL: config.baseUrl,
      timeout: config.timeout ?? 30000,
      maxRetries: 3,
    });

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
    if (!this.initialized || !this.client) {
      throw new Error('Provider not initialized');
    }

    // Update usage stats
    this.usage.requestsCount++;

    // Build message history
    const messages: AnthropicMessage[] = [];

    // Add session history if available
    if (options?.session) {
      const sessionMessages = options.session.messages || [];
      for (const msg of sessionMessages) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          messages.push({
            role: msg.role,
            content: msg.content,
          });
        }
      }
    }

    // Add additional messages if provided
    if (options?.messages) {
      for (const msg of options.messages) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          messages.push({
            role: msg.role,
            content: msg.content,
          });
        }
      }
    }

    // Add current prompt as user message
    messages.push({
      role: 'user',
      content: prompt,
    });

    // Convert tools to Anthropic format if provided
    const anthropicTools = options?.tools?.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema as {
        type: 'object';
        properties?: Record<string, unknown>;
        required?: string[];
      },
    }));

    try {
      if (options?.stream) {
        // Streaming response
        const stream = await this.client.messages.create({
          model: this.config?.model ?? 'claude-opus-4-1-20250805',
          max_tokens: this.config?.maxTokens ?? 4096,
          temperature: this.config?.temperature ?? 0.7,
          messages,
          tools: anthropicTools,
          stream: true,
        });

        for await (const event of stream) {
          const chunk = this.processStreamEvent(event);
          if (chunk) {
            yield chunk;
          }
        }
      } else {
        // Non-streaming response
        const response = await this.client.messages.create({
          model: this.config?.model ?? 'claude-opus-4-1-20250805',
          max_tokens: this.config?.maxTokens ?? 4096,
          temperature: this.config?.temperature ?? 0.7,
          messages,
          tools: anthropicTools,
        });

        // Update token usage
        if (response.usage) {
          this.usage.tokensUsed +=
            response.usage.input_tokens + response.usage.output_tokens;

          // Estimate cost (Claude Opus 4.1 pricing: $15/$75 per million tokens)
          const inputCost = (response.usage.input_tokens / 1000000) * 15;
          const outputCost = (response.usage.output_tokens / 1000000) * 75;
          this.usage.cost += inputCost + outputCost;
        }

        // Process response content
        for (const content of response.content) {
          if (content.type === 'text') {
            yield {
              type: 'text',
              content: content.text,
            };
          } else if (content.type === 'tool_use') {
            yield {
              type: 'tool_use',
              content: JSON.stringify(content.input),
              metadata: {
                tool_name: content.name,
                tool_id: content.id,
              },
            };
          }
        }

        // Update session if provided
        if (options?.session) {
          // Add assistant response to session
          const assistantContent = response.content
            .filter(c => c.type === 'text')
            .map(c => (c as { type: 'text'; text: string }).text)
            .join('');

          if (assistantContent) {
            options.session.messages.push({
              role: 'assistant',
              content: assistantContent,
            });
          }
        }
      }
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        yield {
          type: 'error',
          content: `API Error: ${error.message}`,
          metadata: {
            status: error.status,
          },
        };
      } else if (error instanceof Error) {
        yield {
          type: 'error',
          content: error.message,
        };
      } else {
        yield {
          type: 'error',
          content: 'An unknown error occurred',
        };
      }
      throw error;
    }
  }

  private processStreamEvent(event: MessageStreamEvent): StreamChunk | null {
    if (event.type === 'content_block_delta') {
      const deltaEvent = event;
      if (deltaEvent.delta.type === 'text_delta') {
        return {
          type: 'text',
          content: deltaEvent.delta.text,
        };
      } else if (deltaEvent.delta.type === 'input_json_delta') {
        return {
          type: 'tool_use',
          content: deltaEvent.delta.partial_json,
          metadata: {
            tool_index: deltaEvent.index,
          },
        };
      }
    } else if (event.type === 'message_delta') {
      const deltaEvent = event;
      if (deltaEvent.usage) {
        // Update token usage from streaming
        this.usage.tokensUsed += deltaEvent.usage.output_tokens;
      }
    } else if (event.type === 'content_block_start') {
      if (event.content_block.type === 'tool_use') {
        return {
          type: 'tool_use',
          content: '',
          metadata: {
            tool_name: event.content_block.name,
            tool_id: event.content_block.id,
          },
        };
      }
    }

    return null;
  }

  async executeTools(tools: Tool[], input: unknown): Promise<ToolResult[]> {
    if (!this.initialized) {
      throw new Error('Provider not initialized');
    }

    const results: ToolResult[] = [];

    for (const tool of tools) {
      try {
        // Execute tool - the tool.execute already returns a ToolResult
        const result = await tool.execute(input);
        results.push(result);
      } catch (error) {
        results.push({
          toolName: tool.name,
          result: {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
          metadata: {
            executionTime: Date.now(),
            toolVersion: '1.0.0',
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
    // Clear all sessions
    this.sessions.clear();

    // Reset state
    this.initialized = false;
    this.config = undefined;
    this.client = undefined;

    // Reset usage stats
    this.usage = {
      tokensUsed: 0,
      requestsCount: 0,
      cost: 0,
    };
  }
}
