import * as fs from 'fs/promises';
import type { Dirent } from 'fs';
import * as path from 'path';

// Mirror of extension/src/fsBits.ts — same purpose, different fs API
// (fs/promises Dirent here vs. vscode.FileType's bitmask there).

/**
 * `withFileTypes` avoids a stat per entry, but reports a symlink as neither
 * a file nor a directory — `entry.isDirectory()`/`isFile()` are both false
 * for it, so code that only checks those silently skips every symlinked
 * skill/rule. This matters because `.agents/skills`-style setups are
 * commonly symlink farms (e.g. `.zcode/skills/foo` -> `~/.agents/skills/foo`).
 */
export async function resolveKind(parent: string, entry: Dirent): Promise<'dir' | 'file' | 'other'> {
  if (entry.isDirectory()) return 'dir';
  if (entry.isFile()) return 'file';
  if (entry.isSymbolicLink()) {
    try {
      const stat = await fs.stat(path.join(parent, entry.name));
      if (stat.isDirectory()) return 'dir';
      if (stat.isFile()) return 'file';
    } catch {
      return 'other';
    }
  }
  return 'other';
}
