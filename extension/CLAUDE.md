# Lazy Skill AI Agent

VS Code extension to manage AI skills and rules for Claude Code, Antigravity, Cursor, and ZCode (z.ai).

This is one half of a monorepo — `app/` is an Electron twin of this extension with near-identical
logic. `platforms.ts` and `agentsMd.ts` are meant to be **byte-identical except for their header
comment** between the two trees (each names the other as "the mirror"); everything else is
independently implemented against a different filesystem API (`vscode.workspace.fs` here,
`fs/promises` there). When you change platform routing or the AGENTS.md merge logic here, make the
same change in `app/src/platforms.ts` / `app/src/agentsMd.ts`.

## Project Structure

- `src/extension.ts` - Extension entry point
- `src/types.ts` - Shared TypeScript types
- `src/platforms.ts` - Registry of target platforms (skills dir, rules strategy, index/validation
  capabilities per platform). This is the single place platform routing lives — `skillInstaller.ts`
  never branches on `TargetPlatform` itself, it asks this registry.
- `src/agentsMd.ts` - Pure string logic (no `vscode` import) for merging rules into a platform's
  AGENTS.md managed block. Kept dependency-free so it's unit-testable outside the extension host.
- `src/frontmatter.ts` - Dependency-free YAML frontmatter parser (block scalars, wrapped quoted
  scalars, sequences). Also `vscode`-free and unit-tested for the same reason.
- `src/docReader.ts` - The `vscode.workspace.fs`-dependent half of frontmatter reading
  (`readDocHead`/`readBody`), split out of `frontmatter.ts` so that file could stay testable.
- `src/fsBits.ts` - Bitmask helpers for `vscode.FileType` (`isDir`/`isFile`/`isSymlink`). Necessary
  because `FileType` is a bitmask — a symlinked directory is `Directory | SymbolicLink`, not
  `Directory` alone, so `type === vscode.FileType.Directory` silently skips every symlinked
  skill/rule. This matters in practice: `.agents/skills`-style setups are commonly symlink farms.
- `src/skillScanner.ts` - Scans directories for skill `.md` files, parses frontmatter
- `src/skillInstaller.ts` - Copies/removes skill folders and rule files to/from the project, using
  `platforms.ts` for all path decisions; also owns the AGENTS.md I/O wrapper around `agentsMd.ts`
- `src/webviewPanel.ts` - Webview panel controller with HTML generation
- `media/main.js` - Webview frontend logic (platform radios are rendered from data sent by the host)
- `media/main.css` - Webview styles (VS Code theme-aware)
- `src/test/*.test.ts` - `node:test` suite for the `vscode`-free modules above

## Build

```bash
npm run compile   # TypeScript -> out/
npm run watch     # Watch mode
npm run test      # Compile + run node:test against out/test/
npm run package   # Build .vsix
```

## Conventions

- No external runtime dependencies. Only `@types/vscode`, `@types/node`, and `typescript` as dev deps.
- Use `vscode.workspace.fs` for all file operations (not Node.js `fs`), with two documented exceptions:
  - `fs.promises.realpath` in `webviewPanel.ts`'s read-access gate — `vscode.workspace.fs` has no
    realpath equivalent, and a lexical path check accepts a symlink that points outside the
    configured directories.
  - `os.homedir()` in `skillInstaller.ts`'s user-scope shadow warning (ZCode) — this only resolves
    a path to `stat`, it does no I/O of its own, so it doesn't need `vscode.workspace.fs`.
- Frontmatter parsing lives in `src/frontmatter.ts` — hand-written, no yaml library. It must
  handle block scalars (`>-`, `|`) and quoted scalars that wrap across lines; a naive
  line-by-line `indexOf(':')` reader silently mangles most real skill descriptions.
- Scan results carry no markdown `body`; the webview requests one per item via `getBody`.
- Any path the webview asks to read is validated against the configured directories first,
  using `fs.promises.realpath`, resolved **per top-level entry** rather than per configured root —
  a configured root can itself contain symlinked/junctioned entries (see `fsBits.ts` above), so
  realpath'ing the root itself and comparing against that would reject every entry in it.
- All styles use `--vscode-*` CSS variables for theme compatibility.
- Skill install target is platform-dependent — see `platforms.ts`'s table, not this file, for the
  authoritative per-platform paths (they drift from any copy kept here).
- The selected platform is persisted to `lazy-skill-ai-agent.targetPlatform` (workspace-scoped),
  not just held in memory.

## Testing

Press F5 in VS Code to launch Extension Development Host. Run command "Lazy: Open Skill Manager".

`npm test` runs the `node:test` suite for the modules with no `vscode` dependency (`platforms.ts`,
`agentsMd.ts`, `frontmatter.ts`). Anything that touches `vscode.workspace.fs` is still only
exercised manually via F5 — there is no `@vscode/test-electron` integration harness.
