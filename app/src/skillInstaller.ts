import * as fs from 'fs/promises';
import * as path from 'path';
import { RuleInfo, SkillInfo, TargetPlatform } from './types';

export function getSkillsDir(projectPath: string, platform: TargetPlatform): string {
  switch (platform) {
    case 'antigravity':
      return path.join(projectPath, '.agent', 'skills');
    case 'cursor':
      return path.join(projectPath, '.cursor', 'skills');
    case 'claude-code':
    default:
      return path.join(projectPath, '.claude', 'skills');
  }
}

export function getRulesDir(projectPath: string, platform: TargetPlatform): string {
  switch (platform) {
    case 'antigravity':
      return path.join(projectPath, '.agents', 'rules');
    case 'cursor':
      return path.join(projectPath, '.cursor', 'rules');
    case 'claude-code':
    default:
      return path.join(projectPath, '.claude', 'rules');
  }
}

// --- Skills ---

export async function installSkill(
  skill: SkillInfo,
  projectPath: string,
  platform: TargetPlatform,
): Promise<void> {
  const skillsDir = getSkillsDir(projectPath, platform);
  await fs.mkdir(skillsDir, { recursive: true });

  const sourceDir = path.dirname(skill.sourcePath);
  const targetDir = path.join(skillsDir, skill.name);

  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.cp(sourceDir, targetDir, { recursive: true });
}

export async function uninstallSkill(
  skillName: string,
  projectPath: string,
  platform: TargetPlatform,
): Promise<void> {
  const targetDir = path.join(getSkillsDir(projectPath, platform), skillName);
  await fs.rm(targetDir, { recursive: true, force: true });
}

// --- Rules ---

export async function installRule(
  rule: RuleInfo,
  projectPath: string,
  platform: TargetPlatform,
): Promise<void> {
  const rulesDir = getRulesDir(projectPath, platform);
  await fs.mkdir(rulesDir, { recursive: true });

  const ext = path.extname(rule.sourcePath) || '.md';
  const targetFile = path.join(rulesDir, `${rule.name}${ext}`);
  await fs.copyFile(rule.sourcePath, targetFile);
}

export async function uninstallRule(
  ruleName: string,
  projectPath: string,
  platform: TargetPlatform,
): Promise<void> {
  const rulesDir = getRulesDir(projectPath, platform);
  for (const ext of ['.md', '.mdc', '.txt']) {
    const target = path.join(rulesDir, `${ruleName}${ext}`);
    await fs.rm(target, { force: true });
  }
}

// --- Apply ---

export interface ApplyResult {
  skillsInstalled: number;
  skillsRemoved: number;
  rulesInstalled: number;
  rulesRemoved: number;
  errors: string[];
}

export async function applyChanges(
  allSkills: SkillInfo[],
  selectedSkillIds: Set<string>,
  allRules: RuleInfo[],
  selectedRuleIds: Set<string>,
  projectPath: string,
  platform: TargetPlatform,
): Promise<ApplyResult> {
  const result: ApplyResult = {
    skillsInstalled: 0,
    skillsRemoved: 0,
    rulesInstalled: 0,
    rulesRemoved: 0,
    errors: [],
  };

  for (const skill of allSkills) {
    const should = selectedSkillIds.has(skill.id);
    if (should && !skill.isInstalled) {
      try {
        await installSkill(skill, projectPath, platform);
        result.skillsInstalled++;
      } catch (e) {
        result.errors.push(`Skill ${skill.name}: ${e}`);
      }
    } else if (!should && skill.isInstalled) {
      try {
        await uninstallSkill(skill.name, projectPath, platform);
        result.skillsRemoved++;
      } catch (e) {
        result.errors.push(`Skill ${skill.name}: ${e}`);
      }
    }
  }

  for (const rule of allRules) {
    const should = selectedRuleIds.has(rule.id);
    if (should && !rule.isInstalled) {
      try {
        await installRule(rule, projectPath, platform);
        result.rulesInstalled++;
      } catch (e) {
        result.errors.push(`Rule ${rule.name}: ${e}`);
      }
    } else if (!should && rule.isInstalled) {
      try {
        await uninstallRule(rule.name, projectPath, platform);
        result.rulesRemoved++;
      } catch (e) {
        result.errors.push(`Rule ${rule.name}: ${e}`);
      }
    }
  }

  return result;
}
