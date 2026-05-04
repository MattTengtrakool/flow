import type {ChatMessage} from '../../src/chat/runChat';
import type {
  AudioPermissionStatus,
  AudioRecordingRuntimeState,
  AudioRecordingSource,
} from '../../src/audio/types';
import type {CostSummary} from '../../src/planner/costSummary';
import type {PlannerRevisionCause} from '../../src/planner/types';
import type {MeetingCandidateView} from '../../src/meeting/types';
import type {TimelineDiagnosticsReport} from '../../src/timeline/diagnostics';
import type {TimelineView} from '../../src/timeline/eventLog';
import type {WorklogCalendarBlock} from '../../src/worklog/types';
export type {CalendarView} from './dateUtils';
import type {CalendarView} from './dateUtils';

export type NavKey = 'today' | 'calendar' | 'chat' | 'insights' | 'settings';

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
  };
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

export type SelectionState = {
  selectedDateIso: string;
  selectedBlockId: string | null;
  selectedBlock: WorklogCalendarBlock | null;
};

export type ChatState = {
  messages: ChatMessage[];
  loading: boolean;
  draft: string;
  setDraft: (value: string) => void;
  send: () => Promise<void>;
};

export type CalendarState = {
  view: CalendarView;
  anchorIso: string;
  visibleDateIsos: string[];
  blocksByDate: Record<string, WorklogCalendarBlock[]>;
  selectedDateIso: string;
  selectedBlockId: string | null;
  setView: (view: CalendarView) => void;
  selectDate: (dateIso: string) => void;
  selectBlock: (blockId: string) => void;
  shift: (delta: number) => void;
  goToToday: () => void;
};

export type AppMetrics = {
  allBlocks: WorklogCalendarBlock[];
  costSummary: CostSummary;
  timezone: string;
};
