import * as vscode from 'vscode';
import {
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

const CONFIG_NS = 'lazy-skill-ai-agent';

export class LazySkillPanel {
  public static readonly viewType = 'lazySkillManager';
  private static instance: LazySkillPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private disposables: vscode.Disposable[] = [];
  private currentPlatform: TargetPlatform = 'claude-code';
  private skills: SkillInfo[] = [];
  private rules: RuleInfo[] = [];

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
    this.panel.webview.html = this.getHtml();

    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewMessage) => this.handleMessage(msg),
      null,
      this.disposables,
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private dispose(): void {
    LazySkillPanel.instance = undefined;
    this.panel.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
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
    const dirs = this.getDirectories();
    const ruleFiles = this.getRuleFiles();
    const projectPath = this.getProjectPath();

    this.skills = await scanDirectories(dirs);
    this.rules = await scanRuleFiles(ruleFiles);

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
    });
  }

  private async handleMessage(msg: WebviewMessage): Promise<void> {
    const config = vscode.workspace.getConfiguration(CONFIG_NS);

    switch (msg.command) {
      case 'ready':
        await this.refresh();
        break;

      case 'changePlatform':
        this.currentPlatform = msg.platform;
        await this.refresh();
        break;

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

    <section class="platform-section">
      <label class="radio-label">
        <input type="radio" name="platform" value="claude-code" checked>
        Claude Code
      </label>
      <label class="radio-label">
        <input type="radio" name="platform" value="antigravity">
        Antigravity
      </label>
      <label class="radio-label">
        <input type="radio" name="platform" value="cursor">
        Cursor
      </label>
    </section>

    <section class="directories-section">
      <h3>Skill Directories</h3>
      <div id="dir-list"></div>
      <button id="btn-add-dir" class="btn btn-secondary">+ Add Directory</button>
    </section>

    <section class="skills-section">
      <div class="skills-header">
        <h3>Available Skills</h3>
        <input type="text" id="filter-input" placeholder="Filter skills..." />
      </div>
      <div id="skill-list" class="skill-list"></div>
    </section>

    <section class="directories-section">
      <h3>Rule Files</h3>
      <div id="rule-file-list"></div>
      <button id="btn-add-rule-file" class="btn btn-secondary">+ Add Rule File</button>
    </section>

    <section class="skills-section">
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
