import type {RunChatTurnArgs, RunChatTurnResult} from '../../src/chat/runChat';
import type {
  CalendarItemUpdate,
  CreateCalendarItemInput,
} from '../../src/calendar/types';
import type {DomainEvent} from '../../src/timeline/eventLog';
import type {TimelineView} from '../../src/timeline/eventLog';
import type {
  CaptureInspectionPayload,
  CaptureResultPayload,
  ContextSnapshotPayload,
  PermissionsStatus,
} from '../../src/types/contextCapture';

export type MonitoringOptions = {
  preciseModeEnabled: boolean;
  idleThresholdSeconds: number;
};

export type PersistedEventLogPayload = {
  eventLog: DomainEvent[];
  filePath: string;
};

export type SaveEventLogResult = {
  filePath: string;
  savedAt: string;
};

export type TimelineStatePayload = {
  eventLogLength: number;
  timeline: TimelineView;
  hydrationStatus: 'loading' | 'ready' | 'error';
  storagePath: string | null;
  errorMessage: string | null;
  captureEnabled: boolean;
  captureStatusMessage: string;
  plannerInFlight: boolean;
};

export type FlowElectronApi = {
  app: {
    getVersion: () => Promise<string>;
  };
  storage: {
    loadEventLog: () => Promise<PersistedEventLogPayload>;
    saveEventLog: (eventLog: DomainEvent[]) => Promise<SaveEventLogResult>;
  };
  capture: {
    startMonitoring: (
      options: MonitoringOptions,
    ) => Promise<ContextSnapshotPayload>;
    stopMonitoring: () => Promise<void>;
    setPreciseModeEnabled: (
      enabled: boolean,
    ) => Promise<ContextSnapshotPayload>;
    requestAccessibilityPrompt: () => Promise<PermissionsStatus>;
    getPermissionsStatus: () => Promise<PermissionsStatus>;
    requestScreenCaptureAccess: () => Promise<PermissionsStatus>;
    inspectCaptureTarget: () => Promise<CaptureInspectionPayload>;
    captureNow: () => Promise<CaptureResultPayload>;
    addContextSnapshotListener: (
      listener: (snapshot: ContextSnapshotPayload) => void,
    ) => {remove: () => void};
  };
  chat: {
    runTurn: (args: RunChatTurnArgs) => Promise<RunChatTurnResult>;
  };
  timeline: {
    getState: () => Promise<TimelineStatePayload>;
    startSession: () => Promise<unknown>;
    stopSession: () => Promise<unknown>;
    captureNow: () => Promise<CaptureResultPayload>;
    runPlannerRevision: (force: boolean) => Promise<unknown>;
    editBlockNotes: (args: {
      notesKey: string;
      blockId: string | null;
      notes: string;
    }) => Promise<unknown>;
    createCalendarItem: (input: CreateCalendarItemInput) => Promise<unknown>;
    updateCalendarItem: (args: {
      itemId: string;
      updates: CalendarItemUpdate;
    }) => Promise<unknown>;
    deleteCalendarItem: (itemId: string) => Promise<unknown>;
    addStateListener: (listener: (state: TimelineStatePayload) => void) => {
      remove: () => void;
    };
  };
};

declare global {
  interface Window {
    flow?: FlowElectronApi;
  }
}
