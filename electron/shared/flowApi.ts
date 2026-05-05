import type {RunChatTurnArgs, RunChatTurnResult} from '../../src/chat/runChat';
import type {
  CalendarEventAnnotationPatch,
  CalendarEventBlockLinkAction,
  CalendarItemUpdate,
  CalendarReconciliationView,
  CalendarSourceMode,
  CalendarSourceView,
  CalendarStatePayload,
  CreateCalendarItemInput,
  ExternalCalendarEventView,
  TaskFitSuggestion,
} from '../../src/calendar/types';
import type {
  MeetingAssistantSettings,
  MeetingDetection,
  MeetingRecording,
  MeetingRuntimeState,
  StartMeetingTranscriptionArgs,
} from '../../src/meetings/types';
import type {ProactiveSettings, ProactiveState} from '../../src/proactive/types';
import type {PlannerRevisionCause, TaskPlanRevisionFailure} from '../../src/planner/types';
import type {TimelineDiagnosticsReport} from '../../src/timeline/diagnostics';
import type {DomainEvent, TimelineView} from '../../src/timeline/eventLog';
import type {WorklogCalendarBlock} from '../../src/worklog/types';
import type {WorkCategoryOption} from '../../src/workCategories';
import type {
  CaptureInspectionPayload,
  CaptureResultPayload,
  ContextSnapshotPayload,
  PermissionsStatus,
} from '../../src/types/contextCapture';

export type ApiProvider = 'gemini' | 'anthropic';
export type AiConnectionMode = 'managed' | 'byok';
export type FlowAppProfile = 'dev' | 'prod';

export type ApiKeyStatus = {
  configured: boolean;
  source: 'stored' | 'env' | 'missing';
  encrypted: boolean;
  lastValidatedAt: string | null;
  validationStatus: 'untested' | 'valid' | 'invalid' | 'error';
  validationMessage: string | null;
};

export type FlowSettings = {
  onboardingCompleted: boolean;
  aiConnectionMode: AiConnectionMode;
  selectedProvider: ApiProvider;
  privacyModeEnabled: boolean;
  managedAi: {
    configured: boolean;
    endpoint: string | null;
    authenticated: boolean;
  };
  proactive: ProactiveSettings;
  meetingAssistant: MeetingAssistantSettings;
  customCategories: WorkCategoryOption[];
  apiKeys: Record<ApiProvider, ApiKeyStatus>;
};

export type FlowSettingsPatch = Partial<
  Pick<
    FlowSettings,
    | 'onboardingCompleted'
    | 'aiConnectionMode'
    | 'selectedProvider'
    | 'privacyModeEnabled'
    | 'proactive'
    | 'meetingAssistant'
    | 'customCategories'
  >
>;

export type ApiKeyValidationResult = {
  provider: ApiProvider;
  ok: boolean;
  status: ApiKeyStatus['validationStatus'];
  message: string;
  checkedAt: string;
};

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
  lastCapturedAt: string | null;
  lastObservedAt: string | null;
  plannerLastRunAt: string | null;
  plannerLastSnapshotId: string | null;
  plannerLastFailureMessage: string | null;
  plannerStatus: 'idle' | 'planning' | 'failed';
  plannerRuntimeState: {
    lastRunAt: string | null;
    lastRunCause: PlannerRevisionCause | null;
    lastSnapshotId: string | null;
    lastFailure: TaskPlanRevisionFailure | null;
    lastSkippedReason: string | null;
    consecutiveFailureCount: number;
  };
  diagnostics: TimelineDiagnosticsReport | null;
  privacyModeEnabled: boolean;
  aiConnectionMode: AiConnectionMode;
  selectedProvider: ApiProvider;
  managedAi: FlowSettings['managedAi'];
  apiKeyStatus: Record<ApiProvider, ApiKeyStatus>;
  recentActivity: Array<{
    kind: 'capture' | 'observation' | 'planner';
    occurredAt: string;
    title: string;
    detail: string;
  }>;
  meetingDetection: MeetingDetection | null;
  activeMeetingRecording: MeetingRecording | null;
  meetingTranscriptionStatus: MeetingRuntimeState['transcriptionStatus'];
};

export type WorklogViewRequest = {
  dateIsos: string[];
  timezone: string;
};

export type WorklogViewPayload = {
  blocksByDate: Record<string, WorklogCalendarBlock[]>;
  externalEventsByDate: Record<string, ExternalCalendarEventView[]>;
  calendarSources: CalendarSourceView[];
  reconciliation: CalendarReconciliationView;
  taskFitSuggestions: TaskFitSuggestion[];
  version: number;
};

export type FlowElectronApi = {
  app: {
    getVersion: () => Promise<string>;
    getProfile: () => Promise<FlowAppProfile>;
  };
  companion: {
    setVisible: (visible: boolean) => Promise<void>;
    setContentHeight: (height: number) => Promise<void>;
    setContentSize: (size: { width: number; height: number }) => Promise<void>;
    setMouseEventsIgnored: (ignored: boolean) => Promise<void>;
  };
  storage: {
    loadEventLog: () => Promise<PersistedEventLogPayload>;
    saveEventLog: (eventLog: DomainEvent[]) => Promise<SaveEventLogResult>;
  };
  capture: {
    startMonitoring: (options: MonitoringOptions) => Promise<ContextSnapshotPayload>;
    stopMonitoring: () => Promise<void>;
    setPreciseModeEnabled: (enabled: boolean) => Promise<ContextSnapshotPayload>;
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
  calendar: {
    getState: () => Promise<CalendarStatePayload>;
    connectGoogleAccount: () => Promise<CalendarStatePayload>;
    disconnectGoogleAccount: (accountId: string) => Promise<CalendarStatePayload>;
    syncNow: () => Promise<CalendarStatePayload>;
    updateCalendarSelection: (
      accountId: string,
      calendarId: string,
      enabled: boolean,
    ) => Promise<CalendarStatePayload>;
    updateCalendarSourceMode: (
      accountId: string,
      calendarId: string,
      mode: CalendarSourceMode,
    ) => Promise<CalendarStatePayload>;
    updateEventAnnotation: (
      eventId: string,
      patch: CalendarEventAnnotationPatch,
    ) => Promise<CalendarStatePayload>;
    updateEventBlockLink: (
      eventId: string,
      blockId: string,
      action: CalendarEventBlockLinkAction,
    ) => Promise<CalendarStatePayload>;
    addStateListener: (listener: (state: CalendarStatePayload) => void) => {
      remove: () => void;
    };
  };
  settings: {
    getSettings: () => Promise<FlowSettings>;
    updateSettings: (patch: FlowSettingsPatch) => Promise<FlowSettings>;
    setApiKey: (provider: ApiProvider, value: string) => Promise<FlowSettings>;
    clearApiKey: (provider: ApiProvider) => Promise<FlowSettings>;
    validateApiKey: (provider: ApiProvider) => Promise<ApiKeyValidationResult>;
  };
  proactive: {
    getState: () => Promise<ProactiveState>;
    dismiss: (insightId: string) => Promise<ProactiveState>;
    snooze: (insightId: string, minutes: number) => Promise<ProactiveState>;
    action: (insightId: string, actionId: string) => Promise<ProactiveState>;
    addStateListener: (listener: (state: ProactiveState) => void) => {
      remove: () => void;
    };
  };
  meetings: {
    getState: () => Promise<MeetingRuntimeState>;
    startTranscription: (
      args: StartMeetingTranscriptionArgs,
    ) => Promise<MeetingRuntimeState>;
    stopTranscription: (meetingId: string) => Promise<MeetingRuntimeState>;
    dismissDetection: (detectionId: string) => Promise<MeetingRuntimeState>;
    addStateListener: (listener: (state: MeetingRuntimeState) => void) => {
      remove: () => void;
    };
  };
  timeline: {
    getState: () => Promise<TimelineStatePayload>;
    getWorklogView: (request: WorklogViewRequest) => Promise<WorklogViewPayload>;
    startSession: () => Promise<unknown>;
    stopSession: () => Promise<unknown>;
    captureNow: () => Promise<CaptureResultPayload>;
    runPlannerRevision: (force: boolean) => Promise<unknown>;
    getDiagnostics: () => Promise<TimelineDiagnosticsReport>;
    runDiagnosticReplan: (args?: {sessionId?: string | null}) => Promise<unknown>;
    editBlockNotes: (args: {
      notesKey: string;
      blockId: string | null;
      notes: string;
    }) => Promise<unknown>;
    correctBlock: (args: {
      blockId: string;
      notesKey?: string;
      title?: string;
      category?: string;
      markedWrong?: boolean;
      feedback?: string;
      mergeWithBlockId?: string;
      splitAt?: string;
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
