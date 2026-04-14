import { contextBridge, ipcRenderer } from 'electron';
import { AppConfig, SkillInfo, TargetPlatform } from './types';

const api = {
  loadConfig: (): Promise<AppConfig> => ipcRenderer.invoke('config:load'),
  saveConfig: (config: AppConfig): Promise<void> => ipcRenderer.invoke('config:save', config),
  selectDirectory: (title: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:selectDirectory', title),
  scanSkills: (
    dirs: string[],
    projectPath: string | undefined,
    platform: TargetPlatform,
  ): Promise<SkillInfo[]> => ipcRenderer.invoke('skills:scan', dirs, projectPath, platform),
  applyChanges: (
    allSkills: SkillInfo[],
    selectedIds: string[],
    projectPath: string,
    platform: TargetPlatform,
  ): Promise<{ installed: number; removed: number; errors: string[] }> =>
    ipcRenderer.invoke('skills:apply', allSkills, selectedIds, projectPath, platform),
};

contextBridge.exposeInMainWorld('lazyApi', api);

export type LazyApi = typeof api;
