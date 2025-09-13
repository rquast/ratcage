import { vi } from 'vitest';

// Mock the markdown formatter package that has ESM import issues
vi.mock('@quilicicf/markdown-formatter', () => ({
  formatFromString: async (content: string) => ({
    toString: () => content,
  }),
  formatFromFile: async (content: string) => ({
    toString: () => content,
  }),
}));
