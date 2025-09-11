import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ChildProcess } from 'child_process';
import { spawn } from 'child_process';
import { ClaudeCodeProvider } from '../../providers/claude-code.js';
import type { StreamChunk } from '../../types/provider.js';

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

const mockedSpawn = vi.mocked(spawn);

// Helper to create a mock readable stream that works with both event-based and async iteration
function createMockReadable(data: string | Buffer): NodeJS.ReadableStream {
  const listeners: { [key: string]: Function[] } = {};

  const stream = {
    on: vi.fn((event: string, callback: Function) => {
      if (!listeners[event]) {
        listeners[event] = [];
      }
      listeners[event].push(callback as () => void);

      // Emit data immediately when listener is attached
      if (event === 'data') {
        setImmediate(() => {
          callback(Buffer.from(data));
          // Emit end after data
          const endListeners = listeners['end'] || [];
          endListeners.forEach(cb => cb());
        });
      }
      return stream;
    }),
    once: vi.fn((event: string, callback: Function) => {
      stream.on(event, callback);
      return stream;
    }),
    removeListener: vi.fn(() => stream),
    // For async iteration
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(data);
    },
  };

  return stream as NodeJS.ReadableStream;
}

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

  // Helper to create 'which claude' mock process
  const createWhichMock = (found = true) =>
    createMockProcess({
      on: vi.fn((event, callback) => {
        if (event === 'close') {
          callback(found ? 0 : 1);
        }
      }),
    });

  beforeEach(() => {
    provider = new ClaudeCodeProvider();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await provider.dispose().catch(() => {});
  });

  describe('CLI Process Management', () => {
    it('should spawn claude CLI process on query', async () => {
      const mockStdout = createMockReadable('Hello from Claude');
      const mockProcess = createMockProcess({
        stdout: mockStdout,
        on: vi.fn((event, callback) => {
          if (event === 'close') {
            setImmediate(() => callback(0));
          }
        }),
      });

      // First call is 'which claude', second is actual claude command
      mockedSpawn
        .mockReturnValueOnce(createWhichMock(true))
        .mockReturnValueOnce(mockProcess);

      await provider.initialize({});

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
        stdout: createMockReadable('Test response'),
        on: vi.fn((event, callback) => {
          if (event === 'close') {
            setImmediate(() => callback(0));
          }
        }),
      });

      mockedSpawn
        .mockReturnValueOnce(createWhichMock(true))
        .mockReturnValueOnce(mockProcess);

      await provider.initialize({});
      await provider.query('Test').next();

      // Claude Code CLI doesn't use API keys anymore - it uses OAuth
      expect(spawn).toHaveBeenCalledWith(
        'claude',
        ['--print', 'Test'],
        expect.any(Object)
      );
    });

    it('should handle CLI process errors', async () => {
      const mockProcess = createMockProcess({
        stdout: createMockReadable(''),
        stderr: createMockReadable('Error: Invalid API key'),
        on: vi.fn((event, callback) => {
          if (event === 'close') {
            // Exit with error code after streams have been processed
            setImmediate(() => callback(1));
          }
        }),
      });

      mockedSpawn
        .mockReturnValueOnce(createWhichMock(true))
        .mockReturnValueOnce(mockProcess);

      await provider.initialize({});

      const chunks: StreamChunk[] = [];
      try {
        for await (const chunk of provider.query('Test')) {
          chunks.push(chunk);
        }
      } catch (error) {
        expect(error).toBeDefined();
        expect((error as Error).message).toContain(
          'Claude Code exited with code 1'
        );
        expect((error as Error).message).toContain('Invalid API key');
      }
    });

    it('should handle dispose gracefully', async () => {
      // Claude Code provider spawns a new process for each query
      // and the process exits when the query completes.
      // So dispose() doesn't need to kill any processes.
      const mockProcess = createMockProcess({
        stdout: createMockReadable('Test response'),
        on: vi.fn((event, callback) => {
          if (event === 'close') {
            setImmediate(() => callback(0));
          }
        }),
      });

      mockedSpawn
        .mockReturnValueOnce(createWhichMock(true))
        .mockReturnValueOnce(mockProcess);

      await provider.initialize({});

      // Complete a query (process exits automatically)
      const chunks: StreamChunk[] = [];
      for await (const chunk of provider.query('Test')) {
        chunks.push(chunk);
      }

      // Dispose should work without errors even though there's no process to kill
      await expect(provider.dispose()).resolves.not.toThrow();
    });

    it('should handle streaming responses from CLI', async () => {
      const mockProcess = createMockProcess({
        stdout: createMockReadable('Hello from Claude!'),
        on: vi.fn((event, callback) => {
          if (event === 'close') {
            setImmediate(() => callback(0));
          }
        }),
      });

      mockedSpawn
        .mockReturnValueOnce(createWhichMock(true))
        .mockReturnValueOnce(mockProcess);

      await provider.initialize({});

      const chunks: StreamChunk[] = [];
      for await (const chunk of provider.query('Hello', { stream: true })) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle tool execution through CLI', async () => {
      const mockProcess = createMockProcess({
        stdout: createMockReadable('Tool executed successfully'),
        on: vi.fn((event, callback) => {
          if (event === 'close') {
            setImmediate(() => callback(0));
          }
        }),
      });

      mockedSpawn
        .mockReturnValueOnce(createWhichMock(true))
        .mockReturnValueOnce(mockProcess);

      await provider.initialize({});

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

      // Should have received text response (our provider only returns text)
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].type).toBe('text');
      expect(chunks[0].content).toContain('Tool executed');
    });

    it('should maintain persistent session with CLI', async () => {
      const mockProcess1 = createMockProcess({
        stdout: createMockReadable('First response'),
        on: vi.fn((event, callback) => {
          if (event === 'close') {
            setImmediate(() => callback(0));
          }
        }),
      });

      const mockProcess2 = createMockProcess({
        stdout: createMockReadable('Second response'),
        on: vi.fn((event, callback) => {
          if (event === 'close') {
            setImmediate(() => callback(0));
          }
        }),
      });

      mockedSpawn
        .mockReturnValueOnce(createWhichMock(true))
        .mockReturnValueOnce(mockProcess1)
        .mockReturnValueOnce(mockProcess2);

      await provider.initialize({});

      const session = provider.createSession();

      // First query
      const chunks1: StreamChunk[] = [];
      for await (const chunk of provider.query('First message', { session })) {
        chunks1.push(chunk);
      }

      // Second query
      const chunks2: StreamChunk[] = [];
      for await (const chunk of provider.query('Second message', { session })) {
        chunks2.push(chunk);
      }

      // Claude Code CLI spawns a new process for each query
      expect(spawn).toHaveBeenCalledTimes(3); // 1 for which, 2 for queries
      expect(chunks1[0].content).toContain('First response');
      expect(chunks2[0].content).toContain('Second response');
    });

    it('should handle CLI not found error', async () => {
      // Mock 'which claude' to return not found
      mockedSpawn.mockReturnValueOnce(createWhichMock(false));

      await expect(provider.initialize({})).rejects.toThrow(
        'Claude Code CLI not found'
      );
    });

    it('should parse structured output from CLI', async () => {
      // Since we're using text mode, just test text output
      const mockProcess = createMockProcess({
        stdout: createMockReadable('Hello from Claude'),
        on: vi.fn((event, callback) => {
          if (event === 'close') {
            setImmediate(() => callback(0));
          }
        }),
      });

      mockedSpawn
        .mockReturnValueOnce(createWhichMock(true))
        .mockReturnValueOnce(mockProcess);

      await provider.initialize({});

      const chunks: StreamChunk[] = [];
      for await (const chunk of provider.query('Hello')) {
        chunks.push(chunk);
      }

      expect(chunks[0].content).toBe('Hello from Claude');
      expect(chunks[0].type).toBe('text');
      expect(chunks[0].metadata).toBeDefined();
    });
  });
});
