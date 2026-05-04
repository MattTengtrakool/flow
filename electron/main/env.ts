import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const ENV_FILE_NAME = '.env';
const PROFILE_ENV = 'FLOW_APP_PROFILE';

loadLocalEnv();

function loadLocalEnv() {
  for (const filePath of candidateEnvPaths()) {
    if (!fs.existsSync(filePath)) continue;
    const raw = fs.readFileSync(filePath, 'utf8');
    for (const [key, value] of parseEnvFile(raw)) {
      if (process.env[key] == null) {
        process.env[key] = value;
      }
    }
    return;
  }
}

function candidateEnvPaths(): string[] {
  const explicitProfile = process.env[PROFILE_ENV]?.trim().toLowerCase();
  const profile =
    explicitProfile === 'dev' || explicitProfile === 'prod'
      ? explicitProfile
      : !app.isPackaged || app.getName().toLowerCase().includes('dev')
      ? 'dev'
      : 'prod';
  const profileEnvFile =
    profile === 'dev' || profile === 'prod' ? `.env.${profile}` : null;
  return Array.from(
    new Set([
      ...(profileEnvFile != null
        ? [
            path.join(process.cwd(), profileEnvFile),
            path.join(app.getAppPath(), profileEnvFile),
          ]
        : []),
      path.join(process.cwd(), ENV_FILE_NAME),
      path.join(app.getAppPath(), ENV_FILE_NAME),
    ]),
  );
}

function parseEnvFile(raw: string): Array<[string, string]> {
  return raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'))
    .map(line => {
      const equalsIndex = line.indexOf('=');
      if (equalsIndex === -1) return null;
      const key = line.slice(0, equalsIndex).trim();
      const value = stripQuotes(line.slice(equalsIndex + 1).trim());
      return key.length > 0 ? ([key, value] as [string, string]) : null;
    })
    .filter((entry): entry is [string, string] => entry != null);
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
