import {NativeModules} from 'react-native';

import type {DomainEvent} from '../timeline/eventLog';

type PersistedEventLogPayload = {
  eventLog: DomainEvent[];
  filePath: string;
};

type EventLogStorageModule = {
  loadEventLog: () => Promise<PersistedEventLogPayload>;
  saveEventLog: (
    eventLog: DomainEvent[],
  ) => Promise<{filePath: string; savedAt: string}>;
};

const nativeModule = NativeModules.EventLogStorage as
  | EventLogStorageModule
  | undefined;

let inMemoryEventLog: DomainEvent[] = [];

export async function loadPersistedEventLog(): Promise<PersistedEventLogPayload> {
  if (nativeModule?.loadEventLog != null) {
    return nativeModule.loadEventLog();
  }

  return {
    eventLog: inMemoryEventLog,
    filePath: 'in-memory://event-log.json',
  };
}

export async function savePersistedEventLog(
  eventLog: DomainEvent[],
): Promise<{filePath: string; savedAt: string}> {
  if (nativeModule?.saveEventLog != null) {
    return nativeModule.saveEventLog(eventLog);
  }

  inMemoryEventLog = eventLog;

  return {
    filePath: 'in-memory://event-log.json',
    savedAt: new Date().toISOString(),
  };
}
