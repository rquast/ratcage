import type { StreamChunk } from '../types/provider.js';

interface ParsedChunk {
  type: StreamChunk['type'];
  content: string;
  language?: string;
  isComplete?: boolean;
  metadata?: Record<string, unknown>;
}

export class StreamParser {
  private buffer = '';
  private inCodeBlock = false;
  private currentLanguage = '';
  private codeBuffer = '';

  *parseChunk(rawContent: string): Generator<ParsedChunk> {
    this.buffer += rawContent;
    const lines = this.buffer.split('\n');

    // Keep the last line in buffer if it doesn't end with newline
    this.buffer = rawContent.endsWith('\n') ? '' : (lines.pop() ?? '');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check for thinking patterns
      if (
        line.includes('[Thinking]') ||
        line.includes('🤔') ||
        line.includes('Let me think')
      ) {
        yield {
          type: 'thinking',
          content: line + '\n',
        };
        continue;
      }

      // Check for code block start
      const codeBlockMatch = line.match(/^```(\w+)?/);
      if (codeBlockMatch && !this.inCodeBlock) {
        this.inCodeBlock = true;
        this.currentLanguage = codeBlockMatch[1] || '';
        this.codeBuffer = '';
        continue;
      }

      // Check for code block end
      if (line.match(/^```\s*$/) && this.inCodeBlock) {
        this.inCodeBlock = false;
        yield {
          type: 'code_snippet',
          content: this.codeBuffer,
          language: this.currentLanguage,
          isComplete: true,
        };
        this.codeBuffer = '';
        this.currentLanguage = '';
        continue;
      }

      // Handle content inside code blocks
      if (this.inCodeBlock) {
        this.codeBuffer += line + '\n';
        yield {
          type: 'partial_code',
          content: line + '\n',
          language: this.currentLanguage,
          isComplete: false,
        };
        continue;
      }

      // Check for tool usage patterns
      if (
        line.includes('[Tool:') ||
        line.includes('Using tool:') ||
        line.includes('🔧')
      ) {
        const toolMatch =
          line.match(/\[Tool:\s*([^\]]+)\]/) ??
          line.match(/Using tool:\s*(\w+)/);
        yield {
          type: 'tool_use',
          content: line + '\n',
          metadata: {
            toolName: toolMatch ? toolMatch[1].trim() : 'unknown',
          },
        };
        continue;
      }

      // Check for tool results
      if (
        line.includes('[Result]') ||
        line.includes('Result:') ||
        line.includes('✅')
      ) {
        yield {
          type: 'tool_result',
          content: line + '\n',
        };
        continue;
      }

      // Check for errors
      if (
        line.includes('[Error]') ||
        line.includes('Error:') ||
        line.includes('❌') ||
        line.includes('⚠️')
      ) {
        yield {
          type: 'error',
          content: line + '\n',
        };
        continue;
      }

      // Default to text
      yield {
        type: 'text',
        content: line + '\n',
      };
    }
  }

  // Handle any remaining buffer content when stream ends
  *flush(): Generator<ParsedChunk> {
    if (this.buffer.trim()) {
      if (this.inCodeBlock) {
        yield {
          type: 'code_snippet',
          content: this.codeBuffer + this.buffer,
          language: this.currentLanguage,
          isComplete: true,
        };
      } else {
        yield {
          type: 'text',
          content: this.buffer,
        };
      }
    }

    // Reset state
    this.buffer = '';
    this.inCodeBlock = false;
    this.currentLanguage = '';
    this.codeBuffer = '';
  }
}
