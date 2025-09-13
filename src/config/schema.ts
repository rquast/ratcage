import { z } from 'zod';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Provider configuration schema
 */
export const ProviderConfigSchema = z.object({
  type: z.enum([
    'claude-code',
    'github-copilot',
    'cursor',
    'codeium',
    'continue',
    'ollama',
    'openai',
  ]),
  apiKey: z.string(),
  baseUrl: z.string().url().optional(),
  model: z.string().optional(),
  maxTokens: z.number().int().positive().default(4096),
  temperature: z.number().min(0).max(2).default(0.7),
  timeout: z.number().int().positive().default(30000),
  retries: z.number().int().min(0).default(3),
  custom: z.record(z.unknown()).optional(),
});

/**
 * Hook configuration schema
 */
export const HookConfigSchema = z
  .object({
    name: z.string(),
    type: z.enum([
      'pre-tool-use',
      'post-tool-use',
      'user-prompt-submit',
      'session-start',
      'session-end',
      'notification',
      'error',
      'warning',
    ]),
    enabled: z.boolean().default(true),
    priority: z.number().int().default(50),
    script: z.string().optional(),
    inline: z.string().optional(),
    timeout: z.number().int().positive().optional(),
    config: z.record(z.unknown()).optional(),
  })
  .refine(data => data.script ?? data.inline, {
    message: 'Either script or inline must be provided',
  });

/**
 * Tool configuration schema
 */
export const ToolConfigSchema = z.object({
  name: z.string(),
  enabled: z.boolean().default(true),
  aliases: z.array(z.string()).optional(),
  permissions: z
    .object({
      execute: z.boolean().default(true),
      sudo: z.boolean().default(false),
      allowedCommands: z.array(z.string()).optional(),
      deniedCommands: z.array(z.string()).optional(),
    })
    .optional(),
  config: z.record(z.unknown()).optional(),
});

/**
 * Logger configuration schema
 */
export const LoggerConfigSchema = z.object({
  level: z.enum(['error', 'warn', 'info', 'debug', 'trace']).default('info'),
  format: z.enum(['json', 'text', 'pretty']).default('text'),
  outputs: z
    .array(
      z.object({
        type: z.enum(['console', 'file', 'syslog']),
        level: z.enum(['error', 'warn', 'info', 'debug', 'trace']).optional(),
        path: z.string().optional(),
        maxSize: z.string().optional(),
        maxFiles: z.number().optional(),
      })
    )
    .optional(),
  colors: z.boolean().default(true),
  timestamps: z.boolean().default(true),
});

/**
 * Session configuration schema
 */
export const SessionConfigSchema = z.object({
  persistence: z.boolean().default(true),
  storageDir: z.string().default('~/.cagetools/sessions'),
  maxSessions: z.number().int().positive().default(100),
  sessionTimeout: z.number().int().positive().optional(),
  autoSave: z.boolean().default(true),
  autoSaveInterval: z.number().int().positive().default(60000),
});

/**
 * UI configuration schema
 */
export const UIConfigSchema = z.object({
  theme: z.enum(['light', 'dark', 'auto']).default('auto'),
  colors: z.boolean().default(true),
  spinners: z.boolean().default(true),
  progressBars: z.boolean().default(true),
  icons: z.boolean().default(true),
  formatMarkdown: z.boolean().default(true),
});

/**
 * Complete CageTools configuration schema
 */
export const ConfigurationSchema = z
  .object({
    version: z.string().default('1.0.0'),
    defaultProvider: z.string().optional(),
    providers: z.array(ProviderConfigSchema),
    hooks: z.array(HookConfigSchema).optional(),
    tools: z.array(ToolConfigSchema).optional(),
    logger: LoggerConfigSchema.optional(),
    session: SessionConfigSchema.optional(),
    ui: UIConfigSchema.optional(),
    custom: z.record(z.unknown()).optional(),
  })
  .refine(data => {
    // Set default provider to first provider if not specified
    if (!data.defaultProvider && data.providers.length > 0) {
      data.defaultProvider = data.providers[0].type;
    }
    return true;
  });

export type CageToolsConfig = z.infer<typeof ConfigurationSchema>;

/**
 * Validate a configuration object
 */
export function validateConfiguration(config: unknown): {
  valid: boolean;
  data?: CageToolsConfig;
  errors?: z.ZodError['errors'];
} {
  const result = ConfigurationSchema.safeParse(config);

  if (result.success) {
    return {
      valid: true,
      data: result.data,
    };
  }

  return {
    valid: false,
    errors: result.error.errors,
  };
}

/**
 * Load configuration from a file or object
 */
export async function loadConfiguration(
  configOrPath: string | Record<string, unknown>
): Promise<CageToolsConfig> {
  let config: unknown;

  if (typeof configOrPath === 'string') {
    // Load from file
    const configPath = resolve(configOrPath);
    const configContent = readFileSync(configPath, 'utf-8');

    if (configPath.endsWith('.json')) {
      config = JSON.parse(configContent);
    } else if (configPath.endsWith('.js') || configPath.endsWith('.mjs')) {
      // Dynamic import for JS modules
      const module = (await import(configPath)) as {
        default?: unknown;
        [key: string]: unknown;
      };
      config = module.default ?? module;
    } else {
      throw new Error(`Unsupported config file format: ${configPath}`);
    }
  } else {
    config = configOrPath;
  }

  // Resolve environment variables
  config = resolveEnvironmentVariables(config);

  // Validate and return
  const validation = validateConfiguration(config);

  if (!validation.valid) {
    throw new Error(
      `Invalid configuration: ${JSON.stringify(validation.errors)}`
    );
  }

  return validation.data!;
}

/**
 * Resolve environment variables in configuration
 */
function resolveEnvironmentVariables(config: unknown): unknown {
  if (typeof config === 'string') {
    // Check for ${VAR_NAME} pattern
    const envVarPattern = /\$\{([^}]+)\}/g;
    return config.replace(envVarPattern, (match, varName: string) => {
      return process.env[varName] ?? match;
    });
  }

  if (Array.isArray(config)) {
    return config.map(resolveEnvironmentVariables);
  }

  if (config && typeof config === 'object') {
    const resolved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      resolved[key] = resolveEnvironmentVariables(value);
    }
    return resolved;
  }

  return config;
}

/**
 * Merge multiple configurations with priority
 */
export function mergeConfigurations(
  ...configs: Partial<CageToolsConfig>[]
): CageToolsConfig {
  // Start with a base that has required fields
  const base: Partial<CageToolsConfig> = {
    providers: [],
  };

  const merged = configs.reduce((acc, config) => {
    return deepMerge(acc, config);
  }, base);

  // Validate merged configuration
  const validation = validateConfiguration(merged);

  if (!validation.valid) {
    throw new Error(
      `Invalid merged configuration: ${JSON.stringify(validation.errors)}`
    );
  }

  return validation.data!;
}

/**
 * Deep merge helper function
 */
function deepMerge<T extends Record<string, unknown>>(
  target: Partial<T>,
  source: Partial<T>
): Partial<T> {
  const result = { ...target };

  for (const key in source) {
    const sourceValue = source[key];
    const targetValue = target[key];

    if (Array.isArray(sourceValue)) {
      // For arrays, we'll replace entirely (not concatenate)
      // But we'll merge objects within arrays by matching on 'name' or 'type' property
      if (Array.isArray(targetValue)) {
        const merged: unknown[] = [];
        const sourceItems = sourceValue as Array<Record<string, unknown>>;
        const targetItems = targetValue as Array<Record<string, unknown>>;

        // Special handling for providers array (match by type)
        const matchKey = key === 'providers' ? 'type' : 'name';

        // First, add all target items
        for (const targetItem of targetItems) {
          if (
            targetItem &&
            typeof targetItem === 'object' &&
            matchKey in targetItem
          ) {
            // Find matching source item by matchKey
            const sourceItem = sourceItems.find(
              s =>
                s &&
                typeof s === 'object' &&
                matchKey in s &&
                s[matchKey] === targetItem[matchKey]
            );

            if (sourceItem) {
              // Merge the items
              merged.push(deepMerge(targetItem, sourceItem));
            } else {
              // No override, keep target item
              merged.push(targetItem);
            }
          } else {
            merged.push(targetItem);
          }
        }

        // Add source items that don't exist in target
        for (const sourceItem of sourceItems) {
          if (
            sourceItem &&
            typeof sourceItem === 'object' &&
            matchKey in sourceItem
          ) {
            const exists = targetItems.some(
              t =>
                t &&
                typeof t === 'object' &&
                matchKey in t &&
                t[matchKey] === sourceItem[matchKey]
            );
            if (!exists) {
              merged.push(sourceItem);
            }
          } else if (!targetItems.includes(sourceItem)) {
            merged.push(sourceItem);
          }
        }

        result[key] = merged as T[typeof key];
      } else {
        result[key] = sourceValue as T[typeof key];
      }
    } else if (
      sourceValue &&
      typeof sourceValue === 'object' &&
      targetValue &&
      typeof targetValue === 'object'
    ) {
      // Recursively merge objects
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      ) as T[typeof key];
    } else {
      // Override with source value
      result[key] = sourceValue as T[typeof key];
    }
  }

  return result;
}
