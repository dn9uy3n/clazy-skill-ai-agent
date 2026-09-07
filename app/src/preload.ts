import { contextBridge, ipcRenderer } from 'electron';
import { AppConfig, PlatformMeta, ScanResult, TargetPlatform } from './types';

const api = {
  loadConfig: (): Promise<AppConfig> => ipcRenderer.invoke('config:load'),
  saveConfig: (config: AppConfig): Promise<void> => ipcRenderer.invoke('config:save', config),
  getPlatforms: (): Promise<PlatformMeta[]> => ipcRenderer.invoke('platforms:list'),
  selectDirectory: (title: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:selectDirectory', title),
  selectFiles: (title: string): Promise<string[]> => ipcRenderer.invoke('dialog:selectFiles', title),
  scanSkills: (
    skillDirs: string[],
    ruleFiles: string[],
    projectPath: string | undefined,
    platform: TargetPlatform,
  ): Promise<ScanResult> =>
    ipcRenderer.invoke('skills:scan', skillDirs, ruleFiles, projectPath, platform),
  /** Markdown bodies are fetched per item so the scan payload stays small. */
  getBody: (sourcePath: string): Promise<string> => ipcRenderer.invoke('skills:getBody', sourcePath),
  /** Watch the configured skill directories and re-notify on change. */
  watchDirs: (dirs: string[]): Promise<void> => ipcRenderer.invoke('watch:setDirs', dirs),
  onSkillsChanged: (callback: () => void): void => {
    ipcRenderer.on('skills:changed', () => callback());
  },
  applyChanges: (
    skillDirs: string[],
    ruleFiles: string[],
    selectedSkillIds: string[],
    selectedRuleIds: string[],
    projectPath: string,
    platform: TargetPlatform,
  ): Promise<{
    skillsInstalled: number;
    skillsRemoved: number;
    rulesInstalled: number;
    rulesRemoved: number;
    errors: string[];
  }> =>
    ipcRenderer.invoke(
      'skills:apply',
      skillDirs,
      ruleFiles,
      selectedSkillIds,
      selectedRuleIds,
      projectPath,
      platform,
    ),
};

contextBridge.exposeInMainWorld('lazyApi', api);

export type LazyApi = typeof api;
