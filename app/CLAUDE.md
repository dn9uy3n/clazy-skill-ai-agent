# Lazy Skill AI Agent (Desktop App)

Electron desktop twin of the VS Code extension in `extension/`. Manages AI skills and rules for
Claude Code, Antigravity, Cursor, and ZCode (z.ai) from a standalone window instead of a webview.

`platforms.ts` and `agentsMd.ts` are meant to be **byte-identical to their `extension/src/`
counterparts except for their header comment** (each names the other tree as "the mirror"); every
other file here independently reimplements the same logic against `fs/promises` instead of
`vscode.workspace.fs`. When you change platform routing or the AGENTS.md merge logic here, make
the same change in `extension/src/platforms.ts` / `extension/src/agentsMd.ts`.

## Project Structure

- `src/main.ts` - Electron main process: window creation, all `ipcMain` handlers, file watching
- `src/preload.ts` - `contextBridge`-exposed IPC surface (`window.lazyApi`)
- `src/config.ts` - Persists `{ platform, skillDirectories, ruleFiles, lastProjectPath }` to
  `app.getPath('userData')/config.json`
- `src/types.ts` - Shared TypeScript types
- `src/platforms.ts` - Registry of target platforms — mirror of `extension/src/platforms.ts`
- `src/agentsMd.ts` - Pure string logic for the AGENTS.md rule merge — mirror of
  `extension/src/agentsMd.ts`
- `src/frontmatter.ts` - `js-yaml`-backed frontmatter parser (unlike the extension's hand-written
  one; same `ParsedDoc` contract, plus an `error` field surfaced when a block fails to parse)
- `src/fsKind.ts` - `resolveKind()`: a `fs.Dirent` reports a symlink as neither file nor directory,
  so code that only checks `isDirectory()`/`isFile()` silently skips symlinked skills/rules. Used
  by both `skillScanner.ts` and `skillInstaller.ts`'s `generateSkillsIndex` — kept in its own file
  because those two already import from each other and a copy inside either would cycle.
- `src/skillScanner.ts` - Scans directories for skill `.md` files, parses frontmatter
- `src/skillInstaller.ts` - Copies/removes skill folders and rule files, using `platforms.ts` for
  all path decisions; also owns the AGENTS.md I/O wrapper around `agentsMd.ts`
- `renderer/` - Static HTML/CSS + vanilla JS UI, talking to the main process only through
  `window.lazyApi` (platform radios are rendered from data fetched via `getPlatforms()`)
- `src/test/*.test.ts` - `node:test` suite (mirrors `extension/src/test/`, adapted for this tree's
  `frontmatter.ts` — its `error` field, and that nested mappings survive rather than being skipped)

## Build

```bash
npm run compile   # TypeScript -> out/
npm run watch     # Watch mode
npm run test      # Compile + run node:test against out/test/
npm start         # Compile + launch Electron
npm run build:win|mac|linux|all   # electron-builder installers
```

## Conventions

- `contextIsolation: true`, `nodeIntegration: false` — the renderer never touches Node/Electron
  APIs directly, only through `preload.ts`'s `lazyApi`.
- Any path the renderer asks to read (`skills:getBody`) is validated against the configured
  directories first (`assertReadable` in `main.ts`), resolved with `fs.promises.realpath` **per
  top-level entry** rather than per configured root — a configured root can itself contain
  symlinked/junctioned entries, so realpath'ing the root itself and comparing against that would
  reject every entry in it.
- `out/test/**` is excluded from packaged builds (`build.files` in `package.json`) — it's dev-only.
- Skill install target is platform-dependent — see `platforms.ts`'s table, not this file, for the
  authoritative per-platform paths (they drift from any copy kept here).

## Testing

`npm start` launches the app directly for manual testing. `npm test` runs the `node:test` suite —
it covers `platforms.ts`, `agentsMd.ts`, and `frontmatter.ts` directly (all three are Electron-free
and run under plain Node); nothing that touches Electron IPC or `fs/promises` against a real
filesystem is exercised automatically.
