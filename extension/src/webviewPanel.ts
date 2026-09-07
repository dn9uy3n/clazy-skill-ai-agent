import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
  DirStat,
  ExtensionMessage,
  RuleInfo,
  SkillInfo,
  TargetPlatform,
  WebviewMessage,
} from './types';
import {
  scanDirectories,
  scanRuleFiles,
  getInstalledSkillNames,
  getInstalledRuleNames,
  markInstalled,
  markRulesInstalled,
} from './skillScanner';
import { applyChanges } from './skillInstaller';
import { readBody } from './docReader';
import { DEFAULT_PLATFORM, isTargetPlatform, platformUiList } from './platforms';

const CONFIG_NS = 'lazy-skill-ai-agent';

/** Sync clients and editors write in bursts; collapse them into one re-scan. */
const WATCH_DEBOUNCE_MS = 800;

/** Windows paths compare case-insensitively; POSIX paths do not. */
function normalizePath(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

async function realPathOrNull(p: string): Promise<string | null> {
  try {
    return await fs.promises.realpath(p);
  } catch {
    return null;
  }
}

export class LazySkillPanel {
  public static readonly viewType = 'lazySkillManager';
  private static instance: LazySkillPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private disposables: vscode.Disposable[] = [];
  private watchers: vscode.Disposable[] = [];
  private watchedDirs: string[] = [];
  private watchTimer: NodeJS.Timeout | undefined;
  private currentPlatform: TargetPlatform = DEFAULT_PLATFORM;
  private skills: SkillInfo[] = [];
  private rules: RuleInfo[] = [];
  private scanning = false;
  private rescanQueued = false;

  public static createOrShow(extensionUri: vscode.Uri): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (LazySkillPanel.instance) {
      LazySkillPanel.instance.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      LazySkillPanel.viewType,
      'Lazy Skill Manager',
      column,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
        retainContextWhenHidden: true,
      },
    );

    LazySkillPanel.instance = new LazySkillPanel(panel, extensionUri);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;

    const storedPlatform = vscode.workspace
      .getConfiguration(CONFIG_NS)
      .get<string>('targetPlatform');
    if (isTargetPlatform(storedPlatform)) this.currentPlatform = storedPlatform;

    this.panel.webview.html = this.getHtml();

    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewMessage) => this.handleMessage(msg),
      null,
      this.disposables,
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // Re-scan when the panel is brought back into view, so a skill added while
    // the tab sat in the background is never missing from the list.
    this.panel.onDidChangeViewState(
      e => {
        if (e.webviewPanel.visible) void this.refresh();
      },
      null,
      this.disposables,
    );

    // Editing lazy-skill-ai-agent.* directly in settings.json (or a sync from
    // another window) should be reflected without the user having to reopen
    // the panel.
    vscode.workspace.onDidChangeConfiguration(
      e => {
        if (e.affectsConfiguration(CONFIG_NS)) void this.refresh();
      },
      null,
      this.disposables,
    );
  }

  private dispose(): void {
    LazySkillPanel.instance = undefined;
    this.clearWatchers();
    this.panel.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  private clearWatchers(): void {
    for (const w of this.watchers) w.dispose();
    this.watchers = [];
    this.watchedDirs = [];
    if (this.watchTimer) {
      clearTimeout(this.watchTimer);
      this.watchTimer = undefined;
    }
  }

  /**
   * Watch each configured skill directory so adding or removing a skill on disk
   * shows up without reopening the panel. Watching the directory itself (rather
   * than a recursive glob) keeps a synced folder from firing on every file.
   */
  private setWatchedDirs(dirs: string[]): void {
    const unchanged =
      dirs.length === this.watchedDirs.length && dirs.every((d, i) => d === this.watchedDirs[i]);
    if (unchanged) return;

    this.clearWatchers();
    this.watchedDirs = [...dirs];

    for (const dir of dirs) {
      try {
        const watcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(vscode.Uri.file(dir), '*'),
        );
        const onChange = () => this.scheduleRescan();
        watcher.onDidCreate(onChange, null, this.disposables);
        watcher.onDidDelete(onChange, null, this.disposables);
        watcher.onDidChange(onChange, null, this.disposables);
        this.watchers.push(watcher);
      } catch {
        // unwatchable path — the scan reports the directory error instead
      }
    }
  }

  private scheduleRescan(): void {
    if (this.watchTimer) clearTimeout(this.watchTimer);
    this.watchTimer = setTimeout(() => {
      this.watchTimer = undefined;
      void this.refresh();
    }, WATCH_DEBOUNCE_MS);
  }

  private getProjectPath(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  private getDirectories(): string[] {
    return vscode.workspace.getConfiguration(CONFIG_NS).get<string[]>('skillDirectories', []);
  }

  private getRuleFiles(): string[] {
    return vscode.workspace.getConfiguration(CONFIG_NS).get<string[]>('ruleFiles', []);
  }

  private async refresh(): Promise<void> {
    if (this.scanning) {
      this.rescanQueued = true;
      return;
    }
    this.scanning = true;

    try {
      const dirs = this.getDirectories();
      const ruleFiles = this.getRuleFiles();
      const projectPath = this.getProjectPath();

      this.setWatchedDirs(dirs);
      this.postMessage({ command: 'scanning' });

      const skillScan = await scanDirectories(dirs);
      const ruleScan = await scanRuleFiles(ruleFiles);

      this.skills = skillScan.skills;
      this.rules = ruleScan.rules;

      if (projectPath) {
        const installedSkills = await getInstalledSkillNames(projectPath, this.currentPlatform);
        this.skills = markInstalled(this.skills, installedSkills);
        const installedRules = await getInstalledRuleNames(projectPath, this.currentPlatform);
        this.rules = markRulesInstalled(this.rules, installedRules);
      }

      this.postMessage({
        command: 'update',
        skills: this.skills,
        rules: this.rules,
        directories: dirs,
        ruleFiles,
        platform: this.currentPlatform,
        platforms: platformUiList(),
        dirStats: skillScan.dirStats as DirStat[],
        errors: [...skillScan.errors, ...ruleScan.errors],
      });
    } finally {
      this.scanning = false;
      if (this.rescanQueued) {
        this.rescanQueued = false;
        void this.refresh();
      }
    }
  }

  /**
   * Only documents under a configured skill directory (or a configured rule
   * file) may be read, so a webview message can't turn into an arbitrary file
   * read.
   *
   * Paths are resolved with realpath, not lexically: a lexical check accepts
   * `<skillDir>/link` even when `link` is a symlink pointing anywhere on disk.
   * This is the one place Node's `fs` is used instead of `vscode.workspace.fs`,
   * which has no realpath equivalent.
   *
   * A configured directory's *entries* can themselves be symlinks/junctions —
   * e.g. a `.zcode/skills/foo` folder pointed at a shared `~/.agents/skills/foo`
   * is a normal setup — so the root itself must not be the thing realpath'd
   * and compared against: that would resolve straight through to
   * `~/.agents/skills` and reject every skill under the directory. Instead
   * each top-level entry under a configured root is resolved individually,
   * and the requested path must land inside *that* entry's real location. A
   * symlink nested *inside* a skill folder still resolves outside its
   * entry's real location and is still rejected.
   */
  private async isReadable(sourcePath: string): Promise<boolean> {
    const target = await realPathOrNull(sourcePath);
    if (!target) return false;
    const normTarget = normalizePath(target);

    for (const dir of this.getDirectories()) {
      const normDir = normalizePath(path.resolve(dir));
      const normSource = normalizePath(path.resolve(sourcePath));
      if (normSource !== normDir && !normSource.startsWith(normDir + path.sep)) continue;

      const entryName = path.relative(dir, sourcePath).split(path.sep)[0];
      if (!entryName || entryName === '..') continue;

      const entryReal = await realPathOrNull(path.join(dir, entryName));
      if (!entryReal) continue;
      const normEntry = normalizePath(entryReal);
      if (normTarget === normEntry || normTarget.startsWith(normEntry + path.sep)) return true;
    }

    const files = await Promise.all(this.getRuleFiles().map(realPathOrNull));
    return files.some(file => file !== null && normalizePath(file) === normTarget);
  }

  private async handleMessage(msg: WebviewMessage): Promise<void> {
    const config = vscode.workspace.getConfiguration(CONFIG_NS);

    switch (msg.command) {
      case 'ready':
      case 'refresh':
        await this.refresh();
        break;

      case 'getBody': {
        if (!(await this.isReadable(msg.sourcePath))) {
          this.postMessage({
            command: 'body',
            id: msg.id,
            body: '(access denied: path is outside the configured skill directories)',
          });
          break;
        }
        try {
          this.postMessage({ command: 'body', id: msg.id, body: await readBody(msg.sourcePath) });
        } catch (e) {
          this.postMessage({ command: 'body', id: msg.id, body: `(could not read file: ${e})` });
        }
        break;
      }

      case 'changePlatform': {
        // The webview is a trust boundary — WebviewMessage's type is only a
        // compile-time guarantee, so validate before trusting the payload.
        if (!isTargetPlatform(msg.platform)) break;
        this.currentPlatform = msg.platform;
        // Workspace-scoped, since which tool a project targets is a property
        // of the project, not a personal preference (unlike skillDirectories).
        // ConfigurationTarget.Workspace throws with no folder open, so fall
        // back to Global there.
        const target = vscode.workspace.workspaceFolders?.length
          ? vscode.ConfigurationTarget.Workspace
          : vscode.ConfigurationTarget.Global;
        await config.update('targetPlatform', msg.platform, target);
        await this.refresh();
        break;
      }

      case 'addDirectory': {
        const uris = await vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: false,
          canSelectMany: false,
          openLabel: 'Select Skill Directory',
        });
        if (uris && uris.length > 0) {
          const dirs = this.getDirectories();
          const newDir = uris[0].fsPath;
          if (!dirs.includes(newDir)) {
            dirs.push(newDir);
            await config.update('skillDirectories', dirs, vscode.ConfigurationTarget.Global);
          }
          await this.refresh();
        }
        break;
      }

      case 'removeDirectory': {
        const dirs = this.getDirectories().filter(d => d !== msg.directory);
        await config.update('skillDirectories', dirs, vscode.ConfigurationTarget.Global);
        await this.refresh();
        break;
      }

      case 'addRuleFile': {
        const uris = await vscode.window.showOpenDialog({
          canSelectFolders: false,
          canSelectFiles: true,
          canSelectMany: true,
          openLabel: 'Select Rule File(s)',
          filters: { 'Rule files': ['md', 'mdc', 'txt'], 'All files': ['*'] },
        });
        if (uris && uris.length > 0) {
          const existing = this.getRuleFiles();
          const merged = [...existing];
          for (const uri of uris) {
            if (!merged.includes(uri.fsPath)) merged.push(uri.fsPath);
          }
          await config.update('ruleFiles', merged, vscode.ConfigurationTarget.Global);
          await this.refresh();
        }
        break;
      }

      case 'removeRuleFile': {
        const files = this.getRuleFiles().filter(f => f !== msg.file);
        await config.update('ruleFiles', files, vscode.ConfigurationTarget.Global);
        await this.refresh();
        break;
      }

      case 'apply': {
        const projectPath = this.getProjectPath();
        if (!projectPath) {
          vscode.window.showErrorMessage('No workspace folder open.');
          return;
        }

        const result = await applyChanges(
          this.skills,
          new Set(msg.skillIds),
          this.rules,
          new Set(msg.ruleIds),
          projectPath,
          this.currentPlatform,
        );

        this.postMessage({
          command: 'applyResult',
          skillsInstalled: result.skillsInstalled,
          skillsRemoved: result.skillsRemoved,
          rulesInstalled: result.rulesInstalled,
          rulesRemoved: result.rulesRemoved,
          errors: result.errors,
        });

        if (result.errors.length > 0) {
          vscode.window.showWarningMessage(`Applied with errors: ${result.errors.join('; ')}`);
        } else {
          vscode.window.showInformationMessage(
            `Skills: +${result.skillsInstalled}/-${result.skillsRemoved} · Rules: +${result.rulesInstalled}/-${result.rulesRemoved}`,
          );
        }

        await this.refresh();
        break;
      }
    }
  }

  private postMessage(msg: ExtensionMessage): void {
    this.panel.webview.postMessage(msg);
  }

  private getHtml(): string {
    const webview = this.panel.webview;
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'main.css'));
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'main.js'));
    const nonce = getNonce();

    return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${cssUri}" rel="stylesheet">
  <title>Lazy Skill Manager</title>
</head>
<body>
  <div class="container">
    <h2>Lazy Skill AI Agent</h2>

    <section class="platform-section" id="platform-list"></section>
    <div id="platform-note" class="platform-note"></div>

    <section class="directories-section">
      <h3>Skill Directories</h3>
      <div id="dir-list"></div>
      <button id="btn-add-dir" class="btn btn-secondary">+ Add Directory</button>
    </section>

    <section class="skills-section">
      <div class="skills-header">
        <h3>Available Skills</h3>
        <input type="text" id="filter-input" placeholder="Filter skills..." />
        <button id="btn-refresh" class="btn btn-secondary" title="Re-scan skill directories">Refresh</button>
      </div>
      <div id="status-msg" class="status-msg"></div>
      <div id="skill-list" class="skill-list"></div>
    </section>

    <section class="directories-section" id="rule-files-section">
      <h3>Rule Files</h3>
      <div id="rule-file-list"></div>
      <button id="btn-add-rule-file" class="btn btn-secondary">+ Add Rule File</button>
    </section>

    <section class="skills-section" id="rules-section">
      <div class="skills-header">
        <h3>Available Rules</h3>
        <input type="text" id="rule-filter-input" placeholder="Filter rules..." />
      </div>
      <div id="rule-list" class="skill-list"></div>
    </section>

    <section class="description-section">
      <h3>Description</h3>
      <div id="skill-description" class="description-box">Select an item to see its description.</div>
    </section>

    <section class="actions-section">
      <button id="btn-cancel" class="btn btn-secondary">Cancel</button>
      <button id="btn-apply" class="btn btn-primary">Apply</button>
    </section>
  </div>

  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
