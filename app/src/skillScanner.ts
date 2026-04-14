import * as fs from 'fs/promises';
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
  if (!match) return { frontmatter: {}, body: content };

  const frontmatter: Frontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value: string = line.slice(idx + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    frontmatter[key] = value;
  }
  return { frontmatter, body: match[2].trim() };
}

async function findSkillMdFile(skillDir: string, skillDirName: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await fs.readdir(skillDir);
  } catch {
    return null;
  }

  const mdFiles: string[] = [];
  for (const name of entries) {
    if (!name.toLowerCase().endsWith('.md')) continue;
    try {
      const stat = await fs.stat(path.join(skillDir, name));
      if (stat.isFile()) mdFiles.push(name);
    } catch {
      // skip
    }
  }

  if (mdFiles.length === 0) return null;

  const skillMd = mdFiles.find(n => n.toUpperCase() === 'SKILL.MD');
  if (skillMd) return path.join(skillDir, skillMd);

  const dirMatch = mdFiles.find(n => n.toLowerCase() === `${skillDirName.toLowerCase()}.md`);
  if (dirMatch) return path.join(skillDir, dirMatch);

  const nonReadme = mdFiles.find(n => n.toUpperCase() !== 'README.MD');
  if (nonReadme) return path.join(skillDir, nonReadme);

  return path.join(skillDir, mdFiles[0]);
}

export async function scanDirectories(dirs: string[]): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = [];

  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      continue;
    }

    const dirBasename = path.basename(dir);

    for (const entryName of entries) {
      const entryPath = path.join(dir, entryName);
      let stat;
      try {
        stat = await fs.stat(entryPath);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;

      const mdPath = await findSkillMdFile(entryPath, entryName);
      if (!mdPath) continue;

      try {
        const content = await fs.readFile(mdPath, 'utf-8');
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
        // skip
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
    const names: string[] = [];
    const entries = await fs.readdir(skillsDir);
    for (const name of entries) {
      try {
        const stat = await fs.stat(path.join(skillsDir, name));
        if (stat.isDirectory()) names.push(name);
      } catch {
        // skip
      }
    }
    return names;
  } catch {
    return [];
  }
}

export function markInstalled(skills: SkillInfo[], installedNames: string[]): SkillInfo[] {
  const set = new Set(installedNames);
  return skills.map(s => ({ ...s, isInstalled: set.has(s.name) }));
}
