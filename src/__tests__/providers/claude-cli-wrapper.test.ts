import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ChildProcess } from 'child_process';
import { spawn, execSync } from 'child_process';
import { existsSync } from 'fs';
import { ClaudeCodeProvider } from '../../providers/claude-code.js';
import type { StreamChunk } from '../../types/provider.js';

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(),
}));

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn(),
}));

const mockedSpawn = vi.mocked(spawn);
const mockedExecSync = vi.mocked(execSync);
const mockedExistsSync = vi.mocked(existsSync);

// Helper to create a mock readable stream that works with both event-based and async iteration
function createMockReadable(data: string | Buffer): NodeJS.ReadableStream {
  const bufferData = Buffer.isBuffer(data) ? data : Buffer.from(data);
  let position = 0;
  const chunkSize = 1024; // Simulate chunked reading

  const stream = {
    readable: true,
    read: vi.fn(),
    setEncoding: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    isPaused: vi.fn(() => false),
    pipe: vi.fn(),
    unpipe: vi.fn(),
    unshift: vi.fn(),
    wrap: vi.fn(),
    push: vi.fn(),
    _destroy: vi.fn(),
    addListener: vi.fn(),
    emit: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    prependListener: vi.fn(),
    prependOnceListener: vi.fn(),
    removeListener: vi.fn(),
    removeAllListeners: vi.fn(),
    setMaxListeners: vi.fn(),
    getMaxListeners: vi.fn(() => 10),
    listeners: vi.fn(() => []),
    rawListeners: vi.fn(() => []),
    listenerCount: vi.fn(() => 0),
    eventNames: vi.fn(() => []),
    off: vi.fn(),
    // For async iteration - emit data in chunks like a real stream
    [Symbol.asyncIterator]: async function* () {
      while (position < bufferData.length) {
        const end = Math.min(position + chunkSize, bufferData.length);
        const chunk = bufferData.subarray(position, end);
        position = end;
        yield chunk;
      }
    },
  } as NodeJS.ReadableStream;

  return stream;
}

// Helper to create a mock process that satisfies ChildProcess interface
function createMockProcess(overrides: {
  stdin?: Partial<NodeJS.WritableStream>;
  stdout?: Partial<NodeJS.ReadableStream> | NodeJS.ReadableStream | unknown;
  stderr?: Partial<NodeJS.ReadableStream> | unknown;
  on?: (event: string, callback: Function) => void;
  once?: (event: string, callback: Function) => void;
  kill?: () => void;
  pid?: number;
}): ChildProcess {
  // If stdout is provided, use it; otherwise create a default mock
  const stdout = overrides.stdout ?? {
    on: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn(),
  };

  const stderr = overrides.stderr ?? {
    on: vi.fn(),
    removeListener: vi.fn(),
  };

  const mockProcess = {
    stdin: overrides.stdin ?? {
      write: vi.fn(),
      end: vi.fn(),
    },
    stdout,
    stderr,
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

  beforeEach(() => {
    provider = new ClaudeCodeProvider();
    vi.clearAllMocks();

    // Setup default mocks for the new detection logic
    // Mock 'which claude' to succeed by default
    mockedExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'which claude') {
        return '/usr/local/bin/claude\n';
      }
      if (cmd.includes('--version')) {
        return 'Claude Code 0.1.0';
      }
      return '';
    });

    // Mock existsSync to return true for the mocked path
    mockedExistsSync.mockImplementation(path => {
      const pathStr = typeof path === 'string' ? path : path.toString();
      return pathStr === '/usr/local/bin/claude';
    });
  });

  afterEach(async () => {
    await provider.dispose().catch(() => {});
  });

  describe('CLI Process Management', () => {
    it('should spawn claude CLI process on query', async () => {
      const mockData = 'Hello from Claude';
      const mockStdout = {
        on: vi.fn((event: string, callback: Function) => {
          if (event === 'data') {
            // Simulate data emission for non-streaming mode
            setImmediate(() => callback(Buffer.from(mockData)));
          }
        }),
        once: vi.fn(),
        removeListener: vi.fn(),
      };
      const mockProcess = createMockProcess({
        stdout: mockStdout,
        on: vi.fn((event, callback) => {
          if (event === 'close') {
            setImmediate(() => callback(0));
          }
        }),
      });

      // Now spawn is only called for the actual claude command
      mockedSpawn.mockReturnValueOnce(mockProcess);

      await provider.initialize({});

      const chunks: StreamChunk[] = [];
      // Note: without stream option, it uses non-streaming mode
      for await (const chunk of provider.query('Hello')) {
        chunks.push(chunk);
      }

      expect(spawn).toHaveBeenCalledWith(
        '/usr/local/bin/claude',
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
      expect(chunks[0].content).toBe(mockData);
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

      mockedSpawn.mockReturnValueOnce(mockProcess);

      await provider.initialize({});
      await provider.query('Test').next();

      // Claude Code CLI uses OAuth authentication
      expect(spawn).toHaveBeenCalledWith(
        '/usr/local/bin/claude',
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
      const errorMessage = 'Error: Invalid API key';
      const mockStderr = {
        on: vi.fn((event: string, callback: Function) => {
          if (event === 'data') {
            setImmediate(() => callback(Buffer.from(errorMessage)));
          }
        }),
        removeListener: vi.fn(),
      };
      const mockProcess = createMockProcess({
        stdout: {
          on: vi.fn(),
          once: vi.fn(),
          removeListener: vi.fn(),
        },
        stderr: mockStderr,
        on: vi.fn((event, callback) => {
          if (event === 'close') {
            // Exit with error code after streams have been processed
            setImmediate(() => callback(1));
          }
        }),
      });

      mockedSpawn.mockReturnValueOnce(mockProcess);

      await provider.initialize({});

      const chunks: StreamChunk[] = [];
      try {
        for await (const chunk of provider.query('Test')) {
          chunks.push(chunk);
        }
        expect.fail('Should have thrown an error');
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

      mockedSpawn.mockReturnValueOnce(mockProcess);

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

      mockedSpawn.mockReturnValueOnce(mockProcess);

      await provider.initialize({});

      const chunks: StreamChunk[] = [];
      for await (const chunk of provider.query('Hello', { stream: true })) {
        chunks.push(chunk);
      }

      expect(spawn).toHaveBeenCalledWith(
        '/usr/local/bin/claude',
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
      const mockData = 'Tool executed successfully';
      const mockStdout = {
        on: vi.fn((event: string, callback: Function) => {
          if (event === 'data') {
            setImmediate(() => callback(Buffer.from(mockData)));
          }
        }),
        once: vi.fn(),
        removeListener: vi.fn(),
      };
      const mockProcess = createMockProcess({
        stdout: mockStdout,
        on: vi.fn((event, callback) => {
          if (event === 'close') {
            setImmediate(() => callback(0));
          }
        }),
      });

      mockedSpawn.mockReturnValueOnce(mockProcess);

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

    it('should maintain persistent session with proper session ID and resume flags', async () => {
      const mockProcess1 = createMockProcess({
        stdout: {
          on: vi.fn((event: string, callback: Function) => {
            if (event === 'data') {
              setImmediate(() => callback(Buffer.from('First response')));
            }
          }),
          once: vi.fn(),
          removeListener: vi.fn(),
        },
        on: vi.fn((event, callback) => {
          if (event === 'close') {
            setImmediate(() => callback(0));
          }
        }),
      });

      const mockProcess2 = createMockProcess({
        stdout: {
          on: vi.fn((event: string, callback: Function) => {
            if (event === 'data') {
              setImmediate(() => callback(Buffer.from('Second response')));
            }
          }),
          once: vi.fn(),
          removeListener: vi.fn(),
        },
        on: vi.fn((event, callback) => {
          if (event === 'close') {
            setImmediate(() => callback(0));
          }
        }),
      });

      mockedSpawn
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

      // Second query - should use --resume with session ID
      const chunks2: StreamChunk[] = [];
      for await (const chunk of provider.query('Second message', { session })) {
        chunks2.push(chunk);
      }

      // Verify first call uses session ID
      expect(spawn).toHaveBeenNthCalledWith(
        1,
        '/usr/local/bin/claude',
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

      // Verify second call uses --resume with session ID
      expect(spawn).toHaveBeenNthCalledWith(
        2,
        '/usr/local/bin/claude',
        [
          '--print',
          '--output-format=stream-json',
          '--include-partial-messages',
          '--verbose',
          '--resume',
          session.id,
          'Second message',
        ],
        expect.any(Object)
      );

      expect(spawn).toHaveBeenCalledTimes(2); // 2 for queries (no which check anymore)
      expect(chunks1[0].content).toContain('First response');
      expect(chunks2[0].content).toContain('Second response');
    });

    it('should handle CLI not found error', async () => {
      // Mock that claude is not found
      mockedExecSync.mockImplementation(() => {
        throw new Error('command not found');
      });
      mockedExistsSync.mockReturnValue(false);

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

      mockedSpawn.mockReturnValueOnce(mockProcess);

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
      // No need to mock 'which' anymore as it's handled in beforeEach

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

      mockedSpawn.mockReturnValueOnce(mockProcess);

      await provider.initialize({});

      const chunks: StreamChunk[] = [];
      for await (const chunk of provider.query('Test', { stream: false })) {
        chunks.push(chunk);
      }

      // Should still use streaming format for full Claude Code experience
      expect(spawn).toHaveBeenCalledWith(
        '/usr/local/bin/claude',
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
      // No need to mock 'which' anymore as it's handled in beforeEach

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
      // No need to mock 'which' anymore as it's handled in beforeEach

      await provider.initialize({});

      provider.createSession();
      provider.createSession();

      expect(provider['activeSessions'].size).toBe(2);

      await provider.disconnect();

      expect(provider['activeSessions'].size).toBe(0);
    });
  });
});
