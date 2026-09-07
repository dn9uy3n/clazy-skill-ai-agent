import * as vscode from 'vscode';

/**
 * `vscode.workspace.fs` reports FileType as a bitmask: a symlinked directory
 * comes back as `Directory | SymbolicLink`, not `Directory` alone, so a plain
 * `=== FileType.Directory` check silently skips every symlinked skill/rule.
 * This matters because `.agents/skills`-style setups are commonly symlink
 * farms (e.g. `.zcode/skills/foo` -> `.claude/skills/foo` -> `.agents/skills/foo`).
 */
export function isDir(type: vscode.FileType): boolean {
  return (type & vscode.FileType.Directory) !== 0;
}

export function isFile(type: vscode.FileType): boolean {
  return (type & vscode.FileType.File) !== 0;
}

export function isSymlink(type: vscode.FileType): boolean {
  return (type & vscode.FileType.SymbolicLink) !== 0;
}
