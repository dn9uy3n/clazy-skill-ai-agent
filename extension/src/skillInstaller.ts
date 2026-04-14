import * as vscode from 'vscode';
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

async function ensureDir(dirPath: string): Promise<void> {
  try {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirPath));
  } catch {
    // already exists
  }
}

export async function installSkill(
  skill: SkillInfo,
  projectPath: string,
  platform: TargetPlatform,
): Promise<void> {
  const skillsDir = getSkillsDir(projectPath, platform);
  await ensureDir(skillsDir);

  const sourceDir = path.dirname(skill.sourcePath);
  const targetDir = path.join(skillsDir, skill.name);

  try {
    await vscode.workspace.fs.delete(vscode.Uri.file(targetDir), {
      recursive: true,
      useTrash: false,
    });
  } catch {
    // not present
  }

  await vscode.workspace.fs.copy(
    vscode.Uri.file(sourceDir),
    vscode.Uri.file(targetDir),
    { overwrite: true },
  );
}

export async function uninstallSkill(
  skillName: string,
  projectPath: string,
  platform: TargetPlatform,
): Promise<void> {
  const targetDir = path.join(getSkillsDir(projectPath, platform), skillName);
  try {
    await vscode.workspace.fs.delete(vscode.Uri.file(targetDir), {
      recursive: true,
      useTrash: false,
    });
  } catch {
    // doesn't exist
  }
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
    const shouldBeInstalled = selectedIds.has(skill.id);

    if (shouldBeInstalled && !skill.isInstalled) {
      try {
        await installSkill(skill, projectPath, platform);
        result.installed++;
      } catch (e) {
        result.errors.push(`Failed to install ${skill.name}: ${e}`);
      }
    } else if (!shouldBeInstalled && skill.isInstalled) {
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
