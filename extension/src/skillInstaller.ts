import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { RuleInfo, SkillInfo, TargetPlatform } from './types';
import { toDisplayString } from './frontmatter';
import { readBody, readDocHead } from './docReader';
import { isDir, isFile, isSymlink } from './fsBits';
import { getPlatform } from './platforms';
import { buildAgentsMdUpdate, parseAgentsMdBlock } from './agentsMd';

/**
 * A skill's display name comes from third-party frontmatter, so strip anything
 * that could escape the target directory or be rejected by the filesystem.
 */
export function sanitizeName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\.+$/, '')
    .trim();
  return cleaned || 'unnamed-skill';
}

/** Workspace skill folder for the given platform — see `platforms.ts` for the table. */
export function getSkillsDir(projectPath: string, platform: TargetPlatform): string {
  return getPlatform(platform).skillsDir(projectPath);
}

/**
 * Workspace rule folder for the given platform, or `null` when the platform
 * has no such folder (its rules install a different way — see `platforms.ts`
 * and `syncAgentsMd`). Callers that only handle folder-based rules must check
 * for `null` before using the result.
 */
export function getRulesDir(projectPath: string, platform: TargetPlatform): string | null {
  const rules = getPlatform(platform).rules;
  return rules.kind === 'files' ? rules.dir(projectPath) : null;
}

async function ensureDir(dirPath: string): Promise<void> {
  try {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirPath));
  } catch {
    // already exists
  }
}

/**
 * Regenerate the skills index file at `{skillsDir}/SKILL.md`.
 * The index lists every installed skill with its title, when-to-use guidance,
 * and location — so an AI agent can discover the right skill without scanning
 * every subfolder.
 */
export async function generateSkillsIndex(
  projectPath: string,
  platform: TargetPlatform,
): Promise<void> {
  const skillsDir = getSkillsDir(projectPath, platform);
  const indexPath = path.join(skillsDir, 'SKILL.md');

  if (!getPlatform(platform).writesSkillIndex) {
    // The target tool doesn't read an index like this (e.g. ZCode injects
    // each skill's own metadata into context itself). Clean up a stale one
    // left over from a previous platform selection so it doesn't linger.
    try {
      await vscode.workspace.fs.delete(vscode.Uri.file(indexPath));
    } catch {
      // not present
    }
    return;
  }

  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(skillsDir));
  } catch {
    return;
  }

  const skillFolders = entries.filter(([, type]) => isDir(type));

  if (skillFolders.length === 0) {
    try {
      await vscode.workspace.fs.delete(vscode.Uri.file(indexPath));
    } catch {
      // not present
    }
    return;
  }

  const items: { name: string; description: string; location: string }[] = [];

  for (const [folderName] of skillFolders) {
    const folderPath = path.join(skillsDir, folderName);
    let subEntries: [string, vscode.FileType][];
    try {
      subEntries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(folderPath));
    } catch {
      continue;
    }

    const mdFiles = subEntries
      .filter(([n, t]) => isFile(t) && n.toLowerCase().endsWith('.md'))
      .map(([n]) => n);
    if (mdFiles.length === 0) continue;

    const primary =
      mdFiles.find(n => n.toUpperCase() === 'SKILL.MD') ||
      mdFiles.find(n => n.toLowerCase() === `${folderName.toLowerCase()}.md`) ||
      mdFiles.find(n => n.toUpperCase() !== 'README.MD') ||
      mdFiles[0];

    let name = folderName;
    let description = '';
    try {
      const { frontmatter } = await readDocHead(path.join(folderPath, primary));
      name = toDisplayString(frontmatter.name) || folderName;
      description = toDisplayString(frontmatter.description);
    } catch {
      // unreadable — use folder name only
    }

    items.push({
      name,
      description,
      location: `./${folderName}/${primary}`,
    });
  }

  items.sort((a, b) => a.name.localeCompare(b.name));

  const lines: string[] = [
    '# Skills Index',
    '',
    'Quick reference for every skill installed in this workspace. Each skill lives in its own folder under this directory.',
    '',
    '## How to use',
    '',
    'When a task calls for a specific capability, consult this index first to find the right skill instead of scanning every folder. Open the referenced file to read the full skill definition.',
    '',
    '## Available skills',
    '',
  ];

  for (const item of items) {
    lines.push(`### ${item.name}`);
    if (item.description) {
      lines.push(`- **When to use:** ${item.description}`);
    }
    lines.push(`- **Location:** \`${item.location}\``);
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(
    `_Total: ${items.length} skill${items.length === 1 ? '' : 's'}. Auto-generated by Lazy Skill AI Agent — do not edit manually._`,
  );
  lines.push('');

  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(indexPath),
    Buffer.from(lines.join('\n'), 'utf-8'),
  );
}

// --- Skills ---

/**
 * Remove whatever currently sits at `targetPath` so a fresh copy can take its
 * place. If it's a symlink (e.g. a `.zcode/skills/foo` -> `~/.agents/skills/foo`
 * chain some setups create by hand), deleting it *recursively* would delete
 * through the link into the real skill directory it points at. So a symlink is
 * always unlinked non-recursively, whatever it points to; only a real
 * directory is deleted recursively.
 */
async function removeExisting(targetPath: string): Promise<string | null> {
  let stat: vscode.FileStat;
  try {
    stat = await vscode.workspace.fs.stat(vscode.Uri.file(targetPath));
  } catch {
    return null; // nothing there
  }

  const uri = vscode.Uri.file(targetPath);
  if (isSymlink(stat.type)) {
    await vscode.workspace.fs.delete(uri, { recursive: false, useTrash: false });
    return `${targetPath} was a symlink; replaced it with a real copy instead of deleting through it.`;
  }

  await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: false });
  return null;
}

/**
 * Non-blocking checks against constraints the *target platform itself*
 * enforces on a skill's frontmatter (e.g. ZCode drops a skill outright if
 * these are violated) — surfaced as a warning rather than letting the skill
 * silently vanish from the target tool with no explanation. Re-reads the raw
 * frontmatter rather than using `SkillInfo.description`, which already
 * falls back to the body's first line and so can't tell "missing" from
 * "present but short."
 */
async function validateForPlatform(skill: SkillInfo, platform: TargetPlatform): Promise<string[]> {
  const desc = getPlatform(platform);
  if (desc.maxDescriptionChars === undefined) return [];

  const warnings: string[] = [];
  try {
    const { frontmatter } = await readDocHead(skill.sourcePath);
    const rawName = frontmatter.name;
    const rawDescription = frontmatter.description;

    if (typeof rawName !== 'string' || rawName.trim() === '') {
      warnings.push('has no frontmatter `name` — the target tool drops skills without one.');
    }
    if (typeof rawDescription !== 'string' || rawDescription.trim() === '') {
      warnings.push('has no frontmatter `description` — the target tool drops skills without one.');
    } else if (rawDescription.length > desc.maxDescriptionChars) {
      warnings.push(
        `description is ${rawDescription.length} characters; the target tool drops skills over ${desc.maxDescriptionChars}.`,
      );
    }
  } catch {
    // unreadable — installSkill's own copy step will surface this instead
  }
  return warnings;
}

/**
 * A workspace install can be silently shadowed if the target platform also
 * reads a user-scope location that already has a same-named skill — warn
 * rather than let the user believe the workspace copy is the one in effect.
 */
async function checkUserScopeShadow(skill: SkillInfo, platform: TargetPlatform): Promise<string | null> {
  const roots = getPlatform(platform).userSkillRoots;
  if (!roots || roots.length === 0) return null;

  const name = sanitizeName(skill.name);
  for (const segments of roots) {
    const candidate = path.join(os.homedir(), ...segments, name);
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(candidate));
      return `a user-scope skill named "${name}" exists at ${candidate}; depending on the tool's precedence rules, this workspace copy may be shadowed by it.`;
    } catch {
      // not present at this root — keep checking the others
    }
  }
  return null;
}

export async function installSkill(
  skill: SkillInfo,
  projectPath: string,
  platform: TargetPlatform,
): Promise<string[]> {
  const skillsDir = getSkillsDir(projectPath, platform);
  await ensureDir(skillsDir);

  const warnings = await validateForPlatform(skill, platform);

  const sourceDir = path.dirname(skill.sourcePath);
  const targetDir = path.join(skillsDir, sanitizeName(skill.name));

  const removeWarning = await removeExisting(targetDir);
  if (removeWarning) warnings.push(removeWarning);

  await vscode.workspace.fs.copy(
    vscode.Uri.file(sourceDir),
    vscode.Uri.file(targetDir),
    { overwrite: true },
  );

  const shadowWarning = await checkUserScopeShadow(skill, platform);
  if (shadowWarning) warnings.push(shadowWarning);

  return warnings;
}

export async function uninstallSkill(
  skillName: string,
  projectPath: string,
  platform: TargetPlatform,
): Promise<void> {
  const targetDir = path.join(getSkillsDir(projectPath, platform), sanitizeName(skillName));
  await removeExisting(targetDir);
}

// --- Rules ---

/**
 * File-based rule install. Not valid for a platform whose `rules` strategy
 * is `agents-md` (`getRulesDir` returns `null` there) — those are handled by
 * `syncAgentsMd` instead, and `applyChanges` branches before ever calling this.
 */
export async function installRule(
  rule: RuleInfo,
  projectPath: string,
  platform: TargetPlatform,
): Promise<void> {
  const rulesDir = getRulesDir(projectPath, platform);
  if (rulesDir === null) {
    throw new Error(`Platform ${platform} has no rules directory; use syncAgentsMd instead`);
  }
  await ensureDir(rulesDir);

  const ext = path.extname(rule.sourcePath) || '.md';
  const targetFile = path.join(rulesDir, `${sanitizeName(rule.name)}${ext}`);

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
  if (rulesDir === null) return; // nothing to remove; see installRule's note
  // Try common rule extensions
  for (const ext of ['.md', '.mdc', '.txt']) {
    const target = path.join(rulesDir, `${sanitizeName(ruleName)}${ext}`);
    try {
      await vscode.workspace.fs.delete(vscode.Uri.file(target), { useTrash: false });
    } catch {
      // not present, try next
    }
  }
}

// --- Rules: AGENTS.md merge (platforms with the `agents-md` rule strategy) ---
// The string logic (marker format, block parsing, rebuild) lives in
// `agentsMd.ts`, vscode-free and unit-tested; this is just the I/O wrapper.

/**
 * Rewrite the target platform's AGENTS.md so its managed block contains
 * exactly `selectedRules` — added, removed, and left-alone rules are all
 * resolved by diffing against what the block currently lists. Everything
 * outside the block (the user's own project instructions) is preserved.
 */
export async function syncAgentsMd(
  projectPath: string,
  platform: TargetPlatform,
  selectedRules: RuleInfo[],
): Promise<{ installed: number; removed: number; warnings: string[] }> {
  const strategy = getPlatform(platform).rules;
  if (strategy.kind !== 'agents-md') {
    throw new Error(`Platform ${platform} does not use the AGENTS.md rule strategy`);
  }
  const uri = vscode.Uri.file(strategy.file(projectPath));

  let content = '';
  try {
    content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf-8');
  } catch {
    // AGENTS.md doesn't exist yet — start from an empty file.
  }

  const warnings: string[] = [];
  const ruleInputs: { name: string; body: string }[] = [];
  for (const rule of selectedRules) {
    try {
      ruleInputs.push({ name: sanitizeName(rule.name), body: await readBody(rule.sourcePath) });
    } catch (e) {
      warnings.push(`Rule ${rule.name}: could not read its body for the AGENTS.md merge: ${e}`);
    }
  }

  const update = buildAgentsMdUpdate(content, ruleInputs);
  warnings.push(...update.warnings);

  if (update.newContent.trim() === '') {
    try {
      await vscode.workspace.fs.delete(uri);
    } catch {
      // already absent
    }
  } else {
    await vscode.workspace.fs.writeFile(uri, Buffer.from(update.newContent, 'utf-8'));
  }

  return { installed: update.installed, removed: update.removed, warnings };
}

/** Rule names currently listed in the target platform's AGENTS.md managed block. */
export async function getAgentsMdRuleNames(
  projectPath: string,
  platform: TargetPlatform,
): Promise<string[]> {
  const strategy = getPlatform(platform).rules;
  if (strategy.kind !== 'agents-md') return [];

  let content: string;
  try {
    content = Buffer.from(
      await vscode.workspace.fs.readFile(vscode.Uri.file(strategy.file(projectPath))),
    ).toString('utf-8');
  } catch {
    return [];
  }

  return [...parseAgentsMdBlock(content).names];
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
        const warnings = await installSkill(skill, projectPath, platform);
        for (const w of warnings) result.errors.push(`Skill ${skill.name}: ${w}`);
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

  if (getPlatform(platform).rules.kind === 'agents-md') {
    // One rewrite of the whole managed block, not a per-file loop — the
    // target has no rules folder to add/remove files in.
    try {
      const selected = allRules.filter(r => selectedRuleIds.has(r.id));
      const { installed, removed, warnings } = await syncAgentsMd(projectPath, platform, selected);
      result.rulesInstalled = installed;
      result.rulesRemoved = removed;
      result.errors.push(...warnings);
    } catch (e) {
      result.errors.push(`AGENTS.md: ${e}`);
    }
  } else {
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
  }

  // Regenerate the skills index so AI agents can discover installed skills quickly
  try {
    await generateSkillsIndex(projectPath, platform);
  } catch (e) {
    result.errors.push(`Skills index: ${e}`);
  }

  return result;
}
