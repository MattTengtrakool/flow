import type {ChatMessage} from '../../src/chat/runChat';
import type {
  AudioPermissionStatus,
  AudioRecordingRuntimeState,
  AudioRecordingSource,
} from '../../src/audio/types';
import type {ExternalCalendarEventView} from '../../src/calendar/types';
import type {CostSummary} from '../../src/planner/costSummary';
import type {PlannerRevisionCause} from '../../src/planner/types';
import type {MeetingCandidateView} from '../../src/meeting/types';
import type {TimelineDiagnosticsReport} from '../../src/timeline/diagnostics';
import type {TimelineView} from '../../src/timeline/eventLog';
import type {WorklogCalendarBlock} from '../../src/worklog/types';
import type {
  ApiKeyStatus,
  AiConnectionMode,
  ApiProvider,
  FlowSettings,
  TimelineStatePayload,
} from '../shared/flowApi';
export type {CalendarView} from './dateUtils';

export type NavKey = 'today' | 'calendar' | 'chat' | 'insights' | 'settings';

export type CalendarDisplayItemView =
  | {
      kind: 'observed_block';
      id: string;
      dateIso: string;
      block: WorklogCalendarBlock;
    }
  | {
      kind: 'scheduled_event' | 'context_event';
      id: string;
      dateIso: string;
      event: ExternalCalendarEventView;
    };

export type TimelineUiState = {
  eventLogLength: number;
  timeline: TimelineView;
  hydrationStatus: 'loading' | 'ready' | 'error';
  storagePath: string | null;
  errorMessage: string | null;
  lastSavedAt: string | null;
  continuousModeState: {
    enabled: boolean;
    currentMode: 'off' | 'capturing' | 'observing' | 'paused' | 'error';
    statusMessage: string;
    lastCapturedAt: string | null;
    lastObservedAt: string | null;
    lastObservedFrameHash: string | null;
    consecutiveFailureCount: number;
  };
  plannerRuntimeState: {
    inFlight: boolean;
    lastRunAt: string | null;
    lastRunCause: PlannerRevisionCause | null;
    lastSnapshotId: string | null;
    lastFailureMessage: string | null;
    lastSkippedReason: string | null;
    consecutiveFailureCount: number;
    status: 'idle' | 'planning' | 'failed';
  };
  privacyModeEnabled: boolean;
  aiConnectionMode: AiConnectionMode;
  selectedProvider: ApiProvider;
  managedAi: FlowSettings['managedAi'];
  apiKeyStatus: Record<ApiProvider, ApiKeyStatus>;
  recentActivity: TimelineStatePayload['recentActivity'];
  meetingDetection: TimelineStatePayload['meetingDetection'];
  activeMeetingRecording: TimelineStatePayload['activeMeetingRecording'];
  meetingTranscriptionStatus: TimelineStatePayload['meetingTranscriptionStatus'];
  audioRuntimeState: AudioRecordingRuntimeState;
  activeMeetingCandidate: MeetingCandidateView | null;
  audioPermissionStatus: AudioPermissionStatus | null;
  diagnostics: TimelineDiagnosticsReport | null;
  runCaptureNow: () => Promise<void>;
  runPlannerRevisionNow: (force?: boolean) => Promise<void>;
  runDiagnosticReplan: () => Promise<void>;
  requestAudioPermissions: () => Promise<void>;
  startMeetingRecording: (
    meetingId?: string | null,
    source?: AudioRecordingSource,
  ) => Promise<void>;
  pauseAudioRecording: () => Promise<void>;
  resumeAudioRecording: () => Promise<void>;
  stopAudioRecording: () => Promise<void>;
  dismissMeetingPrompt: (meetingId: string) => Promise<void>;
  startSession: () => void;
  stopSession: () => Promise<void>;
};

export type ChatState = {
  messages: ChatMessage[];
  loading: boolean;
  draft: string;
};

export type CalendarScreenModel = {
  blocksByDate: Record<string, WorklogCalendarBlock[]>;
  selectedDateIso: string;
  selectedBlock: WorklogCalendarBlock | null;
  selectedFocusedMinutes: number;
};

export type InsightsModel = {
  allBlocks: WorklogCalendarBlock[];
  costSummary: CostSummary;
};
