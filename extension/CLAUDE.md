# Lazy Skill AI Agent

VS Code extension to manage AI skills for Claude Code and Antigravity.

## Project Structure

- `src/extension.ts` - Extension entry point
- `src/types.ts` - Shared TypeScript types
- `src/frontmatter.ts` - Dependency-free YAML frontmatter reader (block scalars, wrapped quoted scalars, sequences)
- `src/skillScanner.ts` - Scans directories for skill .md files, parses frontmatter
- `src/skillInstaller.ts` - Copies/removes skill files to/from project `.claude/commands/`
- `src/webviewPanel.ts` - Webview panel controller with HTML generation
- `media/main.js` - Webview frontend logic
- `media/main.css` - Webview styles (VS Code theme-aware)

## Build

```bash
npm run compile   # TypeScript -> out/
npm run watch     # Watch mode
npm run package   # Build .vsix
```

## Conventions

- No external runtime dependencies. Only `@types/vscode` and `typescript` as dev deps.
- Use `vscode.workspace.fs` for all file operations (not Node.js fs).
- Frontmatter parsing lives in `src/frontmatter.ts` — hand-written, no yaml library. It must
  handle block scalars (`>-`, `|`) and quoted scalars that wrap across lines; a naive
  line-by-line `indexOf(':')` reader silently mangles most real skill descriptions.
- Scan results carry no markdown `body`; the webview requests one per item via `getBody`.
- Any path the webview asks to read is validated against the configured directories first,
  using `fs.promises.realpath` — a lexical `path.resolve` check accepts a symlink inside a
  skill directory that points anywhere on disk. This is the sole documented exception to the
  `vscode.workspace.fs` rule above, since that API has no realpath equivalent.
- All styles use `--vscode-*` CSS variables for theme compatibility.
- Target: `{project}/.claude/skills/{skill-name}/` (entire skill directory is copied, preserving markdown + scripts).

## Testing

Press F5 in VS Code to launch Extension Development Host. Run command "Lazy: Open Skill Manager".
