import * as path from 'path';
import { PlatformMeta, TargetPlatform } from './types';

// Mirror of app/src/platforms.ts — keep the two in sync.

/**
 * How a platform wants "rules" installed. Most tools read a folder of
 * standalone rule files; ZCode has no such folder and only reads AGENTS.md,
 * so a rule there is merged into a managed block inside that file instead.
 */
export type RuleStrategy =
  | { kind: 'files'; dir: (projectPath: string) => string }
  | { kind: 'agents-md'; file: (projectPath: string) => string };

export interface PlatformDescriptor {
  id: TargetPlatform;
  label: string;
  skillsDir: (projectPath: string) => string;
  rules: RuleStrategy;
  /** Whether to (re)generate `{skillsDir}/SKILL.md` as a discovery index after Apply. */
  writesSkillIndex: boolean;
  /** Hard cap this platform enforces on a skill's `description`; skills over it get dropped/ignored by the tool itself. */
  maxDescriptionChars?: number;
  /**
   * User-scope skill roots (segments under the user's home directory) this
   * platform also reads, highest-precedence first. Used only to warn when a
   * workspace install could be shadowed by a same-named user-scope skill —
   * the tool itself still decides precedence.
   */
  userSkillRoots?: string[][];
  /** Short explanatory note shown under the platform's radio in the panel. */
  note?: string;
}

export const PLATFORMS: PlatformDescriptor[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    skillsDir: p => path.join(p, '.claude', 'skills'),
    rules: { kind: 'files', dir: p => path.join(p, '.claude', 'rules') },
    writesSkillIndex: true,
  },
  {
    id: 'antigravity',
    label: 'Antigravity',
    skillsDir: p => path.join(p, '.agent', 'skills'),
    // Deliberate asymmetry vs. skillsDir (`.agent`, singular): this matches
    // Antigravity's own convention and has shipped since v0.4.0. Do not
    // "fix" it to match — that would orphan rules already installed by
    // existing users.
    rules: { kind: 'files', dir: p => path.join(p, '.agents', 'rules') },
    writesSkillIndex: true,
  },
  {
    id: 'cursor',
    label: 'Cursor',
    skillsDir: p => path.join(p, '.cursor', 'skills'),
    rules: { kind: 'files', dir: p => path.join(p, '.cursor', 'rules') },
    writesSkillIndex: true,
  },
  {
    id: 'zcode',
    label: 'ZCode (z.ai)',
    skillsDir: p => path.join(p, '.zcode', 'skills'),
    // ZCode has no rules/ directory concept at all — it only reads AGENTS.md
    // (user-level ~/.zcode/AGENTS.md, then workspace <repo>/AGENTS.md, the
    // latter injected second so it can override). So a "rule" here is merged
    // into AGENTS.md inside a managed marker block instead of being copied
    // as a standalone file. See syncAgentsMd() in skillInstaller.ts.
    rules: { kind: 'agents-md', file: p => path.join(p, 'AGENTS.md') },
    // {skillsDir}/SKILL.md would sit at the skills root rather than inside a
    // skill folder, so ZCode wouldn't mistake it for a skill — but it's
    // still useless noise: ZCode injects each skill's own name+description
    // into context itself and has no notion of reading an index file.
    writesSkillIndex: false,
    // ZCode drops a skill outright if `description` is missing or exceeds
    // this many characters (and only injects the first ~250 into context).
    maxDescriptionChars: 1024,
    // ZCode's own docs disagree on whether user scope or workspace scope
    // wins when both have a same-named skill — so this is used only to
    // warn, not to change what gets installed.
    userSkillRoots: [
      ['.zcode', 'skills'],
      ['.agents', 'skills'],
    ],
    note: 'Skills install to .zcode/skills/. Rules merge into AGENTS.md — ZCode has no rules/ folder.',
  },
];

export const DEFAULT_PLATFORM: TargetPlatform = 'claude-code';

const BY_ID = new Map(PLATFORMS.map(p => [p.id, p]));

export function getPlatform(id: TargetPlatform): PlatformDescriptor {
  return BY_ID.get(id) ?? (BY_ID.get(DEFAULT_PLATFORM) as PlatformDescriptor);
}

export function isTargetPlatform(value: unknown): value is TargetPlatform {
  return typeof value === 'string' && BY_ID.has(value as TargetPlatform);
}

/** Metadata the webview/renderer needs to render platform radios from data. */
export function platformUiList(): PlatformMeta[] {
  return PLATFORMS.map(p => ({
    id: p.id,
    label: p.label,
    note: p.note,
  }));
}
