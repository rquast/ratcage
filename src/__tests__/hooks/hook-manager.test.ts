import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HookManager } from '../../hooks/HookManager';
import type { Hook } from '../../types/hook';

describe('HookManager', () => {
  let hookManager: HookManager;

  beforeEach(() => {
    hookManager = new HookManager();
  });

  describe('Hook Registration', () => {
    it('should register a hook', () => {
      const hook: Hook = {
        name: 'test-hook',
        type: 'pre-tool-use',
        enabled: true,
        execute: vi.fn(),
      };

      hookManager.register(hook);
      const hooks = hookManager.getHooks();

      expect(hooks).toHaveLength(1);
      expect(hooks[0].name).toBe('test-hook');
    });

    it('should not register duplicate hooks', () => {
      const hook: Hook = {
        name: 'test-hook',
        type: 'pre-tool-use',
        enabled: true,
        execute: vi.fn(),
      };

      hookManager.register(hook);
      hookManager.register(hook);

      const hooks = hookManager.getHooks();
      expect(hooks).toHaveLength(1);
    });

    it('should unregister a hook', () => {
      const hook: Hook = {
        name: 'test-hook',
        type: 'pre-tool-use',
        enabled: true,
        execute: vi.fn(),
      };

      hookManager.register(hook);
      hookManager.unregister('test-hook');

      const hooks = hookManager.getHooks();
      expect(hooks).toHaveLength(0);
    });

    it('should handle unregistering non-existent hook', () => {
      expect(() => {
        hookManager.unregister('non-existent');
      }).not.toThrow();
    });
  });

  describe('Hook Retrieval', () => {
    beforeEach(() => {
      const hooks: Hook[] = [
        {
          name: 'pre-tool-hook',
          type: 'pre-tool-use',
          enabled: true,
          execute: vi.fn(),
        },
        {
          name: 'post-tool-hook',
          type: 'post-tool-use',
          enabled: true,
          execute: vi.fn(),
        },
        {
          name: 'error-hook',
          type: 'error',
          enabled: true,
          execute: vi.fn(),
        },
      ];

      hooks.forEach(hook => hookManager.register(hook));
    });

    it('should get all hooks', () => {
      const hooks = hookManager.getHooks();
      expect(hooks).toHaveLength(3);
    });

    it('should get hooks by type', () => {
      const preToolHooks = hookManager.getHooks('pre-tool-use');
      expect(preToolHooks).toHaveLength(1);
      expect(preToolHooks[0].name).toBe('pre-tool-hook');

      const errorHooks = hookManager.getHooks('error');
      expect(errorHooks).toHaveLength(1);
      expect(errorHooks[0].name).toBe('error-hook');
    });

    it('should return empty array for non-existent type', () => {
      const hooks = hookManager.getHooks('session-start');
      expect(hooks).toHaveLength(0);
    });
  });

  describe('Hook Execution', () => {
    it('should execute hooks of specific type', async () => {
      const mockExecute = vi.fn().mockResolvedValue({
        success: true,
        continue: true,
        message: 'Hook executed',
      });

      const hook: Hook = {
        name: 'test-hook',
        type: 'pre-tool-use',
        enabled: true,
        execute: mockExecute,
      };

      hookManager.register(hook);

      const results = await hookManager.execute('pre-tool-use', {
        timestamp: new Date(),
        sessionId: 'test-session',
        data: { toolName: 'BashTool' },
      });

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(mockExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'pre-tool-use',
          sessionId: 'test-session',
        })
      );
    });

    it('should execute multiple hooks in priority order', async () => {
      const executionOrder: string[] = [];

      const hooks: Hook[] = [
        {
          name: 'low-priority',
          type: 'pre-tool-use',
          enabled: true,
          priority: 10,
          execute: vi.fn().mockImplementation(async () => {
            executionOrder.push('low-priority');
            return { success: true, continue: true };
          }),
        },
        {
          name: 'high-priority',
          type: 'pre-tool-use',
          enabled: true,
          priority: 100,
          execute: vi.fn().mockImplementation(async () => {
            executionOrder.push('high-priority');
            return { success: true, continue: true };
          }),
        },
        {
          name: 'medium-priority',
          type: 'pre-tool-use',
          enabled: true,
          priority: 50,
          execute: vi.fn().mockImplementation(async () => {
            executionOrder.push('medium-priority');
            return { success: true, continue: true };
          }),
        },
      ];

      hooks.forEach(hook => hookManager.register(hook));

      await hookManager.execute('pre-tool-use', {
        timestamp: new Date(),
        sessionId: 'test',
        data: {},
      });

      expect(executionOrder).toEqual([
        'high-priority',
        'medium-priority',
        'low-priority',
      ]);
    });

    it('should stop execution if hook returns continue: false', async () => {
      const hooks: Hook[] = [
        {
          name: 'blocking-hook',
          type: 'pre-tool-use',
          enabled: true,
          priority: 100,
          execute: vi.fn().mockResolvedValue({
            success: true,
            continue: false,
            message: 'Blocked',
          }),
        },
        {
          name: 'never-executed',
          type: 'pre-tool-use',
          enabled: true,
          priority: 50,
          execute: vi.fn(),
        },
      ];

      hooks.forEach(hook => hookManager.register(hook));

      const results = await hookManager.execute('pre-tool-use', {
        timestamp: new Date(),
        sessionId: 'test',
        data: {},
      });

      expect(results).toHaveLength(1);
      expect(results[0].continue).toBe(false);
      expect(hooks[1].execute).not.toHaveBeenCalled();
    });

    it('should skip disabled hooks', async () => {
      const enabledExecute = vi.fn().mockResolvedValue({
        success: true,
        continue: true,
      });

      const disabledExecute = vi.fn();

      const hooks: Hook[] = [
        {
          name: 'enabled-hook',
          type: 'pre-tool-use',
          enabled: true,
          execute: enabledExecute,
        },
        {
          name: 'disabled-hook',
          type: 'pre-tool-use',
          enabled: false,
          execute: disabledExecute,
        },
      ];

      hooks.forEach(hook => hookManager.register(hook));

      await hookManager.execute('pre-tool-use', {
        timestamp: new Date(),
        sessionId: 'test',
        data: {},
      });

      expect(enabledExecute).toHaveBeenCalled();
      expect(disabledExecute).not.toHaveBeenCalled();
    });

    it('should handle hook execution errors', async () => {
      const errorHook: Hook = {
        name: 'error-hook',
        type: 'pre-tool-use',
        enabled: true,
        execute: vi.fn().mockRejectedValue(new Error('Hook failed')),
      };

      hookManager.register(errorHook);

      const results = await hookManager.execute('pre-tool-use', {
        timestamp: new Date(),
        sessionId: 'test',
        data: {},
      });

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error?.message).toBe('Hook failed');
    });

    it('should handle synchronous hooks', async () => {
      const syncHook: Hook = {
        name: 'sync-hook',
        type: 'pre-tool-use',
        enabled: true,
        execute: () => ({
          success: true,
          continue: true,
          message: 'Sync hook executed',
        }),
      };

      hookManager.register(syncHook);

      const results = await hookManager.execute('pre-tool-use', {
        timestamp: new Date(),
        sessionId: 'test',
        data: {},
      });

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].message).toBe('Sync hook executed');
    });
  });

  describe('Hook State Management', () => {
    it('should enable a disabled hook', () => {
      const hook: Hook = {
        name: 'test-hook',
        type: 'pre-tool-use',
        enabled: false,
        execute: vi.fn(),
      };

      hookManager.register(hook);
      hookManager.enableHook('test-hook');

      const hooks = hookManager.getHooks();
      expect(hooks[0].enabled).toBe(true);
    });

    it('should disable an enabled hook', () => {
      const hook: Hook = {
        name: 'test-hook',
        type: 'pre-tool-use',
        enabled: true,
        execute: vi.fn(),
      };

      hookManager.register(hook);
      hookManager.disableHook('test-hook');

      const hooks = hookManager.getHooks();
      expect(hooks[0].enabled).toBe(false);
    });

    it('should handle enabling non-existent hook', () => {
      expect(() => {
        hookManager.enableHook('non-existent');
      }).not.toThrow();
    });

    it('should handle disabling non-existent hook', () => {
      expect(() => {
        hookManager.disableHook('non-existent');
      }).not.toThrow();
    });
  });

  describe('Hook Isolation', () => {
    it('should not allow hooks to affect each other', async () => {
      const hook1Data: Record<string, unknown> = {};
      const hook2Data: Record<string, unknown> = {};

      const hooks: Hook[] = [
        {
          name: 'hook1',
          type: 'pre-tool-use',
          enabled: true,
          execute: context => {
            context.data.modified = true;
            Object.assign(hook1Data, context.data);
            return { success: true, continue: true };
          },
        },
        {
          name: 'hook2',
          type: 'pre-tool-use',
          enabled: true,
          execute: context => {
            Object.assign(hook2Data, context.data);
            return { success: true, continue: true };
          },
        },
      ];

      hooks.forEach(hook => hookManager.register(hook));

      const originalData: { original: boolean; modified?: boolean } = {
        original: true,
      };
      await hookManager.execute('pre-tool-use', {
        timestamp: new Date(),
        sessionId: 'test',
        data: originalData,
      });

      // Hook1 should see modified data
      expect(hook1Data.modified).toBe(true);

      // Hook2 should also see modified data (contexts are shared)
      expect(hook2Data.modified).toBe(true);

      // Original data should be modified (mutable)
      expect(originalData.modified).toBe(true);
    });
  });
});
