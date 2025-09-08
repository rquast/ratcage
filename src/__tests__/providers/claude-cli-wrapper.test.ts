import type { MockedFunction } from 'vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ChildProcess } from 'child_process';
import { spawn } from 'child_process';
import { ClaudeCodeProvider } from '../../providers/claude-code';
import type { StreamChunk } from '../../types/provider';

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

const mockedSpawn = spawn as MockedFunction<typeof spawn>;

// Helper to create a mock process that satisfies ChildProcess interface
function createMockProcess(overrides: {
  stdin?: Partial<NodeJS.WritableStream>;
  stdout?: Partial<NodeJS.ReadableStream>;
  stderr?: Partial<NodeJS.ReadableStream>;
  on?: (event: string, callback: Function) => void;
  once?: (event: string, callback: Function) => void;
  kill?: () => void;
  pid?: number;
}): ChildProcess {
  const mockProcess = {
    stdin: {
      write: vi.fn(),
      end: vi.fn(),
      ...overrides.stdin,
    },
    stdout: {
      on: vi.fn(),
      once: vi.fn(),
      removeListener: vi.fn(),
      ...overrides.stdout,
    },
    stderr: {
      on: vi.fn(),
      removeListener: vi.fn(),
      ...overrides.stderr,
    },
    on: overrides.on ?? vi.fn(),
    once: overrides.once ?? vi.fn(),
    removeListener: vi.fn(),
    kill: vi.fn(),
    pid: overrides.pid ?? 12345,
    ...overrides,
  } as Partial<ChildProcess>;

  // Add other required ChildProcess properties as stubs
  return mockProcess as ChildProcess;
}

describe('ClaudeCodeProvider CLI Wrapper', () => {
  let provider: ClaudeCodeProvider;

  beforeEach(() => {
    provider = new ClaudeCodeProvider();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await provider.disconnect().catch(() => {});
  });

  describe('CLI Process Management', () => {
    it('should spawn claude CLI process on query', async () => {
      const mockProcess = createMockProcess({
        stdout: {
          on: vi.fn((event, callback) => {
            if (event === 'data') {
              callback(Buffer.from('Hello from Claude'));
            }
          }),
          once: vi.fn(),
          removeListener: vi.fn(),
        },
        once: vi.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(0), 10);
          }
        }),
      });

      mockedSpawn.mockReturnValue(mockProcess);

      await provider.initialize({ apiKey: 'test-key' });

      const chunks: StreamChunk[] = [];
      for await (const chunk of provider.query('Hello')) {
        chunks.push(chunk);
      }

      expect(spawn).toHaveBeenCalledWith(
        'claude',
        expect.any(Array),
        expect.any(Object)
      );
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].content).toContain('Hello from Claude');
    });

    it('should pass API key through environment variable', async () => {
      const mockProcess = createMockProcess({
        once: vi.fn((event, callback) => {
          if (event === 'close') {
            callback(0);
          }
        }),
      });

      mockedSpawn.mockReturnValue(mockProcess);

      await provider.initialize({ apiKey: 'sk-ant-test123' });
      await provider.query('Test').next();

      expect(spawn).toHaveBeenCalledWith(
        'claude',
        expect.any(Array),
        expect.objectContaining({
          env: expect.objectContaining({
            ANTHROPIC_API_KEY: 'sk-ant-test123',
          }),
        })
      );
    });

    it('should handle CLI process errors', async () => {
      const mockProcess = createMockProcess({
        stderr: {
          on: vi.fn((event, callback) => {
            if (event === 'data') {
              callback(Buffer.from('Error: Invalid API key'));
            }
          }),
          removeListener: vi.fn(),
        },
        once: vi.fn((event, callback) => {
          if (event === 'error') {
            callback(new Error('Process spawn error'));
          }
        }),
      });

      mockedSpawn.mockReturnValue(mockProcess);

      await provider.initialize({ apiKey: 'invalid' });

      const chunks: StreamChunk[] = [];
      try {
        for await (const chunk of provider.query('Test')) {
          chunks.push(chunk);
        }
      } catch (error) {
        expect(error).toBeDefined();
        expect((error as Error).message).toContain('Invalid API key');
      }
    });

    it('should kill CLI process on disconnect', async () => {
      const killFn = vi.fn();
      const mockProcess = createMockProcess({
        kill: killFn,
        once: vi.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(0), 10);
          }
        }),
      });

      mockedSpawn.mockReturnValue(mockProcess);

      await provider.initialize({ apiKey: 'test-key' });

      // Start a query to spawn the process
      const iterator = provider.query('Test');
      await iterator.next();

      await provider.disconnect();

      expect(killFn).toHaveBeenCalled();
    });

    it('should handle streaming responses from CLI', async () => {
      const mockProcess = createMockProcess({
        stdout: {
          on: vi.fn((event, callback) => {
            if (event === 'data') {
              // Simulate streaming chunks
              setTimeout(() => callback(Buffer.from('Hello ')), 10);
              setTimeout(() => callback(Buffer.from('from ')), 20);
              setTimeout(() => callback(Buffer.from('Claude!')), 30);
            }
          }),
          once: vi.fn(),
          removeListener: vi.fn(),
        },
        once: vi.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(0), 50);
          }
        }),
      });

      mockedSpawn.mockReturnValue(mockProcess);

      await provider.initialize({ apiKey: 'test-key' });

      const chunks: StreamChunk[] = [];
      for await (const chunk of provider.query('Hello', { stream: true })) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThanOrEqual(3);
    });

    it('should handle tool execution through CLI', async () => {
      const mockProcess = createMockProcess({
        stdout: {
          on: vi.fn((event, callback) => {
            if (event === 'data') {
              callback(
                Buffer.from(
                  JSON.stringify({
                    type: 'tool_result',
                    tool_name: 'write_file',
                    result: { success: true, output: 'File written' },
                  })
                )
              );
            }
          }),
          once: vi.fn(),
          removeListener: vi.fn(),
        },
        once: vi.fn((event, callback) => {
          if (event === 'close') {
            callback(0);
          }
        }),
      });

      mockedSpawn.mockReturnValue(mockProcess);

      await provider.initialize({ apiKey: 'test-key' });

      const writeTool = {
        name: 'write_file',
        description: 'Write a file',
        execute: vi.fn(),
      };

      const chunks: StreamChunk[] = [];
      for await (const chunk of provider.query('Write test.txt', {
        tools: [writeTool],
      })) {
        chunks.push(chunk);
      }

      // Should have received tool result
      const toolResult = chunks.find(c => c.type === 'tool_result');
      expect(toolResult).toBeDefined();
    });

    it('should maintain persistent session with CLI', async () => {
      const stdinWrite = vi.fn();
      const mockProcess = createMockProcess({
        stdin: {
          write: stdinWrite,
        },
        once: vi.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(0), 10);
          }
        }),
      });

      mockedSpawn.mockReturnValue(mockProcess);

      await provider.initialize({ apiKey: 'test-key' });

      const session = provider.createSession();

      // First query
      await provider.query('First message', { session }).next();

      // Second query - should use same process
      await provider.query('Second message', { session }).next();

      // Should only spawn once for the session
      expect(spawn).toHaveBeenCalledTimes(1);

      // Should write both messages to stdin
      expect(stdinWrite).toHaveBeenCalledTimes(2);
    });

    it('should handle CLI not found error', async () => {
      mockedSpawn.mockImplementation(() => {
        throw new Error('spawn claude ENOENT');
      });

      await provider.initialize({ apiKey: 'test-key' });

      try {
        await provider.query('Test').next();
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).message).toContain('Claude CLI not found');
      }
    });

    it('should parse structured output from CLI', async () => {
      const mockProcess = createMockProcess({
        stdout: {
          on: vi.fn((event, callback) => {
            if (event === 'data') {
              // Simulate structured JSON output from CLI
              callback(
                Buffer.from(
                  JSON.stringify({
                    type: 'message',
                    content: 'Hello',
                    metadata: {
                      model: 'claude-3-opus',
                      tokens: 10,
                    },
                  })
                )
              );
            }
          }),
          once: vi.fn(),
          removeListener: vi.fn(),
        },
        once: vi.fn((event, callback) => {
          if (event === 'close') {
            callback(0);
          }
        }),
      });

      mockedSpawn.mockReturnValue(mockProcess);

      await provider.initialize({ apiKey: 'test-key' });

      const chunks: StreamChunk[] = [];
      for await (const chunk of provider.query('Hello')) {
        chunks.push(chunk);
      }

      expect(chunks[0].content).toBe('Hello');
      expect(chunks[0].metadata).toBeDefined();
      expect(chunks[0].metadata?.model).toBe('claude-3-opus');
    });
  });
});
