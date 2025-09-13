# CageTools - Universal Coding Agent CLI Wrapper

A powerful CLI tool that provides a unified interface for interacting with various AI coding assistants, featuring rich terminal formatting, session management, hook system, and extensible tool support.

## Features

- **Multiple AI Provider Support**: Choose between Claude Code CLI (default) and Claude API for AI interactions
- **Rich Terminal Output**: Beautiful markdown rendering with syntax highlighting, bold/italic text, and formatted lists using `stdout-update` for smooth incremental updates
- **Interactive Chat Mode**: Engage in continuous conversations with AI assistants with slash command support
- **Session Management**: Persistent context across conversations with session resume functionality
- **Quality Hook System**: Automated code quality checks with TypeScript, ESLint, and Prettier integration
- **Tool Integration**: Built-in tools for file operations, bash commands, and more
- **Permission Management**: Controlled access to system operations and tools
- **Extensible Architecture**: Plugin-based system for adding new providers, tools, and hooks

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/cagetools.git
cd cagetools

# Install dependencies (automatically sets up hooks and applies patches)
npm install

# Build the project
npm run build

# Or use development mode
npm run dev
```

### Prerequisites

- **Node.js** 18+ and npm
- **Claude Code CLI** (for claude-code provider) - Install from [https://docs.anthropic.com/en/docs/claude-code/setup](https://docs.anthropic.com/en/docs/claude-code/setup)
- **Anthropic API Key** (for claude-api provider) - Optional, can be set via environment variable `ANTHROPIC_API_KEY`

## Usage

### Quick Start

```bash
# Start interactive chat (default behavior)
cagetools
# or
cage

# Send a direct query
cagetools query "How do I implement a binary search tree?"
# or with specific provider
cagetools query -p claude-api "Explain async/await in JavaScript"
```

### Available Commands

- `query [prompt...]` - Send a one-off query to the AI assistant
  - `-p, --provider <provider>` - Choose provider: `claude-code` (default) or `claude-api`
  - `-s, --stream` - Stream the response in real-time
  - `-o, --output <format>` - Output format: `json`, `text`, or `markdown`
  - `--session <id>` - Use a specific session ID for context persistence

- `chat` - Start an interactive chat session
  - `-p, --provider <provider>` - Choose AI provider
  - `-m, --multiline` - Enable multiline input mode

- `config` - Manage configuration
  - `get <key>` - Get a configuration value
  - `set <key> <value>` - Set a configuration value
  - `list` - List all configuration values

- `tools` - Manage tools
  - `list` - List available tools
  - `enable <tool>` - Enable a tool
  - `disable <tool>` - Disable a tool

### Slash Commands (in chat mode)

- `/markdown` - Toggle between formatted and raw markdown output
- `/exit` or `/quit` - Exit chat mode
- `/clear` - Clear the current session context and reset conversation
- `/resume` - Resume a previous session from this project
- `/help` - Show available commands

### Key Features in Chat Mode

- **ESC key** - Stop current AI response
- **Arrow keys** - Navigate slash command suggestions
- **Tab** - Autocomplete slash commands
- **Ctrl+C** - Show exit instructions

## Configuration

Configuration can be managed through the CLI:

```bash
# View current configuration
cagetools config list

# Set default provider
cagetools config set provider claude-code

# Set API key for Claude API provider
cagetools config set apiKey sk-ant-...

# Enable/disable markdown formatting
cagetools config set formatMarkdown true
```

### Configuration Options

- `provider` - Default AI provider (`claude-code` or `claude-api`)
- `apiKey` - Anthropic API key for claude-api provider
- `formatMarkdown` - Enable/disable markdown formatting in chat mode (default: `true`)
- Tool-specific permissions and settings

## Markdown Formatting

CageTools provides rich markdown formatting in the terminal using `marked` and `marked-terminal`:

- **Bold** and _italic_ text rendering
- Syntax highlighted code blocks with language detection
- Properly formatted lists with indentation
- Colored headers and styled links
- Block quotes with visual styling
- Smooth incremental rendering using `stdout-update` for real-time updates

Markdown formatting is **enabled by default** in chat mode. Toggle it with the `/markdown` slash command or configure it with `cagetools config set formatMarkdown false`.

## Technical Notes

### Patch Package for marked-terminal

This project uses `patch-package` to apply a fix to the `marked-terminal` library for proper rendering of inline markdown formatting (bold, italic, etc.) within list items.

**Issue**: The original `marked-terminal@7.3.0` doesn't properly render inline formatting like `**bold**` or `*italic*` when they appear inside list items.

**Solution**: We apply a patch based on [PR #372](https://github.com/mikaelbr/marked-terminal/pull/372) which fixes this by using `parseInline()` for text tokens that contain inline formatting.

The patch is automatically applied during `npm install` via the postinstall script. If you need to update or recreate the patch:

```bash
# Make changes to node_modules/marked-terminal/index.js
# Then create/update the patch
npx patch-package marked-terminal
```

## Architecture

The project follows a modular, plugin-based architecture:

```
src/
├── cli/                    # CLI entry point and command handling
│   └── index.ts           # Main CLI class with command parsing
├── providers/             # AI provider implementations
│   ├── claude-code.ts     # Claude Code CLI wrapper provider
│   └── claude-api.ts      # Direct Anthropic API provider
├── tools/                 # Built-in tool implementations
│   ├── bash-tool.ts       # Shell command execution
│   └── file-tool.ts       # File system operations
├── hooks/                 # Hook system for extensibility
│   └── HookManager.ts     # Hook management and execution
├── ui/                    # User interface components
│   └── progress.ts        # Progress indicators and status
├── config/                # Configuration management
│   └── schema.ts          # Configuration validation schemas
├── types/                 # TypeScript type definitions
│   ├── provider.ts        # Provider interface definitions
│   ├── tool.ts            # Tool interface definitions
│   ├── hook.ts            # Hook interface definitions
│   └── ...               # Other type definitions
├── utils/                 # Utility functions
│   └── stream-parser.ts   # Stream parsing utilities
├── permissions.ts         # Permission management system
└── logger.ts             # Centralized logging utility
```

### Quality Assurance

The project includes a comprehensive quality assurance system via hooks in `.claude/hooks/cli-app/`:

- **Automated Quality Checks**: TypeScript compilation, ESLint, Prettier formatting
- **Git Hooks Integration**: Pre-commit quality validation
- **CLAUDE.md Standards**: Strict coding standards enforcement
- **Zero Tolerance Policy**: All code must pass quality checks before committing

## Development

### Build Commands

```bash
npm run dev              # Development mode with hot reload
npm run dev:watch        # Watch mode for development
npm run build            # Build for production
npm run start            # Run built CLI
npm run typecheck        # TypeScript type checking
npm run lint             # ESLint code analysis
npm run lint:fix         # Auto-fix ESLint issues
npm run format           # Format code with Prettier
npm run format:check     # Check code formatting
npm run test             # Run unit tests
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Run tests with coverage report
npm run check            # Run all quality checks (typecheck + lint + format + test)
```

### Code Quality Standards

The project enforces strict TypeScript and code quality standards via the quality check hook:

**Zero Tolerance Violations:**

- ❌ No `any` types - use proper TypeScript types
- ❌ No `console.log` in source code - use Logger class
- ❌ No CommonJS syntax - ES modules only
- ❌ No file extensions in TypeScript imports
- ❌ No floating promises - all must be awaited or explicitly ignored
- ❌ No `var` declarations - use `const`/`let` only

**Required Patterns:**

- ✅ Interfaces for object shapes (not `type`)
- ✅ Proper error handling for all async operations
- ✅ ES module imports with `import.meta.url` for `__dirname`
- ✅ Logger class for all output instead of console methods

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes following the coding standards in `CLAUDE.md`
4. Ensure all quality checks pass: `npm run check`
5. The quality check hook will automatically validate your changes
6. Submit a pull request

### Adding New Providers

To add a new AI provider:

1. Implement the `Provider` interface in `src/providers/your-provider.ts`
2. Add provider initialization in `src/cli/index.ts`
3. Update capabilities and configuration as needed
4. Add comprehensive tests

### Adding New Tools

To add a new tool:

1. Implement the `Tool` interface in `src/tools/your-tool.ts`
2. Add tool registration and management
3. Implement proper permission checking
4. Add unit tests for tool functionality

## License

MIT

## Acknowledgments

- [marked](https://github.com/markedjs/marked) - Markdown parser and renderer
- [marked-terminal](https://github.com/mikaelbr/marked-terminal) - Terminal renderer for marked (with custom patch)
- [chalk](https://github.com/chalk/chalk) - Terminal string styling and colors
- [commander](https://github.com/tj/commander.js) - CLI framework and command parsing
- [stdout-update](https://github.com/kimmobrunfeldt/stdout-update) - Clean terminal output updates
- [winston](https://github.com/winstonjs/winston) - Logging library
- [zod](https://github.com/colinhacks/zod) - TypeScript-first schema validation
- [vitest](https://github.com/vitest-dev/vitest) - Fast unit testing framework
- [vite](https://github.com/vitejs/vite) - Build tool and development server
