import { promises as fs } from 'fs';
import { dirname, resolve, normalize } from 'path';
import type {
  Tool,
  FileToolConfig,
  FileOperation,
  FileToolResult,
} from '../types/tool';

export class FileTool implements Tool {
  public readonly name = 'FileTool';
  public readonly description =
    'Perform file system operations with path restrictions and safety checks';
  public config: Required<FileToolConfig>;
  public enabled: boolean;

  constructor(config: FileToolConfig = {}) {
    this.config = this.mergeDefaultConfig(config);
    this.enabled = this.config.enabled;
    this.validateConfig();
  }

  private mergeDefaultConfig(config: FileToolConfig): Required<FileToolConfig> {
    return {
      enabled: config.enabled !== false,
      timeout: config.timeout ?? 10000,
      workingDirectory: config.workingDirectory ?? process.cwd(),
      environment: config.environment ?? {},
      allowedPaths: config.allowedPaths ?? [],
      blockedPaths: config.blockedPaths ?? ['/etc', '/sys', '/proc', '/dev'],
      maxFileSize: config.maxFileSize ?? 10 * 1024 * 1024, // 10MB
      encoding: config.encoding ?? 'utf8',
    };
  }

  private validateConfig(): void {
    if (this.config.maxFileSize < 0) {
      throw new Error('Invalid maxFileSize: must be >= 0');
    }
  }

  validate(args: unknown[]): boolean {
    if (!Array.isArray(args) || args.length === 0) {
      return false;
    }

    const operation = args[0];
    if (typeof operation !== 'object' || operation === null) {
      return false;
    }

    const op = operation as FileOperation;

    // Validate operation type
    const validTypes = [
      'read',
      'write',
      'append',
      'delete',
      'copy',
      'move',
      'exists',
      'stat',
    ];
    if (!validTypes.includes(op.type)) {
      return false;
    }

    // Validate required fields
    if (typeof op.path !== 'string') {
      return false;
    }

    // Validate operation-specific requirements
    if (
      ['write', 'append'].includes(op.type) &&
      typeof op.content !== 'string'
    ) {
      return false;
    }

    if (
      ['copy', 'move'].includes(op.type) &&
      typeof op.destinationPath !== 'string'
    ) {
      return false;
    }

    // Validate paths
    const normalizedPath = this.normalizePath(op.path);

    // Check blocked paths
    for (const blockedPath of this.config.blockedPaths) {
      if (normalizedPath.startsWith(blockedPath)) {
        return false;
      }
    }

    // Check allowed paths (if specified)
    if (this.config.allowedPaths.length > 0) {
      const isAllowed = this.config.allowedPaths.some(allowedPath =>
        normalizedPath.startsWith(this.normalizePath(allowedPath))
      );
      if (!isAllowed) {
        return false;
      }
    }

    // Validate destination path for copy/move operations
    if (op.destinationPath) {
      const normalizedDestPath = this.normalizePath(op.destinationPath);

      // Check blocked paths for destination
      for (const blockedPath of this.config.blockedPaths) {
        if (normalizedDestPath.startsWith(blockedPath)) {
          return false;
        }
      }

      // Check allowed paths for destination (if specified)
      if (this.config.allowedPaths.length > 0) {
        const isDestAllowed = this.config.allowedPaths.some(allowedPath =>
          normalizedDestPath.startsWith(this.normalizePath(allowedPath))
        );
        if (!isDestAllowed) {
          return false;
        }
      }
    }

    return true;
  }

  private normalizePath(path: string): string {
    return normalize(resolve(path));
  }

  async execute(args: unknown[]): Promise<FileToolResult> {
    const startTime = Date.now();

    // Validate arguments
    if (!this.validate(args)) {
      return {
        status: 'error',
        error: 'Invalid operation or path not allowed',
        operation: args[0] as FileOperation,
        duration: Date.now() - startTime,
      };
    }

    const operation = args[0] as FileOperation;

    try {
      let result: Partial<FileToolResult>;

      switch (operation.type) {
        case 'read':
          result = await this.readFile(operation);
          break;
        case 'write':
          result = await this.writeFile(operation);
          break;
        case 'append':
          result = await this.appendFile(operation);
          break;
        case 'delete':
          result = await this.deleteFile(operation);
          break;
        case 'copy':
          result = await this.copyFile(operation);
          break;
        case 'move':
          result = await this.moveFile(operation);
          break;
        case 'exists':
          result = await this.checkExists(operation);
          break;
        case 'stat':
          result = await this.getStats(operation);
          break;
        default:
          result = {
            status: 'error',
            error: `Unsupported operation: ${operation.type}`,
          };
      }

      return {
        ...result,
        operation,
        duration: Date.now() - startTime,
      } as FileToolResult;
    } catch (error) {
      return {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        operation,
        duration: Date.now() - startTime,
      };
    }
  }

  private async readFile(
    operation: FileOperation
  ): Promise<Partial<FileToolResult>> {
    const { path } = operation;

    // Check file size first
    try {
      const stats = await fs.stat(path);
      if (stats.size > this.config.maxFileSize) {
        return {
          status: 'error',
          error: `File too large: ${stats.size} bytes exceeds limit of ${this.config.maxFileSize} bytes`,
        };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {
          status: 'error',
          error: `File not found: ${path}`,
        };
      }
      throw error;
    }

    const content = await fs.readFile(path, this.config.encoding);

    return {
      status: 'success',
      content,
    };
  }

  private async writeFile(
    operation: FileOperation
  ): Promise<Partial<FileToolResult>> {
    const { path, content } = operation;

    // Ensure directory exists
    const dir = dirname(path);
    await fs.mkdir(dir, { recursive: true });

    await fs.writeFile(path, content!, this.config.encoding);

    return {
      status: 'success',
    };
  }

  private async appendFile(
    operation: FileOperation
  ): Promise<Partial<FileToolResult>> {
    const { path, content } = operation;

    // Ensure directory exists
    const dir = dirname(path);
    await fs.mkdir(dir, { recursive: true });

    await fs.appendFile(path, content!, this.config.encoding);

    return {
      status: 'success',
    };
  }

  private async deleteFile(
    operation: FileOperation
  ): Promise<Partial<FileToolResult>> {
    const { path } = operation;

    try {
      await fs.unlink(path);

      return {
        status: 'success',
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {
          status: 'error',
          error: `File not found: ${path}`,
        };
      }
      throw error;
    }
  }

  private async copyFile(
    operation: FileOperation
  ): Promise<Partial<FileToolResult>> {
    const { path, destinationPath } = operation;

    // Ensure destination directory exists
    const destDir = dirname(destinationPath!);
    await fs.mkdir(destDir, { recursive: true });

    await fs.copyFile(path, destinationPath!);

    return {
      status: 'success',
    };
  }

  private async moveFile(
    operation: FileOperation
  ): Promise<Partial<FileToolResult>> {
    const { path, destinationPath } = operation;

    // Ensure destination directory exists
    const destDir = dirname(destinationPath!);
    await fs.mkdir(destDir, { recursive: true });

    await fs.rename(path, destinationPath!);

    return {
      status: 'success',
    };
  }

  private async checkExists(
    operation: FileOperation
  ): Promise<Partial<FileToolResult>> {
    const { path } = operation;

    try {
      await fs.access(path);
      return {
        status: 'success',
        output: 'true',
      };
    } catch {
      return {
        status: 'success',
        output: 'false',
      };
    }
  }

  private async getStats(
    operation: FileOperation
  ): Promise<Partial<FileToolResult>> {
    const { path } = operation;

    const stats = await fs.stat(path);

    return {
      status: 'success',
      stats: {
        size: stats.size,
        modified: stats.mtime,
        created: stats.birthtime,
        isDirectory: stats.isDirectory(),
      },
    };
  }

  async cleanup(): Promise<void> {
    // No persistent resources to clean up for FileTool
  }
}
