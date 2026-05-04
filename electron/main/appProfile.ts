import { app } from 'electron';
import path from 'node:path';

export type FlowAppProfile = 'dev' | 'prod';

const PROFILE_ENV = 'FLOW_APP_PROFILE';

export function getAppProfile(): FlowAppProfile {
  const explicitProfile = process.env[PROFILE_ENV]?.trim().toLowerCase();
  if (explicitProfile === 'dev' || explicitProfile === 'prod') {
    return explicitProfile;
  }
  if (!app.isPackaged) return 'dev';
  return app.getName().toLowerCase().includes('dev') ? 'dev' : 'prod';
}

export function getAppDisplayName(): string {
  return getAppProfile() === 'dev' ? 'Flow Dev' : 'Flow';
}

export function getCompanionWindowTitle(): string {
  return `${getAppDisplayName()} Companion`;
}

export function getAppDataDirectoryName(): string {
  return getAppDisplayName();
}

export function getAppDataDirectoryPath(): string {
  return path.join(app.getPath('appData'), getAppDataDirectoryName());
}
