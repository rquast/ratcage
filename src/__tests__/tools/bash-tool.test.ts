import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BashTool } from '../../tools/bash-tool';
import type { BashToolConfig, BashToolResult } from '../../types/tool';

describe('BashTool', () => {
  let bashTool: BashTool;

  beforeEach(() => {
    bashTool = new BashTool();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should create with default config', () => {
      expect(bashTool).toBeDefined();
      expect(bashTool.name).toBe('BashTool');
      expect(bashTool.enabled).toBe(true);
    });

    it('should create with custom config', () => {
      const config: BashToolConfig = {
        enabled: false,
        timeout: 5000,
        shell: '/bin/zsh',
        maxOutputSize: 1000,
      };

      const customBashTool = new BashTool(config);

      expect(customBashTool.enabled).toBe(false);
      expect(customBashTool.config.timeout).toBe(5000);
      expect(customBashTool.config.shell).toBe('/bin/zsh');
    });

    it('should validate config on creation', () => {
      expect(() => {
        new BashTool({ timeout: -1 });
      }).toThrow('Invalid timeout');

      expect(() => {
        new BashTool({ maxOutputSize: -1 });
      }).toThrow('Invalid maxOutputSize');
    });
  });

  describe('Command Execution', () => {
    it('should execute simple command', async () => {
      const result: BashToolResult = await bashTool.execute(['echo', 'hello']);

      expect(result.status).toBe('success');
      expect(result.output).toContain('hello');
      expect(result.exitCode).toBe(0);
      expect(result.command).toBe('echo hello');
    });

    it('should handle command with arguments', async () => {
      const result = await bashTool.execute(['echo', '-n', 'test']);

      expect(result.status).toBe('success');
      expect(result.output).toBe('test');
      expect(result.exitCode).toBe(0);
    });

    it('should handle multi-word arguments', async () => {
      const result = await bashTool.execute(['echo', 'hello world']);

      expect(result.status).toBe('success');
      expect(result.output).toContain('hello world');
    });

    it('should handle command that fails', async () => {
      const result = await bashTool.execute(['false']);

      expect(result.status).toBe('error');
      expect(result.exitCode).toBe(1);
      expect(result.error).toBeDefined();
    });

    it('should handle command not found', async () => {
      const result = await bashTool.execute(['nonexistentcommand']);

      expect(result.status).toBe('error');
      expect(result.error).toContain('command not found');
    });

    it('should respect timeout', async () => {
      const timeoutTool = new BashTool({ timeout: 100 });

      const result = await timeoutTool.execute(['sleep', '1']);

      expect(result.status).toBe('timeout');
      expect(result.error).toContain('timed out');
    });

    it('should limit output size', async () => {
      const limitedTool = new BashTool({ maxOutputSize: 10 });

      const result = await limitedTool.execute([
        'echo',
        'this is a very long output that should be truncated',
      ]);

      expect(result.status).toBe('success');
      expect(result.output?.length).toBeLessThanOrEqual(10);
      expect(result.metadata?.truncated).toBe(true);
    });

    it('should capture stderr', async () => {
      const result = await bashTool.execute(['ls', '/nonexistent']);

      expect(result.status).toBe('error');
      expect(result.error).toContain('No such file or directory');
    });

    it('should set working directory', async () => {
      const tool = new BashTool({ workingDirectory: '/tmp' });

      const result = await tool.execute(['pwd']);

      expect(result.status).toBe('success');
      expect(result.output?.trim()).toBe('/tmp');
    });

    it('should set environment variables', async () => {
      const tool = new BashTool({
        environment: { TEST_VAR: 'test_value' },
      });

      const result = await tool.execute(['echo', '$TEST_VAR']);

      expect(result.status).toBe('success');
      expect(result.output).toContain('test_value');
    });
  });

  describe('Command Validation', () => {
    it('should validate empty commands', () => {
      expect(bashTool.validate([])).toBe(false);
    });

    it('should validate non-string commands', () => {
      expect(bashTool.validate([123])).toBe(false);
      expect(bashTool.validate([null])).toBe(false);
      expect(bashTool.validate([undefined])).toBe(false);
    });

    it('should validate allowed commands', () => {
      const restrictedTool = new BashTool({
        allowedCommands: ['echo', 'ls'],
      });

      expect(restrictedTool.validate(['echo', 'test'])).toBe(true);
      expect(restrictedTool.validate(['ls', '-la'])).toBe(true);
      expect(restrictedTool.validate(['rm', 'file'])).toBe(false);
    });

    it('should validate blocked commands', () => {
      const blockedTool = new BashTool({
        blockedCommands: ['rm', 'sudo'],
      });

      expect(blockedTool.validate(['echo', 'test'])).toBe(true);
      expect(blockedTool.validate(['rm', 'file'])).toBe(false);
      expect(blockedTool.validate(['sudo', 'ls'])).toBe(false);
    });

    it('should combine allowed and blocked commands', () => {
      const tool = new BashTool({
        allowedCommands: ['echo', 'ls', 'rm'],
        blockedCommands: ['rm'],
      });

      expect(tool.validate(['echo', 'test'])).toBe(true);
      expect(tool.validate(['ls'])).toBe(true);
      expect(tool.validate(['rm', 'file'])).toBe(false);
      expect(tool.validate(['cat', 'file'])).toBe(false);
    });
  });

  describe('Shell Selection', () => {
    it('should use default shell', () => {
      expect(bashTool.config.shell).toBe('/bin/bash');
    });

    it('should use custom shell', () => {
      const zshTool = new BashTool({ shell: '/bin/zsh' });
      expect(zshTool.config.shell).toBe('/bin/zsh');
    });

    it('should validate shell exists', async () => {
      const invalidTool = new BashTool({ shell: '/bin/nonexistentshell' });

      const result = await invalidTool.execute(['echo', 'test']);

      expect(result.status).toBe('error');
      expect(result.error).toContain('Shell not found');
    });
  });

  describe('Process Management', () => {
    it('should track process ID', async () => {
      const result = await bashTool.execute(['echo', 'test']);

      expect(result.pid).toBeDefined();
      expect(typeof result.pid).toBe('number');
    });

    it('should measure execution duration', async () => {
      const result = await bashTool.execute(['echo', 'test']);

      expect(result.duration).toBeDefined();
      expect(typeof result.duration).toBe('number');
      expect(result.duration).toBeGreaterThan(0);
    });

    it('should cleanup resources', async () => {
      await bashTool.execute(['echo', 'test']);

      expect(async () => {
        await bashTool.cleanup();
      }).not.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should handle permission denied', async () => {
      const result = await bashTool.execute(['cat', '/etc/shadow']);

      expect(result.status).toBe('error');
      expect(result.error).toContain('Permission denied');
    });

    it('should handle invalid arguments', async () => {
      const result = await bashTool.execute(['ls', '--invalid-flag']);

      expect(result.status).toBe('error');
      expect(result.error).toBeDefined();
    });

    it('should handle interruption gracefully', async () => {
      const longRunningTool = new BashTool({ timeout: 50 });

      const result = await longRunningTool.execute(['sleep', '0.1']);

      expect(['success', 'timeout']).toContain(result.status);
    });
  });

  describe('Output Handling', () => {
    it('should handle empty output', async () => {
      const result = await bashTool.execute(['true']);

      expect(result.status).toBe('success');
      expect(result.output).toBe('');
    });

    it('should handle binary output safely', async () => {
      // Create a temporary binary file for testing
      await bashTool.execute([
        'echo',
        '-e',
        '\\x00\\x01\\x02',
        '>',
        '/tmp/test_binary',
      ]);

      const result = await bashTool.execute(['cat', '/tmp/test_binary']);

      expect(result.status).toBe('success');
      expect(result.output).toBeDefined();

      // Cleanup
      await bashTool.execute(['rm', '/tmp/test_binary']);
    });

    it('should handle large output', async () => {
      const largeTool = new BashTool({ maxOutputSize: 100 });

      const result = await largeTool.execute(['yes', 'test | head -n 20']);

      expect(result.status).toBe('success');
      expect(result.output?.length).toBeLessThanOrEqual(100);
    });
  });

  describe('Concurrency', () => {
    it('should handle multiple concurrent commands', async () => {
      const promises = [
        bashTool.execute(['echo', '1']),
        bashTool.execute(['echo', '2']),
        bashTool.execute(['echo', '3']),
      ];

      const results = await Promise.all(promises);

      results.forEach(result => {
        expect(result.status).toBe('success');
      });
    });

    it('should isolate command environments', async () => {
      const tool1 = new BashTool({ environment: { TEST: '1' } });
      const tool2 = new BashTool({ environment: { TEST: '2' } });

      const [result1, result2] = await Promise.all([
        tool1.execute(['echo', '$TEST']),
        tool2.execute(['echo', '$TEST']),
      ]);

      expect(result1.output).toContain('1');
      expect(result2.output).toContain('2');
    });
  });
});
