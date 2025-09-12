# CageTools - Universal Coding Agent CLI Wrapper

## MANDATORY CODING STANDARDS - ZERO TOLERANCE

**ALL CODE MUST PASS QUALITY CHECKS BEFORE COMMITTING**

### CRITICAL DO NOT VIOLATIONS - CODE WILL BE REJECTED

**TypeScript Violations:**

- ❌ **NEVER** use `any` type - use proper types always
- ❌ **NEVER** use `require()` - only ES6 `import`/`export`
- ❌ **NEVER** use CommonJS syntax (`module.exports`, `__dirname`, `__filename`)
- ❌ **NEVER** use file extensions in TypeScript imports (`import './file.ts'` or `import './file.js'` → `import './file'`)
- ❌ **NEVER** use `var` - only `const`/`let`
- ❌ **NEVER** use `==` or `!=` - only `===` and `!==`
- ❌ **NEVER** skip curly braces: `if (x) doSomething()` → `if (x) { doSomething() }`

**Import Violations:**

- ❌ **NEVER** write: `import { Type } from './types'` when only using as type
- ✅ **ALWAYS** write: `import type { Type } from './types'`

**Interface Violations:**

- ❌ **NEVER** use `type` for object shapes
- ✅ **ALWAYS** use `interface` for object definitions

**Promise Violations:**

- ❌ **NEVER** have floating promises - all promises must be awaited or explicitly ignored with `void`
- ❌ **NEVER** await non-promises

**Variable Violations:**

- ❌ **NEVER** declare unused variables
- ❌ **NEVER** use `let` when value never changes - use `const`

**Console Violations:**

- ❌ **NEVER** use `console.log/error/warn` in source code (tests are OK)
- ✅ **ONLY** use Logger class for all output

### MANDATORY IMPLEMENTATION PATTERNS

**ES Modules (Required):**

```typescript
// ✅ CORRECT
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ❌ WRONG
const __dirname = require('path').dirname(__filename);
```

**Type Safety (Required):**

```typescript
// ✅ CORRECT
interface UserConfig {
  name: string;
  settings: ConfigData;
}
const config: UserConfig = loadConfig();

// ❌ WRONG
const config: any = loadConfig();
```

**Error Handling (Required):**

```typescript
// ✅ CORRECT - All async operations must have error handling
try {
  const result = await operation();
  return result;
} catch (error) {
  logger.error('Operation failed', { error });
  throw error;
}
```

**Process Management (Required):**

```typescript
// ✅ CORRECT - Rename process variable to avoid Node.js global
const childProcess = spawn('command', args);

// ❌ WRONG - Shadows Node.js global
const process = spawn('command', args);
```

**Logging (Required):**

```typescript
// ✅ CORRECT - Use Logger class
import { Logger } from '../logger.js';
const logger = new Logger();
logger.info('Operation completed');

// ❌ WRONG - Direct console usage
console.log('Operation completed');
```

### PROJECT-SPECIFIC REQUIREMENTS

**File Extensions:** TypeScript imports should NOT include file extensions - the TypeScript compiler handles this

**Winston Logger:** Use custom ConsoleTransport for proper console method calling in tests

**Hook System:** All hooks must implement `HookResult` with `success` and `continue` properties

**Provider Pattern:** All providers implement `Provider` interface with async iterators for streaming

**Tool Results:** Use `ToolResult` interface with `status`, `output`, `error` fields

**Permission System:** All operations requiring permissions must use `PermissionManager.check()`

**Session Management:** Use `ProviderSession` interface for context persistence

### TESTING REQUIREMENTS

**Test Coverage:** All new code must have corresponding unit tests

**Mock Patterns:** Use Vitest mocks, avoid actual file system in unit tests

**Integration Tests:** Use fixtures from `__fixtures__` directory for integration tests

**Type Safety:** No `any` types allowed in tests - use proper type assertions

### ARCHITECTURE COMPLIANCE

**Modular Design:** Follow plugin-based architecture for providers and tools

**Interface Segregation:** Implement required interfaces (`Provider`, `Tool`, `Hook`, etc.)

**Dependency Injection:** Use constructor injection for dependencies

**Error Boundaries:** All public methods must handle errors gracefully

---

## Quality Check Integration

Run quality checks before committing:

```bash
npm run check  # Runs typecheck + lint + format + tests
```

The `.claude/hooks/cli-app/quality-check.js` hook enforces these rules automatically.

**Code that violates these standards will be automatically rejected by the quality check hook.**
