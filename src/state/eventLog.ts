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

export type TaskStartedEvent = EventBase & {
  type: 'task_started';
  taskId: string;
  sessionId?: string;
  title: string;
};

export type TaskStoppedEvent = EventBase & {
  type: 'task_stopped';
  taskId: string;
};

export type TaskRenamedEvent = EventBase & {
  type: 'task_renamed';
  taskId: string;
  title: string;
};

export type ObservationAddedEvent = EventBase & {
  type: 'observation_added';
  observationId: string;
  sessionId?: string;
  taskId?: string;
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
  | TaskStartedEvent
  | TaskStoppedEvent
  | TaskRenamedEvent
  | ObservationAddedEvent
  | ObservationDeletedEvent
  | ContextSnapshotRecordedEvent
  | CaptureTargetResolvedEvent
  | CapturePerformedEvent
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
  taskIds: string[];
};

export type TaskView = {
  id: string;
  sessionId?: string;
  title: string;
  startedAt: string;
  endedAt?: string;
  observationIds: string[];
};

export type ObservationView = {
  id: string;
  sessionId?: string;
  taskId?: string;
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

export type ActivityPeriodView = {
  id: string;
  startAt: string;
  endAt?: string;
  appName: string | null;
  bundleIdentifier: string | null;
  processId: number | null;
  windowTitle: string | null;
  source: 'app' | 'window';
  isIdle: boolean;
  preciseModeEnabled: boolean;
};

export type TimelineView = {
  sessionsById: Record<string, SessionView>;
  sessionOrder: string[];
  tasksById: Record<string, TaskView>;
  taskOrder: string[];
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
  currentSessionId: string | null;
  currentTaskId: string | null;
  currentTaskSegmentId: string | null;
  currentTaskLineageId: string | null;
  currentSideBranchSegmentId: string | null;
  currentContextSnapshotId: string | null;
  latestCaptureInspectionId: string | null;
  latestCaptureRecordId: string | null;
  latestTaskReconciliationId: string | null;
};

export const EMPTY_TIMELINE: TimelineView = {
  sessionsById: {},
  sessionOrder: [],
  tasksById: {},
  taskOrder: [],
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
  currentSessionId: null,
  currentTaskId: null,
  currentTaskSegmentId: null,
  currentTaskLineageId: null,
  currentSideBranchSegmentId: null,
  currentContextSnapshotId: null,
  latestCaptureInspectionId: null,
  latestCaptureRecordId: null,
  latestTaskReconciliationId: null,
};

export function createDomainId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createOccurredAt(): string {
  return new Date().toISOString();
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
    const apps = observation.structured.entities.apps;
    segment.supportingApps = Array.from(new Set([...segment.supportingApps, ...apps]));
  }

  const lineage = timeline.taskLineagesById[segment.lineageId];
  if (lineage != null) {
    lineage.lastActiveTime = observedAt;
    if (segment.sessionId != null && !lineage.sessionIds.includes(segment.sessionId)) {
      lineage.sessionIds.push(segment.sessionId);
    }
  }
}

export function replayEventLog(eventLog: DomainEvent[]): TimelineView {
  const timeline: TimelineView = {
    ...EMPTY_TIMELINE,
  };

  for (const event of eventLog) {
    switch (event.type) {
      case 'session_started': {
        if (timeline.currentSessionId != null) {
          const activeSession = timeline.sessionsById[timeline.currentSessionId];
          if (activeSession != null && activeSession.endedAt == null) {
            activeSession.endedAt = event.occurredAt;
          }
        }

        if (timeline.currentTaskId != null) {
          const activeTask = timeline.tasksById[timeline.currentTaskId];
          if (activeTask != null && activeTask.endedAt == null) {
            activeTask.endedAt = event.occurredAt;
          }
          timeline.currentTaskId = null;
        }

        timeline.sessionsById[event.sessionId] = {
          id: event.sessionId,
          title: event.title,
          startedAt: event.occurredAt,
          taskIds: [],
        };
        timeline.sessionOrder.push(event.sessionId);
        timeline.currentSessionId = event.sessionId;
        break;
      }

      case 'session_stopped': {
        const session = timeline.sessionsById[event.sessionId];
        if (session != null && session.endedAt == null) {
          session.endedAt = event.occurredAt;
        }

        if (timeline.currentTaskId != null) {
          const activeTask = timeline.tasksById[timeline.currentTaskId];
          if (
            activeTask != null &&
            activeTask.endedAt == null &&
            activeTask.sessionId === event.sessionId
          ) {
            activeTask.endedAt = event.occurredAt;
            timeline.currentTaskId = null;
          }
        }

        if (timeline.currentTaskSegmentId != null) {
          const activeSegment = timeline.taskSegmentsById[timeline.currentTaskSegmentId];
          if (
            activeSegment != null &&
            activeSegment.sessionId === event.sessionId &&
            activeSegment.endTime == null
          ) {
            activeSegment.endTime = event.occurredAt;
            activeSegment.state = 'closed';
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

      case 'task_started': {
        if (timeline.currentTaskId != null) {
          const activeTask = timeline.tasksById[timeline.currentTaskId];
          if (activeTask != null && activeTask.endedAt == null) {
            activeTask.endedAt = event.occurredAt;
          }
        }

        timeline.tasksById[event.taskId] = {
          id: event.taskId,
          sessionId: event.sessionId,
          title: event.title,
          startedAt: event.occurredAt,
          observationIds: [],
        };
        timeline.taskOrder.push(event.taskId);
        timeline.currentTaskId = event.taskId;

        if (event.sessionId != null) {
          const session = timeline.sessionsById[event.sessionId];
          if (session != null && !session.taskIds.includes(event.taskId)) {
            session.taskIds.push(event.taskId);
          }
        }
        break;
      }

      case 'task_stopped': {
        const task = timeline.tasksById[event.taskId];
        if (task != null && task.endedAt == null) {
          task.endedAt = event.occurredAt;
        }
        if (timeline.currentTaskId === event.taskId) {
          timeline.currentTaskId = null;
        }
        break;
      }

      case 'task_renamed': {
        const task = timeline.tasksById[event.taskId];
        if (task != null) {
          task.title = event.title;
        }
        break;
      }

      case 'observation_added': {
        timeline.observationsById[event.observationId] = {
          id: event.observationId,
          sessionId: event.sessionId,
          taskId: event.taskId,
          text: event.text,
          structured: event.structured,
          engineRun: event.engineRun,
          capturePreviewDataUri: event.capturePreviewDataUri ?? null,
          observedAt: event.occurredAt,
        };
        timeline.observationOrder.push(event.observationId);

        if (event.taskId != null) {
          const task = timeline.tasksById[event.taskId];
          if (task != null && !task.observationIds.includes(event.observationId)) {
            task.observationIds.push(event.observationId);
          }
        }
        break;
      }

      case 'observation_deleted': {
        const observation = timeline.observationsById[event.observationId];
        if (observation != null && observation.deletedAt == null) {
          observation.deletedAt = event.occurredAt;
        }
        break;
      }

      case 'context_snapshot_recorded': {
        timeline.contextSnapshotsById[event.snapshotId] = {
          id: event.snapshotId,
          ...event.snapshot,
        };
        timeline.contextSnapshotOrder.push(event.snapshotId);
        timeline.currentContextSnapshotId = event.snapshotId;
        break;
      }

      case 'capture_target_resolved': {
        timeline.captureInspectionsById[event.inspectionId] = {
          id: event.inspectionId,
          inspectedAt: event.inspection.inspectedAt,
          inspection: event.inspection,
        };
        timeline.captureInspectionOrder.push(event.inspectionId);
        timeline.latestCaptureInspectionId = event.inspectionId;
        break;
      }

      case 'capture_performed': {
        timeline.captureRecordsById[event.captureId] = {
          id: event.captureId,
          capturedAt: event.capture.capturedAt,
          capture: event.capture,
        };
        timeline.captureRecordOrder.push(event.captureId);
        timeline.latestCaptureRecordId = event.captureId;
        break;
      }

      case 'task_segment_started': {
        timeline.taskSegmentsById[event.segment.id] = {
          ...event.segment,
          observationIds: [...event.segment.observationIds],
          supportingApps: [...event.segment.supportingApps],
          entityMemory: {
            ...event.segment.entityMemory,
            apps: [...event.segment.entityMemory.apps],
            repos: [...event.segment.entityMemory.repos],
            ticketIds: [...event.segment.entityMemory.ticketIds],
            projects: [...event.segment.entityMemory.projects],
            documents: [...event.segment.entityMemory.documents],
            people: [...event.segment.entityMemory.people],
            urls: [...event.segment.entityMemory.urls],
          },
          interruptionSegments: [...event.segment.interruptionSegments],
        };
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
        timeline.taskSegmentsById[event.segment.id] = {
          ...event.segment,
          observationIds: [...event.segment.observationIds],
          supportingApps: [...event.segment.supportingApps],
          entityMemory: {
            ...event.segment.entityMemory,
            apps: [...event.segment.entityMemory.apps],
            repos: [...event.segment.entityMemory.repos],
            ticketIds: [...event.segment.entityMemory.ticketIds],
            projects: [...event.segment.entityMemory.projects],
            documents: [...event.segment.entityMemory.documents],
            people: [...event.segment.entityMemory.people],
            urls: [...event.segment.entityMemory.urls],
          },
          interruptionSegments: [...event.segment.interruptionSegments],
        };
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
            reasonCodes: [...event.reasonCodes],
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
          timeline.pendingObservationOrder = timeline.pendingObservationOrder.filter(
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

        const observation = timeline.observationsById[event.decision.observationId];
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
        if (!timeline.taskReconciliationOrder.includes(event.reconciliation.id)) {
          timeline.taskReconciliationOrder.push(event.reconciliation.id);
        }
        timeline.latestTaskReconciliationId = event.reconciliation.id;

        const lineage = timeline.taskLineagesById[event.reconciliation.lineageId];
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
          timeline.taskSegmentsById[segment.id] = segment;
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

  return timeline;
}

export function getSessions(timeline: TimelineView): SessionView[] {
  return timeline.sessionOrder.map(sessionId => timeline.sessionsById[sessionId]);
}

export function getTasks(timeline: TimelineView): TaskView[] {
  return timeline.taskOrder.map(taskId => timeline.tasksById[taskId]);
}

export function getVisibleObservations(
  timeline: TimelineView,
): ObservationView[] {
  return timeline.observationOrder
    .map(observationId => timeline.observationsById[observationId])
    .filter(observation => observation.deletedAt == null);
}

export function getStandaloneTasks(timeline: TimelineView): TaskView[] {
  return getTasks(timeline).filter(task => task.sessionId == null);
}

export function getStandaloneObservations(
  timeline: TimelineView,
): ObservationView[] {
  return getVisibleObservations(timeline).filter(
    observation => observation.taskId == null,
  );
}

export function getContextSnapshots(
  timeline: TimelineView,
): ContextSnapshotView[] {
  return timeline.contextSnapshotOrder.map(
    snapshotId => timeline.contextSnapshotsById[snapshotId],
  );
}

export function getCurrentContext(
  timeline: TimelineView,
): ContextSnapshotView | null {
  if (timeline.currentContextSnapshotId == null) {
    return null;
  }

  return timeline.contextSnapshotsById[timeline.currentContextSnapshotId] ?? null;
}

export function getActivityPeriods(
  timeline: TimelineView,
): ActivityPeriodView[] {
  const snapshots = getContextSnapshots(timeline);

  return snapshots.map((snapshot, index) => ({
    id: `period_${snapshot.id}`,
    startAt: snapshot.recordedAt,
    endAt: snapshots[index + 1]?.recordedAt,
    appName: snapshot.appName,
    bundleIdentifier: snapshot.bundleIdentifier,
    processId: snapshot.processId,
    windowTitle: snapshot.windowTitle,
    source: snapshot.source,
    isIdle: snapshot.isIdle,
    preciseModeEnabled: snapshot.preciseModeEnabled,
  }));
}

export function getLatestInspection(
  timeline: TimelineView,
): CaptureInspectionView | null {
  if (timeline.latestCaptureInspectionId == null) {
    return null;
  }

  return (
    timeline.captureInspectionsById[timeline.latestCaptureInspectionId] ?? null
  );
}

export function getLatestCapture(
  timeline: TimelineView,
): CaptureRecordView | null {
  if (timeline.latestCaptureRecordId == null) {
    return null;
  }

  return timeline.captureRecordsById[timeline.latestCaptureRecordId] ?? null;
}

export function getTaskSegments(timeline: TimelineView): TaskSegmentView[] {
  return timeline.taskSegmentOrder.map(segmentId => timeline.taskSegmentsById[segmentId]);
}

export function getTaskLineages(timeline: TimelineView): TaskLineageView[] {
  return timeline.taskLineageOrder.map(lineageId => timeline.taskLineagesById[lineageId]);
}

export function getTaskDecisions(timeline: TimelineView): TaskDecisionView[] {
  return timeline.taskDecisionOrder.map(decisionId => timeline.taskDecisionsById[decisionId]);
}

export function getPendingObservations(
  timeline: TimelineView,
): PendingObservationView[] {
  return timeline.pendingObservationOrder.map(
    observationId => timeline.pendingObservationsById[observationId],
  );
}

export function getCurrentPrimaryTaskSegment(
  timeline: TimelineView,
): TaskSegmentView | null {
  if (timeline.currentTaskSegmentId == null) {
    return null;
  }

  return timeline.taskSegmentsById[timeline.currentTaskSegmentId] ?? null;
}

export function getCurrentTaskLineage(
  timeline: TimelineView,
): TaskLineageView | null {
  if (timeline.currentTaskLineageId == null) {
    return null;
  }

  return timeline.taskLineagesById[timeline.currentTaskLineageId] ?? null;
}

export function getCurrentSideBranchSegment(
  timeline: TimelineView,
): TaskSegmentView | null {
  if (timeline.currentSideBranchSegmentId == null) {
    return null;
  }

  return timeline.taskSegmentsById[timeline.currentSideBranchSegmentId] ?? null;
}

export function getLatestTaskReconciliation(
  timeline: TimelineView,
): TaskReconciliationResult | null {
  if (timeline.latestTaskReconciliationId == null) {
    return null;
  }

  return (
    timeline.taskReconciliationsById[timeline.latestTaskReconciliationId] ?? null
  );
}
