#!/usr/bin/env node
/* global console, process */
/**
 * CLI App Quality Check Hook
 * Optimized for CLI applications with sensible defaults
 *
 * EXIT CODES:
 *   0 - Success (all checks passed)
 *   1 - General error (missing dependencies, etc.)
 *   2 - Quality issues found - ALL must be fixed (blocking)
 */

import { promises as fs } from 'fs';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { execSync } from 'child_process';

// ESM compatibility for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Check if dependencies are installed
const nodeModulesPath = path.join(__dirname, 'node_modules');
if (!existsSync(nodeModulesPath)) {
  console.error('Installing hook dependencies...');
  try {
    execSync('npm install', { cwd: __dirname, stdio: 'inherit' });
  } catch {
    console.error(
      'Failed to install hook dependencies. Please run: cd .claude/hooks/cli-app && npm install'
    );
    process.exit(1);
  }
}

// Now import glob after ensuring it's installed
const { globSync } = await import('glob');

/**
 * Find project root by looking for package.json
 * @param {string} startPath - Starting directory path
 * @returns {string} Project root directory
 */
function findProjectRoot(startPath) {
  let currentPath = startPath;
  while (currentPath !== '/') {
    if (existsSync(path.join(currentPath, 'package.json'))) {
      return currentPath;
    }
    currentPath = path.dirname(currentPath);
  }
  return process.cwd();
}

const projectRoot = findProjectRoot(__dirname);

/**
 * Intelligent TypeScript Config Cache with checksum validation
 * Handles multiple tsconfig files and maps files to appropriate configs
 */
class TypeScriptConfigCache {
  constructor() {
    this.cacheFile = path.join(__dirname, 'tsconfig-cache.json');
    this.cache = { hashes: {}, mappings: {} };
    this.loadCache();
  }

  getConfigHash(configPath) {
    try {
      const content = readFileSync(configPath, 'utf8');
      return crypto.createHash('sha256').update(content).digest('hex');
    } catch {
      return null;
    }
  }

  findTsConfigFiles() {
    try {
      return globSync('tsconfig*.json', { cwd: projectRoot }).map(file =>
        path.join(projectRoot, file)
      );
    } catch {
      const configs = [];
      const commonConfigs = ['tsconfig.json', 'tsconfig.test.json'];

      for (const config of commonConfigs) {
        const configPath = path.join(projectRoot, config);
        if (existsSync(configPath)) {
          configs.push(configPath);
        }
      }
      return configs;
    }
  }

  isValid() {
    const configFiles = this.findTsConfigFiles();

    if (Object.keys(this.cache.hashes).length !== configFiles.length) {
      return false;
    }

    for (const configPath of configFiles) {
      const currentHash = this.getConfigHash(configPath);
      if (currentHash !== this.cache.hashes[configPath]) {
        return false;
      }
    }

    return true;
  }

  rebuild() {
    this.cache = { hashes: {}, mappings: {} };

    const configPriority = ['tsconfig.test.json', 'tsconfig.json'];

    configPriority.forEach(configName => {
      const configPath = path.join(projectRoot, configName);
      if (!existsSync(configPath)) {
        return;
      }

      this.cache.hashes[configPath] = this.getConfigHash(configPath);

      try {
        const configContent = readFileSync(configPath, 'utf8');
        const config = JSON.parse(configContent);

        if (config.include) {
          config.include.forEach(pattern => {
            if (!this.cache.mappings[pattern]) {
              this.cache.mappings[pattern] = {
                configPath,
                excludes: config.exclude || [],
              };
            }
          });
        }
      } catch {
        // Skip invalid configs
      }
    });

    this.saveCache();
  }

  loadCache() {
    try {
      const cacheContent = readFileSync(this.cacheFile, 'utf8');
      this.cache = JSON.parse(cacheContent);
    } catch {
      this.cache = { hashes: {}, mappings: {} };
    }
  }

  saveCache() {
    const lockFile = `${this.cacheFile}.lock`;
    const maxRetries = 5;
    let retries = 0;

    while (retries < maxRetries) {
      try {
        writeFileSync(lockFile, process.pid.toString(), { flag: 'wx' });

        try {
          writeFileSync(this.cacheFile, JSON.stringify(this.cache, null, 2));
        } finally {
          try {
            unlinkSync(lockFile);
          } catch {
            // Ignore unlock errors
          }
        }
        return;
      } catch (e) {
        if (e.code === 'EEXIST' && retries < maxRetries - 1) {
          retries++;
          const delay = Math.min(50 * Math.pow(2, retries), 500);
          const start = Date.now();
          while (Date.now() - start < delay) {
            // Busy wait
          }
        } else {
          log.debug(`Cache save error: ${e.message}`);
          return;
        }
      }
    }
  }

  getTsConfigForFile(filePath) {
    if (!this.isValid()) {
      this.rebuild();
    }

    const relativePath = path.relative(projectRoot, filePath);

    const sortedMappings = Object.entries(this.cache.mappings).sort(
      ([a], [b]) => {
        const aSpecificity = a.split('/').length + (a.includes('**') ? 0 : 10);
        const bSpecificity = b.split('/').length + (b.includes('**') ? 0 : 10);
        return bSpecificity - aSpecificity;
      }
    );

    for (const [pattern, mapping] of sortedMappings) {
      const configPath =
        typeof mapping === 'string' ? mapping : mapping.configPath;
      const excludes = typeof mapping === 'string' ? [] : mapping.excludes;

      if (this.matchesPattern(relativePath, pattern)) {
        let isExcluded = false;
        for (const exclude of excludes) {
          if (this.matchesPattern(relativePath, exclude)) {
            isExcluded = true;
            break;
          }
        }

        if (!isExcluded) {
          return configPath;
        }
      }
    }

    // Test files
    if (
      relativePath.includes('/__tests__/') ||
      relativePath.includes('.test.') ||
      relativePath.includes('.spec.')
    ) {
      const testConfig = path.join(projectRoot, 'tsconfig.test.json');
      if (existsSync(testConfig)) {
        return testConfig;
      }
    }

    return path.join(projectRoot, 'tsconfig.json');
  }

  matchesPattern(filePath, pattern) {
    if (pattern.endsWith('/**/*')) {
      const baseDir = pattern.slice(0, -5);
      return filePath.startsWith(baseDir);
    }

    let regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '🌟')
      .replace(/\*/g, '[^/]*')
      .replace(/🌟/g, '.*')
      .replace(/\?/g, '.');

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(filePath);
  }
}

// Global config cache instance
const tsConfigCache = new TypeScriptConfigCache();

// ANSI color codes
const colors = {
  red: '\x1b[0;31m',
  green: '\x1b[0;32m',
  yellow: '\x1b[0;33m',
  blue: '\x1b[0;34m',
  cyan: '\x1b[0;36m',
  reset: '\x1b[0m',
};

/**
 * Load configuration from JSON file with environment variable overrides
 * @returns {Object} Configuration object
 */
function loadConfig() {
  let fileConfig = {};

  try {
    const configPath = path.join(__dirname, 'hook-config.json');
    if (existsSync(configPath)) {
      fileConfig = JSON.parse(readFileSync(configPath, 'utf8'));
    }
  } catch {
    // Config file not found or invalid, use defaults
  }

  return {
    typescriptEnabled:
      process.env.CLAUDE_HOOKS_TYPESCRIPT_ENABLED !== undefined
        ? process.env.CLAUDE_HOOKS_TYPESCRIPT_ENABLED !== 'false'
        : (fileConfig.typescript?.enabled ?? true),

    showDependencyErrors:
      process.env.CLAUDE_HOOKS_SHOW_DEPENDENCY_ERRORS !== undefined
        ? process.env.CLAUDE_HOOKS_SHOW_DEPENDENCY_ERRORS === 'true'
        : (fileConfig.typescript?.showDependencyErrors ?? false),

    eslintEnabled:
      process.env.CLAUDE_HOOKS_ESLINT_ENABLED !== undefined
        ? process.env.CLAUDE_HOOKS_ESLINT_ENABLED !== 'false'
        : (fileConfig.eslint?.enabled ?? true),

    eslintAutofix:
      process.env.CLAUDE_HOOKS_ESLINT_AUTOFIX !== undefined
        ? process.env.CLAUDE_HOOKS_ESLINT_AUTOFIX === 'true'
        : (fileConfig.eslint?.autofix ?? false),

    prettierEnabled:
      process.env.CLAUDE_HOOKS_PRETTIER_ENABLED !== undefined
        ? process.env.CLAUDE_HOOKS_PRETTIER_ENABLED !== 'false'
        : (fileConfig.prettier?.enabled ?? true),

    prettierAutofix:
      process.env.CLAUDE_HOOKS_PRETTIER_AUTOFIX !== undefined
        ? process.env.CLAUDE_HOOKS_PRETTIER_AUTOFIX === 'true'
        : (fileConfig.prettier?.autofix ?? false),

    autofixSilent:
      process.env.CLAUDE_HOOKS_AUTOFIX_SILENT !== undefined
        ? process.env.CLAUDE_HOOKS_AUTOFIX_SILENT === 'true'
        : (fileConfig.general?.autofixSilent ?? false),

    debug:
      process.env.CLAUDE_HOOKS_DEBUG !== undefined
        ? process.env.CLAUDE_HOOKS_DEBUG === 'true'
        : (fileConfig.general?.debug ?? false),

    ignorePatterns: fileConfig.ignore?.patterns || [],
    _fileConfig: fileConfig,
  };
}

const config = loadConfig();

const log = {
  info: msg => console.error(`${colors.blue}[INFO]${colors.reset} ${msg}`),
  error: msg => console.error(`${colors.red}[ERROR]${colors.reset} ${msg}`),
  success: msg => console.error(`${colors.green}[OK]${colors.reset} ${msg}`),
  warning: msg => console.error(`${colors.yellow}[WARN]${colors.reset} ${msg}`),
  debug: msg => {
    if (config.debug) {
      console.error(`${colors.cyan}[DEBUG]${colors.reset} ${msg}`);
    }
  },
};

// Try to load modules, but make them optional
let ESLint, prettier, ts;

/**
 * Quality checker for a single file.
 * Runs TypeScript, ESLint, and Prettier checks with optional auto-fixing.
 */
class QualityChecker {
  constructor(filePath) {
    this.filePath = filePath;
    this.fileType = this.detectFileType(filePath);
    this.errors = [];
    this.autofixes = [];
  }

  detectFileType(filePath) {
    if (/\.(test|spec)\.(ts|js)$/.test(filePath)) {
      return 'test';
    }
    if (/\.ts$/.test(filePath)) {
      return 'typescript';
    }
    if (/\.js$/.test(filePath)) {
      return 'javascript';
    }
    return 'unknown';
  }

  async checkAll() {
    if (this.fileType === 'unknown') {
      log.info('Unknown file type, skipping detailed checks');
      return { errors: [], autofixes: [] };
    }

    const checkPromises = [];

    if (config.typescriptEnabled) {
      checkPromises.push(this.checkTypeScript());
    }

    if (config.eslintEnabled) {
      checkPromises.push(this.checkESLint());
    }

    if (config.prettierEnabled) {
      checkPromises.push(this.checkPrettier());
    }

    checkPromises.push(this.checkCommonIssues());

    await Promise.all(checkPromises);

    await this.suggestRelatedTests();

    return {
      errors: this.errors,
      autofixes: this.autofixes,
    };
  }

  async checkTypeScript() {
    if (!config.typescriptEnabled || !ts) {
      return;
    }

    // Skip TypeScript checking for JavaScript files in hook directories
    if (
      this.filePath.endsWith('.js') &&
      this.filePath.includes('.claude/hooks/')
    ) {
      log.debug('Skipping TypeScript check for JavaScript hook file');
      return;
    }

    log.info('Running TypeScript compilation check...');

    try {
      const configPath = tsConfigCache.getTsConfigForFile(this.filePath);

      if (!existsSync(configPath)) {
        log.debug(`No TypeScript config found: ${configPath}`);
        return;
      }

      log.debug(
        `Using TypeScript config: ${path.basename(configPath)} for ${path.relative(projectRoot, this.filePath)}`
      );

      const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
      const parsedConfig = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        path.dirname(configPath)
      );

      log.debug(`TypeScript checking edited file only`);

      const program = ts.createProgram([this.filePath], parsedConfig.options);
      const diagnostics = ts.getPreEmitDiagnostics(program);

      const diagnosticsByFile = new Map();
      diagnostics.forEach(d => {
        if (d.file) {
          const fileName = d.file.fileName;
          if (!diagnosticsByFile.has(fileName)) {
            diagnosticsByFile.set(fileName, []);
          }
          diagnosticsByFile.get(fileName).push(d);
        }
      });

      const editedFileDiagnostics = diagnosticsByFile.get(this.filePath) || [];
      if (editedFileDiagnostics.length > 0) {
        this.errors.push(
          `TypeScript errors in edited file (using ${path.basename(configPath)})`
        );
        editedFileDiagnostics.forEach(diagnostic => {
          const message = ts.flattenDiagnosticMessageText(
            diagnostic.messageText,
            '\n'
          );
          const { line, character } =
            diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
          console.error(
            `  ❌ ${diagnostic.file.fileName}:${line + 1}:${character + 1} - ${message}`
          );
        });
      }

      if (config.showDependencyErrors) {
        let hasDepErrors = false;
        diagnosticsByFile.forEach((diags, fileName) => {
          if (fileName !== this.filePath) {
            if (!hasDepErrors) {
              console.error(
                '\n[DEPENDENCY ERRORS] Files imported by your edited file:'
              );
              hasDepErrors = true;
            }
            console.error(`  ⚠️ ${fileName}:`);
            diags.forEach(diagnostic => {
              const message = ts.flattenDiagnosticMessageText(
                diagnostic.messageText,
                '\n'
              );
              const { line, character } =
                diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
              console.error(
                `     Line ${line + 1}:${character + 1} - ${message}`
              );
            });
          }
        });
      }

      if (diagnostics.length === 0) {
        log.success('TypeScript compilation passed');
      }
    } catch (error) {
      log.debug(`TypeScript check error: ${error.message}`);
    }
  }

  async checkESLint() {
    if (!config.eslintEnabled || !ESLint) {
      return;
    }

    log.info('Running ESLint...');

    try {
      const eslint = new ESLint({
        fix: config.eslintAutofix,
        cwd: projectRoot,
      });

      const results = await eslint.lintFiles([this.filePath]);
      const result = results[0];

      if (result.errorCount > 0 || result.warningCount > 0) {
        if (config.eslintAutofix) {
          log.warning('ESLint issues found, attempting auto-fix...');

          if (result.output) {
            await fs.writeFile(this.filePath, result.output);

            const resultsAfterFix = await eslint.lintFiles([this.filePath]);
            const resultAfterFix = resultsAfterFix[0];

            if (
              resultAfterFix.errorCount === 0 &&
              resultAfterFix.warningCount === 0
            ) {
              log.success('ESLint auto-fixed all issues!');
              if (config.autofixSilent) {
                this.autofixes.push(
                  'ESLint auto-fixed formatting/style issues'
                );
              } else {
                this.errors.push(
                  'ESLint issues were auto-fixed - verify the changes'
                );
              }
            } else {
              this.errors.push(
                `ESLint found issues that couldn't be auto-fixed in ${this.filePath}`
              );
              const formatter = await eslint.loadFormatter('stylish');
              const output = formatter.format(resultsAfterFix);
              console.error(output);
            }
          } else {
            this.errors.push(`ESLint found issues in ${this.filePath}`);
            const formatter = await eslint.loadFormatter('stylish');
            const output = formatter.format(results);
            console.error(output);
          }
        } else {
          this.errors.push(`ESLint found issues in ${this.filePath}`);
          const formatter = await eslint.loadFormatter('stylish');
          const output = formatter.format(results);
          console.error(output);
        }
      } else {
        log.success('ESLint passed');
      }
    } catch (error) {
      log.debug(`ESLint check error: ${error.message}`);
    }
  }

  async checkPrettier() {
    if (!config.prettierEnabled || !prettier) {
      return;
    }

    log.info('Running Prettier check...');

    try {
      const fileContent = await fs.readFile(this.filePath, 'utf8');
      const prettierConfig = await prettier.resolveConfig(this.filePath);

      const isFormatted = await prettier.check(fileContent, {
        ...prettierConfig,
        filepath: this.filePath,
      });

      if (!isFormatted) {
        if (config.prettierAutofix) {
          log.warning('Prettier formatting issues found, auto-fixing...');

          const formatted = await prettier.format(fileContent, {
            ...prettierConfig,
            filepath: this.filePath,
          });

          await fs.writeFile(this.filePath, formatted);
          log.success('Prettier auto-formatted the file!');

          if (config.autofixSilent) {
            this.autofixes.push('Prettier auto-formatted the file');
          } else {
            this.errors.push(
              'Prettier formatting was auto-fixed - verify the changes'
            );
          }
        } else {
          this.errors.push(`Prettier formatting issues in ${this.filePath}`);
          console.error('Run prettier --write to fix');
        }
      } else {
        log.success('Prettier formatting correct');
      }
    } catch (error) {
      log.debug(`Prettier check error: ${error.message}`);
    }
  }

  async checkCommonIssues() {
    log.info('Checking for common issues...');

    try {
      const content = await fs.readFile(this.filePath, 'utf8');
      const lines = content.split('\n');
      let foundIssues = false;

      // Check for CommonJS in all JS/TS files (must be ESM)
      const hasESMCompatibility = content.includes(
        'fileURLToPath(import.meta.url)'
      );

      const commonJSPatterns = [
        { pattern: /\brequire\s*\(/, name: 'require()' },
        { pattern: /module\.exports\s*=/, name: 'module.exports' },
        { pattern: /exports\.\w+\s*=/, name: 'exports.property' },
      ];

      if (!hasESMCompatibility) {
        commonJSPatterns.push(
          {
            pattern: /__dirname(?!\s*=)/,
            name: '__dirname (use import.meta.url)',
          },
          {
            pattern: /__filename(?!\s*=)/,
            name: '__filename (use import.meta.url)',
          }
        );
      }

      lines.forEach((line, index) => {
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith('//') || trimmedLine.startsWith('*')) {
          return;
        }

        if (
          trimmedLine.includes('= fileURLToPath(import.meta.url)') ||
          trimmedLine.includes('= dirname(__filename)')
        ) {
          return;
        }

        if (trimmedLine.includes('pattern:') || trimmedLine.includes('name:')) {
          return;
        }

        commonJSPatterns.forEach(({ pattern, name }) => {
          if (pattern.test(line)) {
            this.errors.push(
              `Found CommonJS syntax '${name}' in ${this.filePath} - All files must use ES modules syntax only`
            );
            console.error(`  Line ${index + 1}: ${line.trim()}`);
            foundIssues = true;
          }
        });
      });

      // Check for 'any' type usage in TypeScript files
      const asAnyRule = config._fileConfig.rules?.asAny || {};
      if (
        (this.fileType === 'typescript' ||
          (this.fileType === 'test' && /\.ts$/.test(this.filePath))) &&
        asAnyRule.enabled !== false
      ) {
        lines.forEach((line, index) => {
          const trimmedLine = line.trim();
          if (trimmedLine.startsWith('//') || trimmedLine.startsWith('*')) {
            return;
          }

          const anyPatterns = [
            { pattern: /\bas\s+any\b/, description: "'as any' type assertion" },
            { pattern: /:\s*any\b/, description: "': any' type annotation" },
            { pattern: /\bany\[\]/, description: "'any[]' array type" },
            {
              pattern: /\bArray<any>/,
              description: "'Array<any>' generic type",
            },
            {
              pattern: /\bPromise<any>/,
              description: "'Promise<any>' generic type",
            },
            {
              pattern: /\bRecord<[^,]+,\s*any>/,
              description: "'Record<K, any>' type",
            },
            { pattern: /<any[,>]/, description: "generic 'any' type" },
            {
              pattern: /\bas\s+unknown\s+as\b/,
              description: "'as unknown as' double assertion",
            },
          ];

          for (const { pattern, description } of anyPatterns) {
            if (pattern.test(line)) {
              const severity = asAnyRule.severity || 'error';
              const message =
                asAnyRule.message ||
                'Avoid using "any" type - use specific types, unknown, or generics instead';

              if (severity === 'error') {
                this.errors.push(
                  `Found ${description} in ${this.filePath} - ${message}`
                );
                console.error(`  Line ${index + 1}: ${line.trim()}`);
                foundIssues = true;
              } else {
                log.warning(`${description} at line ${index + 1}: ${message}`);
              }
              break;
            }
          }
        });
      }

      // Check for trivial test assertions
      const trivialTestRule = config._fileConfig.rules?.trivialTests || {};
      if (this.fileType === 'test' && trivialTestRule.enabled !== false) {
        const trivialTestPatterns = [
          {
            pattern: /expect\s*\(\s*true\s*\)\s*\.toBe\s*\(\s*true\s*\)/,
            description: 'expect(true).toBe(true)',
          },
          {
            pattern: /expect\s*\(\s*false\s*\)\s*\.toBe\s*\(\s*false\s*\)/,
            description: 'expect(false).toBe(false)',
          },
        ];

        lines.forEach((line, index) => {
          const trimmedLine = line.trim();
          if (trimmedLine.startsWith('//') || trimmedLine.startsWith('*')) {
            return;
          }

          for (const { pattern, description } of trivialTestPatterns) {
            if (pattern.test(line)) {
              const severity = trivialTestRule.severity || 'error';
              const message =
                trivialTestRule.message ||
                'This is a trivial test assertion that tests nothing meaningful. Write real tests that verify actual functionality.';

              if (severity === 'error') {
                this.errors.push(
                  `Found trivial test assertion '${description}' in ${this.filePath} - ${message}`
                );
                console.error(`  Line ${index + 1}: ${line.trim()}`);
                foundIssues = true;
              } else {
                log.warning(
                  `Trivial test '${description}' at line ${index + 1}: ${message}`
                );
              }
              break;
            }
          }
        });
      }

      // Console statements are OK for CLI apps
      const debuggerRule = config._fileConfig.rules?.debugger || {};
      if (debuggerRule.enabled !== false) {
        lines.forEach((line, index) => {
          if (/\bdebugger\b/.test(line)) {
            this.errors.push(
              `Found debugger statement in ${this.filePath} - ${debuggerRule.message || 'Remove debugger statements before committing'}`
            );
            console.error(`  Line ${index + 1}: ${line.trim()}`);
            foundIssues = true;
          }
        });
      }

      // Check for TODO/FIXME comments
      lines.forEach((line, index) => {
        if (/TODO|FIXME/.test(line)) {
          log.warning(`Found TODO/FIXME comment at line ${index + 1}`);
        }
      });

      // Check for ESLint disable comments
      const eslintDisableRule = config._fileConfig.rules?.eslintDisable || {};
      if (
        eslintDisableRule.enabled !== false &&
        !this.filePath.endsWith('quality-check.js')
      ) {
        lines.forEach((line, index) => {
          const trimmedLine = line.trim();

          if (
            trimmedLine.includes('eslintDisablePatterns') ||
            trimmedLine.includes('eslintDisableStrings') ||
            (trimmedLine.includes('pattern:') &&
              trimmedLine.includes('eslint')) ||
            (trimmedLine.startsWith("'eslint-") &&
              trimmedLine.endsWith("',")) ||
            (trimmedLine.startsWith('"eslint-') && trimmedLine.endsWith('",'))
          ) {
            return;
          }

          const eslintDisableStrings = [
            'eslint-disable-next-line',
            'eslint-disable-line',
            'eslint-disable',
            'eslint-enable',
          ];

          for (const disableString of eslintDisableStrings) {
            if (line.includes(disableString)) {
              const severity = eslintDisableRule.severity || 'error';
              const message =
                eslintDisableRule.message ||
                'ESLint disable comments found - Fix the underlying issue instead of disabling the linter.';

              if (severity === 'error') {
                this.errors.push(
                  `Found ESLint disable comment in ${this.filePath} - ${message}`
                );
                console.error(`  Line ${index + 1}: ${line.trim()}`);
                foundIssues = true;
              } else {
                log.warning(
                  `ESLint disable comment at line ${index + 1}: ${message}`
                );
              }
              break;
            }
          }
        });
      }

      if (!foundIssues) {
        log.success('No common issues found');
      }
    } catch (error) {
      log.debug(`Common issues check error: ${error.message}`);
    }
  }

  async suggestRelatedTests() {
    if (this.fileType === 'test') {
      return;
    }

    const baseName = this.filePath.replace(/\.[^.]+$/, '');
    const testExtensions = ['test.ts', 'spec.ts'];
    let hasTests = false;

    for (const ext of testExtensions) {
      try {
        await fs.access(`${baseName}.${ext}`);
        hasTests = true;
        log.warning(`💡 Related test found: ${path.basename(baseName)}.${ext}`);
        log.warning('   Consider running the tests to ensure nothing broke');
        break;
      } catch {
        // File doesn't exist, continue
      }
    }

    if (!hasTests) {
      // Check __tests__ directory
      const dir = path.dirname(this.filePath);
      const fileName = path.basename(this.filePath);
      const baseFileName = fileName.replace(/\.[^.]+$/, '');

      for (const ext of testExtensions) {
        try {
          await fs.access(
            path.join(dir, '__tests__', `${baseFileName}.${ext}`)
          );
          hasTests = true;
          log.warning(
            `💡 Related test found: __tests__/${baseFileName}.${ext}`
          );
          log.warning('   Consider running the tests to ensure nothing broke');
          break;
        } catch {
          // File doesn't exist, continue
        }
      }
    }

    if (!hasTests) {
      log.warning(`💡 No test file found for ${path.basename(this.filePath)}`);
      log.warning('   Consider adding tests for better code quality');
    }
  }
}

/**
 * Parse JSON input from stdin
 */
async function parseJsonInput() {
  let inputData = '';

  for await (const chunk of process.stdin) {
    inputData += chunk;
  }

  if (!inputData.trim()) {
    log.warning(
      'No JSON input provided. This hook expects JSON input from Claude Code.'
    );
    log.info(
      'For testing, provide JSON like: echo \'{"tool_name":"Edit","tool_input":{"file_path":"/path/to/file.ts"}}\' | node hook.js'
    );
    console.error(
      `\n${colors.yellow}👉 Hook executed but no input to process.${colors.reset}`
    );
    process.exit(0);
  }

  try {
    return JSON.parse(inputData);
  } catch (error) {
    log.error(`Failed to parse JSON input: ${error.message}`);
    log.debug(`Input was: ${inputData}`);
    process.exit(1);
  }
}

/**
 * Extract file path from tool input
 */
function extractFilePath(input) {
  const { tool_input } = input;
  if (!tool_input) {
    return null;
  }

  return (
    tool_input.file_path || tool_input.path || tool_input.notebook_path || null
  );
}

/**
 * Check if file exists
 */
async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if file is a source file
 */
function isSourceFile(filePath) {
  return /\.(ts|js)$/.test(filePath);
}

/**
 * Print summary of errors and autofixes
 */
function printSummary(errors, autofixes) {
  if (autofixes.length > 0) {
    console.error(`\n${colors.blue}═══ Auto-fixes Applied ═══${colors.reset}`);
    autofixes.forEach(fix => {
      console.error(`${colors.green}✨${colors.reset} ${fix}`);
    });
    console.error(
      `${colors.green}Automatically fixed ${autofixes.length} issue(s) for you!${colors.reset}`
    );
  }

  if (errors.length > 0) {
    console.error(
      `\n${colors.blue}═══ Quality Check Summary ═══${colors.reset}`
    );
    errors.forEach(error => {
      console.error(`${colors.red}❌${colors.reset} ${error}`);
    });

    console.error(
      `\n${colors.red}Found ${errors.length} issue(s) that MUST be fixed!${colors.reset}`
    );
    console.error(
      `${colors.red}════════════════════════════════════════════${colors.reset}`
    );
    console.error(`${colors.red}❌ ALL ISSUES ARE BLOCKING ❌${colors.reset}`);
    console.error(
      `${colors.red}════════════════════════════════════════════${colors.reset}`
    );
    console.error(
      `${colors.red}Fix EVERYTHING above until all checks are ✅ GREEN${colors.reset}`
    );
  }
}

/**
 * Main entry point
 */
async function main() {
  const hookVersion = config._fileConfig.version || '1.0.0';
  console.error('');
  console.error(`🖥️  CLI App Quality Check v${hookVersion} - Starting...`);
  console.error('────────────────────────────────────────────');

  log.debug(`Loaded config: ${JSON.stringify(config, null, 2)}`);

  // Load optional modules
  try {
    const eslintModule = await import(
      path.join(projectRoot, 'node_modules', 'eslint', 'lib', 'api.js')
    );
    ESLint = eslintModule.ESLint;
  } catch {
    log.debug('ESLint not found in project - will skip ESLint checks');
  }

  try {
    prettier = await import(
      path.join(projectRoot, 'node_modules', 'prettier', 'index.cjs')
    );
    prettier = prettier.default || prettier;
  } catch {
    log.debug('Prettier not found in project - will skip Prettier checks');
  }

  try {
    ts = await import(
      path.join(
        projectRoot,
        'node_modules',
        'typescript',
        'lib',
        'typescript.js'
      )
    );
    ts = ts.default || ts;
  } catch {
    log.debug('TypeScript not found in project - will skip TypeScript checks');
  }

  const input = await parseJsonInput();
  const filePath = extractFilePath(input);

  if (!filePath) {
    log.warning(
      'No file path found in JSON input. Tool might not be file-related.'
    );
    log.debug(`JSON input was: ${JSON.stringify(input)}`);
    console.error(
      `\n${colors.yellow}👉 No file to check - tool may not be file-related.${colors.reset}`
    );
    process.exit(0);
  }

  if (!(await fileExists(filePath))) {
    log.info(`File does not exist: ${filePath} (may have been deleted)`);
    console.error(
      `\n${colors.yellow}👉 File skipped - doesn't exist.${colors.reset}`
    );
    process.exit(0);
  }

  if (!isSourceFile(filePath)) {
    log.info(`Skipping non-source file: ${filePath}`);
    console.error(
      `\n${colors.yellow}👉 File skipped - not a source file.${colors.reset}`
    );
    console.error(
      `\n${colors.green}✅ No checks needed for ${path.basename(filePath)}${colors.reset}`
    );
    process.exit(0);
  }

  console.error('');
  console.error(`🔍 Validating: ${path.basename(filePath)}`);
  console.error('────────────────────────────────────────────');
  log.info(`Checking: ${filePath}`);

  const checker = new QualityChecker(filePath);
  const { errors, autofixes } = await checker.checkAll();

  printSummary(errors, autofixes);

  const editedFileErrors = errors.filter(
    e =>
      e.includes('edited file') ||
      e.includes('ESLint found issues') ||
      e.includes('Prettier formatting issues') ||
      e.includes('debugger statement') ||
      e.includes("'as any' usage") ||
      (e.includes('Found') && e.includes('any') && e.includes('type')) ||
      (e.includes('Found') &&
        e.includes('unknown as') &&
        e.includes('double assertion')) ||
      e.includes('trivial test assertion') ||
      e.includes('were auto-fixed') ||
      e.includes('CommonJS syntax') ||
      e.includes('ESLint disable comment')
  );

  const dependencyWarnings = errors.filter(e => !editedFileErrors.includes(e));

  if (editedFileErrors.length > 0) {
    console.error(
      `\n${colors.red}🛑 FAILED - Fix issues in your edited file! 🛑${colors.reset}`
    );
    console.error(`${colors.cyan}💡 CLAUDE.md CHECK:${colors.reset}`);
    console.error(
      `${colors.cyan}  → What CLAUDE.md pattern would have prevented this?${colors.reset}`
    );
    console.error(
      `${colors.cyan}  → Are you following JSDoc batching strategy?${colors.reset}`
    );
    console.error(`${colors.yellow}📋 NEXT STEPS:${colors.reset}`);
    console.error(
      `${colors.yellow}  1. Fix the issues listed above${colors.reset}`
    );
    console.error(
      `${colors.yellow}  2. The hook will run again automatically${colors.reset}`
    );
    console.error(
      `${colors.yellow}  3. Continue with your original task once all checks pass${colors.reset}`
    );
    process.exit(2);
  } else if (dependencyWarnings.length > 0) {
    console.error(
      `\n${colors.yellow}⚠️ WARNING - Dependency issues found${colors.reset}`
    );
    console.error(
      `${colors.yellow}These won't block your progress but should be addressed${colors.reset}`
    );
    console.error(
      `\n${colors.green}✅ Quality check passed for ${path.basename(filePath)}${colors.reset}`
    );

    if (autofixes.length > 0 && config.autofixSilent) {
      console.error(
        `\n${colors.yellow}👉 File quality verified. Auto-fixes applied. Continue with your task.${colors.reset}`
      );
    } else {
      console.error(
        `\n${colors.yellow}👉 File quality verified. Continue with your task.${colors.reset}`
      );
    }
    process.exit(0);
  } else {
    console.error(
      `\n${colors.green}✅ Quality check passed for ${path.basename(filePath)}${colors.reset}`
    );

    if (autofixes.length > 0 && config.autofixSilent) {
      console.error(
        `\n${colors.yellow}👉 File quality verified. Auto-fixes applied. Continue with your task.${colors.reset}`
      );
    } else {
      console.error(
        `\n${colors.yellow}👉 File quality verified. Continue with your task.${colors.reset}`
      );
    }
    process.exit(0);
  }
}

// Handle errors
process.on('unhandledRejection', error => {
  log.error(`Unhandled error: ${error.message}`);
  process.exit(1);
});

// Run main
main().catch(error => {
  log.error(`Fatal error: ${error.message}`);
  process.exit(1);
});
