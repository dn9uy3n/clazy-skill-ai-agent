import * as vscode from 'vscode';
import { SkillInfo, TargetPlatform, WebviewMessage, ExtensionMessage } from './types';
import { scanDirectories, getInstalledSkillNames, markInstalled } from './skillScanner';
import { applyChanges } from './skillInstaller';

export class LazySkillPanel {
  public static readonly viewType = 'lazySkillManager';
  private static instance: LazySkillPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private disposables: vscode.Disposable[] = [];
  private currentPlatform: TargetPlatform = 'claude-code';
  private skills: SkillInfo[] = [];

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
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }

  private getProjectPath(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  private getDirectories(): string[] {
    const config = vscode.workspace.getConfiguration('lazy-skill-ai-agent');
    return config.get<string[]>('skillDirectories', []);
  }

  private async refresh(): Promise<void> {
    const dirs = this.getDirectories();
    const projectPath = this.getProjectPath();

    this.skills = await scanDirectories(dirs);

    if (projectPath) {
      const installed = await getInstalledSkillNames(projectPath, this.currentPlatform);
      this.skills = markInstalled(this.skills, installed);
    }

    this.postMessage({
      command: 'update',
      skills: this.skills,
      directories: dirs,
      platform: this.currentPlatform,
    });
  }

  private async handleMessage(msg: WebviewMessage): Promise<void> {
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
            const config = vscode.workspace.getConfiguration('lazy-skill-ai-agent');
            await config.update('skillDirectories', dirs, vscode.ConfigurationTarget.Global);
          }
          await this.refresh();
        }
        break;
      }

      case 'removeDirectory': {
        const dirs = this.getDirectories().filter(d => d !== msg.directory);
        const config = vscode.workspace.getConfiguration('lazy-skill-ai-agent');
        await config.update('skillDirectories', dirs, vscode.ConfigurationTarget.Global);
        await this.refresh();
        break;
      }

      case 'apply': {
        const projectPath = this.getProjectPath();
        if (!projectPath) {
          vscode.window.showErrorMessage('No workspace folder open.');
          return;
        }

        const selectedIds = new Set(msg.skillIds);
        const result = await applyChanges(this.skills, selectedIds, projectPath, this.currentPlatform);

        this.postMessage({
          command: 'applyResult',
          installed: result.installed,
          removed: result.removed,
          errors: result.errors,
        });

        if (result.errors.length > 0) {
          vscode.window.showWarningMessage(`Applied with errors: ${result.errors.join('; ')}`);
        } else {
          vscode.window.showInformationMessage(
            `Skills updated: ${result.installed} installed, ${result.removed} removed.`,
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

    <section class="description-section">
      <h3>Description</h3>
      <div id="skill-description" class="description-box">Select a skill to see its description.</div>
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
