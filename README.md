# Lazy Skill AI Agent

A tool to manage AI skills for **Claude Code** and **Antigravity**. Browse skills from multiple source directories and add/remove them from your project through a visual interface.

![Lazy Skill Manager screenshot](Resource/image.png)

Two versions are available:

- **[extension/](extension/)** — VS Code extension ([Install from Marketplace](https://marketplace.visualstudio.com/items?itemName=dn9uy3n.lazy-skill-ai-agent))
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

When applied, the **entire skill folder** (markdown, scripts, helpers — everything) is copied into the workspace skills directory of the selected platform:

| Platform | Workspace Skills Folder |
|----------|--------------------------|
| **Claude Code** | `{project}/.claude/skills/{skill-name}/` |
| **Antigravity** | `{project}/.agent/skills/{skill-name}/` |

The platform toggle at the top of the UI controls which folder is read from / written to. Switching platforms updates the install state of each skill in the list accordingly.

---

## Version 1: VS Code Extension

### Install from Marketplace (easiest)

Open VS Code / Antigravity → Extensions tab → search **"Lazy Skill AI Agent"**, or visit:

👉 https://marketplace.visualstudio.com/items?itemName=dn9uy3n.lazy-skill-ai-agent

Or install from CLI:

```bash
code --install-extension dn9uy3n.lazy-skill-ai-agent
```

#### 🪐 Using Antigravity? Enable the Microsoft Marketplace first

Antigravity does not ship with the Microsoft VS Code Marketplace enabled by default. To install any extension from the Microsoft Marketplace (including this one), add the following entries to your Antigravity `settings.json`:

```json
{
  "extensions.gallery.serviceUrl": "https://marketplace.visualstudio.com/_apis/public/gallery",
  "extensions.gallery.itemUrl": "https://marketplace.visualstudio.com/items"
}
```

**How to open `settings.json`:**

1. `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS)
2. Type: **Preferences: Open User Settings (JSON)**
3. Add the two lines above, save, and **restart Antigravity**

After restart, open the Extensions tab and search for **"Lazy Skill AI Agent"** — the extension will now appear and can be installed like on regular VS Code.

> ⚠️ Per Microsoft's marketplace terms, only Microsoft products (VS Code, Azure Data Studio, etc.) are officially allowed to use this gallery. Use at your own discretion.

### Build & Install from source

```bash
cd extension
npm install
npm run compile
npm run package       # Produces a .vsix file
```

Install into VS Code:
```bash
code --install-extension lazy-skill-ai-agent-0.1.0.vsix
```

Or via UI: **Extensions tab → `...` menu → Install from VSIX...**

For Antigravity:
```bash
antigravity --install-extension lazy-skill-ai-agent-0.1.0.vsix
```

### Development Mode

Open the project in VS Code → press `F5` → select the **"Run Extension"** launch config.

### Usage

`Ctrl+Shift+P` → **Lazy: Open Skill Manager**

---

## Version 2: Desktop Application

A standalone Electron app for Windows, macOS, and Linux.

### Download prebuilt binaries

Get the latest installer from the [GitHub Releases](../../releases) page:

| OS | File |
|----|------|
| Windows | `Lazy Skill AI Agent Setup X.Y.Z.exe` |
| Linux | `lazy-skill-ai-agent-app-X.Y.Z.tar.gz` |

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
| Windows | `%APPDATA%\Lazy Skill AI Agent\config.json` |
| macOS | `~/Library/Application Support/Lazy Skill AI Agent/config.json` |
| Linux | `~/.config/Lazy Skill AI Agent/config.json` |

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
lazy-skill-ai-agent/
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
