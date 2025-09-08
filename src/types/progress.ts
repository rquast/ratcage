import type { Ora } from 'ora';

/**
 * Progress status types
 */
export type ProgressStatus = 'success' | 'error' | 'warn' | 'info';

/**
 * Spinner configuration options
 */
export interface SpinnerOptions {
  spinner?: string;
  color?: string;
  interval?: number;
}

/**
 * Progress bar configuration
 */
export interface ProgressBarConfig {
  total: number;
  format: string;
  width?: number;
  complete?: string;
  incomplete?: string;
}

/**
 * Progress update callback
 */
export type ProgressUpdateCallback = (current: number) => void;

/**
 * Task with progress callback
 */
export type ProgressTask<T> = (
  updateProgress: ProgressUpdateCallback
) => Promise<T>;

/**
 * Active spinner instance
 */
export interface ActiveSpinner {
  id: string;
  ora: Ora;
}

/**
 * Active progress bar instance
 */
export interface ActiveProgressBar {
  id: string;
  config: ProgressBarConfig;
  current: number;
  isComplete: boolean;
}
