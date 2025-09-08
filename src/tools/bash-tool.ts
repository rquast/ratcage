import { spawn } from 'child_process';
import { existsSync } from 'fs';
import type {
  Tool,
  BashToolConfig,
  BashToolResult,
  ToolResultStatus,
} from '../types/tool';

export class BashTool implements Tool {
  public readonly name = 'BashTool';
  public readonly description =
    'Execute shell commands with configurable restrictions and monitoring';
  public config: Required<BashToolConfig>;
  public enabled: boolean;

  constructor(config: BashToolConfig = {}) {
    this.config = this.mergeDefaultConfig(config);
    this.enabled = this.config.enabled;
    this.validateConfig();
  }

  private mergeDefaultConfig(config: BashToolConfig): Required<BashToolConfig> {
    return {
      enabled: config.enabled !== false,
      timeout: config.timeout ?? 30000,
      workingDirectory: config.workingDirectory ?? process.cwd(),
      environment: config.environment ?? {},
      shell: config.shell ?? '/bin/bash',
      allowedCommands: config.allowedCommands ?? [],
      blockedCommands: config.blockedCommands ?? [
        'rm',
        'sudo',
        'su',
        'chmod',
        'chown',
      ],
      maxOutputSize: config.maxOutputSize ?? 1024 * 1024, // 1MB
    };
  }

  private validateConfig(): void {
    if (this.config.timeout < 0) {
      throw new Error('Invalid timeout: must be >= 0');
    }

    if (this.config.maxOutputSize < 0) {
      throw new Error('Invalid maxOutputSize: must be >= 0');
    }
  }

  validate(args: unknown[]): boolean {
    // Check if args is valid
    if (!Array.isArray(args) || args.length === 0) {
      return false;
    }

    // Check if all arguments are strings
    if (!args.every(arg => typeof arg === 'string')) {
      return false;
    }

    const command = args[0];

    // Check allowed commands (if specified)
    if (this.config.allowedCommands.length > 0) {
      if (!this.config.allowedCommands.includes(command)) {
        return false;
      }
    }

    // Check blocked commands
    if (this.config.blockedCommands.includes(command)) {
      return false;
    }

    return true;
  }

  async execute(args: unknown[]): Promise<BashToolResult> {
    const startTime = Date.now();

    // Validate arguments
    if (!this.validate(args)) {
      return {
        status: 'error',
        error: 'Invalid command or arguments',
        command: Array.isArray(args) ? args.join(' ') : 'invalid',
        duration: Date.now() - startTime,
      };
    }

    const stringArgs = args as string[];
    const command = stringArgs.join(' ');

    // Check if shell exists
    if (!existsSync(this.config.shell)) {
      return {
        status: 'error',
        error: 'Shell not found: ' + this.config.shell,
        command,
        duration: Date.now() - startTime,
      };
    }

    return new Promise(resolve => {
      let output = '';
      let errorOutput = '';
      let timedOut = false;
      let outputTruncated = false;
      let errorTruncated = false;

      const childProcess = spawn(this.config.shell, ['-c', command], {
        cwd: this.config.workingDirectory,
        env: { ...process.env, ...this.config.environment },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const timeout = setTimeout(() => {
        timedOut = true;
        childProcess.kill('SIGTERM');

        // Force kill after additional timeout
        setTimeout(() => {
          if (!childProcess.killed) {
            childProcess.kill('SIGKILL');
          }
        }, 1000);
      }, this.config.timeout);

      childProcess.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        if (output.length + chunk.length <= this.config.maxOutputSize) {
          output += chunk;
        } else if (output.length < this.config.maxOutputSize) {
          // Partially add chunk and mark as truncated
          const remaining = this.config.maxOutputSize - output.length;
          output += chunk.substring(0, remaining);
          outputTruncated = true;
        } else {
          // Already at max size, mark as truncated
          outputTruncated = true;
        }
      });

      childProcess.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        if (errorOutput.length + chunk.length <= this.config.maxOutputSize) {
          errorOutput += chunk;
        } else if (errorOutput.length < this.config.maxOutputSize) {
          // Partially add chunk and mark as truncated
          const remaining = this.config.maxOutputSize - errorOutput.length;
          errorOutput += chunk.substring(0, remaining);
          errorTruncated = true;
        } else {
          // Already at max size, mark as truncated
          errorTruncated = true;
        }
      });

      childProcess.on('close', code => {
        clearTimeout(timeout);

        const duration = Date.now() - startTime;
        let status: ToolResultStatus;

        if (timedOut) {
          status = 'timeout';
        } else if (code === 0) {
          status = 'success';
        } else {
          status = 'error';
        }

        // Check if output was truncated
        const truncated = outputTruncated || errorTruncated;

        let errorMessage = errorOutput.trim();
        if (status === 'timeout') {
          errorMessage = `Command timed out after ${this.config.timeout}ms`;
        } else if (status === 'error' && !errorMessage) {
          errorMessage = `Command failed with exit code ${code}`;
        }

        const result: BashToolResult = {
          status,
          output: output.trim(),
          error: errorMessage || undefined,
          exitCode: code ?? undefined,
          command,
          pid: childProcess.pid,
          duration,
          metadata: truncated ? { truncated: true } : undefined,
        };

        resolve(result);
      });

      childProcess.on('error', error => {
        clearTimeout(timeout);

        resolve({
          status: 'error',
          error: error.message,
          command,
          duration: Date.now() - startTime,
        });
      });
    });
  }

  async cleanup(): Promise<void> {
    // No persistent resources to clean up for BashTool
    // Individual process cleanup is handled in execute method
  }
}
