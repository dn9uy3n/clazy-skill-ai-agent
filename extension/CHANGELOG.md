# Changelog

All notable changes to the "Lazy Skill AI Agent" extension are documented here.

## [0.8.0]

### Added

- **ZCode (z.ai) support** as a fourth target platform. Skills install to `{project}/.zcode/skills/{skill-name}/`. ZCode has no rules folder, so a checked rule is instead merged into a managed block inside `{project}/AGENTS.md` — see the README's "Rules on ZCode" section.
- Non-blocking warnings on Apply when a skill would be dropped or misread by the target tool: missing frontmatter `name`/`description`, a `description` over 1024 characters (ZCode's own limit), or a same-named skill that could be shadowed by a user-scope install.
- The platform toggle is now **persisted** (`lazy-skill-ai-agent.targetPlatform`, workspace-scoped) instead of resetting to Claude Code every time the panel is opened.
- Platform radios are now rendered from data (`platforms.ts`) instead of hardcoded HTML, so future targets are a registry entry rather than an edit in three files.
- A minimal `node:test` suite covering the platform registry, the AGENTS.md merge logic, and the frontmatter parser.

### Fixed

- Skills and rules that are symlinks or Windows junctions (e.g. a shared `~/.agents/skills/foo` linked into a project) were silently skipped by every scan, because `vscode.workspace.fs`'s `FileType` is a bitmask and the code compared it with `===` instead of testing the bit. This also affected the webview's read-access check, which additionally mis-resolved a configured directory that itself contained symlinked entries.
- Installing over an existing symlinked skill folder could delete through the link into whatever it pointed at; it's now detected and replaced with a real copy instead, with a warning.

## [0.7.1]

- Fixed a path-traversal-adjacent read-access bug: the webview's file-read gate compared paths lexically, so a symlink inside a configured skill directory could point outside it and still be read. It now resolves with `fs.promises.realpath` first.

## [0.7.0]

- Rewrote the frontmatter parser: the previous line-by-line reader mis-parsed multi-line block scalars (`>-`, `|`) and quoted values that wrapped across lines, so the skill list could go stale or show mangled descriptions. The new parser is still hand-written and dependency-free but correctly handles block scalars, wrapped quoted scalars, and flow/block sequences.

## [0.6.0]

- Added a logo, `LICENSE`, and `repository` field to `package.json`.

## [0.5.0]

- Version bump; see git history for details predating this changelog.

## [0.4.0]

- Added **Cursor** as a target platform.
- Added **rule files** (`.md`/`.mdc`/`.txt`) as a first-class, separate concept from skills — single files copied into a per-platform rules directory rather than whole skill folders.

## [0.3.0] / [0.2.0]

- Early iterations; see git history predating this changelog.

## [0.1.0]

- Initial release: manage AI skills for Claude Code and Antigravity from a VS Code webview panel.
