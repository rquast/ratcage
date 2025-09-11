import { describe, it, expect, vi } from 'vitest';
import type { Hook, HookContext, HookResult, HookType } from '../../types/hook';

describe('Hook Interface', () => {
  describe('Hook Type Definitions', () => {
    it('should define all hook types', () => {
      const hookTypes: HookType[] = [
        'pre-tool-use',
        'post-tool-use',
        'user-prompt-submit',
        'session-start',
        'session-end',
        'notification',
        'error',
        'warning',
      ];

      // This test verifies the type exists at compile time
      expect(hookTypes).toHaveLength(8);
    });
  });

  describe('Hook Context', () => {
    it('should provide context for hook execution', () => {
      const context: HookContext = {
        type: 'pre-tool-use',
        timestamp: new Date(),
        sessionId: 'test-session',
        userId: 'test-user',
        data: {
          toolName: 'BashTool',
          args: ['ls', '-la'],
        },
        environment: {
          NODE_ENV: 'test',
          CAGETOOLS_HOME: '/home/user/.cagetools',
        },
      };

      expect(context.type).toBe('pre-tool-use');
      expect(context.sessionId).toBe('test-session');
      expect(context.data.toolName).toBe('BashTool');
    });
  });

  describe('Hook Result', () => {
    it('should handle successful hook execution', () => {
      const result: HookResult = {
        success: true,
        continue: true,
        message: 'Hook executed successfully',
        data: { processed: true },
      };

      expect(result.success).toBe(true);
      expect(result.continue).toBe(true);
    });

    it('should handle hook blocking execution', () => {
      const result: HookResult = {
        success: true,
        continue: false,
        message: 'Dangerous operation blocked',
        data: { reason: 'rm -rf detected' },
      };

      expect(result.success).toBe(true);
      expect(result.continue).toBe(false);
      expect(result.message).toContain('blocked');
    });

    it('should handle hook errors', () => {
      const result: HookResult = {
        success: false,
        continue: false,
        message: 'Hook execution failed',
        error: new Error('Script not found'),
      };

      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
    });
  });

  describe('Hook Implementation', () => {
    it('should implement the Hook interface', async () => {
      const mockHook: Hook = {
        name: 'test-hook',
        type: 'pre-tool-use',
        enabled: true,
        priority: 100,
        description: 'Test hook for validation',
        execute: vi.fn().mockResolvedValue({
          success: true,
          continue: true,
          message: 'Hook executed',
        }),
      };

      const context: HookContext = {
        type: 'pre-tool-use',
        timestamp: new Date(),
        sessionId: 'test',
        data: {},
      };

      const result = await mockHook.execute(context);

      expect(mockHook.name).toBe('test-hook');
      expect(mockHook.type).toBe('pre-tool-use');
      expect(mockHook.enabled).toBe(true);
      expect(mockHook.priority).toBe(100);
      expect(result.success).toBe(true);
      expect(mockHook.execute).toHaveBeenCalledWith(context);
    });

    it('should support async hook execution', async () => {
      const mockHook: Hook = {
        name: 'async-hook',
        type: 'user-prompt-submit',
        enabled: true,
        execute: vi.fn().mockImplementation(async (context: HookContext) => {
          // Simulate async operation
          await new Promise(resolve => setTimeout(resolve, 10));
          return {
            success: true,
            continue: true,
            message: `Processed prompt: ${context.data.prompt}`,
          };
        }),
      };

      const context: HookContext = {
        type: 'user-prompt-submit',
        timestamp: new Date(),
        sessionId: 'test',
        data: { prompt: 'Hello, Claude' },
      };

      const result = await mockHook.execute(context);

      expect(result.success).toBe(true);
      expect(result.message).toContain('Hello, Claude');
    });

    it('should support hook configuration', () => {
      const hookWithConfig: Hook = {
        name: 'configurable-hook',
        type: 'post-tool-use',
        enabled: true,
        priority: 50,
        config: {
          timeout: 5000,
          retries: 3,
          customOption: 'value',
        },
        execute: vi.fn(),
      };

      expect(hookWithConfig.config).toBeDefined();
      expect(hookWithConfig.config?.timeout).toBe(5000);
      expect(hookWithConfig.config?.retries).toBe(3);
    });
  });

  describe('Hook Priority', () => {
    it('should support priority ordering', () => {
      const hooks: Hook[] = [
        {
          name: 'low-priority',
          type: 'pre-tool-use',
          enabled: true,
          priority: 10,
          execute: vi.fn(),
        },
        {
          name: 'high-priority',
          type: 'pre-tool-use',
          enabled: true,
          priority: 100,
          execute: vi.fn(),
        },
        {
          name: 'medium-priority',
          type: 'pre-tool-use',
          enabled: true,
          priority: 50,
          execute: vi.fn(),
        },
      ];

      // Sort by priority (higher numbers first)
      const sorted = hooks.sort(
        (a, b) => (b.priority ?? 0) - (a.priority ?? 0)
      );

      expect(sorted[0].name).toBe('high-priority');
      expect(sorted[1].name).toBe('medium-priority');
      expect(sorted[2].name).toBe('low-priority');
    });
  });

  describe('Hook Validation', () => {
    it('should validate hook type matches context type', async () => {
      const hook: Hook = {
        name: 'type-validator',
        type: 'pre-tool-use',
        enabled: true,
        execute: vi.fn().mockImplementation((context: HookContext) => {
          if (context.type !== 'pre-tool-use') {
            return {
              success: false,
              continue: false,
              message: 'Type mismatch',
              error: new Error(`Expected pre-tool-use, got ${context.type}`),
            };
          }
          return { success: true, continue: true };
        }),
      };

      const validContext: HookContext = {
        type: 'pre-tool-use',
        timestamp: new Date(),
        sessionId: 'test',
        data: {},
      };

      const invalidContext: HookContext = {
        type: 'post-tool-use',
        timestamp: new Date(),
        sessionId: 'test',
        data: {},
      };

      const validResult = await hook.execute(validContext);
      expect(validResult.success).toBe(true);

      const invalidResult = await hook.execute(invalidContext);
      expect(invalidResult.success).toBe(false);
      expect(invalidResult.error?.message).toContain('Expected pre-tool-use');
    });
  });

  describe('Hook Error Handling', () => {
    it('should handle hook execution errors gracefully', async () => {
      const errorHook: Hook = {
        name: 'error-hook',
        type: 'error',
        enabled: true,
        execute: vi.fn().mockRejectedValue(new Error('Hook failed')),
      };

      const context: HookContext = {
        type: 'error',
        timestamp: new Date(),
        sessionId: 'test',
        data: { error: 'Some error occurred' },
      };

      await expect(errorHook.execute(context)).rejects.toThrow('Hook failed');
    });

    it('should support error recovery in hooks', async () => {
      const recoveryHook: Hook = {
        name: 'recovery-hook',
        type: 'error',
        enabled: true,
        execute: vi.fn().mockImplementation(async (context: HookContext) => {
          try {
            // Simulate operation that might fail
            if (context.data.shouldFail) {
              throw new Error('Operation failed');
            }
            return { success: true, continue: true };
          } catch (error) {
            // Recovery logic
            return {
              success: false,
              continue: true, // Continue despite error
              message: 'Recovered from error',
              error: error as Error,
            };
          }
        }),
      };

      const failContext: HookContext = {
        type: 'error',
        timestamp: new Date(),
        sessionId: 'test',
        data: { shouldFail: true },
      };

      const result = await recoveryHook.execute(failContext);
      expect(result.success).toBe(false);
      expect(result.continue).toBe(true); // Should continue despite error
      expect(result.message).toContain('Recovered');
    });
  });
});
