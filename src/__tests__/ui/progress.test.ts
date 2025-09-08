import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProgressManager } from '../../ui/progress';

// Create mock ora instance
const mockOraInstance = {
  start: vi.fn().mockReturnThis(),
  stop: vi.fn().mockReturnThis(),
  succeed: vi.fn().mockReturnThis(),
  fail: vi.fn().mockReturnThis(),
  warn: vi.fn().mockReturnThis(),
  info: vi.fn().mockReturnThis(),
  text: '',
  isSpinning: false,
};

// Mock ora
vi.mock('ora', () => ({
  default: vi.fn(() => mockOraInstance),
}));

describe('ProgressManager', () => {
  let progressManager: ProgressManager;

  beforeEach(() => {
    progressManager = new ProgressManager();
    // Reset all mocks before each test
    vi.clearAllMocks();
    mockOraInstance.text = '';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Spinner Management', () => {
    it('should create and start a spinner', () => {
      const spinnerId = progressManager.startSpinner('Loading...');

      expect(mockOraInstance.start).toHaveBeenCalled();
      expect(spinnerId).toBeDefined();
      expect(typeof spinnerId).toBe('string');
    });

    it('should update spinner text', () => {
      const spinnerId = progressManager.startSpinner('Loading...');
      progressManager.updateSpinner(spinnerId, 'Processing...');

      expect(mockOraInstance.text).toBe('Processing...');
    });

    it('should stop spinner with success', () => {
      const spinnerId = progressManager.startSpinner('Loading...');
      progressManager.stopSpinner(spinnerId, 'success', 'Completed!');

      expect(mockOraInstance.succeed).toHaveBeenCalledWith('Completed!');
    });

    it('should stop spinner with failure', () => {
      const spinnerId = progressManager.startSpinner('Loading...');
      progressManager.stopSpinner(spinnerId, 'error', 'Failed!');

      expect(mockOraInstance.fail).toHaveBeenCalledWith('Failed!');
    });

    it('should stop spinner with warning', () => {
      const spinnerId = progressManager.startSpinner('Loading...');
      progressManager.stopSpinner(spinnerId, 'warn', 'Warning!');

      expect(mockOraInstance.warn).toHaveBeenCalledWith('Warning!');
    });

    it('should stop spinner with info', () => {
      const spinnerId = progressManager.startSpinner('Loading...');
      progressManager.stopSpinner(spinnerId, 'info', 'Info message');

      expect(mockOraInstance.info).toHaveBeenCalledWith('Info message');
    });

    it('should stop spinner without status', () => {
      const spinnerId = progressManager.startSpinner('Loading...');
      progressManager.stopSpinner(spinnerId);

      expect(mockOraInstance.stop).toHaveBeenCalled();
    });

    it('should handle multiple spinners', () => {
      const spinner1 = progressManager.startSpinner('Loading 1...');
      const spinner2 = progressManager.startSpinner('Loading 2...');

      expect(spinner1).not.toBe(spinner2);
      expect(mockOraInstance.start).toHaveBeenCalledTimes(2);
    });

    it('should throw error when updating non-existent spinner', () => {
      expect(() => {
        progressManager.updateSpinner('non-existent', 'text');
      }).toThrow('Spinner with id non-existent not found');
    });

    it('should throw error when stopping non-existent spinner', () => {
      expect(() => {
        progressManager.stopSpinner('non-existent');
      }).toThrow('Spinner with id non-existent not found');
    });
  });

  describe('Progress Bar Management', () => {
    it('should create a progress bar', () => {
      const progressId = progressManager.createProgress({
        total: 100,
        format: 'Progress: {bar} {percentage}%',
      });

      expect(progressId).toBeDefined();
      expect(typeof progressId).toBe('string');
    });

    it('should update progress bar', () => {
      const progressId = progressManager.createProgress({
        total: 100,
        format: 'Progress: {bar} {percentage}%',
      });

      progressManager.updateProgress(progressId, 50);

      // Should not throw
      expect(() =>
        progressManager.updateProgress(progressId, 75)
      ).not.toThrow();
    });

    it('should complete progress bar', () => {
      const progressId = progressManager.createProgress({
        total: 100,
        format: 'Progress: {bar} {percentage}%',
      });

      progressManager.updateProgress(progressId, 50);
      progressManager.completeProgress(progressId);

      // Should throw when trying to complete again
      expect(() => progressManager.completeProgress(progressId)).toThrow(
        'Progress bar with id ' + progressId + ' not found'
      );
    });

    it('should throw error when updating non-existent progress bar', () => {
      expect(() => {
        progressManager.updateProgress('non-existent', 50);
      }).toThrow('Progress bar with id non-existent not found');
    });

    it('should throw error when completing non-existent progress bar', () => {
      expect(() => {
        progressManager.completeProgress('non-existent');
      }).toThrow('Progress bar with id non-existent not found');
    });
  });

  describe('Task Progress Tracking', () => {
    it('should track task with spinner', async () => {
      const task = vi.fn().mockResolvedValue('result');

      const result = await progressManager.withSpinner('Processing...', task);

      expect(mockOraInstance.start).toHaveBeenCalled();
      expect(mockOraInstance.succeed).toHaveBeenCalled();
      expect(task).toHaveBeenCalled();
      expect(result).toBe('result');
    });

    it('should handle task failure with spinner', async () => {
      const error = new Error('Task failed');
      const task = vi.fn().mockRejectedValue(error);

      await expect(
        progressManager.withSpinner('Processing...', task)
      ).rejects.toThrow('Task failed');

      expect(mockOraInstance.start).toHaveBeenCalled();
      expect(mockOraInstance.fail).toHaveBeenCalled();
    });

    it('should track task with progress bar', async () => {
      const task = vi.fn(async updateProgress => {
        updateProgress(25);
        updateProgress(50);
        updateProgress(75);
        updateProgress(100);
        return 'result';
      });

      const result = await progressManager.withProgress(
        { total: 100, format: 'Progress: {bar} {percentage}%' },
        task
      );

      expect(task).toHaveBeenCalled();
      expect(result).toBe('result');
    });

    it('should handle task failure with progress bar', async () => {
      const error = new Error('Task failed');
      const task = vi.fn().mockRejectedValue(error);

      await expect(
        progressManager.withProgress(
          { total: 100, format: 'Progress: {bar} {percentage}%' },
          task
        )
      ).rejects.toThrow('Task failed');

      expect(task).toHaveBeenCalled();
    });
  });

  describe('Cleanup', () => {
    it('should stop all active spinners on cleanup', () => {
      progressManager.startSpinner('Loading 1...');
      progressManager.startSpinner('Loading 2...');

      progressManager.cleanup();

      expect(mockOraInstance.stop).toHaveBeenCalledTimes(2);
    });

    it('should complete all active progress bars on cleanup', () => {
      progressManager.createProgress({
        total: 100,
        format: 'Progress 1: {bar}',
      });
      progressManager.createProgress({
        total: 50,
        format: 'Progress 2: {bar}',
      });

      // Should not throw
      expect(() => progressManager.cleanup()).not.toThrow();
    });
  });

  describe('Configuration', () => {
    it('should allow custom spinner configuration', () => {
      const spinnerId = progressManager.startSpinner('Loading...', {
        spinner: 'dots2',
        color: 'yellow',
      });

      expect(spinnerId).toBeDefined();
      expect(mockOraInstance.start).toHaveBeenCalled();
    });

    it('should support silent mode', () => {
      progressManager.setSilent(true);
      progressManager.startSpinner('Loading...');

      // In silent mode, spinner should not start
      expect(mockOraInstance.start).not.toHaveBeenCalled();
    });

    it('should support disabling progress indicators', () => {
      progressManager.setEnabled(false);
      progressManager.startSpinner('Loading...');

      // When disabled, spinner should not start
      expect(mockOraInstance.start).not.toHaveBeenCalled();
    });
  });
});
