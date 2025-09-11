import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  build: {
    target: 'node18',
    lib: {
      entry: {
        cli: resolve(__dirname, 'src/cli.ts'),
        'cli/index': resolve(__dirname, 'src/cli/index.ts'),
      },
      formats: ['es'],
      fileName: (_, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: [
        /^node:/,
        'commander',
        'chalk',
        'inquirer',
        'winston',
        'zod',
        '@anthropic-ai/sdk',
        '@modelcontextprotocol/sdk',
        '@modelcontextprotocol/server-filesystem',
        'ora',
        'child_process',
        'fs',
        'path',
        'url',
        'os',
        'stream',
        'events',
        'readline',
      ],
      output: {
        preserveModules: true,
        preserveModulesRoot: 'src',
      },
    },
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
