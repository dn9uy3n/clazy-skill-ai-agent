export interface SkillInfo {
  /** Unique identifier: sourceDir basename + skill name */
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
  body: string;
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
  body: string;
}

export type TargetPlatform = 'claude-code' | 'antigravity' | 'cursor';

export type WebviewMessage =
  | { command: 'ready' }
  | { command: 'apply'; skillIds: string[]; ruleIds: string[] }
  | { command: 'changePlatform'; platform: TargetPlatform }
  | { command: 'addDirectory' }
  | { command: 'removeDirectory'; directory: string }
  | { command: 'addRuleFile' }
  | { command: 'removeRuleFile'; file: string };

export type ExtensionMessage =
  | {
      command: 'update';
      skills: SkillInfo[];
      rules: RuleInfo[];
      directories: string[];
      ruleFiles: string[];
      platform: TargetPlatform;
    }
  | {
      command: 'applyResult';
      skillsInstalled: number;
      skillsRemoved: number;
      rulesInstalled: number;
      rulesRemoved: number;
      errors: string[];
    };
