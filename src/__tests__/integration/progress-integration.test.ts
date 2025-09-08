import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProgressManager } from '../../ui/progress';

describe('ProgressManager Integration Tests', () => {
  let progressManager: ProgressManager;

  beforeEach(() => {
    progressManager = new ProgressManager();
  });

  afterEach(() => {
    // Always clean up to prevent test interference
    progressManager.cleanup();
  });

  describe('Real Ora Integration', () => {
    it('should create and manage real spinners', async () => {
      // Test with actual Ora instance (not mocked)
      const spinnerId = progressManager.startSpinner('Testing real spinner...');

      expect(spinnerId).toBeDefined();
      expect(typeof spinnerId).toBe('string');

      // Update the spinner text
      progressManager.updateSpinner(spinnerId, 'Updated spinner text...');

      // Stop the spinner with success
      progressManager.stopSpinner(
        spinnerId,
        'success',
        'Integration test passed!'
      );

      // Should not throw when accessing a completed spinner
      expect(() => {
        progressManager.updateSpinner(spinnerId, 'Should fail');
      }).toThrow('Spinner with id ' + spinnerId + ' not found');
    });

    it('should handle real spinner errors gracefully', () => {
      const spinnerId = progressManager.startSpinner('Error test spinner...');

      // This should work
      progressManager.stopSpinner(spinnerId, 'error', 'Something went wrong!');

      // This should throw since spinner is already stopped
      expect(() => {
        progressManager.stopSpinner(spinnerId, 'success', 'Should fail');
      }).toThrow('Spinner with id ' + spinnerId + ' not found');
    });

    it('should work with multiple concurrent spinners', () => {
      const spinner1 = progressManager.startSpinner('First spinner...');
      const spinner2 = progressManager.startSpinner('Second spinner...');
      const spinner3 = progressManager.startSpinner('Third spinner...');

      expect(spinner1).not.toBe(spinner2);
      expect(spinner2).not.toBe(spinner3);

      // Update all spinners
      progressManager.updateSpinner(spinner1, 'Updated first...');
      progressManager.updateSpinner(spinner2, 'Updated second...');
      progressManager.updateSpinner(spinner3, 'Updated third...');

      // Stop them with different statuses
      progressManager.stopSpinner(spinner1, 'success', 'First completed!');
      progressManager.stopSpinner(spinner2, 'warn', 'Second had warnings');
      progressManager.stopSpinner(spinner3, 'info', 'Third finished');

      // All should be cleaned up
      expect(() => progressManager.updateSpinner(spinner1, 'fail')).toThrow();
      expect(() => progressManager.updateSpinner(spinner2, 'fail')).toThrow();
      expect(() => progressManager.updateSpinner(spinner3, 'fail')).toThrow();
    });

    it('should handle custom spinner options', () => {
      const spinnerId = progressManager.startSpinner('Custom spinner...', {
        spinner: 'dots2',
        color: 'yellow',
      });

      expect(spinnerId).toBeDefined();
      progressManager.stopSpinner(spinnerId);
    });

    it('should respect silent mode', () => {
      progressManager.setSilent(true);

      const spinnerId = progressManager.startSpinner('Silent spinner...');
      expect(spinnerId).toBeDefined();

      // These operations should work without visual output
      progressManager.updateSpinner(spinnerId, 'Updated silently...');
      progressManager.stopSpinner(spinnerId, 'success', 'Completed silently');
    });

    it('should respect enabled/disabled state', () => {
      progressManager.setEnabled(false);

      const spinnerId = progressManager.startSpinner('Disabled spinner...');
      expect(spinnerId).toBeDefined();

      // Should work but without visual feedback
      progressManager.updateSpinner(spinnerId, 'Updated when disabled...');
      progressManager.stopSpinner(spinnerId);

      // Re-enable for next test
      progressManager.setEnabled(true);
    });
  });

  describe('Progress Bar Integration', () => {
    it('should create and manage progress bars', () => {
      const progressId = progressManager.createProgress({
        total: 100,
        format: 'Progress: {bar} {percentage}%',
      });

      expect(progressId).toBeDefined();

      // Update progress
      progressManager.updateProgress(progressId, 25);
      progressManager.updateProgress(progressId, 50);
      progressManager.updateProgress(progressId, 75);

      // Complete the progress
      progressManager.completeProgress(progressId);

      // Should throw when trying to update completed progress
      expect(() => {
        progressManager.updateProgress(progressId, 90);
      }).toThrow('Progress bar with id ' + progressId + ' not found');
    });

    it('should handle multiple progress bars', () => {
      const progress1 = progressManager.createProgress({
        total: 50,
        format: 'Task 1: {bar}',
      });

      const progress2 = progressManager.createProgress({
        total: 200,
        format: 'Task 2: {bar} {percentage}%',
      });

      expect(progress1).not.toBe(progress2);

      // Update both independently
      progressManager.updateProgress(progress1, 10);
      progressManager.updateProgress(progress2, 50);

      progressManager.updateProgress(progress1, 25);
      progressManager.updateProgress(progress2, 100);

      // Complete both
      progressManager.completeProgress(progress1);
      progressManager.completeProgress(progress2);
    });
  });

  describe('Task Execution Integration', () => {
    it('should execute task with real spinner', async () => {
      let taskExecuted = false;

      const task = async (): Promise<string> => {
        // Simulate some work
        await new Promise(resolve => setTimeout(resolve, 10));
        taskExecuted = true;
        return 'task result';
      };

      const result = await progressManager.withSpinner(
        'Executing task...',
        task
      );

      expect(result).toBe('task result');
      expect(taskExecuted).toBe(true);
    });

    it('should handle task failure with real spinner', async () => {
      const task = async (): Promise<never> => {
        // Simulate some work before failure
        await new Promise(resolve => setTimeout(resolve, 10));
        throw new Error('Task execution failed');
      };

      await expect(
        progressManager.withSpinner('Executing failing task...', task)
      ).rejects.toThrow('Task execution failed');
    });

    it('should execute task with real progress tracking', async () => {
      const updates: number[] = [];

      const task = async (
        updateProgress: (current: number) => void
      ): Promise<string> => {
        // Simulate work with progress updates
        for (let i = 0; i <= 100; i += 25) {
          await new Promise(resolve => setTimeout(resolve, 5));
          updateProgress(i);
          updates.push(i);
        }
        return 'progress task result';
      };

      const result = await progressManager.withProgress(
        { total: 100, format: 'Working: {bar} {percentage}%' },
        task
      );

      expect(result).toBe('progress task result');
      expect(updates).toEqual([0, 25, 50, 75, 100]);
    });

    it('should handle progress task failure', async () => {
      const task = async (
        updateProgress: (current: number) => void
      ): Promise<never> => {
        updateProgress(25);
        await new Promise(resolve => setTimeout(resolve, 5));
        updateProgress(50);
        throw new Error('Progress task failed');
      };

      await expect(
        progressManager.withProgress(
          { total: 100, format: 'Failing: {bar}' },
          task
        )
      ).rejects.toThrow('Progress task failed');
    });
  });

  describe('Cleanup Integration', () => {
    it('should cleanup all active spinners and progress bars', () => {
      // Create multiple spinners and progress bars
      const spinner1 = progressManager.startSpinner('Spinner 1...');
      const spinner2 = progressManager.startSpinner('Spinner 2...');

      const progress1 = progressManager.createProgress({
        total: 100,
        format: 'Progress 1: {bar}',
      });

      const progress2 = progressManager.createProgress({
        total: 50,
        format: 'Progress 2: {bar}',
      });

      // Update some of them
      progressManager.updateSpinner(spinner1, 'Updated spinner 1...');
      progressManager.updateProgress(progress1, 25);

      // Cleanup should stop everything
      progressManager.cleanup();

      // All should be cleaned up - these should throw
      expect(() =>
        progressManager.updateSpinner(spinner1, 'Should fail')
      ).toThrow();
      expect(() =>
        progressManager.updateSpinner(spinner2, 'Should fail')
      ).toThrow();
      expect(() => progressManager.updateProgress(progress1, 50)).toThrow();
      expect(() => progressManager.updateProgress(progress2, 25)).toThrow();
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle rapid spinner creation and destruction', () => {
      const spinnerIds: string[] = [];

      // Create many spinners rapidly
      for (let i = 0; i < 10; i++) {
        const id = progressManager.startSpinner(`Spinner ${i}...`);
        spinnerIds.push(id);
      }

      // Stop them all
      spinnerIds.forEach(id => {
        progressManager.stopSpinner(id, 'success', 'Done');
      });

      // Verify they're all cleaned up
      spinnerIds.forEach(id => {
        expect(() =>
          progressManager.updateSpinner(id, 'Should fail')
        ).toThrow();
      });
    });

    it('should handle concurrent task execution', async () => {
      const task1 = async (): Promise<string> => {
        await new Promise(resolve => setTimeout(resolve, 20));
        return 'task1 result';
      };

      const task2 = async (): Promise<string> => {
        await new Promise(resolve => setTimeout(resolve, 30));
        return 'task2 result';
      };

      // Execute tasks concurrently with spinners
      const [result1, result2] = await Promise.all([
        progressManager.withSpinner('Task 1...', task1),
        progressManager.withSpinner('Task 2...', task2),
      ]);

      expect(result1).toBe('task1 result');
      expect(result2).toBe('task2 result');
    });
  });
});
