export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  sourcePath: string;
  sourceDir: string;
  format: 'command' | 'skill';
  isInstalled: boolean;
  body: string;
}

export interface RuleInfo {
  id: string;
  name: string;
  description: string;
  sourcePath: string;
  isInstalled: boolean;
  body: string;
}

export type TargetPlatform = 'claude-code' | 'antigravity' | 'cursor';

export interface AppConfig {
  skillDirectories: string[];
  ruleFiles: string[];
  lastProjectPath?: string;
  platform: TargetPlatform;
}
