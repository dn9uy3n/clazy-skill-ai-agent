import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { loadConfig, saveConfig } from './config';
import {
  scanDirectories,
  scanRuleFiles,
  getInstalledSkillNames,
  getInstalledRuleNames,
  markInstalled,
  markRulesInstalled,
} from './skillScanner';
import { readBody } from './frontmatter';
import { applyChanges } from './skillInstaller';
import { ScanResult, TargetPlatform } from './types';
import { platformUiList } from './platforms';

/** Dropbox and editors write in bursts; collapse them into one re-scan. */
const WATCH_DEBOUNCE_MS = 800;

let mainWindow: BrowserWindow | null = null;
let watchers: fs.FSWatcher[] = [];
let watchTimer: NodeJS.Timeout | null = null;

function closeWatchers(): void {
  for (const watcher of watchers) {
    try {
      watcher.close();
    } catch {
      // already closed
    }
  }
  watchers = [];
  if (watchTimer) {
    clearTimeout(watchTimer);
    watchTimer = null;
  }
}

function notifyChanged(): void {
  if (watchTimer) clearTimeout(watchTimer);
  watchTimer = setTimeout(() => {
    watchTimer = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('skills:changed');
    }
  }, WATCH_DEBOUNCE_MS);
}

function setWatchedDirs(dirs: string[]): void {
  closeWatchers();
  for (const dir of dirs) {
    try {
      // Non-recursive on purpose: a synced folder generates a lot of noise from
      // files inside skills, and adding/removing a skill shows up at this level.
      const watcher = fs.watch(dir, { recursive: false }, () => notifyChanged());
      watcher.on('error', () => {
        /* directory went away; the next scan reports it */
      });
      watchers.push(watcher);
    } catch {
      // unreadable directory — the scan surfaces the error instead
    }
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 950,
    height: 850,
    title: 'Lazy Skill AI Agent',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.setMenuBarVisibility(false);

  mainWindow.on('closed', () => {
    closeWatchers();
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  closeWatchers();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('config:load', async () => loadConfig());
ipcMain.handle('config:save', async (_e, config) => saveConfig(config));
ipcMain.handle('platforms:list', async () => platformUiList());

ipcMain.handle('watch:setDirs', async (_e, dirs: string[]) => setWatchedDirs(dirs ?? []));

ipcMain.handle('dialog:selectDirectory', async (_e, title: string) => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
    title,
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('dialog:selectFiles', async (_e, title: string) => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile', 'multiSelections'],
    title,
    filters: [
      { name: 'Rule files', extensions: ['md', 'mdc', 'txt'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  return result.canceled ? [] : result.filePaths;
});

/**
 * Scan results carry no markdown bodies — the renderer asks for one only when
 * the user selects an item.
 */
async function scan(
  skillDirs: string[],
  ruleFiles: string[],
  projectPath: string | undefined,
  platform: TargetPlatform,
): Promise<ScanResult> {
  const skillScan = await scanDirectories(skillDirs);
  const ruleScan = await scanRuleFiles(ruleFiles);

  let skills = skillScan.skills;
  let rules = ruleScan.rules;

  if (projectPath) {
    skills = markInstalled(skills, await getInstalledSkillNames(projectPath, platform));
    rules = markRulesInstalled(rules, await getInstalledRuleNames(projectPath, platform));
  }

  return {
    skills,
    rules,
    dirStats: skillScan.dirStats,
    errors: [...skillScan.errors, ...ruleScan.errors],
  };
}

ipcMain.handle(
  'skills:scan',
  async (
    _e,
    skillDirs: string[],
    ruleFiles: string[],
    projectPath: string | undefined,
    platform: TargetPlatform,
  ): Promise<ScanResult> => scan(skillDirs, ruleFiles, projectPath, platform),
);

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

/**
 * The renderer may only read documents that live under a configured skill
 * directory or that are a configured rule file — never an arbitrary path.
 * Paths are resolved first so `..` segments and symlinks can't step outside.
 *
 * A configured directory's *entries* can themselves be symlinks/junctions —
 * e.g. a `.zcode/skills/foo` folder pointed at a shared `~/.agents/skills/foo`
 * is a normal setup — so the root itself must not be the thing realpath'd
 * and compared against: that would resolve straight through to
 * `~/.agents/skills` and reject every skill under the directory. Instead
 * each top-level entry under a configured root is resolved individually,
 * and the requested path must land inside *that* entry's real location. A
 * symlink nested *inside* a skill folder still resolves outside its entry's
 * real location and is still rejected.
 */
async function assertReadable(sourcePath: string): Promise<string> {
  const config = await loadConfig();
  const target = await realPathOrNull(sourcePath);
  if (!target) throw new Error(`Cannot read ${sourcePath}`);
  const normTarget = normalizePath(target);

  for (const dir of config.skillDirectories) {
    const normDir = normalizePath(path.resolve(dir));
    const normSource = normalizePath(path.resolve(sourcePath));
    if (normSource !== normDir && !normSource.startsWith(normDir + path.sep)) continue;

    const entryName = path.relative(dir, sourcePath).split(path.sep)[0];
    if (!entryName || entryName === '..') continue;

    const entryReal = await realPathOrNull(path.join(dir, entryName));
    if (!entryReal) continue;
    const normEntry = normalizePath(entryReal);
    if (normTarget === normEntry || normTarget.startsWith(normEntry + path.sep)) return target;
  }

  const files = await Promise.all(config.ruleFiles.map(realPathOrNull));
  const isRuleFile = files.some(file => file && normalizePath(file) === normTarget);
  if (isRuleFile) return target;

  throw new Error('Access denied: path is outside the configured skill directories');
}

ipcMain.handle('skills:getBody', async (_e, sourcePath: string): Promise<string> =>
  readBody(await assertReadable(sourcePath)),
);

/**
 * Apply takes only the selected ids and re-scans here, so a large skill set never
 * crosses the IPC boundary and the install can't act on a stale renderer snapshot.
 */
ipcMain.handle(
  'skills:apply',
  async (
    _e,
    skillDirs: string[],
    ruleFiles: string[],
    selectedSkillIds: string[],
    selectedRuleIds: string[],
    projectPath: string,
    platform: TargetPlatform,
  ) => {
    const { skills, rules } = await scan(skillDirs, ruleFiles, projectPath, platform);
    return applyChanges(
      skills,
      new Set(selectedSkillIds),
      rules,
      new Set(selectedRuleIds),
      projectPath,
      platform,
    );
  },
);
