/**
 * Tool result types
 */
export type ToolResultStatus = 'success' | 'error' | 'timeout' | 'cancelled';

/**
 * Base tool result interface
 */
export interface ToolResult {
  status: ToolResultStatus;
  output?: string;
  error?: string;
  exitCode?: number;
  duration?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Tool configuration interface
 */
export interface ToolConfig {
  enabled?: boolean;
  timeout?: number;
  workingDirectory?: string;
  environment?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * Base tool interface
 */
export interface Tool {
  name: string;
  description: string;
  config: ToolConfig;
  enabled: boolean;

  execute(args: unknown[]): Promise<ToolResult>;
  validate?(args: unknown[]): boolean;
  cleanup?(): Promise<void>;
}

/**
 * Bash tool specific types
 */
export interface BashToolConfig extends ToolConfig {
  shell?: string;
  allowedCommands?: string[];
  blockedCommands?: string[];
  maxOutputSize?: number;
}

export interface BashToolResult extends ToolResult {
  command: string;
  pid?: number;
}

/**
 * File tool specific types
 */
export interface FileToolConfig extends ToolConfig {
  allowedPaths?: string[];
  blockedPaths?: string[];
  maxFileSize?: number;
  encoding?: BufferEncoding;
}

export interface FileOperation {
  type:
    | 'read'
    | 'write'
    | 'append'
    | 'delete'
    | 'copy'
    | 'move'
    | 'exists'
    | 'stat';
  path: string;
  content?: string;
  destinationPath?: string;
  options?: Record<string, unknown>;
}

export interface FileToolResult extends ToolResult {
  operation: FileOperation;
  content?: string;
  stats?: {
    size: number;
    modified: Date;
    created: Date;
    isDirectory: boolean;
  };
}

/**
 * Search tool specific types
 */
export interface SearchToolConfig extends ToolConfig {
  maxResults?: number;
  maxDepth?: number;
  includeHidden?: boolean;
  followSymlinks?: boolean;
}

export interface SearchQuery {
  type: 'grep' | 'glob' | 'find';
  pattern: string;
  path?: string;
  options?: {
    caseSensitive?: boolean;
    wholeWords?: boolean;
    regex?: boolean;
    includeFiles?: string[];
    excludeFiles?: string[];
  };
}

export interface SearchMatch {
  file: string;
  line?: number;
  column?: number;
  match: string;
  context?: {
    before: string[];
    after: string[];
  };
}

export interface SearchToolResult extends ToolResult {
  query: SearchQuery;
  matches: SearchMatch[];
  totalMatches: number;
  filesSearched: number;
}

/**
 * Tool registry types
 */
export interface ToolRegistryEntry {
  tool: Tool;
  metadata: {
    registered: Date;
    lastUsed?: Date;
    usageCount: number;
  };
}

export interface ToolRegistry {
  register(tool: Tool): void;
  unregister(name: string): boolean;
  get(name: string): Tool | undefined;
  list(): ToolRegistryEntry[];
  enable(name: string): boolean;
  disable(name: string): boolean;
  isEnabled(name: string): boolean;
}
