import * as vscode from 'vscode';
import * as path from 'path';
import { DirStat, RuleInfo, SkillInfo, TargetPlatform } from './types';
import { getAgentsMdRuleNames, getRulesDir, getSkillsDir, sanitizeName } from './skillInstaller';
import { firstLine, toDisplayString } from './frontmatter';
import { readDocHead } from './docReader';
import { isDir, isFile } from './fsBits';
import { getPlatform } from './platforms';

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

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
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
    .filter(([name, type]) => isFile(type) && name.toLowerCase().endsWith('.md'))
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

export interface SkillScanResult {
  skills: SkillInfo[];
  dirStats: DirStat[];
  errors: string[];
}

/**
 * Skill entries carry no markdown body — the panel fetches one only when the
 * user selects an item, so a large skill set never crosses the webview bridge.
 */
export async function scanDirectories(dirs: string[]): Promise<SkillScanResult> {
  const skills: SkillInfo[] = [];
  const dirStats: DirStat[] = [];
  const errorLog = new ErrorLog();

  for (const dir of dirs) {
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dir));
    } catch (e) {
      errorLog.add(`Cannot read directory ${dir}: ${errText(e)}`);
      dirStats.push({ dir, count: 0 });
      continue;
    }

    const subDirs = entries
      .filter(([name, type]) => isDir(type) && !name.startsWith('.'))
      .map(([name]) => name);

    const scanned = await mapLimit(subDirs, SCAN_CONCURRENCY, async entryName => {
      const skillDir = path.join(dir, entryName);

      const mdPath = await findSkillMdFile(skillDir, entryName);
      if (!mdPath) {
        errorLog.add(`No markdown file found in ${skillDir}`);
        return null;
      }

      try {
        const { frontmatter, body } = await readDocHead(mdPath);

        return {
          // Full source dir keeps ids unique when two configured directories
          // share a basename (e.g. two different `.../skills` folders).
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
    const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(skillsDir));
    return entries
      .filter(([, type]) => isDir(type))
      .map(([name]) => name);
  } catch {
    return [];
  }
}

export function markInstalled(skills: SkillInfo[], installedNames: string[]): SkillInfo[] {
  // Installed folders are named with the sanitized skill name, so compare like for like.
  const installedSet = new Set(installedNames);
  return skills.map(skill => ({
    ...skill,
    isInstalled: installedSet.has(sanitizeName(skill.name)),
  }));
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
      const stat = await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
      if (!isFile(stat.type)) {
        errorLog.add(`Not a file: ${filePath}`);
        return null;
      }

      const { frontmatter, body } = await readDocHead(filePath);

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
  if (getPlatform(platform).rules.kind === 'agents-md') {
    return getAgentsMdRuleNames(projectPath, platform);
  }

  const rulesDir = getRulesDir(projectPath, platform);
  if (rulesDir === null) return [];
  try {
    const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(rulesDir));
    return entries
      .filter(([name, type]) => isFile(type) && /\.(md|mdc|txt)$/i.test(name))
      .map(([name]) => path.basename(name, path.extname(name)));
  } catch {
    return [];
  }
}

export function markRulesInstalled(rules: RuleInfo[], installedNames: string[]): RuleInfo[] {
  const set = new Set(installedNames);
  return rules.map(r => ({ ...r, isInstalled: set.has(sanitizeName(r.name)) }));
}
