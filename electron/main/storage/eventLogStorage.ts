import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { DomainEvent } from '../../../src/timeline/eventLog';
import { getAppDataDirectoryPath } from '../appProfile';

export type PersistedEventLogPayload = {
  eventLog: DomainEvent[];
  filePath: string;
};

export type SaveEventLogResult = {
  filePath: string;
  savedAt: string;
};

let saveEventLogQueue: Promise<void> = Promise.resolve();

export function getEventLogDirectoryPath(): string {
  return getAppDataDirectoryPath();
}

export function getEventLogFilePath(): string {
  return path.join(getEventLogDirectoryPath(), 'event-log.json');
}

function getPackagedUserDataEventLogFilePath(): string {
  return path.join(app.getPath('userData'), 'event-log.json');
}

async function ensureEventLogDirectoryExists() {
  await fs.mkdir(getEventLogDirectoryPath(), { recursive: true });
}

export async function loadEventLog(): Promise<PersistedEventLogPayload> {
  await ensureEventLogDirectoryExists();
  const filePath = getEventLogFilePath();
  const packagedPath = getPackagedUserDataEventLogFilePath();

  try {
    const fileContents = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(fileContents) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error('The event log file does not contain an array.');
    }

    return {
      eventLog: parsed as DomainEvent[],
      filePath,
    };
  } catch (error) {
    if (
      error != null &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      if (packagedPath !== filePath) {
        try {
          const packagedContents = await fs.readFile(packagedPath, 'utf8');
          const parsed = JSON.parse(packagedContents) as unknown;
          if (!Array.isArray(parsed)) {
            throw new Error(
              'The Electron event log file does not contain an array.',
            );
          }
          await saveEventLog(parsed as DomainEvent[]);
          return { eventLog: parsed as DomainEvent[], filePath };
        } catch (packagedError) {
          if (
            packagedError == null ||
            typeof packagedError !== 'object' ||
            !('code' in packagedError) ||
            packagedError.code !== 'ENOENT'
          ) {
            throw packagedError;
          }
        }
      }
      return { eventLog: [], filePath };
    }
    throw error;
  }
}

export async function saveEventLog(
  eventLog: DomainEvent[],
): Promise<SaveEventLogResult> {
  const filePath = getEventLogFilePath();
  const serialized = JSON.stringify(eventLog, null, 2);
  const saveOperation = saveEventLogQueue.then(() =>
    writeSerializedEventLog(filePath, serialized),
  );
  saveEventLogQueue = saveOperation.then(
    () => undefined,
    () => undefined,
  );
  return saveOperation;
}

async function writeSerializedEventLog(
  filePath: string,
  serialized: string,
): Promise<SaveEventLogResult> {
  await ensureEventLogDirectoryExists();
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;

  try {
    await fs.writeFile(temporaryPath, serialized, 'utf8');
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => {});
    throw error;
  }

  return {
    filePath,
    savedAt: new Date().toISOString(),
  };
}
