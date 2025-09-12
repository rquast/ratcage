// Define our own Message types since SDK doesn't export them directly
export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  name?: string;
}

export interface MessageParam {
  role: 'user' | 'assistant' | 'system';
  content: string;
  name?: string;
}

export interface ProviderCapabilities {
  streaming: boolean;
  tools: boolean;
  mcp: boolean;
  subagents: boolean;
  hooks: boolean;
  webSearch: boolean;
  codeExecution: boolean;
}

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  maxTokens?: number;
  temperature?: number;
  model?: string;
  timeout?: number;
  retries?: number;
  enableMCP?: boolean;
}

export interface ToolResult {
  toolName: string;
  result: {
    success: boolean;
    output?: string;
    error?: string;
  };
  metadata?: Record<string, unknown>;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  execute(input: unknown): Promise<ToolResult>;
}

export interface ProviderSession {
  id: string;
  messages: Message[];
  state: Record<string, unknown>;
  startTime?: Date;
  context?: Record<string, unknown>;
}

export interface StreamChunk {
  type:
    | 'text'
    | 'tool_use'
    | 'tool_result'
    | 'error'
    | 'thinking'
    | 'code_snippet'
    | 'partial_code';
  content: string;
  metadata?: Record<string, unknown>;
  language?: string; // For code snippets
  isComplete?: boolean; // For partial updates
}

export interface Provider {
  name: string;
  capabilities: ProviderCapabilities;

  initialize(config: ProviderConfig): Promise<void>;

  query(
    prompt: string,
    options?: {
      messages?: MessageParam[];
      stream?: boolean;
      tools?: Tool[];
      session?: ProviderSession;
      signal?: AbortSignal;
    }
  ): AsyncIterable<StreamChunk>;

  executeTools(tools: Tool[], input: unknown): Promise<ToolResult[]>;

  createSession(): ProviderSession;

  destroySession(sessionId: string): Promise<void>;

  getUsage(): Promise<{
    tokensUsed: number;
    requestsCount: number;
    cost?: number;
  }>;

  disconnect(): Promise<void>;
}
