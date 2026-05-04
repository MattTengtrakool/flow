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
  TaskPlanRevisionFailure,
  TaskPlanSnapshot,
} from '../planner/types';
import type {
  ProactiveInsight,
  ProactiveInsightView,
} from '../proactive/types';
import type {
  MeetingAudioChunkMetadata,
  MeetingDetection,
  MeetingRecording,
  MeetingSummary,
  MeetingTranscriptChunk,
} from '../meetings/types';

export type EventBase = {
  id: string;
  occurredAt: string;
};

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

export type UserBlockCorrectedEvent = EventBase & {
  type: 'user_block_corrected';
  blockId: string;
  notesKey?: string;
  title?: string;
  category?: string;
  markedWrong?: boolean;
  feedback?: string;
  mergeWithBlockId?: string;
  splitAt?: string;
};

export type ProactiveInsightGeneratedEvent = EventBase & {
  type: 'proactive_insight_generated';
  insight: ProactiveInsight;
};

export type ProactiveInsightDismissedEvent = EventBase & {
  type: 'proactive_insight_dismissed';
  insightId: string;
};

export type ProactiveInsightSnoozedEvent = EventBase & {
  type: 'proactive_insight_snoozed';
  insightId: string;
  snoozedUntil: string;
};

export type ProactiveInsightActionedEvent = EventBase & {
  type: 'proactive_insight_actioned';
  insightId: string;
  actionId: string;
};

export type MeetingDetectedEvent = EventBase & {
  type: 'meeting_detected';
  detection: MeetingDetection;
};

export type MeetingDetectionDismissedEvent = EventBase & {
  type: 'meeting_detection_dismissed';
  detectionId: string;
  dedupeKey: string;
};

export type MeetingTranscriptionStartedEvent = EventBase & {
  type: 'meeting_transcription_started';
  recording: MeetingRecording;
};

export type MeetingAudioChunkCapturedEvent = EventBase & {
  type: 'meeting_audio_chunk_captured';
  chunk: MeetingAudioChunkMetadata;
};

export type MeetingTranscriptChunkAddedEvent = EventBase & {
  type: 'meeting_transcript_chunk_added';
  chunk: MeetingTranscriptChunk;
};

export type MeetingTranscriptionStoppedEvent = EventBase & {
  type: 'meeting_transcription_stopped';
  meetingId: string;
  stoppedAt: string;
  reason: 'user' | 'privacy' | 'error' | 'completed';
};

export type MeetingTranscriptionFailedEvent = EventBase & {
  type: 'meeting_transcription_failed';
  meetingId: string;
  message: string;
};

export type MeetingSummaryGeneratedEvent = EventBase & {
  type: 'meeting_summary_generated';
  summary: MeetingSummary;
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
  | UserBlockCorrectedEvent
  | ProactiveInsightGeneratedEvent
  | ProactiveInsightDismissedEvent
  | ProactiveInsightSnoozedEvent
  | ProactiveInsightActionedEvent
  | MeetingDetectedEvent
  | MeetingDetectionDismissedEvent
  | MeetingTranscriptionStartedEvent
  | MeetingAudioChunkCapturedEvent
  | MeetingTranscriptChunkAddedEvent
  | MeetingTranscriptionStoppedEvent
  | MeetingTranscriptionFailedEvent
  | MeetingSummaryGeneratedEvent;

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

export type UserBlockCorrectionView = {
  blockId: string;
  notesKey?: string;
  title?: string;
  category?: string;
  markedWrong?: boolean;
  feedback?: string;
  mergeWithBlockId?: string;
  splitAt?: string;
  editedAt: string;
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
  planSnapshots: TaskPlanSnapshot[];
  lastPlanRevisionFailure: TaskPlanRevisionFailure | null;
  userBlockNotes: Record<
    string,
    { notes: string; editedAt: string; lastBlockId: string | null }
  >;
  userBlockCorrections: Record<string, UserBlockCorrectionView>;
  proactiveInsightsById: Record<string, ProactiveInsightView>;
  proactiveInsightOrder: string[];
  meetingDetectionsById: Record<string, MeetingDetection>;
  meetingDetectionOrder: string[];
  dismissedMeetingDetectionIds: Record<
    string,
    { dedupeKey: string; dismissedAt: string }
  >;
  meetingRecordingsById: Record<string, MeetingRecording>;
  meetingRecordingOrder: string[];
  meetingTranscriptChunksByMeetingId: Record<string, MeetingTranscriptChunk[]>;
  meetingSummariesByMeetingId: Record<string, MeetingSummary>;
  currentSessionId: string | null;
  currentContextSnapshotId: string | null;
  latestCaptureInspectionId: string | null;
  latestCaptureRecordId: string | null;
};

export function createDomainId(prefix: string): string {
  return `${prefix}_${Math.random()
    .toString(36)
    .slice(2, 10)}_${Date.now().toString(36)}`;
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
    planSnapshots: [],
    lastPlanRevisionFailure: null,
    userBlockNotes: {},
    userBlockCorrections: {},
    proactiveInsightsById: {},
    proactiveInsightOrder: [],
    meetingDetectionsById: {},
    meetingDetectionOrder: [],
    dismissedMeetingDetectionIds: {},
    meetingRecordingsById: {},
    meetingRecordingOrder: [],
    meetingTranscriptChunksByMeetingId: {},
    meetingSummariesByMeetingId: {},
    currentSessionId: null,
    currentContextSnapshotId: null,
    latestCaptureInspectionId: null,
    latestCaptureRecordId: null,
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
        { ...session, observationIds: session.observationIds.slice() },
      ]),
    ),
    sessionOrder: timeline.sessionOrder.slice(),
    observationsById: Object.fromEntries(
      Object.entries(timeline.observationsById).map(([id, observation]) => [
        id,
        { ...observation },
      ]),
    ),
    observationOrder: timeline.observationOrder.slice(),
    contextSnapshotsById: { ...timeline.contextSnapshotsById },
    contextSnapshotOrder: timeline.contextSnapshotOrder.slice(),
    captureInspectionsById: { ...timeline.captureInspectionsById },
    captureInspectionOrder: timeline.captureInspectionOrder.slice(),
    captureRecordsById: { ...timeline.captureRecordsById },
    captureRecordOrder: timeline.captureRecordOrder.slice(),
    planSnapshots: timeline.planSnapshots.slice(),
    userBlockNotes: { ...timeline.userBlockNotes },
    userBlockCorrections: { ...timeline.userBlockCorrections },
    proactiveInsightsById: { ...timeline.proactiveInsightsById },
    proactiveInsightOrder: timeline.proactiveInsightOrder.slice(),
    meetingDetectionsById: { ...timeline.meetingDetectionsById },
    meetingDetectionOrder: timeline.meetingDetectionOrder.slice(),
    dismissedMeetingDetectionIds: {
      ...timeline.dismissedMeetingDetectionIds,
    },
    meetingRecordingsById: { ...timeline.meetingRecordingsById },
    meetingRecordingOrder: timeline.meetingRecordingOrder.slice(),
    meetingTranscriptChunksByMeetingId: Object.fromEntries(
      Object.entries(timeline.meetingTranscriptChunksByMeetingId).map(
        ([meetingId, chunks]) => [
          meetingId,
          chunks.map(chunk => ({ ...chunk })),
        ],
      ),
    ),
    meetingSummariesByMeetingId: { ...timeline.meetingSummariesByMeetingId },
  };
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

    case 'user_block_corrected': {
      const correctionKey = event.notesKey ?? event.blockId;
      if (correctionKey.length === 0) break;
      const previous = timeline.userBlockCorrections[correctionKey];
      const next: UserBlockCorrectionView = {
        blockId: event.blockId,
        notesKey: event.notesKey,
        title: event.title != null ? event.title.trim() : previous?.title,
        category:
          event.category != null ? event.category.trim() : previous?.category,
        markedWrong: event.markedWrong ?? previous?.markedWrong,
        feedback:
          event.feedback != null ? event.feedback.trim() : previous?.feedback,
        mergeWithBlockId:
          event.mergeWithBlockId != null
            ? event.mergeWithBlockId.trim()
            : previous?.mergeWithBlockId,
        splitAt:
          event.splitAt != null ? event.splitAt.trim() : previous?.splitAt,
        editedAt: event.occurredAt,
      };
      if (next.title != null && next.title.length === 0) {
        delete next.title;
      }
      if (next.category != null && next.category.length === 0) {
        delete next.category;
      }
      if (next.feedback != null && next.feedback.length === 0) {
        delete next.feedback;
      }
      if (next.mergeWithBlockId != null && next.mergeWithBlockId.length === 0) {
        delete next.mergeWithBlockId;
      }
      if (next.splitAt != null && next.splitAt.length === 0) {
        delete next.splitAt;
      }
      timeline.userBlockCorrections[correctionKey] = next;
      break;
    }

    case 'proactive_insight_generated': {
      const previous = timeline.proactiveInsightsById[event.insight.id];
      timeline.proactiveInsightsById[event.insight.id] = {
        ...event.insight,
        status: previous?.status ?? 'active',
        dismissedAt: previous?.dismissedAt,
        snoozedUntil: previous?.snoozedUntil,
        actionedAt: previous?.actionedAt,
        lastActionId: previous?.lastActionId,
      };
      if (!timeline.proactiveInsightOrder.includes(event.insight.id)) {
        timeline.proactiveInsightOrder.push(event.insight.id);
      }
      break;
    }

    case 'proactive_insight_dismissed': {
      const insight = timeline.proactiveInsightsById[event.insightId];
      if (insight != null) {
        insight.status = 'dismissed';
        insight.dismissedAt = event.occurredAt;
        delete insight.snoozedUntil;
      }
      break;
    }

    case 'proactive_insight_snoozed': {
      const insight = timeline.proactiveInsightsById[event.insightId];
      if (insight != null) {
        insight.status = 'snoozed';
        insight.snoozedUntil = event.snoozedUntil;
      }
      break;
    }

    case 'proactive_insight_actioned': {
      const insight = timeline.proactiveInsightsById[event.insightId];
      if (insight != null) {
        insight.status = 'dismissed';
        insight.actionedAt = event.occurredAt;
        insight.lastActionId = event.actionId;
        delete insight.snoozedUntil;
      }
      break;
    }

    case 'meeting_detected': {
      timeline.meetingDetectionsById[event.detection.id] = event.detection;
      if (!timeline.meetingDetectionOrder.includes(event.detection.id)) {
        timeline.meetingDetectionOrder.push(event.detection.id);
      }
      break;
    }

    case 'meeting_detection_dismissed': {
      timeline.dismissedMeetingDetectionIds[event.detectionId] = {
        dedupeKey: event.dedupeKey,
        dismissedAt: event.occurredAt,
      };
      break;
    }

    case 'meeting_transcription_started': {
      timeline.meetingRecordingsById[event.recording.meetingId] = {
        ...event.recording,
      };
      if (!timeline.meetingRecordingOrder.includes(event.recording.meetingId)) {
        timeline.meetingRecordingOrder.push(event.recording.meetingId);
      }
      break;
    }

    case 'meeting_audio_chunk_captured': {
      const recording =
        timeline.meetingRecordingsById[event.chunk.meetingId] ?? null;
      if (recording != null && recording.status === 'starting') {
        recording.status = 'recording';
      }
      break;
    }

    case 'meeting_transcript_chunk_added': {
      const chunks =
        timeline.meetingTranscriptChunksByMeetingId[event.chunk.meetingId] ??
        [];
      if (!chunks.some(chunk => chunk.id === event.chunk.id)) {
        chunks.push({ ...event.chunk });
      }
      timeline.meetingTranscriptChunksByMeetingId[event.chunk.meetingId] =
        chunks;
      break;
    }

    case 'meeting_transcription_stopped': {
      const recording = timeline.meetingRecordingsById[event.meetingId];
      if (recording != null) {
        recording.stoppedAt = event.stoppedAt;
        recording.status =
          event.reason === 'completed' ? 'finalizing' : 'stopped';
      }
      break;
    }

    case 'meeting_transcription_failed': {
      const recording = timeline.meetingRecordingsById[event.meetingId];
      if (recording != null) {
        recording.status = 'failed';
        recording.errorMessage = event.message;
      }
      break;
    }

    case 'meeting_summary_generated': {
      timeline.meetingSummariesByMeetingId[event.summary.meetingId] = {
        ...event.summary,
      };
      const recording =
        timeline.meetingRecordingsById[event.summary.meetingId] ?? null;
      if (recording != null) {
        recording.status = 'stopped';
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
  return (
    timeline.contextSnapshotsById[timeline.currentContextSnapshotId] ?? null
  );
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
