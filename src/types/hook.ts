/**
 * Types of hooks that can be registered in the system
 */
export type HookType =
  | 'pre-tool-use'
  | 'post-tool-use'
  | 'user-prompt-submit'
  | 'session-start'
  | 'session-end'
  | 'notification'
  | 'error'
  | 'warning';

/**
 * Context passed to hooks during execution
 */
export interface HookContext {
  type: HookType;
  timestamp: Date;
  sessionId?: string;
  userId?: string;
  data: Record<string, unknown>;
  environment?: Record<string, string>;
}

/**
 * Result returned from hook execution
 */
export interface HookResult {
  success: boolean;
  continue: boolean;
  message?: string;
  data?: Record<string, unknown>;
  error?: Error;
}

/**
 * Hook interface for lifecycle management
 */
export interface Hook {
  name: string;
  type: HookType;
  enabled: boolean;
  priority?: number;
  description?: string;
  config?: Record<string, unknown>;
  execute: (context: HookContext) => Promise<HookResult> | HookResult;
}

/**
 * Hook manager interface for managing hooks
 */
export interface HookManager {
  register(hook: Hook): void;
  unregister(hookName: string): void;
  execute(
    type: HookType,
    context: Omit<HookContext, 'type'>
  ): Promise<HookResult[]>;
  getHooks(type?: HookType): Hook[];
  enableHook(hookName: string): void;
  disableHook(hookName: string): void;
}
