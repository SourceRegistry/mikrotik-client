import {
  type IRBlock,
  type IRItem,
  type IRProperty,
  type IRResourceBlock,
  type IRResourceCommand,
  type IRSystemCommand,
  type RouterOSConfig,
  createEmptyConfig,
  isResourceBlock,
  IR_RESOURCE_COMMANDS,
} from './types';

// ─── Parser Options ───────────────────────────────────────────────────────────

export type ParseExportOptions = {
  /**
   * Preserve blank lines as comment nodes with empty text.
   * @default false
   */
  preserveBlankLines?: boolean;
};

// ─── Export Parse Errors ──────────────────────────────────────────────────────

/** Error thrown when `/export` text cannot be parsed. */
export class ParseExportError extends Error {
  public readonly code = 'parse_failed' as const;
  public readonly line: number;

  public constructor(message: string, line: number) {
    super(message);
    this.name = 'ParseExportError';
    this.line = line;
  }
}

// ─── Tokenizer ────────────────────────────────────────────────────────────────

type Token =
  | { type: 'comment'; text: string }
  | { type: 'path'; value: string }
  | { type: 'bracketOpen' }
  | { type: 'bracketClose' }
  | { type: 'braceOpen' }
  | { type: 'braceClose' }
  | { type: 'word'; value: string }
  | { type: 'quoted'; value: string }
  | { type: 'newline' }
  | { type: 'eof' };

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    // Newline
    if (ch === '\n') {
      tokens.push({ type: 'newline' });
      i++;
      continue;
    }
    // Carriage return (skip)
    if (ch === '\r') {
      i++;
      continue;
    }
    // Whitespace (skip)
    if (ch === ' ' || ch === '\t') {
      i++;
      continue;
    }

    // Block comment (multiline) — `/* ... */`
    if (ch === '/' && text[i + 1] === '*') {
      let end = text.indexOf('*/', i + 2);
      if (end < 0) end = text.length;
      else end += 2;
      const commentText = text.slice(i + 2, end).trim();
      tokens.push({ type: 'comment', text: commentText });
      i = end;
      continue;
    }

    // Line comment — `#` or `//`
    if (ch === '#' || (ch === '/' && text[i + 1] === '/')) {
      const start = i;
      if (ch === '/' && text[i + 1] === '/') i += 2;
      else i++;
      while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i++;
      tokens.push({ type: 'comment', text: text.slice(start, i).trim() });
      continue;
    }

    // Quoted string — handles `\"` as escape
    if (ch === '"') {
      let j = i + 1;
      let value = '';
      while (j < text.length) {
        const c = text[j];
        if (c === '\\' && j + 1 < text.length) {
          value += text[j + 1];
          j += 2;
          continue;
        }
        if (c === '"') break;
        value += c;
        j++;
      }
      tokens.push({ type: 'quoted', value });
      i = j + 1; // skip closing quote
      continue;
    }

    // Square brackets
    if (ch === '[') {
      tokens.push({ type: 'bracketOpen' });
      i++;
      continue;
    }
    if (ch === ']') {
      tokens.push({ type: 'bracketClose' });
      i++;
      continue;
    }

    // Curly braces
    if (ch === '{') {
      tokens.push({ type: 'braceOpen' });
      i++;
      continue;
    }
    if (ch === '}') {
      tokens.push({ type: 'braceClose' });
      i++;
      continue;
    }

    // Path — starts with `/`
    if (ch === '/') {
      let j = i;
      let path = '';
      while (j < text.length) {
        const c = text[j];
        if (c === '/' && path.length > 0 && j + 1 < text.length && text[j + 1] !== ' ' && text[j + 1] !== '\n' && text[j + 1] !== '\r' && text[j + 1] !== '\t') {
          path += '/';
          j++;
          continue;
        }
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r') break;
        path += c;
        j++;
      }
      tokens.push({ type: 'path', value: path });
      i = j;
      continue;
    }

    // Regular word (including system commands starting with `:`)
    {
      let j = i;
      let word = '';
      while (j < text.length) {
        const c = text[j];
        if (
          c === ' ' || c === '\t' || c === '\n' || c === '\r' ||
          c === '"' || c === '[' || c === ']' || c === '{' || c === '}' ||
          c === '#' ||
          (c === '/' && j + 1 < text.length && text[j + 1] === '/')
        ) break;
        word += c;
        j++;
      }
      if (word.length > 0) {
        tokens.push({ type: 'word', value: word });
      }
      i = j;
      continue;
    }
  }

  tokens.push({ type: 'eof' });
  return tokens;
}

// ─── Parser State ─────────────────────────────────────────────────────────────

class Parser {
  readonly tokens: Token[];
  readonly options: ParseExportOptions;
  pos = 0;

  constructor(tokens: Token[], options: ParseExportOptions = {}) {
    this.tokens = tokens;
    this.options = options;
  }

  get current(): Token {
    return this.tokens[this.pos] ?? { type: 'eof' };
  }

  advance(): Token {
    const token = this.current;
    this.pos++;
    return token;
  }

  expect(type: Token['type']): Token & { value?: string; text?: string } {
    const token = this.current;
    if (token.type !== type) {
      throw new ParseExportError(
        `Expected ${type} but got ${token.type}`,
        this.pos
      );
    }
    return this.advance();
  }

  skipIf(type: Token['type']): boolean {
    if (this.current.type === type) {
      this.advance();
      return true;
    }
    return false;
  }
}

// ─── Parse Value ──────────────────────────────────────────────────────────────

function parseValue(parser: Parser): string {
  const token = parser.current;

  if (token.type === 'quoted') {
    parser.advance();
    return token.value;
  }
  if (token.type === 'word') {
    parser.advance();
    return token.value;
  }
  return '';
}

// ─── Parse Find Query (`[find ...]`) ──────────────────────────────────────────

function parseFindQuery(parser: Parser): IRProperty[] {
  const props: IRProperty[] = [];
  parser.expect('bracketOpen');

  // Skip the `find` keyword if present
  if (parser.current.type === 'word' && parser.current.value === 'find') {
    parser.advance();
  }

  while (parser.current.type !== 'bracketClose' && parser.current.type !== 'eof') {
    const token = parser.current;

    // Skip operators
    if (token.type === 'word' && ['!', 'and', 'or', 'not'].includes(token.value)) {
      parser.advance();
      continue;
    }

    if (token.type === 'word' && token.value.includes('=')) {
      // Inline `key=value` token (common in find queries)
      const eqIdx = token.value.indexOf('=');
      const name = token.value.slice(0, eqIdx);
      let value = token.value.slice(eqIdx + 1);
      parser.advance();
      if (value === '' && (parser.current.type === 'word' || parser.current.type === 'quoted')) {
        value = parseValue(parser);
      }
      props.push({ name, value });
    } else if (token.type === 'word') {
      const name = token.value;
      parser.advance();

      // Skip operator
      if (parser.current.type === 'word' && ['=', '!=', '>', '<'].includes(parser.current.value)) {
        parser.advance();
      }

      // Value
      if (parser.current.type === 'word' || parser.current.type === 'quoted') {
        const value = parseValue(parser);
        props.push({ name, value });
      } else {
        props.push({ name, value: '' });
      }
    } else {
      parser.advance();
    }
  }

  parser.skipIf('bracketClose');
  return props;
}

// ─── Parse Properties Until Newline ───────────────────────────────────────────

function parseProperties(parser: Parser): IRProperty[] {
  const properties: IRProperty[] = [];

  while (
    parser.current.type !== 'newline' &&
    parser.current.type !== 'eof' &&
    parser.current.type !== 'comment'
  ) {
    const token = parser.current;

    if (token.type === 'bracketOpen') {
      // Skip bracket pairs (find queries already consumed, but handle edge cases)
      let depth = 0;
      while (parser.pos < parser.tokens.length) {
        const cur = parser.current;
        if (cur.type === 'bracketOpen') depth++;
        else if (cur.type === 'bracketClose') depth--;
        parser.advance();
        if (depth <= 0) break;
      }
      continue;
    }

    if (token.type === 'word' && token.value.includes('=')) {
      const eqIdx = token.value.indexOf('=');
      const name = token.value.slice(0, eqIdx);
      let value = token.value.slice(eqIdx + 1);
      parser.advance();

      // If value is empty, check for following value token (word or quoted)
      if (value === '' && (parser.current.type === 'word' || parser.current.type === 'quoted')) {
        value = parseValue(parser);
      }

      properties.push({ name, value });
    } else if (token.type === 'word') {
      // Could be a bare word — skip it
      parser.advance();
    } else if (token.type === 'quoted') {
      // Standalone quoted value — skip
      parser.advance();
    } else {
      parser.advance();
    }
  }

  return properties;
}

// ─── Parse Block (`{ ... }`) ──────────────────────────────────────────────────

function parseBlock(parser: Parser): IRBlock {
  parser.expect('braceOpen');
  const items: IRItem[] = [];

  while (parser.current.type !== 'braceClose' && parser.current.type !== 'eof') {
    if (parser.current.type === 'newline') {
      parser.advance();
      continue;
    }
    if (parser.current.type === 'comment') {
      items.push({ kind: 'comment', text: parser.current.text });
      parser.advance();
      continue;
    }

    const item = parseItem(parser);
    if (item) {
      items.push(item);
    }
  }

  parser.skipIf('braceClose');
  return { kind: 'block', items };
}

// ─── Parse System Command ─────────────────────────────────────────────────────

function parseSystemCommand(parser: Parser): IRSystemCommand | null {
  const token = parser.current;
  if (token.type !== 'word' || !token.value.startsWith(':')) {
    return null;
  }

  const parts: string[] = [];
  while (parser.current.type !== 'newline' && parser.current.type !== 'eof') {
    if (parser.current.type === 'word' || parser.current.type === 'quoted') {
      parts.push(parser.current.value);
      parser.advance();
    } else {
      break;
    }
  }

  if (parts.length === 0) return null;
  return { kind: 'system', command: parts.join(' ') };
}

// ─── Parse Single Item ────────────────────────────────────────────────────────

function parseItem(parser: Parser): IRItem | null {
  const token = parser.current;

  // Comment
  if (token.type === 'comment') {
    parser.advance();
    return { kind: 'comment', text: token.text };
  }

  // Block
  if (token.type === 'braceOpen') {
    return parseBlock(parser);
  }

  // System command
  if (token.type === 'word' && token.value.startsWith(':')) {
    return parseSystemCommand(parser);
  }

  // Command-only line (inside a block context): e.g. `add name=bridge1`
  if (token.type === 'word' && (IR_RESOURCE_COMMANDS as readonly string[]).includes(token.value)) {
    const command = token.value as IRResourceCommand;
    parser.advance();
    const properties = parseProperties(parser);
    return { kind: 'resource', path: '', command, properties };
  }

  // Resource path
  if (token.type === 'path') {
    parser.advance();
    const COMMAND_KEYWORDS = new Set<string>(IR_RESOURCE_COMMANDS);

    // Collect multi-word path segments (e.g. `/interface bridge`, `/ip firewall filter`)
    let path = token.value;
    while (parser.current.type === 'word' && !COMMAND_KEYWORDS.has(parser.current.value)) {
      path += ' ' + parser.current.value;
      parser.advance();
    }

    // Block grouping: `/path { add name=x; add name=y }`
    if (parser.current.type === 'braceOpen') {
      const block = parseBlock(parser);
      return block;
    }

    // Command
    let command: IRResourceCommand;
    if (parser.current.type === 'word' && COMMAND_KEYWORDS.has(parser.current.value)) {
      command = parser.current.value as IRResourceCommand;
      parser.advance();
    } else {
      command = 'add';
    }

    // Find query
    let findQuery: IRProperty[] | undefined;
    if (
      ['set', 'remove', 'disable', 'enable'].includes(command) &&
      parser.current.type === 'bracketOpen'
    ) {
      findQuery = parseFindQuery(parser);
    }

    // Properties
    const properties = parseProperties(parser);

    const result: IRResourceBlock = {
      kind: 'resource',
      path,
      command,
      properties,
    };
    if (findQuery !== undefined) {
      result.findQuery = findQuery;
    }
    return result;
  }

  return null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a RouterOS `/export` text into a typed {@link RouterOSConfig} IR.
 *
 * Tolerant of both v6 and v7 export syntax differences. Preserves comments as
 * nodes. Handles `set [find ...]`, quoted values, system commands, and `{}`
 * block groupings.
 *
 * @param text - The output of a `/export` command from RouterOS.
 * @param options - Parser options.
 * @returns A typed IR representation of the configuration.
 * @throws {ParseExportError} When the text cannot be parsed.
 *
 * @example
 * ```ts
 * import { parseExport } from '@sourceregistry/mikrotik-client/ir';
 *
 * const config = parseExport(`
 *   # ==== interfaces ====
 *   /interface ethernet set [find default-name=ether1] disabled=no
 *   /ip address add address=192.168.1.1/24 interface=bridge1
 * `);
 * ```
 */
export function parseExport(text: string, options?: ParseExportOptions): RouterOSConfig {
  const tokens = tokenize(text);
  const parser = new Parser(tokens, options ?? {});
  const config = createEmptyConfig();
  const { preserveBlankLines = false } = options ?? {};

  while (parser.current.type !== 'eof') {
    // Handle blank lines
    if (parser.current.type === 'newline') {
      if (preserveBlankLines) {
        config.items.push({ kind: 'comment', text: '' });
      }
      parser.advance();
      continue;
    }

    const posBefore = parser.pos;
    const item = parseItem(parser);
    // Safety: if parseItem returned null without advancing, advance to avoid infinite loop
    if (parser.pos === posBefore) {
      parser.advance();
      continue;
    }
    if (item) {
      config.items.push(item);

      // Extract identity if present
      if (
        isResourceBlock(item) &&
        item.path === '/system identity' &&
        item.command === 'set'
      ) {
        const nameProp = item.properties.find((p) => p.name === 'name');
        if (nameProp) {
          config.identity = nameProp.value;
        }
      }
    }
  }

  return config;
}
