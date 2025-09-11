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

  // Return a Vitest mock function that satisfies the interface
  return vi.fn().mockReturnValue(stream)() as NodeJS.ReadableStream;
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
  };

  // Use Vitest mock to create a proper ChildProcess mock
  const mockedProcess = vi.fn().mockReturnValue(mockProcess)() as ChildProcess;
  return mockedProcess;
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
        [
          '--print',
          '--output-format=stream-json',
          '--include-partial-messages',
          '--verbose',
          'Hello',
        ],
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

      // Claude Code CLI uses OAuth authentication
      expect(spawn).toHaveBeenCalledWith(
        'claude',
        [
          '--print',
          '--output-format=stream-json',
          '--include-partial-messages',
          '--verbose',
          'Test',
        ],
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

    it('should handle streaming responses from CLI with JSON format', async () => {
      // Mock streaming JSON response with real Claude Code format
      const jsonResponse = [
        '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}},"session_id":"test-session"}',
        '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":" from Claude!"}},"session_id":"test-session"}',
        '',
      ].join('\n');

      const mockProcess = createMockProcess({
        stdout: createMockReadable(jsonResponse),
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

      expect(spawn).toHaveBeenCalledWith(
        'claude',
        [
          '--print',
          '--output-format=stream-json',
          '--include-partial-messages',
          '--verbose',
          'Hello',
        ],
        expect.any(Object)
      );
      expect(chunks.length).toBe(2);
      expect(chunks[0].type).toBe('text');
      expect(chunks[0].content).toBe('Hello');
      expect(chunks[1].type).toBe('text');
      expect(chunks[1].content).toBe(' from Claude!');
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

    it('should maintain persistent session with proper session ID and continue flags', async () => {
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
      expect(session.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      ); // UUID format

      // First query - should use --session-id
      const chunks1: StreamChunk[] = [];
      for await (const chunk of provider.query('First message', { session })) {
        chunks1.push(chunk);
      }

      // Second query - should use --continue
      const chunks2: StreamChunk[] = [];
      for await (const chunk of provider.query('Second message', { session })) {
        chunks2.push(chunk);
      }

      // Verify first call uses session ID
      expect(spawn).toHaveBeenNthCalledWith(
        2,
        'claude',
        [
          '--print',
          '--output-format=stream-json',
          '--include-partial-messages',
          '--verbose',
          '--session-id',
          session.id,
          'First message',
        ],
        expect.any(Object)
      );

      // Verify second call uses continue
      expect(spawn).toHaveBeenNthCalledWith(
        3,
        'claude',
        [
          '--print',
          '--output-format=stream-json',
          '--include-partial-messages',
          '--verbose',
          '--continue',
          'Second message',
        ],
        expect.any(Object)
      );

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

    it('should parse tool usage from JSON stream', async () => {
      const jsonResponse = [
        '{"type":"stream_event","event":{"type":"content_block_start","content_block":{"type":"tool_use","name":"bash","input":{"command":"ls"}}},"session_id":"test-session"}',
        '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Files listed successfully"}},"session_id":"test-session"}',
        '',
      ].join('\n');

      const mockProcess = createMockProcess({
        stdout: createMockReadable(jsonResponse),
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
      for await (const chunk of provider.query('List files', {
        stream: true,
      })) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBe(2);
      expect(chunks[0].type).toBe('tool_use');
      expect(chunks[0].metadata?.toolName).toBe('bash');
      expect(chunks[1].type).toBe('text');
      expect(chunks[1].content).toBe('Files listed successfully');
    });

    it('should handle session destruction properly', async () => {
      mockedSpawn.mockReturnValueOnce(createWhichMock(true));

      await provider.initialize({});

      const session = provider.createSession();
      const sessionId = session.id;

      // Session should be tracked
      expect(provider['activeSessions'].has(sessionId)).toBe(true);

      // Destroy session
      await provider.destroySession(sessionId);

      // Session should be removed from tracking
      expect(provider['activeSessions'].has(sessionId)).toBe(false);
    });

    it('should always use streaming JSON format even without stream option', async () => {
      const mockProcess = createMockProcess({
        stdout: createMockReadable('Response without streaming'),
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
      for await (const chunk of provider.query('Test', { stream: false })) {
        chunks.push(chunk);
      }

      // Should still use streaming format for full Claude Code experience
      expect(spawn).toHaveBeenCalledWith(
        'claude',
        [
          '--print',
          '--output-format=stream-json',
          '--include-partial-messages',
          '--verbose',
          'Test',
        ],
        expect.any(Object)
      );
    });
  });

  describe('Session Management', () => {
    it('should generate valid UUIDs for sessions', () => {
      const session1 = provider.createSession();
      const session2 = provider.createSession();

      // Should be different UUIDs
      expect(session1.id).not.toBe(session2.id);

      // Should match UUID format
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(session1.id).toMatch(uuidRegex);
      expect(session2.id).toMatch(uuidRegex);
    });

    it('should handle multiple concurrent sessions', async () => {
      mockedSpawn.mockReturnValueOnce(createWhichMock(true));

      await provider.initialize({});

      const session1 = provider.createSession();
      const session2 = provider.createSession();

      // Both sessions should be tracked
      expect(provider['activeSessions'].has(session1.id)).toBe(true);
      expect(provider['activeSessions'].has(session2.id)).toBe(true);

      // Sessions should have different IDs
      expect(session1.id).not.toBe(session2.id);
    });

    it('should clear all sessions on disconnect', async () => {
      mockedSpawn.mockReturnValueOnce(createWhichMock(true));

      await provider.initialize({});

      provider.createSession();
      provider.createSession();

      expect(provider['activeSessions'].size).toBe(2);

      await provider.disconnect();

      expect(provider['activeSessions'].size).toBe(0);
    });
  });
});
