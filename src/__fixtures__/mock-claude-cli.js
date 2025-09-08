#!/usr/bin/env node
/* eslint-env node */
/* eslint no-console: "off" */
// Mock Claude CLI for integration testing
const { stdin, stdout, stderr } = process;

// Parse command line arguments
const args = process.argv.slice(2);
const apiKey = process.env.ANTHROPIC_API_KEY;

// Simulate startup delay
setTimeout(() => {
  if (!apiKey || apiKey === 'invalid') {
    stderr.write('Error: Invalid API key\n');
    process.exit(1);
  }

  // Handle different commands
  if (args.includes('--help')) {
    stdout.write('Mock Claude CLI v1.0.0\nUsage: claude [options] [input]\n');
    process.exit(0);
  }

  // Listen for input from stdin
  let input = '';
  stdin.on('data', chunk => {
    input += chunk.toString();
  });

  stdin.on('end', () => {
    try {
      const parsed = JSON.parse(input);

      if (parsed.prompt) {
        // Simulate response based on prompt
        if (parsed.prompt.includes('error')) {
          stderr.write('Error: Something went wrong processing the request\n');
          process.exit(1);
        }

        if (parsed.tools && parsed.tools.some(t => t.name === 'write_file')) {
          // Simulate tool usage
          const toolResult = {
            type: 'tool_result',
            tool_name: 'write_file',
            result: { success: true, output: 'File written successfully' },
          };
          stdout.write(JSON.stringify(toolResult) + '\n');
        } else {
          // Regular response
          const response = {
            type: 'message',
            content: `Hello! You said: "${parsed.prompt}"`,
            metadata: {
              model: 'claude-3-opus',
              tokens: 42,
            },
          };
          stdout.write(JSON.stringify(response) + '\n');
        }
      }
    } catch {
      // Handle plain text input
      stdout.write(`Mock response to: ${input.trim()}\n`);
    }
  });

  // Handle process termination
  process.on('SIGTERM', () => {
    stdout.write('Process terminated\n');
    process.exit(0);
  });
}, 10); // Small delay to simulate startup
