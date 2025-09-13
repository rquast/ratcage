# CageTools - Universal Coding Agent CLI Wrapper

A powerful CLI tool that provides a unified interface for interacting with various AI coding assistants, featuring rich terminal formatting, session management, and extensible tool support.

## Features

- **Multiple AI Provider Support**: Seamlessly switch between Claude, GitHub Copilot, Cursor, and other AI assistants
- **Rich Terminal Output**: Beautiful markdown rendering with syntax highlighting, bold/italic text, and formatted lists
- **Tool Call Suppression**: Clean output without distracting tool call information
- **Session Management**: Persistent context across conversations
- **Extensible Architecture**: Plugin-based system for adding new providers and tools
- **Interactive Chat Mode**: Engage in continuous conversations with AI assistants
- **Slash Commands**: Quick actions like `/markdown` to toggle output formatting

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/cagetools.git
cd cagetools

# Install dependencies
npm install

# Build the project
npm run build
```

## Usage

### Basic Query

```bash
node dist/cli.js query "How do I implement a binary search tree?"
```

### Interactive Chat Mode

```bash
node dist/cli.js chat
```

### Available Commands

- `query <prompt>` - Send a one-off query to the AI assistant
- `chat` - Start an interactive chat session
- `config get <key>` - Get a configuration value
- `config set <key> <value>` - Set a configuration value

### Slash Commands (in chat mode)

- `/markdown` - Toggle between formatted and raw markdown output
- `/exit` or `/quit` - Exit chat mode
- `/clear` - Clear the current session context
- `/help` - Show available commands

## Configuration

Configuration is stored in `~/.cagetools/config.json`. You can modify settings like:

- Default AI provider
- API keys and endpoints
- UI preferences (colors, formatting, etc.)
- Tool permissions and settings

## Markdown Formatting

CageTools provides rich markdown formatting in the terminal, including:

- **Bold** and _italic_ text
- Syntax highlighted code blocks
- Formatted lists with proper indentation
- Colored headers and links
- Block quotes with styling

Markdown formatting is **enabled by default**. Toggle it with the `/markdown` command.

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

## Development

### Build Commands

```bash
npm run build       # Build the project
npm run dev        # Watch mode for development
npm run test       # Run tests
npm run lint       # Run linter
npm run typecheck  # Type checking
npm run check      # Run all quality checks
```

### Code Quality

The project enforces strict TypeScript and ESLint rules. All code must pass quality checks before committing:

- No `any` types
- No `console.log` (use Logger class)
- Proper ES module imports
- Type-safe interfaces
- Comprehensive error handling

### Architecture

```
src/
├── cli/           # CLI interface and commands
├── providers/     # AI provider implementations
├── tools/         # Tool implementations
├── hooks/         # Hook system for extensibility
├── config/        # Configuration schemas and loaders
├── types/         # TypeScript type definitions
└── logger.ts      # Logging utility
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Ensure all tests pass (`npm run check`)
5. Submit a pull request

## License

MIT

## Acknowledgments

- [marked](https://github.com/markedjs/marked) - Markdown parser
- [marked-terminal](https://github.com/mikaelbr/marked-terminal) - Terminal renderer for marked
- [chalk](https://github.com/chalk/chalk) - Terminal string styling
- [commander](https://github.com/tj/commander.js) - CLI framework
