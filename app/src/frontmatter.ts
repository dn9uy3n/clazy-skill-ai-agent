import * as fs from 'fs/promises';
import * as yaml from 'js-yaml';

/**
 * Frontmatter lives at the top of the file, so building a listing only needs the
 * first chunk of each SKILL.md. Reading whole files turned a scan of ~800 skills
 * into ~10 MB of I/O for data the list view never showed.
 */
const HEAD_BYTES = 8192;

export const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export interface ParsedDoc {
  frontmatter: Record<string, unknown>;
  body: string;
  /** Set when a frontmatter block exists but could not be parsed as YAML. */
  error?: string;
}

export function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function parseFrontmatter(content: string): ParsedDoc {
  // Strip a UTF-8 BOM so the leading `---` still anchors at position 0.
  const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const match = text.match(FRONTMATTER_RE);
  if (!match) return { frontmatter: {}, body: text.trim() };

  let frontmatter: Record<string, unknown> = {};
  let error: string | undefined;
  try {
    // CORE_SCHEMA is plain YAML 1.2 — no custom tags, so nothing in a third-party
    // skill file can make the parser construct arbitrary types.
    const loaded = yaml.load(match[1], { schema: yaml.CORE_SCHEMA });
    if (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) {
      frontmatter = loaded as Record<string, unknown>;
    } else if (loaded != null) {
      error = 'frontmatter is not a key/value mapping';
    }
  } catch (e) {
    error = errText(e).split('\n')[0];
  }

  return { frontmatter, body: match[2].trim(), error };
}

/** Flatten a YAML value into something renderable on one line of a list. */
export function toDisplayString(value: unknown): string {
  if (value == null) return '';
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
 * Parse a document's frontmatter reading only its head, falling back to a full
 * read when the closing `---` sits past the head window.
 */
export async function readDocHead(filePath: string): Promise<ParsedDoc> {
  let head: string;
  let isWholeFile: boolean;

  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0);
    head = buffer.subarray(0, bytesRead).toString('utf-8');
    isWholeFile = bytesRead < HEAD_BYTES;
  } finally {
    await handle.close();
  }

  if (isWholeFile || FRONTMATTER_RE.test(head)) return parseFrontmatter(head);
  return parseFrontmatter(await fs.readFile(filePath, 'utf-8'));
}

/** Read a document's full markdown body, on demand. */
export async function readBody(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath, 'utf-8');
  return parseFrontmatter(content).body;
}
