import type {
  CaptureInspectionPayload,
  CaptureMetadataPayload,
  ContextSnapshotPayload,
} from '../types/contextCapture';
import type {
  ObservationRun,
  StructuredObservation,
} from '../observation/types';
import type {
  AudioPermissionStatus,
  AudioRecordingView,
  AudioTranscriptView,
} from '../audio/types';
import type {MeetingCandidateView} from '../meeting/types';
import type {
  TaskPlanRevisionFailure,
  TaskPlanSnapshot,
} from '../planner/types';
import type {
  CalendarItemUpdate,
  UserCalendarItem,
} from '../calendar/types';
import type {
  PendingObservationView,
  TaskDecisionView,
  TaskEventMetadata,
  TaskLineageView,
  TaskReconciliationResult,
  TaskSegmentState,
  TaskSegmentView,
  UserTaskCorrection,
} from '../tasks/types';

export type EventBase = {
  id: string;
  occurredAt: string;
} & TaskEventMetadata;

export type SessionStartedEvent = EventBase & {
  type: 'session_started';
  sessionId: string;
  title: string;
};

export type SessionStoppedEvent = EventBase & {
  type: 'session_stopped';
  sessionId: string;
};

export type SessionRenamedEvent = EventBase & {
  type: 'session_renamed';
  sessionId: string;
  title: string;
};

export type ObservationAddedEvent = EventBase & {
  type: 'observation_added';
  observationId: string;
  sessionId?: string;
  text: string;
  structured?: StructuredObservation;
  engineRun?: ObservationRun;
  capturePreviewDataUri?: string | null;
};

export type ObservationDeletedEvent = EventBase & {
  type: 'observation_deleted';
  observationId: string;
};

export type ContextSnapshotRecordedEvent = EventBase & {
  type: 'context_snapshot_recorded';
  snapshotId: string;
  snapshot: ContextSnapshotPayload;
};

export type CaptureTargetResolvedEvent = EventBase & {
  type: 'capture_target_resolved';
  inspectionId: string;
  inspection: CaptureInspectionPayload;
};

export type CapturePerformedEvent = EventBase & {
  type: 'capture_performed';
  captureId: string;
  capture: CaptureMetadataPayload;
};

export type TaskPlanRevisedEvent = EventBase & {
  type: 'task_plan_revised';
  snapshot: TaskPlanSnapshot;
};

export type TaskPlanRevisionFailedEvent = EventBase & {
  type: 'task_plan_revision_failed';
  failure: TaskPlanRevisionFailure;
};

export type UserBlockNotesEditedEvent = EventBase & {
  type: 'user_block_notes_edited';
  notesKey: string;
  blockId: string | null;
  notes: string;
};

export type CalendarItemCreatedEvent = EventBase & {
  type: 'calendar_item_created';
  item: UserCalendarItem;
};

export type CalendarItemUpdatedEvent = EventBase & {
  type: 'calendar_item_updated';
  itemId: string;
  updates: CalendarItemUpdate;
};

export type CalendarItemDeletedEvent = EventBase & {
  type: 'calendar_item_deleted';
  itemId: string;
};

export type MeetingCandidateDetectedEvent = EventBase & {
  type: 'meeting_candidate_detected';
  candidate: MeetingCandidateView;
};

export type MeetingPromptShownEvent = EventBase & {
  type: 'meeting_prompt_shown';
  meetingId: string;
  shownAt: string;
};

export type MeetingPromptDismissedEvent = EventBase & {
  type: 'meeting_prompt_dismissed';
  meetingId: string;
  dismissedAt: string;
  reason: 'user_dismissed' | 'not_a_meeting' | 'cooldown' | 'recording_started';
};

export type MeetingEndedEvent = EventBase & {
  type: 'meeting_ended';
  meetingId: string;
  endedAt: string;
};

export type AudioPermissionChangedEvent = EventBase & {
  type: 'audio_permission_changed';
  status: AudioPermissionStatus;
};

export type AudioRecordingStartedEvent = EventBase & {
  type: 'audio_recording_started';
  recording: AudioRecordingView;
};

export type AudioRecordingPausedEvent = EventBase & {
  type: 'audio_recording_paused';
  recordingId: string;
  pausedAt: string;
};

export type AudioRecordingResumedEvent = EventBase & {
  type: 'audio_recording_resumed';
  recordingId: string;
  resumedAt: string;
};

export type AudioRecordingStoppedEvent = EventBase & {
  type: 'audio_recording_stopped';
  recordingId: string;
  stoppedAt: string;
  durationMs: number | null;
  filePath: string | null;
  byteLength: number | null;
};

export type AudioRecordingFailedEvent = EventBase & {
  type: 'audio_recording_failed';
  recordingId: string | null;
  failedAt: string;
  errorMessage: string;
};

export type AudioRecordingDeletedEvent = EventBase & {
  type: 'audio_recording_deleted';
  recordingId: string;
  deletedAt: string;
};

export type AudioTranscriptGeneratedEvent = EventBase & {
  type: 'audio_transcript_generated';
  transcript: AudioTranscriptView;
};

export type MeetingSummaryGeneratedEvent = EventBase & {
  type: 'meeting_summary_generated';
  meetingId: string;
  recordingId: string | null;
  generatedAt: string;
  title: string;
  summary: string;
  actionItems: string[];
};

export type TaskDecisionRecordedEvent = EventBase & {
  type: 'task_decision_recorded';
  decisionId: string;
  decision: TaskDecisionView;
};

export type TaskSegmentStartedEvent = EventBase & {
  type: 'task_segment_started';
  segment: TaskSegmentView;
};

export type TaskSegmentClosedEvent = EventBase & {
  type: 'task_segment_closed';
  segmentId: string;
  endTime: string;
  nextState?: TaskSegmentState;
};

export type TaskLineageResumedEvent = EventBase & {
  type: 'task_lineage_resumed';
  lineageId: string;
  segmentId: string;
  sessionId?: string | null;
  resumedAt: string;
};

export type TaskInterruptionMarkedEvent = EventBase & {
  type: 'task_interruption_marked';
  segmentId: string;
  interruption: {
    startTime: string;
    endTime: string | null;
    reason: string;
  };
};

export type TaskBranchStartedEvent = EventBase & {
  type: 'task_branch_started';
  segment: TaskSegmentView;
  parentSegmentId?: string | null;
  parentLineageId?: string | null;
};

export type TaskPendingBufferedEvent = EventBase & {
  type: 'task_pending_buffered';
  pendingObservationId: string;
  pendingObservationIds: string[];
  bufferedUntil: string | null;
  reasonCodes: string[];
  summary: string;
};

export type TaskPendingResolvedEvent = EventBase & {
  type: 'task_pending_resolved';
  observationIds: string[];
  resolutionDecisionId?: string | null;
};

export type TaskReconciledEvent = EventBase & {
  type: 'task_reconciled';
  reconciliation: TaskReconciliationResult;
};

export type TaskFinalizedEvent = EventBase & {
  type: 'task_finalized';
  segmentId?: string | null;
  lineageId: string;
  finalTitle: string;
  finalSummary: string;
  confidence: number;
};

export type TaskMergedEvent = EventBase & {
  type: 'task_merged';
  mergedSegmentIds: string[];
  targetLineageId: string;
  targetSegmentId?: string | null;
  summary?: string;
};

export type TaskSplitEvent = EventBase & {
  type: 'task_split';
  sourceSegmentId: string;
  newSegments: TaskSegmentView[];
  summary?: string;
};

export type TaskSummaryGeneratedEvent = EventBase & {
  type: 'task_summary_generated';
  lineageId: string;
  segmentId?: string | null;
  title: string;
  summary: string;
  final: boolean;
};

export type UserTaskEditAppliedEvent = EventBase & {
  type: 'user_task_edit_applied';
  correction: UserTaskCorrection;
};

export type DomainEvent =
  | SessionStartedEvent
  | SessionStoppedEvent
  | SessionRenamedEvent
  | ObservationAddedEvent
  | ObservationDeletedEvent
  | ContextSnapshotRecordedEvent
  | CaptureTargetResolvedEvent
  | CapturePerformedEvent
  | TaskPlanRevisedEvent
  | TaskPlanRevisionFailedEvent
  | UserBlockNotesEditedEvent
  | CalendarItemCreatedEvent
  | CalendarItemUpdatedEvent
  | CalendarItemDeletedEvent
  | MeetingCandidateDetectedEvent
  | MeetingPromptShownEvent
  | MeetingPromptDismissedEvent
  | MeetingEndedEvent
  | AudioPermissionChangedEvent
  | AudioRecordingStartedEvent
  | AudioRecordingPausedEvent
  | AudioRecordingResumedEvent
  | AudioRecordingStoppedEvent
  | AudioRecordingFailedEvent
  | AudioRecordingDeletedEvent
  | AudioTranscriptGeneratedEvent
  | MeetingSummaryGeneratedEvent
  | TaskDecisionRecordedEvent
  | TaskSegmentStartedEvent
  | TaskSegmentClosedEvent
  | TaskLineageResumedEvent
  | TaskInterruptionMarkedEvent
  | TaskBranchStartedEvent
  | TaskPendingBufferedEvent
  | TaskPendingResolvedEvent
  | TaskReconciledEvent
  | TaskFinalizedEvent
  | TaskMergedEvent
  | TaskSplitEvent
  | TaskSummaryGeneratedEvent
  | UserTaskEditAppliedEvent;

export type SessionView = {
  id: string;
  title: string;
  startedAt: string;
  endedAt?: string;
  observationIds: string[];
};

export type ObservationView = {
  id: string;
  sessionId?: string;
  text: string;
  structured?: StructuredObservation;
  engineRun?: ObservationRun;
  capturePreviewDataUri?: string | null;
  observedAt: string;
  deletedAt?: string;
};

export type ContextSnapshotView = ContextSnapshotPayload & {
  id: string;
};

export type CaptureInspectionView = {
  id: string;
  inspectedAt: string;
  inspection: CaptureInspectionPayload;
};

export type CaptureRecordView = {
  id: string;
  capturedAt: string;
  capture: CaptureMetadataPayload;
};

export type MeetingSummaryView = {
  meetingId: string;
  recordingId: string | null;
  generatedAt: string;
  title: string;
  summary: string;
  actionItems: string[];
};

export type TimelineView = {
  sessionsById: Record<string, SessionView>;
  sessionOrder: string[];
  observationsById: Record<string, ObservationView>;
  observationOrder: string[];
  contextSnapshotsById: Record<string, ContextSnapshotView>;
  contextSnapshotOrder: string[];
  captureInspectionsById: Record<string, CaptureInspectionView>;
  captureInspectionOrder: string[];
  captureRecordsById: Record<string, CaptureRecordView>;
  captureRecordOrder: string[];
  taskSegmentsById: Record<string, TaskSegmentView>;
  taskSegmentOrder: string[];
  taskLineagesById: Record<string, TaskLineageView>;
  taskLineageOrder: string[];
  taskDecisionsById: Record<string, TaskDecisionView>;
  taskDecisionOrder: string[];
  taskDecisionByObservationId: Record<string, string>;
  pendingObservationsById: Record<string, PendingObservationView>;
  pendingObservationOrder: string[];
  taskReconciliationsById: Record<string, TaskReconciliationResult>;
  taskReconciliationOrder: string[];
  meetingCandidatesById: Record<string, MeetingCandidateView>;
  meetingCandidateOrder: string[];
  audioRecordingsById: Record<string, AudioRecordingView>;
  audioRecordingOrder: string[];
  audioTranscriptsById: Record<string, AudioTranscriptView>;
  audioTranscriptOrder: string[];
  meetingSummariesById: Record<string, MeetingSummaryView>;
  latestAudioPermissionStatus: AudioPermissionStatus | null;
  planSnapshots: TaskPlanSnapshot[];
  lastPlanRevisionFailure: TaskPlanRevisionFailure | null;
  userBlockNotes: Record<
    string,
    {notes: string; editedAt: string; lastBlockId: string | null}
  >;
  calendarItemsById: Record<string, UserCalendarItem>;
  calendarItemOrder: string[];
  currentSessionId: string | null;
  currentTaskSegmentId: string | null;
  currentTaskLineageId: string | null;
  currentSideBranchSegmentId: string | null;
  currentContextSnapshotId: string | null;
  latestCaptureInspectionId: string | null;
  latestCaptureRecordId: string | null;
  latestTaskReconciliationId: string | null;
  activeMeetingCandidateId: string | null;
  activeAudioRecordingId: string | null;
};

export function createDomainId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

export function createOccurredAt(): string {
  return new Date().toISOString();
}

export function createEmptyTimeline(): TimelineView {
  return {
    sessionsById: {},
    sessionOrder: [],
    observationsById: {},
    observationOrder: [],
    contextSnapshotsById: {},
    contextSnapshotOrder: [],
    captureInspectionsById: {},
    captureInspectionOrder: [],
    captureRecordsById: {},
    captureRecordOrder: [],
    taskSegmentsById: {},
    taskSegmentOrder: [],
    taskLineagesById: {},
    taskLineageOrder: [],
    taskDecisionsById: {},
    taskDecisionOrder: [],
    taskDecisionByObservationId: {},
    pendingObservationsById: {},
    pendingObservationOrder: [],
    taskReconciliationsById: {},
    taskReconciliationOrder: [],
    meetingCandidatesById: {},
    meetingCandidateOrder: [],
    audioRecordingsById: {},
    audioRecordingOrder: [],
    audioTranscriptsById: {},
    audioTranscriptOrder: [],
    meetingSummariesById: {},
    latestAudioPermissionStatus: null,
    planSnapshots: [],
    lastPlanRevisionFailure: null,
    userBlockNotes: {},
    calendarItemsById: {},
    calendarItemOrder: [],
    currentSessionId: null,
    currentTaskSegmentId: null,
    currentTaskLineageId: null,
    currentSideBranchSegmentId: null,
    currentContextSnapshotId: null,
    latestCaptureInspectionId: null,
    latestCaptureRecordId: null,
    latestTaskReconciliationId: null,
    activeMeetingCandidateId: null,
    activeAudioRecordingId: null,
  };
}

export const EMPTY_TIMELINE: TimelineView = Object.freeze(
  createEmptyTimeline(),
) as TimelineView;

function cloneTimeline(timeline: TimelineView): TimelineView {
  return {
    ...timeline,
    sessionsById: Object.fromEntries(
      Object.entries(timeline.sessionsById).map(([id, session]) => [
        id,
        {...session, observationIds: session.observationIds.slice()},
      ]),
    ),
    sessionOrder: timeline.sessionOrder.slice(),
    observationsById: Object.fromEntries(
      Object.entries(timeline.observationsById).map(([id, observation]) => [
        id,
        {...observation},
      ]),
    ),
    observationOrder: timeline.observationOrder.slice(),
    contextSnapshotsById: {...timeline.contextSnapshotsById},
    contextSnapshotOrder: timeline.contextSnapshotOrder.slice(),
    captureInspectionsById: {...timeline.captureInspectionsById},
    captureInspectionOrder: timeline.captureInspectionOrder.slice(),
    captureRecordsById: {...timeline.captureRecordsById},
    captureRecordOrder: timeline.captureRecordOrder.slice(),
    taskSegmentsById: Object.fromEntries(
      Object.entries(timeline.taskSegmentsById).map(([id, segment]) => [
        id,
        cloneTaskSegment(segment),
      ]),
    ),
    taskSegmentOrder: timeline.taskSegmentOrder.slice(),
    taskLineagesById: Object.fromEntries(
      Object.entries(timeline.taskLineagesById).map(([id, lineage]) => [
        id,
        cloneTaskLineage(lineage),
      ]),
    ),
    taskLineageOrder: timeline.taskLineageOrder.slice(),
    taskDecisionsById: {...timeline.taskDecisionsById},
    taskDecisionOrder: timeline.taskDecisionOrder.slice(),
    taskDecisionByObservationId: {...timeline.taskDecisionByObservationId},
    pendingObservationsById: {...timeline.pendingObservationsById},
    pendingObservationOrder: timeline.pendingObservationOrder.slice(),
    taskReconciliationsById: {...timeline.taskReconciliationsById},
    taskReconciliationOrder: timeline.taskReconciliationOrder.slice(),
    meetingCandidatesById: Object.fromEntries(
      Object.entries(timeline.meetingCandidatesById).map(([id, candidate]) => [
        id,
        cloneMeetingCandidate(candidate),
      ]),
    ),
    meetingCandidateOrder: timeline.meetingCandidateOrder.slice(),
    audioRecordingsById: Object.fromEntries(
      Object.entries(timeline.audioRecordingsById).map(([id, recording]) => [
        id,
        {...recording},
      ]),
    ),
    audioRecordingOrder: timeline.audioRecordingOrder.slice(),
    audioTranscriptsById: Object.fromEntries(
      Object.entries(timeline.audioTranscriptsById).map(([id, transcript]) => [
        id,
        cloneAudioTranscript(transcript),
      ]),
    ),
    audioTranscriptOrder: timeline.audioTranscriptOrder.slice(),
    meetingSummariesById: Object.fromEntries(
      Object.entries(timeline.meetingSummariesById).map(([id, summary]) => [
        id,
        {...summary, actionItems: summary.actionItems.slice()},
      ]),
    ),
    latestAudioPermissionStatus:
      timeline.latestAudioPermissionStatus == null
        ? null
        : {...timeline.latestAudioPermissionStatus},
    planSnapshots: timeline.planSnapshots.slice(),
    userBlockNotes: {...timeline.userBlockNotes},
    calendarItemsById: Object.fromEntries(
      Object.entries(timeline.calendarItemsById).map(([id, item]) => [
        id,
        {
          ...item,
          recurrence:
            item.recurrence == null
              ? null
              : {
                  ...item.recurrence,
                  daysOfWeek: item.recurrence.daysOfWeek?.slice(),
                },
        },
      ]),
    ),
    calendarItemOrder: timeline.calendarItemOrder.slice(),
  };
}

function cloneTaskSegment(segment: TaskSegmentView): TaskSegmentView {
  return {
    ...segment,
    observationIds: segment.observationIds.slice(),
    supportingApps: segment.supportingApps.slice(),
    entityMemory: {
      apps: segment.entityMemory.apps.slice(),
      repos: segment.entityMemory.repos.slice(),
      ticketIds: segment.entityMemory.ticketIds.slice(),
      projects: segment.entityMemory.projects.slice(),
      documents: segment.entityMemory.documents.slice(),
      people: segment.entityMemory.people.slice(),
      urls: segment.entityMemory.urls.slice(),
    },
    interruptionSegments: segment.interruptionSegments.slice(),
  };
}

function cloneTaskLineage(lineage: TaskLineageView): TaskLineageView {
  return {
    ...lineage,
    sessionIds: lineage.sessionIds.slice(),
    segmentIds: lineage.segmentIds.slice(),
    entityMemory: {
      apps: lineage.entityMemory.apps.slice(),
      repos: lineage.entityMemory.repos.slice(),
      ticketIds: lineage.entityMemory.ticketIds.slice(),
      projects: lineage.entityMemory.projects.slice(),
      documents: lineage.entityMemory.documents.slice(),
      people: lineage.entityMemory.people.slice(),
      urls: lineage.entityMemory.urls.slice(),
    },
  };
}

function cloneMeetingCandidate(
  candidate: MeetingCandidateView,
): MeetingCandidateView {
  return {
    ...candidate,
    reasonCodes: candidate.reasonCodes.slice(),
    sourceEventIds: candidate.sourceEventIds.slice(),
  };
}

function cloneAudioTranscript(
  transcript: AudioTranscriptView,
): AudioTranscriptView {
  return {
    ...transcript,
    segments: transcript.segments.map(segment => ({...segment})),
  };
}

function ensureLineage(
  timeline: TimelineView,
  segment: TaskSegmentView,
): TaskLineageView {
  const existing = timeline.taskLineagesById[segment.lineageId];
  if (existing != null) {
    return existing;
  }

  const created: TaskLineageView = {
    id: segment.lineageId,
    sessionIds: segment.sessionId != null ? [segment.sessionId] : [],
    segmentIds: [segment.id],
    state: segment.state,
    firstStartTime: segment.startTime,
    lastActiveTime: segment.lastActiveTime,
    latestLiveTitle: segment.liveTitle,
    latestLiveSummary: segment.liveSummary,
    finalTitle: segment.finalTitle,
    finalSummary: segment.finalSummary,
    entityMemory: {...segment.entityMemory},
    confidence: segment.confidence,
    reviewStatus: segment.reviewStatus,
  };
  timeline.taskLineagesById[segment.lineageId] = created;
  timeline.taskLineageOrder.push(segment.lineageId);
  return created;
}

function attachObservationToSegment(
  timeline: TimelineView,
  segmentId: string,
  observationId: string,
  observedAt: string,
): void {
  const segment = timeline.taskSegmentsById[segmentId];
  const observation = timeline.observationsById[observationId];
  if (segment == null || observation == null) {
    return;
  }

  if (!segment.observationIds.includes(observationId)) {
    segment.observationIds.push(observationId);
  }
  segment.lastActiveTime = observedAt;
  if (observation.structured != null) {
    segment.supportingApps = Array.from(
      new Set([...segment.supportingApps, ...observation.structured.entities.apps]),
    );
  }

  const lineage = timeline.taskLineagesById[segment.lineageId];
  if (lineage != null) {
    lineage.lastActiveTime = observedAt;
    if (
      segment.sessionId != null &&
      !lineage.sessionIds.includes(segment.sessionId)
    ) {
      lineage.sessionIds.push(segment.sessionId);
    }
  }
}

export function applyEventInPlace(timeline: TimelineView, event: DomainEvent) {
  switch (event.type) {
    case 'session_started': {
      timeline.sessionsById[event.sessionId] = {
        id: event.sessionId,
        title: event.title,
        startedAt: event.occurredAt,
        observationIds: [],
      };
      if (!timeline.sessionOrder.includes(event.sessionId)) {
        timeline.sessionOrder.push(event.sessionId);
      }
      timeline.currentSessionId = event.sessionId;
      break;
    }

    case 'session_stopped': {
      const session = timeline.sessionsById[event.sessionId];
      if (session != null) {
        session.endedAt = event.occurredAt;
      }
      if (timeline.currentTaskSegmentId != null) {
        const activeSegment =
          timeline.taskSegmentsById[timeline.currentTaskSegmentId];
        if (
          activeSegment != null &&
          activeSegment.sessionId === event.sessionId &&
          activeSegment.endTime == null
        ) {
          activeSegment.endTime = event.occurredAt;
          activeSegment.state = 'closed';
          const lineage = timeline.taskLineagesById[activeSegment.lineageId];
          if (lineage != null) {
            lineage.state = 'closed';
            lineage.lastActiveTime = event.occurredAt;
          }
          timeline.currentTaskSegmentId = null;
          timeline.currentTaskLineageId = null;
        }
      }
      if (timeline.currentSessionId === event.sessionId) {
        timeline.currentSessionId = null;
      }
      break;
    }

    case 'session_renamed': {
      const session = timeline.sessionsById[event.sessionId];
      if (session != null) {
        session.title = event.title;
      }
      break;
    }

    case 'observation_added': {
      timeline.observationsById[event.observationId] = {
        id: event.observationId,
        sessionId: event.sessionId,
        text: event.text,
        structured: event.structured,
        engineRun: event.engineRun,
        capturePreviewDataUri: event.capturePreviewDataUri,
        observedAt: event.occurredAt,
      };
      if (!timeline.observationOrder.includes(event.observationId)) {
        timeline.observationOrder.push(event.observationId);
      }
      if (event.sessionId != null) {
        const session = timeline.sessionsById[event.sessionId];
        if (
          session != null &&
          !session.observationIds.includes(event.observationId)
        ) {
          session.observationIds.push(event.observationId);
        }
      }
      break;
    }

    case 'observation_deleted': {
      const observation = timeline.observationsById[event.observationId];
      if (observation != null) {
        observation.deletedAt = event.occurredAt;
      }
      break;
    }

    case 'context_snapshot_recorded': {
      timeline.contextSnapshotsById[event.snapshotId] = {
        ...event.snapshot,
        id: event.snapshotId,
      };
      if (!timeline.contextSnapshotOrder.includes(event.snapshotId)) {
        timeline.contextSnapshotOrder.push(event.snapshotId);
      }
      timeline.currentContextSnapshotId = event.snapshotId;
      break;
    }

    case 'capture_target_resolved': {
      timeline.captureInspectionsById[event.inspectionId] = {
        id: event.inspectionId,
        inspectedAt: event.inspection.inspectedAt,
        inspection: event.inspection,
      };
      if (!timeline.captureInspectionOrder.includes(event.inspectionId)) {
        timeline.captureInspectionOrder.push(event.inspectionId);
      }
      timeline.latestCaptureInspectionId = event.inspectionId;
      break;
    }

    case 'capture_performed': {
      timeline.captureRecordsById[event.captureId] = {
        id: event.captureId,
        capturedAt: event.capture.capturedAt,
        capture: event.capture,
      };
      if (!timeline.captureRecordOrder.includes(event.captureId)) {
        timeline.captureRecordOrder.push(event.captureId);
      }
      timeline.latestCaptureRecordId = event.captureId;
      break;
    }

    case 'task_plan_revised': {
      timeline.planSnapshots.push(event.snapshot);
      timeline.lastPlanRevisionFailure = null;
      break;
    }

    case 'task_plan_revision_failed': {
      timeline.lastPlanRevisionFailure = event.failure;
      break;
    }

    case 'user_block_notes_edited': {
      if (event.notesKey.length === 0) break;
      if (event.notes.trim().length === 0) {
        delete timeline.userBlockNotes[event.notesKey];
      } else {
        timeline.userBlockNotes[event.notesKey] = {
          notes: event.notes,
          editedAt: event.occurredAt,
          lastBlockId: event.blockId,
        };
      }
      break;
    }

    case 'calendar_item_created': {
      timeline.calendarItemsById[event.item.id] = {
        ...event.item,
        recurrence:
          event.item.recurrence == null
            ? null
            : {
                ...event.item.recurrence,
                daysOfWeek: event.item.recurrence.daysOfWeek?.slice(),
              },
      };
      if (!timeline.calendarItemOrder.includes(event.item.id)) {
        timeline.calendarItemOrder.push(event.item.id);
      }
      break;
    }

    case 'calendar_item_updated': {
      const item = timeline.calendarItemsById[event.itemId];
      if (item != null && item.deletedAt == null) {
        timeline.calendarItemsById[event.itemId] = {
          ...item,
          ...event.updates,
          recurrence:
            event.updates.recurrence === undefined
              ? item.recurrence
              : event.updates.recurrence == null
                ? null
                : {
                    ...event.updates.recurrence,
                    daysOfWeek: event.updates.recurrence.daysOfWeek?.slice(),
                  },
          updatedAt: event.occurredAt,
        };
      }
      break;
    }

    case 'calendar_item_deleted': {
      const item = timeline.calendarItemsById[event.itemId];
      if (item != null) {
        timeline.calendarItemsById[event.itemId] = {
          ...item,
          deletedAt: event.occurredAt,
          updatedAt: event.occurredAt,
        };
      }
      break;
    }

    case 'meeting_candidate_detected': {
      const candidate = cloneMeetingCandidate(event.candidate);
      timeline.meetingCandidatesById[candidate.meetingId] = candidate;
      if (!timeline.meetingCandidateOrder.includes(candidate.meetingId)) {
        timeline.meetingCandidateOrder.push(candidate.meetingId);
      }
      if (
        candidate.status === 'candidate' ||
        candidate.status === 'prompted' ||
        candidate.status === 'recording'
      ) {
        timeline.activeMeetingCandidateId = candidate.meetingId;
      }
      break;
    }

    case 'meeting_prompt_shown': {
      const candidate = timeline.meetingCandidatesById[event.meetingId];
      if (candidate != null) {
        candidate.status = 'prompted';
        candidate.promptShownAt = event.shownAt;
        candidate.updatedAt = event.shownAt;
        timeline.activeMeetingCandidateId = event.meetingId;
      }
      break;
    }

    case 'meeting_prompt_dismissed': {
      const candidate = timeline.meetingCandidatesById[event.meetingId];
      if (candidate != null) {
        candidate.status = 'dismissed';
        candidate.dismissedAt = event.dismissedAt;
        candidate.updatedAt = event.dismissedAt;
      }
      if (timeline.activeMeetingCandidateId === event.meetingId) {
        timeline.activeMeetingCandidateId = null;
      }
      break;
    }

    case 'meeting_ended': {
      const candidate = timeline.meetingCandidatesById[event.meetingId];
      if (candidate != null) {
        candidate.status = 'ended';
        candidate.endedAt = event.endedAt;
        candidate.updatedAt = event.endedAt;
      }
      if (timeline.activeMeetingCandidateId === event.meetingId) {
        timeline.activeMeetingCandidateId = null;
      }
      break;
    }

    case 'audio_permission_changed': {
      timeline.latestAudioPermissionStatus = {...event.status};
      break;
    }

    case 'audio_recording_started': {
      timeline.audioRecordingsById[event.recording.recordingId] = {
        ...event.recording,
      };
      if (!timeline.audioRecordingOrder.includes(event.recording.recordingId)) {
        timeline.audioRecordingOrder.push(event.recording.recordingId);
      }
      timeline.activeAudioRecordingId = event.recording.recordingId;
      if (event.recording.meetingId != null) {
        const candidate =
          timeline.meetingCandidatesById[event.recording.meetingId];
        if (candidate != null) {
          candidate.status = 'recording';
          candidate.recordingId = event.recording.recordingId;
          candidate.updatedAt = event.recording.startedAt;
        }
      }
      break;
    }

    case 'audio_recording_paused': {
      const recording = timeline.audioRecordingsById[event.recordingId];
      if (recording != null) {
        recording.status = 'paused';
        recording.pausedAt = event.pausedAt;
      }
      break;
    }

    case 'audio_recording_resumed': {
      const recording = timeline.audioRecordingsById[event.recordingId];
      if (recording != null) {
        recording.status = 'recording';
        recording.resumedAt = event.resumedAt;
        recording.pausedAt = null;
      }
      break;
    }

    case 'audio_recording_stopped': {
      const recording = timeline.audioRecordingsById[event.recordingId];
      if (recording != null) {
        recording.status = 'stopped';
        recording.stoppedAt = event.stoppedAt;
        recording.durationMs = event.durationMs;
        recording.filePath = event.filePath;
        recording.byteLength = event.byteLength;
        if (recording.meetingId != null) {
          const candidate =
            timeline.meetingCandidatesById[recording.meetingId];
          if (candidate != null) {
            candidate.status = 'ended';
            candidate.endedAt = event.stoppedAt;
            candidate.updatedAt = event.stoppedAt;
          }
        }
      }
      if (timeline.activeAudioRecordingId === event.recordingId) {
        timeline.activeAudioRecordingId = null;
      }
      break;
    }

    case 'audio_recording_failed': {
      if (event.recordingId != null) {
        const recording = timeline.audioRecordingsById[event.recordingId];
        if (recording != null) {
          recording.status = 'failed';
          recording.errorMessage = event.errorMessage;
          recording.stoppedAt = event.failedAt;
        }
        if (timeline.activeAudioRecordingId === event.recordingId) {
          timeline.activeAudioRecordingId = null;
        }
      }
      break;
    }

    case 'audio_recording_deleted': {
      const recording = timeline.audioRecordingsById[event.recordingId];
      if (recording != null) {
        recording.status = 'deleted';
        recording.stoppedAt = event.deletedAt;
      }
      if (timeline.activeAudioRecordingId === event.recordingId) {
        timeline.activeAudioRecordingId = null;
      }
      break;
    }

    case 'audio_transcript_generated': {
      timeline.audioTranscriptsById[event.transcript.transcriptId] =
        cloneAudioTranscript(event.transcript);
      if (
        !timeline.audioTranscriptOrder.includes(event.transcript.transcriptId)
      ) {
        timeline.audioTranscriptOrder.push(event.transcript.transcriptId);
      }
      break;
    }

    case 'meeting_summary_generated': {
      timeline.meetingSummariesById[event.meetingId] = {
        meetingId: event.meetingId,
        recordingId: event.recordingId,
        generatedAt: event.generatedAt,
        title: event.title,
        summary: event.summary,
        actionItems: event.actionItems.slice(),
      };
      break;
    }

    case 'task_segment_started': {
      timeline.taskSegmentsById[event.segment.id] = cloneTaskSegment(
        event.segment,
      );
      if (!timeline.taskSegmentOrder.includes(event.segment.id)) {
        timeline.taskSegmentOrder.push(event.segment.id);
      }

      const lineage = ensureLineage(timeline, event.segment);
      if (!lineage.segmentIds.includes(event.segment.id)) {
        lineage.segmentIds.push(event.segment.id);
      }
      if (
        event.segment.sessionId != null &&
        !lineage.sessionIds.includes(event.segment.sessionId)
      ) {
        lineage.sessionIds.push(event.segment.sessionId);
      }
      lineage.state = event.segment.state;
      lineage.lastActiveTime = event.segment.lastActiveTime;
      lineage.latestLiveTitle = event.segment.liveTitle;
      lineage.latestLiveSummary = event.segment.liveSummary;

      if (event.segment.kind === 'side_branch') {
        timeline.currentSideBranchSegmentId = event.segment.id;
      } else {
        timeline.currentTaskSegmentId = event.segment.id;
        timeline.currentTaskLineageId = event.segment.lineageId;
      }
      break;
    }

    case 'task_segment_closed': {
      const segment = timeline.taskSegmentsById[event.segmentId];
      if (segment != null) {
        segment.endTime = event.endTime;
        segment.state = event.nextState ?? 'closed';
        if (timeline.currentTaskSegmentId === event.segmentId) {
          timeline.currentTaskSegmentId = null;
          timeline.currentTaskLineageId = null;
        }
        if (timeline.currentSideBranchSegmentId === event.segmentId) {
          timeline.currentSideBranchSegmentId = null;
        }

        const lineage = timeline.taskLineagesById[segment.lineageId];
        if (lineage != null) {
          lineage.state = segment.state;
          lineage.lastActiveTime = event.endTime;
        }
      }
      break;
    }

    case 'task_lineage_resumed': {
      const lineage = timeline.taskLineagesById[event.lineageId];
      if (lineage != null) {
        lineage.state = 'open';
        lineage.lastActiveTime = event.resumedAt;
        if (
          event.sessionId != null &&
          !lineage.sessionIds.includes(event.sessionId)
        ) {
          lineage.sessionIds.push(event.sessionId);
        }
      }
      break;
    }

    case 'task_interruption_marked': {
      const segment = timeline.taskSegmentsById[event.segmentId];
      if (segment != null) {
        segment.interruptionSegments.push(event.interruption);
        segment.state = 'interrupted';
      }
      break;
    }

    case 'task_branch_started': {
      timeline.taskSegmentsById[event.segment.id] = cloneTaskSegment(
        event.segment,
      );
      if (!timeline.taskSegmentOrder.includes(event.segment.id)) {
        timeline.taskSegmentOrder.push(event.segment.id);
      }
      ensureLineage(timeline, event.segment);
      timeline.currentSideBranchSegmentId = event.segment.id;
      break;
    }

    case 'task_pending_buffered': {
      for (const observationId of event.pendingObservationIds) {
        timeline.pendingObservationsById[observationId] = {
          observationId,
          bufferedAt: event.occurredAt,
          bufferedUntil: event.bufferedUntil,
          reasonCodes: event.reasonCodes.slice(),
          summary: event.summary,
        };
        if (!timeline.pendingObservationOrder.includes(observationId)) {
          timeline.pendingObservationOrder.push(observationId);
        }
      }
      break;
    }

    case 'task_pending_resolved': {
      for (const observationId of event.observationIds) {
        delete timeline.pendingObservationsById[observationId];
        timeline.pendingObservationOrder =
          timeline.pendingObservationOrder.filter(
            pendingId => pendingId !== observationId,
          );
      }
      break;
    }

    case 'task_decision_recorded': {
      timeline.taskDecisionsById[event.decisionId] = event.decision;
      if (!timeline.taskDecisionOrder.includes(event.decisionId)) {
        timeline.taskDecisionOrder.push(event.decisionId);
      }
      timeline.taskDecisionByObservationId[event.decision.observationId] =
        event.decisionId;

      const observation =
        timeline.observationsById[event.decision.observationId];
      if (
        observation != null &&
        event.decision.targetSegmentId != null &&
        event.decision.decision !== 'hold_pending' &&
        event.decision.decision !== 'ignore'
      ) {
        attachObservationToSegment(
          timeline,
          event.decision.targetSegmentId,
          event.decision.observationId,
          observation.observedAt,
        );
      }
      break;
    }

    case 'task_reconciled': {
      timeline.taskReconciliationsById[event.reconciliation.id] =
        event.reconciliation;
      if (
        !timeline.taskReconciliationOrder.includes(event.reconciliation.id)
      ) {
        timeline.taskReconciliationOrder.push(event.reconciliation.id);
      }
      timeline.latestTaskReconciliationId = event.reconciliation.id;

      const lineage =
        timeline.taskLineagesById[event.reconciliation.lineageId];
      if (lineage != null) {
        lineage.state = 'reconciled';
        lineage.finalTitle = event.reconciliation.finalTitle;
        lineage.finalSummary = event.reconciliation.finalSummary;
        lineage.confidence = event.reconciliation.confidence;
        lineage.reviewStatus = event.reconciliation.reviewStatus;
      }

      for (const segmentId of event.reconciliation.segmentIds) {
        const segment = timeline.taskSegmentsById[segmentId];
        if (segment != null) {
          segment.state = 'reconciled';
          segment.finalTitle = event.reconciliation.finalTitle;
          segment.finalSummary = event.reconciliation.finalSummary;
          segment.reviewStatus = event.reconciliation.reviewStatus;
        }
      }
      break;
    }

    case 'task_finalized': {
      const lineage = timeline.taskLineagesById[event.lineageId];
      if (lineage != null) {
        lineage.state = 'finalized';
        lineage.finalTitle = event.finalTitle;
        lineage.finalSummary = event.finalSummary;
        lineage.confidence = event.confidence;
      }

      if (event.segmentId != null) {
        const segment = timeline.taskSegmentsById[event.segmentId];
        if (segment != null) {
          segment.state = 'finalized';
          segment.finalTitle = event.finalTitle;
          segment.finalSummary = event.finalSummary;
          segment.confidence = event.confidence;
        }
      }
      break;
    }

    case 'task_merged': {
      const lineage = timeline.taskLineagesById[event.targetLineageId];
      if (lineage != null) {
        lineage.segmentIds = Array.from(
          new Set([...lineage.segmentIds, ...event.mergedSegmentIds]),
        );
        lineage.state = 'reconciled';
      }
      break;
    }

    case 'task_split': {
      for (const segment of event.newSegments) {
        timeline.taskSegmentsById[segment.id] = cloneTaskSegment(segment);
        if (!timeline.taskSegmentOrder.includes(segment.id)) {
          timeline.taskSegmentOrder.push(segment.id);
        }
        ensureLineage(timeline, segment);
      }
      break;
    }

    case 'task_summary_generated': {
      if (event.segmentId != null) {
        const segment = timeline.taskSegmentsById[event.segmentId];
        if (segment != null) {
          if (event.final) {
            segment.finalTitle = event.title;
            segment.finalSummary = event.summary;
          } else {
            segment.liveTitle = event.title;
            segment.liveSummary = event.summary;
          }
        }
      }

      const lineage = timeline.taskLineagesById[event.lineageId];
      if (lineage != null) {
        if (event.final) {
          lineage.finalTitle = event.title;
          lineage.finalSummary = event.summary;
        } else {
          lineage.latestLiveTitle = event.title;
          lineage.latestLiveSummary = event.summary;
        }
      }
      break;
    }

    case 'user_task_edit_applied': {
      for (const segmentId of event.correction.segmentIds) {
        const segment = timeline.taskSegmentsById[segmentId];
        if (segment != null) {
          segment.reviewStatus = 'reviewed';
        }
      }
      for (const lineageId of event.correction.lineageIds) {
        const lineage = timeline.taskLineagesById[lineageId];
        if (lineage != null) {
          lineage.reviewStatus = 'reviewed';
        }
      }
      break;
    }
  }
}

export function stepEvent(
  timeline: TimelineView,
  event: DomainEvent,
): TimelineView {
  const next = cloneTimeline(timeline);
  applyEventInPlace(next, event);
  return next;
}

export function replayEventLog(eventLog: DomainEvent[]): TimelineView {
  const timeline = createEmptyTimeline();
  for (const event of eventLog) {
    applyEventInPlace(timeline, event);
  }
  return timeline;
}

export function getCurrentContext(
  timeline: TimelineView,
): ContextSnapshotPayload | null {
  if (timeline.currentContextSnapshotId == null) return null;
  return timeline.contextSnapshotsById[timeline.currentContextSnapshotId] ?? null;
}

export function getVisibleObservations(
  timeline: TimelineView,
): ObservationView[] {
  return timeline.observationOrder
    .map(observationId => timeline.observationsById[observationId])
    .filter(
      (observation): observation is ObservationView =>
        observation != null && observation.deletedAt == null,
    );
}

export function getTaskSegments(timeline: TimelineView): TaskSegmentView[] {
  return timeline.taskSegmentOrder
    .map(segmentId => timeline.taskSegmentsById[segmentId])
    .filter((segment): segment is TaskSegmentView => segment != null);
}

export function getTaskLineages(timeline: TimelineView): TaskLineageView[] {
  return timeline.taskLineageOrder
    .map(lineageId => timeline.taskLineagesById[lineageId])
    .filter((lineage): lineage is TaskLineageView => lineage != null);
}

export function getTaskDecisions(timeline: TimelineView): TaskDecisionView[] {
  return timeline.taskDecisionOrder
    .map(decisionId => timeline.taskDecisionsById[decisionId])
    .filter((decision): decision is TaskDecisionView => decision != null);
}

export function getPendingObservations(
  timeline: TimelineView,
): PendingObservationView[] {
  return timeline.pendingObservationOrder
    .map(observationId => timeline.pendingObservationsById[observationId])
    .filter(
      (pending): pending is PendingObservationView => pending != null,
    );
}

export function getCurrentPrimaryTaskSegment(
  timeline: TimelineView,
): TaskSegmentView | null {
  if (timeline.currentTaskSegmentId == null) return null;
  return timeline.taskSegmentsById[timeline.currentTaskSegmentId] ?? null;
}

export function getCurrentSideBranchSegment(
  timeline: TimelineView,
): TaskSegmentView | null {
  if (timeline.currentSideBranchSegmentId == null) return null;
  return timeline.taskSegmentsById[timeline.currentSideBranchSegmentId] ?? null;
}

export function getCurrentTaskLineage(
  timeline: TimelineView,
): TaskLineageView | null {
  if (timeline.currentTaskLineageId == null) return null;
  return timeline.taskLineagesById[timeline.currentTaskLineageId] ?? null;
}

export function getActiveMeetingCandidate(
  timeline: TimelineView,
): MeetingCandidateView | null {
  if (timeline.activeMeetingCandidateId == null) return null;
  return (
    timeline.meetingCandidatesById[timeline.activeMeetingCandidateId] ?? null
  );
}

export function getActiveAudioRecording(
  timeline: TimelineView,
): AudioRecordingView | null {
  if (timeline.activeAudioRecordingId == null) return null;
  return timeline.audioRecordingsById[timeline.activeAudioRecordingId] ?? null;
}
