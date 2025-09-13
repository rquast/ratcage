import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [swc.vite()],
  test: {
    globals: true,
    environment: 'node',
    include: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.spec.ts'],
    exclude: ['node_modules', 'dist', 'build'],
    // Use forks for better test isolation
    pool: 'forks',
    isolate: true, // Run each test file in isolation
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '*.config.ts',
        '**/*.d.ts',
        '**/__tests__/**',
        '**/__mocks__/**',
        '**/__fixtures__/**',
      ],
    },
  },
});
