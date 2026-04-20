import { app, BrowserWindow, ipcMain, dialog } from 'electron';
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
import { applyChanges } from './skillInstaller';
import { RuleInfo, SkillInfo, TargetPlatform } from './types';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 950,
    height: 850,
    title: 'Lazy Skill AI Agent',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.setMenuBarVisibility(false);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('config:load', async () => loadConfig());
ipcMain.handle('config:save', async (_e, config) => saveConfig(config));

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

ipcMain.handle(
  'skills:scan',
  async (
    _e,
    skillDirs: string[],
    ruleFiles: string[],
    projectPath: string | undefined,
    platform: TargetPlatform,
  ): Promise<{ skills: SkillInfo[]; rules: RuleInfo[] }> => {
    let skills = await scanDirectories(skillDirs);
    let rules = await scanRuleFiles(ruleFiles);
    if (projectPath) {
      skills = markInstalled(skills, await getInstalledSkillNames(projectPath, platform));
      rules = markRulesInstalled(rules, await getInstalledRuleNames(projectPath, platform));
    }
    return { skills, rules };
  },
);

ipcMain.handle(
  'skills:apply',
  async (
    _e,
    allSkills: SkillInfo[],
    selectedSkillIds: string[],
    allRules: RuleInfo[],
    selectedRuleIds: string[],
    projectPath: string,
    platform: TargetPlatform,
  ) => {
    return await applyChanges(
      allSkills,
      new Set(selectedSkillIds),
      allRules,
      new Set(selectedRuleIds),
      projectPath,
      platform,
    );
  },
);
