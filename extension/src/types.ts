export interface SkillInfo {
  /** Unique identifier: full source directory + skill folder name */
  id: string;
  name: string;
  description: string;
  /** Full path to the source .md file inside the skill folder */
  sourcePath: string;
  /** The configured root directory this skill came from */
  sourceDir: string;
  /** Whether it is from commands or skills directory layout */
  format: 'command' | 'skill';
  isInstalled: boolean;
  /** Full markdown body. Omitted from scan results; fetched on demand. */
  body?: string;
}

export interface RuleInfo {
  /** Unique identifier */
  id: string;
  /** Filename without extension (used as install target name) */
  name: string;
  description: string;
  /** Full path to the source rule file */
  sourcePath: string;
  isInstalled: boolean;
  /** Full markdown body. Omitted from scan results; fetched on demand. */
  body?: string;
}

export type TargetPlatform = 'claude-code' | 'antigravity' | 'cursor' | 'zcode';

/** Per-directory tally so the panel can show what each configured directory contributed. */
export interface DirStat {
  dir: string;
  count: number;
}

/** What the webview needs to render the platform radios — derived from `platforms.ts`. */
export interface PlatformMeta {
  id: TargetPlatform;
  label: string;
  note?: string;
}

export type WebviewMessage =
  | { command: 'ready' }
  | { command: 'refresh' }
  | { command: 'apply'; skillIds: string[]; ruleIds: string[] }
  | { command: 'changePlatform'; platform: TargetPlatform }
  | { command: 'addDirectory' }
  | { command: 'removeDirectory'; directory: string }
  | { command: 'addRuleFile' }
  | { command: 'removeRuleFile'; file: string }
  | { command: 'getBody'; id: string; sourcePath: string };

export type ExtensionMessage =
  | { command: 'scanning' }
  | {
      command: 'update';
      skills: SkillInfo[];
      rules: RuleInfo[];
      directories: string[];
      ruleFiles: string[];
      platform: TargetPlatform;
      platforms: PlatformMeta[];
      dirStats: DirStat[];
      errors: string[];
    }
  | { command: 'body'; id: string; body: string }
  | {
      command: 'applyResult';
      skillsInstalled: number;
      skillsRemoved: number;
      rulesInstalled: number;
      rulesRemoved: number;
      errors: string[];
    };
