#!/usr/bin/env node
/* eslint-env node */
/* eslint no-console: "off" */

import { readFileSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { resolve } from 'path';
import { homedir } from 'os';

const execAsync = promisify(exec);

async function importMcpConfig() {
  try {
    // Read the mcp-template.json file
    const mcpConfigPath = resolve(process.cwd(), 'mcp-template.json');
    const config = JSON.parse(readFileSync(mcpConfigPath, 'utf8'));

    if (!config.mcpServers) {
      console.error('No mcpServers found in mcp-template.json');
      process.exit(1);
    }

    console.log('🚀 Importing MCP configuration for RatCage project...\n');

    // Import each MCP server configuration
    for (const [serverName, serverConfig] of Object.entries(
      config.mcpServers
    )) {
      console.log(`\n📦 Importing MCP server: ${serverName}`);

      // Build the claude mcp add command
      const command = serverConfig.command;
      let args = serverConfig.args || [];

      // Replace template variables
      const projectPath = process.cwd();
      args = args.map(arg => {
        // Replace ${PROJECT_PATH} with actual project path
        if (arg.includes('${PROJECT_PATH}')) {
          const replaced = arg.replace('${PROJECT_PATH}', projectPath);
          console.log(`  📝 Replacing template: ${arg} -> ${replaced}`);
          return replaced;
        }
        // Also handle old-style /home/username paths for backwards compatibility
        if (arg.includes('/home/')) {
          const replaced = arg.replace(/\/home\/[^/]+/, homedir());
          console.log(`  📝 Converting path: ${arg} -> ${replaced}`);
          return replaced;
        }
        return arg;
      });

      // Create the full command string
      // For MCP servers with arguments that start with --, we need to use -- separator
      let claudeCommand;
      if (args.length > 0 && args.some(arg => arg.startsWith('--'))) {
        claudeCommand = `claude mcp add ${serverName} ${command} -- ${args.join(' ')}`;
      } else {
        const quotedArgs = args
          .map(arg => {
            // Check if arg contains spaces and doesn't already have quotes
            if (
              arg.includes(' ') &&
              !arg.startsWith('"') &&
              !arg.startsWith("'")
            ) {
              return `"${arg}"`;
            }
            return arg;
          })
          .join(' ');
        claudeCommand =
          `claude mcp add ${serverName} ${command} ${quotedArgs}`.trim();
      }

      console.log(`  🔧 Running: ${claudeCommand}`);

      try {
        const { stdout, stderr } = await execAsync(claudeCommand);
        if (stdout) console.log(stdout);
        if (stderr && !stderr.includes('already exists')) console.error(stderr);
        console.log(`  ✅ Successfully imported ${serverName}`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`  ℹ️  ${serverName} already exists - skipping`);
        } else if (error.message.includes('command not found')) {
          console.error(
            `  ⚠️  Claude CLI not found. Please install Claude Code first.`
          );
          console.error(
            `     Visit: https://docs.anthropic.com/claude-code/installation`
          );
          process.exit(1);
        } else {
          console.error(`  ❌ Failed to import ${serverName}:`, error.message);
        }
      }
    }

    console.log('\n✨ MCP configuration import completed successfully!');
    console.log('\n📌 Important: Context7 is now available for this project');
    console.log(
      '   You can use @context7 in Claude Code to access contextual information.\n'
    );
  } catch (error) {
    console.error('❌ Error importing MCP configuration:', error);
    process.exit(1);
  }
}

// Run the import
importMcpConfig();
