import { contextBridge, ipcRenderer } from 'electron';
import { AppConfig, RuleInfo, SkillInfo, TargetPlatform } from './types';

const api = {
  loadConfig: (): Promise<AppConfig> => ipcRenderer.invoke('config:load'),
  saveConfig: (config: AppConfig): Promise<void> => ipcRenderer.invoke('config:save', config),
  selectDirectory: (title: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:selectDirectory', title),
  selectFiles: (title: string): Promise<string[]> => ipcRenderer.invoke('dialog:selectFiles', title),
  scanSkills: (
    skillDirs: string[],
    ruleFiles: string[],
    projectPath: string | undefined,
    platform: TargetPlatform,
  ): Promise<{ skills: SkillInfo[]; rules: RuleInfo[] }> =>
    ipcRenderer.invoke('skills:scan', skillDirs, ruleFiles, projectPath, platform),
  applyChanges: (
    allSkills: SkillInfo[],
    selectedSkillIds: string[],
    allRules: RuleInfo[],
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
      allSkills,
      selectedSkillIds,
      allRules,
      selectedRuleIds,
      projectPath,
      platform,
    ),
};

contextBridge.exposeInMainWorld('lazyApi', api);

export type LazyApi = typeof api;
