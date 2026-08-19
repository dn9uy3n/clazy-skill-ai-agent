import * as vscode from 'vscode';

/**
 * Minimal YAML-frontmatter reader.
 *
 * The extension ships with no runtime dependencies, so this covers the subset
 * frontmatter actually uses: top-level keys whose values are block scalars
 * (`>-`, `|`), quoted scalars that wrap across lines, plain scalars, and block
 * sequences. Nested mappings are skipped — only `name` and `description` are read.
 *
 * The previous line-by-line `indexOf(':')` reader mis-parsed every multi-line
 * value: `description: >-` came back as the literal string `">-"`, and quoted
 * values were truncated at the first newline with the opening quote left on.
 */

/** Frontmatter sits at the top of the file, so only the head needs decoding. */
const HEAD_BYTES = 8192;

export const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export interface ParsedDoc {
  frontmatter: Record<string, unknown>;
  body: string;
}

function indentOf(line: string): number {
  let n = 0;
  while (n < line.length && line[n] === ' ') n++;
  return n;
}

function isBlank(line: string): boolean {
  return line.trim() === '';
}

/** Fold a run of lines the way YAML folds a `>` scalar: blank lines become newlines. */
function foldLines(lines: string[]): string {
  let out = '';
  let pendingNewlines = 0;
  for (const line of lines) {
    if (isBlank(line)) {
      pendingNewlines++;
      continue;
    }
    if (out === '') {
      out = line;
    } else {
      out += pendingNewlines > 0 ? '\n'.repeat(pendingNewlines) : ' ';
      out += line;
    }
    pendingNewlines = 0;
  }
  return out;
}

/** Consume a `|`/`>` block scalar; returns the value and the index after it. */
function readBlockScalar(
  lines: string[],
  start: number,
  header: string,
  parentIndent: number,
): { value: string; next: number } {
  const style = header[0];
  const chomp = header.includes('-') ? 'strip' : header.includes('+') ? 'keep' : 'clip';

  const collected: string[] = [];
  let i = start;
  let contentIndent = -1;

  for (; i < lines.length; i++) {
    const line = lines[i];
    if (isBlank(line)) {
      collected.push('');
      continue;
    }
    const indent = indentOf(line);
    if (indent <= parentIndent) break;
    if (contentIndent === -1) contentIndent = indent;
    collected.push(line.slice(contentIndent));
  }

  while (collected.length > 0 && collected[collected.length - 1] === '') collected.pop();

  let value: string;
  if (style === '>') {
    // More-indented lines keep their own line breaks; the rest fold onto one line.
    const chunks: string[] = [];
    let plain: string[] = [];
    for (const line of collected) {
      if (line.startsWith(' ')) {
        if (plain.length) {
          chunks.push(foldLines(plain));
          plain = [];
        }
        chunks.push(line);
      } else {
        plain.push(line);
      }
    }
    if (plain.length) chunks.push(foldLines(plain));
    value = chunks.join('\n');
  } else {
    value = collected.join('\n');
  }

  if (chomp === 'clip' && value !== '') value += '\n';
  else if (chomp === 'keep') value += '\n';

  return { value, next: i };
}

/** Consume a quoted scalar that may wrap across lines; returns value and next index. */
function readQuotedScalar(
  lines: string[],
  start: number,
  firstChunk: string,
  quote: string,
): { value: string; next: number } {
  const escaped = quote === '"' ? /\\./g : /''/g;

  const findClose = (text: string): number => {
    for (let i = 0; i < text.length; i++) {
      if (quote === '"' && text[i] === '\\') {
        i++;
        continue;
      }
      if (text[i] === quote) {
        if (quote === "'" && text[i + 1] === "'") {
          i++;
          continue;
        }
        return i;
      }
    }
    return -1;
  };

  let close = findClose(firstChunk);
  if (close !== -1) {
    return { value: unescape(firstChunk.slice(0, close), quote, escaped), next: start };
  }

  const parts = [firstChunk];
  let i = start;
  for (; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    close = findClose(trimmed);
    if (close !== -1) {
      parts.push(trimmed.slice(0, close));
      i++;
      break;
    }
    parts.push(trimmed);
  }

  return { value: unescape(foldLines(parts), quote, escaped), next: i };
}

function unescape(text: string, quote: string, _pattern: RegExp): string {
  if (quote === "'") return text.replace(/''/g, "'");
  return text.replace(/\\(["\\/nrt])/g, (_m, c) => {
    switch (c) {
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      default:
        return c;
    }
  });
}

/** Strip a trailing `# comment` from an unquoted scalar. */
function stripComment(text: string): string {
  const idx = text.search(/\s#/);
  return (idx === -1 ? text : text.slice(0, idx)).trim();
}

function parseScalar(text: string): unknown {
  if (text === '' || text === '~' || text === 'null') return null;
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^-?\d+$/.test(text)) return Number(text);
  if (/^-?\d*\.\d+$/.test(text)) return Number(text);
  return text;
}

function parseFlowSequence(text: string): unknown[] {
  const inner = text.slice(1, -1).trim();
  if (inner === '') return [];
  return inner.split(',').map(part => {
    const t = part.trim();
    if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
      return unescape(t.slice(1, -1), t[0], /''/g);
    }
    return parseScalar(t);
  });
}

/** Parse the top-level keys of a YAML mapping. */
export function parseYamlMap(raw: string): Record<string, unknown> {
  const lines = raw.split(/\r?\n/);
  const result: Record<string, unknown> = {};
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (isBlank(line) || line.trimStart().startsWith('#') || indentOf(line) > 0) {
      i++;
      continue;
    }

    const match = /^([^:#]+?)\s*:(?:\s+(.*))?$/.exec(line);
    if (!match) {
      i++;
      continue;
    }

    const key = match[1].trim();
    const rest = (match[2] ?? '').trim();
    i++;

    if (rest.startsWith('|') || rest.startsWith('>')) {
      const block = readBlockScalar(lines, i, rest, 0);
      result[key] = block.value;
      i = block.next;
      continue;
    }

    if (rest.startsWith("'") || rest.startsWith('"')) {
      const quoted = readQuotedScalar(lines, i, rest.slice(1), rest[0]);
      result[key] = quoted.value;
      i = quoted.next;
      continue;
    }

    if (rest.startsWith('[') && rest.endsWith(']')) {
      result[key] = parseFlowSequence(rest);
      continue;
    }

    if (rest === '') {
      // A block sequence, a nested mapping, or an empty value. Only a flat
      // sequence of scalars is representable here; anything deeper is skipped,
      // since only `name` and `description` are ever read.
      const items: unknown[] = [];
      let isNested = false;
      while (i < lines.length) {
        const child = lines[i];
        if (isBlank(child)) {
          i++;
          continue;
        }
        const trimmed = child.trim();
        if (indentOf(child) === 0 && !trimmed.startsWith('- ')) break;
        if (!trimmed.startsWith('- ')) {
          isNested = true;
        } else {
          const item = trimmed.slice(2).trim();
          // `- key: value` is a sequence of mappings, not of scalars.
          if (/^[^:#]+:(\s|$)/.test(item)) {
            isNested = true;
          } else if (
            (item.startsWith("'") && item.endsWith("'")) ||
            (item.startsWith('"') && item.endsWith('"'))
          ) {
            items.push(unescape(item.slice(1, -1), item[0], /''/g));
          } else {
            items.push(parseScalar(stripComment(item)));
          }
        }
        i++;
      }
      result[key] = isNested || items.length === 0 ? null : items;
      continue;
    }

    // Plain scalar, possibly continued on following indented lines.
    const parts = [stripComment(rest)];
    while (i < lines.length) {
      const child = lines[i];
      if (isBlank(child)) break;
      if (indentOf(child) === 0) break;
      const trimmed = child.trim();
      if (trimmed.startsWith('- ')) break;
      parts.push(trimmed);
      i++;
    }
    result[key] = parts.length === 1 ? parseScalar(parts[0]) : foldLines(parts);
  }

  return result;
}

export function parseFrontmatter(content: string): ParsedDoc {
  // Strip a UTF-8 BOM so the leading `---` still anchors at position 0.
  const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const match = text.match(FRONTMATTER_RE);
  if (!match) return { frontmatter: {}, body: text.trim() };
  return { frontmatter: parseYamlMap(match[1]), body: match[2].trim() };
}

/** Flatten a value into something renderable on one line of a list. */
export function toDisplayString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(toDisplayString).filter(Boolean).join(', ');
  return '';
}

export function firstLine(body: string): string {
  const line = body.split('\n').find(l => l.trim());
  return line ? line.trim() : '';
}

/**
 * Read a document's frontmatter, decoding only its head. Scanning ~800 skills
 * otherwise decodes ~10 MB of markdown that the list view never shows.
 */
export async function readDocHead(filePath: string): Promise<ParsedDoc> {
  const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (buffer.length <= HEAD_BYTES) return parseFrontmatter(buffer.toString('utf-8'));

  const head = buffer.subarray(0, HEAD_BYTES).toString('utf-8');
  if (FRONTMATTER_RE.test(head)) return parseFrontmatter(head);
  return parseFrontmatter(buffer.toString('utf-8'));
}

/** Read a document's full markdown body, on demand. */
export async function readBody(filePath: string): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
  return parseFrontmatter(Buffer.from(bytes).toString('utf-8')).body;
}
