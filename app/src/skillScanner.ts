import * as fs from 'fs/promises';
import type { Dirent } from 'fs';
import * as path from 'path';
import { DirStat, RuleInfo, SkillInfo, TargetPlatform } from './types';
import { getRulesDir, getSkillsDir, sanitizeName } from './skillInstaller';
import { errText, firstLine, readDocHead, toDisplayString } from './frontmatter';

const SCAN_CONCURRENCY = 32;
const MAX_ERRORS = 50;

/** Collects scan problems without letting a pathological directory blow up memory. */
class ErrorLog {
  private readonly messages: string[] = [];
  private total = 0;

  add(message: string): void {
    this.total++;
    if (this.messages.length < MAX_ERRORS) this.messages.push(message);
  }

  toArray(): string[] {
    const hidden = this.total - this.messages.length;
    return hidden > 0 ? [...this.messages, `... and ${hidden} more`] : [...this.messages];
  }
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** `withFileTypes` avoids a stat per entry, but reports symlinks as neither file nor dir. */
async function resolveKind(parent: string, entry: Dirent): Promise<'dir' | 'file' | 'other'> {
  if (entry.isDirectory()) return 'dir';
  if (entry.isFile()) return 'file';
  if (entry.isSymbolicLink()) {
    try {
      const stat = await fs.stat(path.join(parent, entry.name));
      if (stat.isDirectory()) return 'dir';
      if (stat.isFile()) return 'file';
    } catch {
      return 'other';
    }
  }
  return 'other';
}

async function findSkillMdFile(skillDir: string, skillDirName: string): Promise<string | null> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(skillDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const mdFiles: string[] = [];
  for (const entry of entries) {
    if (!entry.name.toLowerCase().endsWith('.md')) continue;
    if ((await resolveKind(skillDir, entry)) === 'file') mdFiles.push(entry.name);
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

export interface SkillScanResult {
  skills: SkillInfo[];
  dirStats: DirStat[];
  errors: string[];
}

export async function scanDirectories(dirs: string[]): Promise<SkillScanResult> {
  const skills: SkillInfo[] = [];
  const dirStats: DirStat[] = [];
  const errorLog = new ErrorLog();

  for (const dir of dirs) {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (e) {
      errorLog.add(`Cannot read directory ${dir}: ${errText(e)}`);
      dirStats.push({ dir, count: 0 });
      continue;
    }

    const subDirs: string[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if ((await resolveKind(dir, entry)) === 'dir') subDirs.push(entry.name);
    }

    const scanned = await mapLimit(subDirs, SCAN_CONCURRENCY, async entryName => {
      const entryPath = path.join(dir, entryName);

      const mdPath = await findSkillMdFile(entryPath, entryName);
      if (!mdPath) {
        errorLog.add(`No markdown file found in ${entryPath}`);
        return null;
      }

      try {
        const { frontmatter, body, error } = await readDocHead(mdPath);
        if (error) errorLog.add(`Invalid frontmatter in ${mdPath}: ${error}`);

        return {
          id: `${dir}::${entryName}`,
          name: toDisplayString(frontmatter.name) || entryName,
          description: toDisplayString(frontmatter.description) || firstLine(body),
          sourcePath: mdPath,
          sourceDir: dir,
          format: path.basename(mdPath).toUpperCase() === 'SKILL.MD' ? 'skill' : 'command',
          isInstalled: false,
        } as SkillInfo;
      } catch (e) {
        errorLog.add(`Cannot read ${mdPath}: ${errText(e)}`);
        return null;
      }
    });

    const found = scanned.filter((s): s is SkillInfo => s !== null);
    skills.push(...found);
    dirStats.push({ dir, count: found.length });
  }

  return { skills, dirStats, errors: errorLog.toArray() };
}

export async function getInstalledSkillNames(
  projectPath: string,
  platform: TargetPlatform,
): Promise<string[]> {
  const skillsDir = getSkillsDir(projectPath, platform);
  try {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });
    const names: string[] = [];
    for (const entry of entries) {
      if ((await resolveKind(skillsDir, entry)) === 'dir') names.push(entry.name);
    }
    return names;
  } catch {
    return [];
  }
}

export function markInstalled(skills: SkillInfo[], installedNames: string[]): SkillInfo[] {
  // Installed folders are named with the sanitized skill name, so compare like for like.
  const set = new Set(installedNames);
  return skills.map(s => ({ ...s, isInstalled: set.has(sanitizeName(s.name)) }));
}

// --- Rules ---

export interface RuleScanResult {
  rules: RuleInfo[];
  errors: string[];
}

export async function scanRuleFiles(files: string[]): Promise<RuleScanResult> {
  const errorLog = new ErrorLog();

  const scanned = await mapLimit(files, SCAN_CONCURRENCY, async filePath => {
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) {
        errorLog.add(`Not a file: ${filePath}`);
        return null;
      }

      const { frontmatter, body, error } = await readDocHead(filePath);
      if (error) errorLog.add(`Invalid frontmatter in ${filePath}: ${error}`);

      const ext = path.extname(filePath);
      const baseName = path.basename(filePath, ext);

      return {
        id: `rule:${filePath}`,
        name: toDisplayString(frontmatter.name) || baseName,
        description: toDisplayString(frontmatter.description) || firstLine(body),
        sourcePath: filePath,
        isInstalled: false,
      } as RuleInfo;
    } catch (e) {
      errorLog.add(`Cannot read ${filePath}: ${errText(e)}`);
      return null;
    }
  });

  return {
    rules: scanned.filter((r): r is RuleInfo => r !== null),
    errors: errorLog.toArray(),
  };
}

export async function getInstalledRuleNames(
  projectPath: string,
  platform: TargetPlatform,
): Promise<string[]> {
  const rulesDir = getRulesDir(projectPath, platform);
  try {
    const entries = await fs.readdir(rulesDir, { withFileTypes: true });
    const names: string[] = [];
    for (const entry of entries) {
      if (!/\.(md|mdc|txt)$/i.test(entry.name)) continue;
      if ((await resolveKind(rulesDir, entry)) === 'file') {
        names.push(path.basename(entry.name, path.extname(entry.name)));
      }
    }
    return names;
  } catch {
    return [];
  }
}

export function markRulesInstalled(rules: RuleInfo[], installedNames: string[]): RuleInfo[] {
  const set = new Set(installedNames);
  return rules.map(r => ({ ...r, isInstalled: set.has(sanitizeName(r.name)) }));
}
