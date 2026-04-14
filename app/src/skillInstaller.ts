import * as fs from 'fs/promises';
import * as path from 'path';
import { SkillInfo, TargetPlatform } from './types';

/**
 * Workspace skills folder per platform:
 *   - Claude Code  -> {project}/.claude/skills
 *   - Antigravity  -> {project}/.agent/skills
 */
export function getSkillsDir(projectPath: string, platform: TargetPlatform): string {
  const root = platform === 'antigravity' ? '.agent' : '.claude';
  return path.join(projectPath, root, 'skills');
}

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

export interface ApplyResult {
  installed: number;
  removed: number;
  errors: string[];
}

export async function applyChanges(
  allSkills: SkillInfo[],
  selectedIds: Set<string>,
  projectPath: string,
  platform: TargetPlatform,
): Promise<ApplyResult> {
  const result: ApplyResult = { installed: 0, removed: 0, errors: [] };

  for (const skill of allSkills) {
    const shouldInstall = selectedIds.has(skill.id);

    if (shouldInstall && !skill.isInstalled) {
      try {
        await installSkill(skill, projectPath, platform);
        result.installed++;
      } catch (e) {
        result.errors.push(`Failed to install ${skill.name}: ${e}`);
      }
    } else if (!shouldInstall && skill.isInstalled) {
      try {
        await uninstallSkill(skill.name, projectPath, platform);
        result.removed++;
      } catch (e) {
        result.errors.push(`Failed to remove ${skill.name}: ${e}`);
      }
    }
  }

  return result;
}
