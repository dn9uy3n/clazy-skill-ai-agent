import * as vscode from 'vscode';
import * as path from 'path';
import { RuleInfo, SkillInfo, TargetPlatform } from './types';

/**
 * Workspace skill folder per platform:
 *   - Claude Code  -> {project}/.claude/skills
 *   - Antigravity  -> {project}/.agent/skills
 *   - Cursor       -> {project}/.cursor/skills
 */
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

/**
 * Workspace rule folder per platform:
 *   - Claude Code  -> {project}/.claude/rules
 *   - Antigravity  -> {project}/.agents/rules
 *   - Cursor       -> {project}/.cursor/rules
 */
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

async function ensureDir(dirPath: string): Promise<void> {
  try {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirPath));
  } catch {
    // already exists
  }
}

// --- Skills ---

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

// --- Rules ---

export async function installRule(
  rule: RuleInfo,
  projectPath: string,
  platform: TargetPlatform,
): Promise<void> {
  const rulesDir = getRulesDir(projectPath, platform);
  await ensureDir(rulesDir);

  const ext = path.extname(rule.sourcePath) || '.md';
  const targetFile = path.join(rulesDir, `${rule.name}${ext}`);

  await vscode.workspace.fs.copy(
    vscode.Uri.file(rule.sourcePath),
    vscode.Uri.file(targetFile),
    { overwrite: true },
  );
}

export async function uninstallRule(
  ruleName: string,
  projectPath: string,
  platform: TargetPlatform,
): Promise<void> {
  const rulesDir = getRulesDir(projectPath, platform);
  // Try common rule extensions
  for (const ext of ['.md', '.mdc', '.txt']) {
    const target = path.join(rulesDir, `${ruleName}${ext}`);
    try {
      await vscode.workspace.fs.delete(vscode.Uri.file(target), { useTrash: false });
    } catch {
      // not present, try next
    }
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
    const shouldInstall = selectedSkillIds.has(skill.id);
    if (shouldInstall && !skill.isInstalled) {
      try {
        await installSkill(skill, projectPath, platform);
        result.skillsInstalled++;
      } catch (e) {
        result.errors.push(`Skill ${skill.name}: ${e}`);
      }
    } else if (!shouldInstall && skill.isInstalled) {
      try {
        await uninstallSkill(skill.name, projectPath, platform);
        result.skillsRemoved++;
      } catch (e) {
        result.errors.push(`Skill ${skill.name}: ${e}`);
      }
    }
  }

  for (const rule of allRules) {
    const shouldInstall = selectedRuleIds.has(rule.id);
    if (shouldInstall && !rule.isInstalled) {
      try {
        await installRule(rule, projectPath, platform);
        result.rulesInstalled++;
      } catch (e) {
        result.errors.push(`Rule ${rule.name}: ${e}`);
      }
    } else if (!shouldInstall && rule.isInstalled) {
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
