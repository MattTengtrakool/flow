import type { TimelineView } from '../../src/timeline/eventLog';
import type { ExternalCalendarEventView } from '../../src/calendar/types';
import type { WorklogCalendarBlock } from '../../src/worklog/types';
import type {
  ApiKeyStatus,
  AiConnectionMode,
  ApiProvider,
  FlowSettings,
  TimelineStatePayload,
} from '../shared/flowApi';
export type { CalendarView } from './dateUtils';

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
    currentMode: 'off' | 'capturing' | 'observing' | 'error';
    statusMessage: string;
    lastCapturedAt: string | null;
    lastObservedAt: string | null;
    lastObservedFrameHash: string | null;
    consecutiveFailureCount: number;
  };
  plannerRuntimeState: {
    inFlight: boolean;
    lastRunAt: string | null;
    lastSnapshotId: string | null;
    lastFailureMessage: string | null;
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
  runCaptureNow: () => Promise<void>;
  runPlannerRevisionNow: (force?: boolean) => Promise<void>;
  startSession: () => void;
  stopSession: () => Promise<void>;
};
