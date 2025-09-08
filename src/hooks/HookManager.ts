import type {
  Hook,
  HookContext,
  HookResult,
  HookType,
  HookManager as IHookManager,
} from '../types/hook.js';

export class HookManager implements IHookManager {
  private hooks: Map<string, Hook> = new Map();

  register(hook: Hook): void {
    if (this.hooks.has(hook.name)) {
      console.warn(`Hook ${hook.name} is already registered. Skipping.`);
      return;
    }
    this.hooks.set(hook.name, hook);
  }

  unregister(hookName: string): void {
    this.hooks.delete(hookName);
  }

  async execute(
    type: HookType,
    context: Omit<HookContext, 'type'>
  ): Promise<HookResult[]> {
    const fullContext: HookContext = {
      ...context,
      type,
    };

    // Get all hooks of the specified type that are enabled
    const hooksToExecute = this.getHooks(type)
      .filter(hook => hook.enabled)
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    const results: HookResult[] = [];

    for (const hook of hooksToExecute) {
      try {
        // Execute the hook and await the result
        const result = await Promise.resolve(hook.execute(fullContext));
        results.push(result);

        // Stop execution if the hook says not to continue
        if (!result.continue) {
          break;
        }
      } catch (error) {
        // Handle errors gracefully
        const errorResult: HookResult = {
          success: false,
          continue: false,
          message: `Hook ${hook.name} failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          error: error instanceof Error ? error : new Error(String(error)),
        };
        results.push(errorResult);
        break; // Stop execution on error
      }
    }

    return results;
  }

  getHooks(type?: HookType): Hook[] {
    const allHooks = Array.from(this.hooks.values());

    if (type) {
      return allHooks.filter(hook => hook.type === type);
    }

    return allHooks;
  }

  enableHook(hookName: string): void {
    const hook = this.hooks.get(hookName);
    if (hook) {
      hook.enabled = true;
    }
  }

  disableHook(hookName: string): void {
    const hook = this.hooks.get(hookName);
    if (hook) {
      hook.enabled = false;
    }
  }
}
