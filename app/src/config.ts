import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import { AppConfig } from './types';
import { DEFAULT_PLATFORM, isTargetPlatform } from './platforms';

const DEFAULT_CONFIG: AppConfig = {
  skillDirectories: [],
  ruleFiles: [],
  platform: DEFAULT_PLATFORM,
};

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'config.json');
}

export async function loadConfig(): Promise<AppConfig> {
  try {
    const raw = await fs.readFile(getConfigPath(), 'utf-8');
    const merged = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    // config.json is hand-editable, and an old build may have written a
    // platform id this build no longer recognizes — fall back rather than
    // let an invalid value flow into getSkillsDir's own fallback silently.
    if (!isTargetPlatform(merged.platform)) merged.platform = DEFAULT_PLATFORM;
    return merged;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(config: AppConfig): Promise<void> {
  const configPath = getConfigPath();
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
}
