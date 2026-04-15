import {NativeModules} from 'react-native';

import type {
  ObservationFixtureRecord,
  ObservationSettings,
  WorkflowRecordingRecord,
} from '../observation/types';

type LoadSettingsPayload = {
  settings: ObservationSettings;
  filePath: string;
};

type LoadFixturesPayload = {
  fixtures: ObservationFixtureRecord[];
  directoryPath: string;
};

type LoadWorkflowRecordingsPayload = {
  recordings: WorkflowRecordingRecord[];
  directoryPath: string;
};

type ObservationLabStorageModule = {
  loadObservationSettings: () => Promise<LoadSettingsPayload>;
  saveObservationSettings: (
    settings: ObservationSettings,
  ) => Promise<{filePath: string; savedAt: string}>;
  loadObservationFixtures: () => Promise<LoadFixturesPayload>;
  saveObservationFixture: (
    fixture: ObservationFixtureRecord,
  ) => Promise<{filePath: string; savedAt: string}>;
  deleteObservationFixture: (
    fixtureId: string,
  ) => Promise<{directoryPath: string; deletedAt: string}>;
  loadWorkflowRecordings: () => Promise<LoadWorkflowRecordingsPayload>;
  saveWorkflowRecording: (
    recording: WorkflowRecordingRecord,
  ) => Promise<{filePath: string; savedAt: string}>;
  deleteWorkflowRecording: (
    recordingId: string,
  ) => Promise<{directoryPath: string; deletedAt: string}>;
};

const nativeModule = NativeModules.ObservationLabStorage as
  | ObservationLabStorageModule
  | undefined;

const inMemoryState = {
  settings: {
    apiKey: '',
    model: 'gemini-2.5-flash-lite',
    savedAt: null,
  } as ObservationSettings,
  fixtures: [] as ObservationFixtureRecord[],
  workflowRecordings: [] as WorkflowRecordingRecord[],
};

export async function loadObservationSettings(): Promise<LoadSettingsPayload> {
  if (nativeModule?.loadObservationSettings != null) {
    return nativeModule.loadObservationSettings();
  }

  return {
    settings: inMemoryState.settings,
    filePath: 'in-memory://observation-settings.json',
  };
}

export async function saveObservationSettings(
  settings: ObservationSettings,
): Promise<{filePath: string; savedAt: string}> {
  if (nativeModule?.saveObservationSettings != null) {
    return nativeModule.saveObservationSettings(settings);
  }

  inMemoryState.settings = settings;

  return {
    filePath: 'in-memory://observation-settings.json',
    savedAt: new Date().toISOString(),
  };
}

export async function loadObservationFixtures(): Promise<LoadFixturesPayload> {
  if (nativeModule?.loadObservationFixtures != null) {
    return nativeModule.loadObservationFixtures();
  }

  return {
    fixtures: inMemoryState.fixtures,
    directoryPath: 'in-memory://observation-fixtures',
  };
}

export async function saveObservationFixture(
  fixture: ObservationFixtureRecord,
): Promise<{filePath: string; savedAt: string}> {
  if (nativeModule?.saveObservationFixture != null) {
    return nativeModule.saveObservationFixture(fixture);
  }

  const nextFixtures = [...inMemoryState.fixtures];
  const existingIndex = nextFixtures.findIndex(item => item.id === fixture.id);

  if (existingIndex >= 0) {
    nextFixtures[existingIndex] = fixture;
  } else {
    nextFixtures.push(fixture);
  }

  inMemoryState.fixtures = nextFixtures;

  return {
    filePath: `in-memory://observation-fixtures/${fixture.id}.json`,
    savedAt: new Date().toISOString(),
  };
}

export async function deleteObservationFixture(
  fixtureId: string,
): Promise<{directoryPath: string; deletedAt: string}> {
  if (nativeModule?.deleteObservationFixture != null) {
    return nativeModule.deleteObservationFixture(fixtureId);
  }

  inMemoryState.fixtures = inMemoryState.fixtures.filter(
    fixture => fixture.id !== fixtureId,
  );

  return {
    directoryPath: 'in-memory://observation-fixtures',
    deletedAt: new Date().toISOString(),
  };
}

export async function loadWorkflowRecordings(): Promise<LoadWorkflowRecordingsPayload> {
  if (nativeModule?.loadWorkflowRecordings != null) {
    return nativeModule.loadWorkflowRecordings();
  }

  return {
    recordings: inMemoryState.workflowRecordings,
    directoryPath: 'in-memory://workflow-recordings',
  };
}

export async function saveWorkflowRecording(
  recording: WorkflowRecordingRecord,
): Promise<{filePath: string; savedAt: string}> {
  if (nativeModule?.saveWorkflowRecording != null) {
    return nativeModule.saveWorkflowRecording(recording);
  }

  const nextRecordings = [...inMemoryState.workflowRecordings];
  const existingIndex = nextRecordings.findIndex(item => item.id === recording.id);

  if (existingIndex >= 0) {
    nextRecordings[existingIndex] = recording;
  } else {
    nextRecordings.push(recording);
  }

  inMemoryState.workflowRecordings = nextRecordings;

  return {
    filePath: `in-memory://workflow-recordings/${recording.id}.json`,
    savedAt: new Date().toISOString(),
  };
}

export async function deleteWorkflowRecording(
  recordingId: string,
): Promise<{directoryPath: string; deletedAt: string}> {
  if (nativeModule?.deleteWorkflowRecording != null) {
    return nativeModule.deleteWorkflowRecording(recordingId);
  }

  inMemoryState.workflowRecordings = inMemoryState.workflowRecordings.filter(
    recording => recording.id !== recordingId,
  );

  return {
    directoryPath: 'in-memory://workflow-recordings',
    deletedAt: new Date().toISOString(),
  };
}
