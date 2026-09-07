export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  sourcePath: string;
  sourceDir: string;
  format: 'command' | 'skill';
  isInstalled: boolean;
  /** Full markdown body. Omitted from scan results; fetched on demand via `skills:getBody`. */
  body?: string;
}

export interface RuleInfo {
  id: string;
  name: string;
  description: string;
  sourcePath: string;
  isInstalled: boolean;
  /** Full markdown body. Omitted from scan results; fetched on demand via `skills:getBody`. */
  body?: string;
}

export type TargetPlatform = 'claude-code' | 'antigravity' | 'cursor' | 'zcode';

export interface AppConfig {
  skillDirectories: string[];
  ruleFiles: string[];
  lastProjectPath?: string;
  platform: TargetPlatform;
}

/** Per-directory tally so the UI can show what each configured directory contributed. */
export interface DirStat {
  dir: string;
  count: number;
}

/** What the renderer needs to render the platform radios — derived from `platforms.ts`. */
export interface PlatformMeta {
  id: TargetPlatform;
  label: string;
  supportsRuleFiles: boolean;
  note?: string;
}

export interface ScanResult {
  skills: SkillInfo[];
  rules: RuleInfo[];
  dirStats: DirStat[];
  errors: string[];
}
