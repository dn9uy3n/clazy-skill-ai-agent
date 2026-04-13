# Clazy Skill AI Agent

A tool to manage AI skills for **Claude Code** and **Antigravity**. Browse skills from multiple source directories and add/remove them from your project through a visual interface.

Two versions are available:

- **[extension/](extension/)** — VS Code extension (runs inside VS Code / Antigravity)
- **[app/](app/)** — Desktop application (standalone, runs on Windows / macOS / Linux)

## Skill Directory Structure

Both versions share the same skill directory convention:

```
my-skills/
├── commit/
│   └── SKILL.md
├── code-review/
│   └── code-review.md
└── feature-dev/
    └── SKILL.md
```

Each subdirectory is one skill. The `.md` file supports optional frontmatter:

```markdown
---
name: commit
description: Auto-generate commit messages
---

# Content...
```

File lookup priority: `SKILL.md` → `{dir-name}.md` → first `.md` file.

When applied, each skill is copied to `{project}/.claude/commands/{skill-name}.md`.

---

## Version 1: VS Code Extension

### Build & Install

```bash
cd extension
npm install
npm run compile
npm run package       # Produces a .vsix file
```

Install into VS Code:
```bash
code --install-extension clazy-skill-ai-agent-0.1.0.vsix
```

Or via UI: **Extensions tab → `...` menu → Install from VSIX...**

For Antigravity:
```bash
antigravity --install-extension clazy-skill-ai-agent-0.1.0.vsix
```

### Development Mode

Open the project in VS Code → press `F5` → select the **"Run Extension"** launch config.

### Usage

`Ctrl+Shift+P` → **Clazy: Open Skill Manager**

---

## Version 2: Desktop Application

A standalone Electron app for Windows, macOS, and Linux.

### Download prebuilt binaries

Get the latest installer from the [GitHub Releases](../../releases) page:

| OS | File |
|----|------|
| Windows | `Clazy Skill AI Agent Setup X.Y.Z.exe` |
| macOS | `Clazy Skill AI Agent-X.Y.Z.dmg` |
| Linux | `clazy-skill-ai-agent-app-X.Y.Z.tar.gz` |

### Run in Development Mode

```bash
cd app
npm install
npm start
```

### Build Installers

```bash
cd app

# Windows (.exe installer)
npm run build:win

# macOS (.dmg)
npm run build:mac

# Linux (AppImage + .deb)
npm run build:linux

# All platforms
npm run build:all
```

Installers are placed in `app/dist/`.

### Config File Location

| OS | Path |
|----|------|
| Windows | `%APPDATA%\Clazy Skill AI Agent\config.json` |
| macOS | `~/Library/Application Support/Clazy Skill AI Agent/config.json` |
| Linux | `~/.config/Clazy Skill AI Agent/config.json` |

### Usage

1. Launch the app
2. Click **Browse...** to select your project folder
3. Click **+ Add Directory** to add a directory containing skills
4. Check the skills you want to include in the project
5. Click **Apply**

---

## Version Comparison

| Feature | Extension | Desktop App |
|---------|-----------|-------------|
| Platform | VS Code / Antigravity | Windows / macOS / Linux |
| Standalone | No | Yes |
| Project path | Current workspace folder | Selected manually |
| Size | ~50KB | ~100MB (Electron) |
| Requires VS Code | Yes | No |

---

## Repository Layout

```
clazy-skill-ai-agent/
├── extension/           # VS Code extension
│   ├── src/
│   ├── media/
│   └── package.json
├── app/                 # Electron desktop app
│   ├── src/             # Main + preload process
│   ├── renderer/        # UI (HTML/CSS/JS)
│   └── package.json
├── .vscode/             # Debug configs for both
└── README.md
```

## Requirements

- Node.js >= 18
- npm >= 9
- VS Code >= 1.85 (for the extension)

## License

MIT
