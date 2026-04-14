import * as vscode from 'vscode';
import * as path from 'path';
import { SkillInfo, TargetPlatform } from './types';
import { getSkillsDir } from './skillInstaller';

interface Frontmatter {
  name?: string;
  description?: string;
  [key: string]: unknown;
}

function parseFrontmatter(content: string): { frontmatter: Frontmatter; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const raw = match[1];
  const body = match[2].trim();
  const frontmatter: Frontmatter = {};

  for (const line of raw.split(/\r?\n/)) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value: string | unknown = line.slice(colonIdx + 1).trim();
    if (typeof value === 'string' && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    frontmatter[key] = value;
  }

  return { frontmatter, body };
}

/**
 * Find the primary skill .md file inside a skill subdirectory.
 * Priority: SKILL.md > {dirName}.md > first .md file (excluding README.md).
 */
async function findSkillMdFile(skillDir: string, skillDirName: string): Promise<string | null> {
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(skillDir));
  } catch {
    return null;
  }

  const mdFiles = entries
    .filter(([name, type]) => type === vscode.FileType.File && name.toLowerCase().endsWith('.md'))
    .map(([name]) => name);

  if (mdFiles.length === 0) return null;

  // Priority 1: SKILL.md
  const skillMd = mdFiles.find(n => n.toUpperCase() === 'SKILL.MD');
  if (skillMd) return path.join(skillDir, skillMd);

  // Priority 2: {dirName}.md
  const dirMatch = mdFiles.find(n => n.toLowerCase() === `${skillDirName.toLowerCase()}.md`);
  if (dirMatch) return path.join(skillDir, dirMatch);

  // Priority 3: first .md that isn't README
  const nonReadme = mdFiles.find(n => n.toUpperCase() !== 'README.MD');
  if (nonReadme) return path.join(skillDir, nonReadme);

  return path.join(skillDir, mdFiles[0]);
}

export async function scanDirectories(dirs: string[]): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = [];

  for (const dir of dirs) {
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dir));
    } catch {
      continue;
    }

    const dirBasename = path.basename(dir);

    for (const [entryName, entryType] of entries) {
      if (entryType !== vscode.FileType.Directory) continue;

      const skillDir = path.join(dir, entryName);
      const mdPath = await findSkillMdFile(skillDir, entryName);
      if (!mdPath) continue;

      try {
        const contentBytes = await vscode.workspace.fs.readFile(vscode.Uri.file(mdPath));
        const content = Buffer.from(contentBytes).toString('utf-8');
        const { frontmatter, body } = parseFrontmatter(content);

        const name = (frontmatter.name as string) || entryName;
        const description = (frontmatter.description as string) || body.split('\n')[0] || '';
        const isSkillFormat = path.basename(mdPath).toUpperCase() === 'SKILL.MD';

        skills.push({
          id: `${dirBasename}:${name}`,
          name,
          description,
          sourcePath: mdPath,
          sourceDir: dir,
          format: isSkillFormat ? 'skill' : 'command',
          isInstalled: false,
          body,
        });
      } catch {
        // Skip unreadable files
      }
    }
  }

  return skills;
}

export async function getInstalledSkillNames(
  projectPath: string,
  platform: TargetPlatform,
): Promise<string[]> {
  const skillsDir = getSkillsDir(projectPath, platform);
  try {
    const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(skillsDir));
    return entries
      .filter(([, type]) => type === vscode.FileType.Directory)
      .map(([name]) => name);
  } catch {
    return [];
  }
}

export function markInstalled(skills: SkillInfo[], installedNames: string[]): SkillInfo[] {
  const installedSet = new Set(installedNames);
  return skills.map(skill => ({
    ...skill,
    isInstalled: installedSet.has(skill.name),
  }));
}
