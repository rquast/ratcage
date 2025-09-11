#!/usr/bin/env node

/**
 * CageTools CLI entry point
 */

import { CLI } from './cli/index.js';
import { fileURLToPath } from 'url';

// Only run if this is the main module (not imported for testing)
if (
  import.meta.url === `file://${process.argv[1]}` ||
  fileURLToPath(import.meta.url) === process.argv[1]
) {
  const cli = new CLI();

  // Start the CLI
  cli.parse(process.argv.slice(2)).catch((error: Error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { CLI };
