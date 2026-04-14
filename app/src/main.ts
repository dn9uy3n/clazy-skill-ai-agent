import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import { loadConfig, saveConfig } from './config';
import { scanDirectories, getInstalledSkillNames, markInstalled } from './skillScanner';
import { applyChanges } from './skillInstaller';
import { SkillInfo, TargetPlatform } from './types';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 750,
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

// --- IPC Handlers ---

ipcMain.handle('config:load', async () => {
  return await loadConfig();
});

ipcMain.handle('config:save', async (_e, config) => {
  await saveConfig(config);
});

ipcMain.handle('dialog:selectDirectory', async (_e, title: string) => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
    title,
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle(
  'skills:scan',
  async (
    _e,
    dirs: string[],
    projectPath: string | undefined,
    platform: TargetPlatform,
  ): Promise<SkillInfo[]> => {
    let skills = await scanDirectories(dirs);
    if (projectPath) {
      const installed = await getInstalledSkillNames(projectPath, platform);
      skills = markInstalled(skills, installed);
    }
    return skills;
  },
);

ipcMain.handle(
  'skills:apply',
  async (
    _e,
    allSkills: SkillInfo[],
    selectedIds: string[],
    projectPath: string,
    platform: TargetPlatform,
  ) => {
    return await applyChanges(allSkills, new Set(selectedIds), projectPath, platform);
  },
);
