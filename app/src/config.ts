import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import { AppConfig } from './types';

const DEFAULT_CONFIG: AppConfig = {
  skillDirectories: [],
  ruleFiles: [],
  platform: 'claude-code',
};

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'config.json');
}

export async function loadConfig(): Promise<AppConfig> {
  try {
    const raw = await fs.readFile(getConfigPath(), 'utf-8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(config: AppConfig): Promise<void> {
  const configPath = getConfigPath();
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
}
