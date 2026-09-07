import * as vscode from 'vscode';
import { FRONTMATTER_RE, ParsedDoc, parseFrontmatter } from './frontmatter';

/**
 * The `vscode.workspace.fs`-dependent half of frontmatter reading, split out
 * of `frontmatter.ts` so that file's parser stays plain, dependency-free
 * TypeScript — testable with `node:test` outside the extension host, which
 * has no `vscode` module to resolve.
 */

/** Frontmatter sits at the top of the file, so only the head needs decoding. */
const HEAD_BYTES = 8192;

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
