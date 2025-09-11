import ora from 'ora';
import type { Ora, Options as OraOptions } from 'ora';
import type {
  ProgressStatus,
  SpinnerOptions,
  ProgressBarConfig,
  ProgressUpdateCallback,
  ProgressTask,
  ActiveSpinner,
  ActiveProgressBar,
} from '../types/progress';

/**
 * Progress manager for spinners and progress bars
 */
export class ProgressManager {
  private spinners: Map<string, ActiveSpinner> = new Map();
  private progressBars: Map<string, ActiveProgressBar> = new Map();
  private silent = false;
  private enabled = true;
  private idCounter = 0;

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `progress-${++this.idCounter}`;
  }

  /**
   * Start a spinner
   */
  startSpinner(text: string, options?: SpinnerOptions): string {
    if (!this.enabled || this.silent) {
      const id = this.generateId();
      // Create inactive spinner for silent mode
      this.spinners.set(id, {
        id,
        ora: {} as Ora, // Mock ora instance
      });
      return id;
    }

    const id = this.generateId();
    // Build ora options with proper typing
    const oraOptions: OraOptions = {
      text,
      ...(options?.spinner && {
        spinner: options.spinner as OraOptions['spinner'],
      }),
      ...(options?.color && { color: options.color as OraOptions['color'] }),
      ...(options?.interval && { interval: options.interval }),
    };
    const spinner = ora(oraOptions).start();

    this.spinners.set(id, { id, ora: spinner });
    return id;
  }

  /**
   * Update spinner text
   */
  updateSpinner(spinnerId: string, text: string): void {
    const spinner = this.spinners.get(spinnerId);
    if (!spinner) {
      throw new Error(`Spinner with id ${spinnerId} not found`);
    }

    if (!this.enabled || this.silent) {
      return;
    }

    spinner.ora.text = text;
  }

  /**
   * Stop spinner with optional status
   */
  stopSpinner(
    spinnerId: string,
    status?: ProgressStatus,
    message?: string
  ): void {
    const spinner = this.spinners.get(spinnerId);
    if (!spinner) {
      throw new Error(`Spinner with id ${spinnerId} not found`);
    }

    if (!this.enabled || this.silent) {
      this.spinners.delete(spinnerId);
      return;
    }

    if (status && message) {
      switch (status) {
        case 'success':
          spinner.ora.succeed(message);
          break;
        case 'error':
          spinner.ora.fail(message);
          break;
        case 'warn':
          spinner.ora.warn(message);
          break;
        case 'info':
          spinner.ora.info(message);
          break;
      }
    } else {
      spinner.ora.stop();
    }

    this.spinners.delete(spinnerId);
  }

  /**
   * Create a progress bar
   */
  createProgress(config: ProgressBarConfig): string {
    const id = this.generateId();

    this.progressBars.set(id, {
      id,
      config,
      current: 0,
      isComplete: false,
    });

    if (this.enabled && !this.silent) {
      // In a real implementation, we would create a CLI progress bar
      // For now, we'll just track the state
    }

    return id;
  }

  /**
   * Update progress bar
   */
  updateProgress(progressId: string, current: number): void {
    const progress = this.progressBars.get(progressId);
    if (!progress) {
      throw new Error(`Progress bar with id ${progressId} not found`);
    }

    progress.current = current;

    if (this.enabled && !this.silent) {
      // Update the actual progress bar display
      // For now, we'll just update the state
    }
  }

  /**
   * Complete progress bar
   */
  completeProgress(progressId: string): void {
    const progress = this.progressBars.get(progressId);
    if (!progress) {
      throw new Error(`Progress bar with id ${progressId} not found`);
    }

    progress.isComplete = true;
    progress.current = progress.config.total;

    if (this.enabled && !this.silent) {
      // Complete the progress bar display
    }

    // Remove completed progress bar from tracking
    this.progressBars.delete(progressId);
  }

  /**
   * Execute task with spinner
   */
  async withSpinner<T>(text: string, task: () => Promise<T>): Promise<T> {
    const spinnerId = this.startSpinner(text);

    try {
      const result = await task();
      this.stopSpinner(spinnerId, 'success', 'Completed');
      return result;
    } catch (error) {
      this.stopSpinner(spinnerId, 'error', 'Failed');
      throw error;
    }
  }

  /**
   * Execute task with progress bar
   */
  async withProgress<T>(
    config: ProgressBarConfig,
    task: ProgressTask<T>
  ): Promise<T> {
    const progressId = this.createProgress(config);

    try {
      const updateProgress: ProgressUpdateCallback = (current: number) => {
        this.updateProgress(progressId, current);
      };

      const result = await task(updateProgress);
      this.completeProgress(progressId);
      return result;
    } catch (error) {
      // Clean up progress bar on error
      this.progressBars.delete(progressId);
      throw error;
    }
  }

  /**
   * Set silent mode
   */
  setSilent(silent: boolean): void {
    this.silent = silent;
  }

  /**
   * Set enabled state
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Clean up all active spinners and progress bars
   */
  cleanup(): void {
    // Stop all spinners
    for (const [, spinner] of this.spinners) {
      if (!this.silent && this.enabled) {
        spinner.ora.stop();
      }
    }
    this.spinners.clear();

    // Complete all progress bars
    for (const [,] of this.progressBars) {
      if (!this.silent && this.enabled) {
        // Stop progress bar display
      }
    }
    this.progressBars.clear();
  }
}
