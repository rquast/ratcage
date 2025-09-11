import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { FileTool } from '../../tools/file-tool';
import type {
  FileToolConfig,
  FileOperation,
  FileToolResult,
} from '../../types/tool';

describe('FileTool', () => {
  let fileTool: FileTool;
  let tempDir: string;

  beforeEach(async () => {
    // Create a temporary directory for each test
    tempDir = join(tmpdir(), `file-tool-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    fileTool = new FileTool({
      allowedPaths: [tempDir],
      workingDirectory: tempDir,
    });
  });

  afterEach(async () => {
    // Cleanup test directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    vi.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should create with default config', () => {
      const defaultTool = new FileTool();

      expect(defaultTool).toBeDefined();
      expect(defaultTool.name).toBe('FileTool');
      expect(defaultTool.enabled).toBe(true);
    });

    it('should create with custom config', () => {
      const config: FileToolConfig = {
        enabled: false,
        allowedPaths: ['/tmp'],
        blockedPaths: ['/etc'],
        maxFileSize: 1000,
        encoding: 'utf8',
      };

      const customTool = new FileTool(config);

      expect(customTool.enabled).toBe(false);
      expect(customTool.config.allowedPaths).toEqual(['/tmp']);
      expect(customTool.config.maxFileSize).toBe(1000);
    });

    it('should validate config on creation', () => {
      expect(() => {
        new FileTool({ maxFileSize: -1 });
      }).toThrow('Invalid maxFileSize');
    });
  });

  describe('File Reading', () => {
    it('should read existing file', async () => {
      const testFile = join(tempDir, 'test.txt');
      const testContent = 'Hello, World!';
      await fs.writeFile(testFile, testContent);

      const operation: FileOperation = {
        type: 'read',
        path: testFile,
      };

      const result: FileToolResult = await fileTool.execute([operation]);

      expect(result.status).toBe('success');
      expect(result.content).toBe(testContent);
      expect(result.operation.type).toBe('read');
    });

    it('should handle non-existent file', async () => {
      const operation: FileOperation = {
        type: 'read',
        path: join(tempDir, 'nonexistent.txt'),
      };

      const result = await fileTool.execute([operation]);

      expect(result.status).toBe('error');
      expect(result.error).toContain('File not found');
    });

    it('should respect file size limits', async () => {
      const limitedTool = new FileTool({
        maxFileSize: 10,
        allowedPaths: [tempDir],
      });

      const testFile = join(tempDir, 'large.txt');
      await fs.writeFile(testFile, 'This is a very long file content');

      const operation: FileOperation = {
        type: 'read',
        path: testFile,
      };

      const result = await limitedTool.execute([operation]);

      expect(result.status).toBe('error');
      expect(result.error).toContain('File too large');
    });

    it('should handle different encodings', async () => {
      const tool = new FileTool({
        encoding: 'base64',
        allowedPaths: [tempDir],
      });

      const testFile = join(tempDir, 'encoded.txt');
      const testContent = 'Hello, World!';
      await fs.writeFile(testFile, testContent);

      const operation: FileOperation = {
        type: 'read',
        path: testFile,
      };

      const result = await tool.execute([operation]);

      expect(result.status).toBe('success');
      expect(result.content).toBe(Buffer.from(testContent).toString('base64'));
    });
  });

  describe('File Writing', () => {
    it('should write to new file', async () => {
      const testFile = join(tempDir, 'new.txt');
      const testContent = 'New file content';

      const operation: FileOperation = {
        type: 'write',
        path: testFile,
        content: testContent,
      };

      const result = await fileTool.execute([operation]);

      expect(result.status).toBe('success');

      // Verify file was actually written
      const written = await fs.readFile(testFile, 'utf8');
      expect(written).toBe(testContent);
    });

    it('should overwrite existing file', async () => {
      const testFile = join(tempDir, 'existing.txt');
      await fs.writeFile(testFile, 'Original content');

      const newContent = 'Updated content';
      const operation: FileOperation = {
        type: 'write',
        path: testFile,
        content: newContent,
      };

      const result = await fileTool.execute([operation]);

      expect(result.status).toBe('success');

      const written = await fs.readFile(testFile, 'utf8');
      expect(written).toBe(newContent);
    });

    it('should create directories if needed', async () => {
      const nestedFile = join(tempDir, 'nested', 'deep', 'file.txt');
      const content = 'Nested content';

      const operation: FileOperation = {
        type: 'write',
        path: nestedFile,
        content: content,
      };

      const result = await fileTool.execute([operation]);

      expect(result.status).toBe('success');

      const written = await fs.readFile(nestedFile, 'utf8');
      expect(written).toBe(content);
    });

    it('should handle write errors', async () => {
      const invalidPath = join(tempDir, 'invalid\0name.txt');

      const operation: FileOperation = {
        type: 'write',
        path: invalidPath,
        content: 'content',
      };

      const result = await fileTool.execute([operation]);

      expect(result.status).toBe('error');
      expect(result.error).toBeDefined();
    });
  });

  describe('File Appending', () => {
    it('should append to existing file', async () => {
      const testFile = join(tempDir, 'append.txt');
      const originalContent = 'Original\n';
      const appendContent = 'Appended';

      await fs.writeFile(testFile, originalContent);

      const operation: FileOperation = {
        type: 'append',
        path: testFile,
        content: appendContent,
      };

      const result = await fileTool.execute([operation]);

      expect(result.status).toBe('success');

      const final = await fs.readFile(testFile, 'utf8');
      expect(final).toBe(originalContent + appendContent);
    });

    it('should create file if it does not exist', async () => {
      const testFile = join(tempDir, 'newappend.txt');
      const content = 'New content';

      const operation: FileOperation = {
        type: 'append',
        path: testFile,
        content: content,
      };

      const result = await fileTool.execute([operation]);

      expect(result.status).toBe('success');

      const written = await fs.readFile(testFile, 'utf8');
      expect(written).toBe(content);
    });
  });

  describe('File Deletion', () => {
    it('should delete existing file', async () => {
      const testFile = join(tempDir, 'delete.txt');
      await fs.writeFile(testFile, 'To be deleted');

      const operation: FileOperation = {
        type: 'delete',
        path: testFile,
      };

      const result = await fileTool.execute([operation]);

      expect(result.status).toBe('success');

      // Verify file was deleted
      const exists = await fs
        .access(testFile)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    });

    it('should handle deletion of non-existent file', async () => {
      const operation: FileOperation = {
        type: 'delete',
        path: join(tempDir, 'nonexistent.txt'),
      };

      const result = await fileTool.execute([operation]);

      expect(result.status).toBe('error');
      expect(result.error).toContain('File not found');
    });
  });

  describe('File Operations', () => {
    it('should copy file', async () => {
      const sourceFile = join(tempDir, 'source.txt');
      const destFile = join(tempDir, 'destination.txt');
      const content = 'Copy me!';

      await fs.writeFile(sourceFile, content);

      const operation: FileOperation = {
        type: 'copy',
        path: sourceFile,
        destinationPath: destFile,
      };

      const result = await fileTool.execute([operation]);

      expect(result.status).toBe('success');

      // Verify both files exist with same content
      const sourceContent = await fs.readFile(sourceFile, 'utf8');
      const destContent = await fs.readFile(destFile, 'utf8');
      expect(sourceContent).toBe(content);
      expect(destContent).toBe(content);
    });

    it('should move file', async () => {
      const sourceFile = join(tempDir, 'move-source.txt');
      const destFile = join(tempDir, 'move-dest.txt');
      const content = 'Move me!';

      await fs.writeFile(sourceFile, content);

      const operation: FileOperation = {
        type: 'move',
        path: sourceFile,
        destinationPath: destFile,
      };

      const result = await fileTool.execute([operation]);

      expect(result.status).toBe('success');

      // Verify source doesn't exist and dest does
      const sourceExists = await fs
        .access(sourceFile)
        .then(() => true)
        .catch(() => false);
      const destContent = await fs.readFile(destFile, 'utf8');
      expect(sourceExists).toBe(false);
      expect(destContent).toBe(content);
    });

    it('should check if file exists', async () => {
      const existingFile = join(tempDir, 'exists.txt');
      await fs.writeFile(existingFile, 'I exist');

      const existsOp: FileOperation = {
        type: 'exists',
        path: existingFile,
      };

      const result = await fileTool.execute([existsOp]);

      expect(result.status).toBe('success');
      expect(result.output).toBe('true');
    });

    it('should get file stats', async () => {
      const testFile = join(tempDir, 'stats.txt');
      const content = 'Stats test';
      await fs.writeFile(testFile, content);

      const operation: FileOperation = {
        type: 'stat',
        path: testFile,
      };

      const result = await fileTool.execute([operation]);

      expect(result.status).toBe('success');
      expect(result.stats).toBeDefined();
      expect(result.stats?.size).toBe(content.length);
      expect(result.stats?.isDirectory).toBe(false);
    });
  });

  describe('Path Validation', () => {
    it('should allow operations in allowed paths', () => {
      const operation: FileOperation = {
        type: 'read',
        path: join(tempDir, 'allowed.txt'),
      };

      expect(fileTool.validate([operation])).toBe(true);
    });

    it('should block operations in blocked paths', () => {
      const blockedTool = new FileTool({
        blockedPaths: ['/etc', '/var'],
        allowedPaths: [tempDir],
      });

      const operation: FileOperation = {
        type: 'read',
        path: '/etc/passwd',
      };

      expect(blockedTool.validate([operation])).toBe(false);
    });

    it('should validate operation types', () => {
      const validOp: FileOperation = {
        type: 'read',
        path: join(tempDir, 'test.txt'),
      };

      // Create invalid operation without type assertion
      const invalidOp = {
        type: 'invalid' as const,
        path: join(tempDir, 'test.txt'),
      };

      expect(fileTool.validate([validOp])).toBe(true);
      expect(fileTool.validate([invalidOp])).toBe(false);
    });

    it('should require destination path for copy/move', () => {
      const copyOp: FileOperation = {
        type: 'copy',
        path: join(tempDir, 'source.txt'),
        // Missing destinationPath
      };

      expect(fileTool.validate([copyOp])).toBe(false);
    });

    it('should require content for write/append', () => {
      const writeOp: FileOperation = {
        type: 'write',
        path: join(tempDir, 'test.txt'),
        // Missing content
      };

      expect(fileTool.validate([writeOp])).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid arguments', async () => {
      const result = await fileTool.execute(['invalid']);

      expect(result.status).toBe('error');
      expect(result.error).toContain('Invalid operation');
    });

    it('should handle permission errors', async () => {
      const restrictedTool = new FileTool({
        allowedPaths: ['/tmp/nonexistent'],
      });

      const operation: FileOperation = {
        type: 'read',
        path: join(tempDir, 'test.txt'),
      };

      const result = await restrictedTool.execute([operation]);

      expect(result.status).toBe('error');
      expect(result.error).toContain('not allowed');
    });

    it('should handle concurrent operations safely', async () => {
      const file1 = join(tempDir, 'concurrent1.txt');
      const file2 = join(tempDir, 'concurrent2.txt');

      const promises = [
        fileTool.execute([
          {
            type: 'write',
            path: file1,
            content: 'Content 1',
          },
        ]),
        fileTool.execute([
          {
            type: 'write',
            path: file2,
            content: 'Content 2',
          },
        ]),
      ];

      const results = await Promise.all(promises);

      results.forEach(result => {
        expect(result.status).toBe('success');
      });

      // Verify both files were written correctly
      const content1 = await fs.readFile(file1, 'utf8');
      const content2 = await fs.readFile(file2, 'utf8');
      expect(content1).toBe('Content 1');
      expect(content2).toBe('Content 2');
    });
  });

  describe('Resource Management', () => {
    it('should cleanup resources', async () => {
      expect(async () => {
        await fileTool.cleanup();
      }).not.toThrow();
    });

    it('should track operation metadata', async () => {
      const testFile = join(tempDir, 'metadata.txt');
      const content = 'Test content';

      const operation: FileOperation = {
        type: 'write',
        path: testFile,
        content: content,
      };

      const result = await fileTool.execute([operation]);

      expect(result.duration).toBeDefined();
      expect(typeof result.duration).toBe('number');
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });
});
