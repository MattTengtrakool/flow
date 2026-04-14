import type {
  CaptureInspectionPayload,
  CaptureMetadataPayload,
  ContextSnapshotPayload,
} from '../types/contextCapture';
import type {
  ObservationRun,
  StructuredObservation,
} from '../observation/types';

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
  | CapturePerformedEvent;

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
  currentSessionId: string | null;
  currentTaskId: string | null;
  currentContextSnapshotId: string | null;
  latestCaptureInspectionId: string | null;
  latestCaptureRecordId: string | null;
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
  currentSessionId: null,
  currentTaskId: null,
  currentContextSnapshotId: null,
  latestCaptureInspectionId: null,
  latestCaptureRecordId: null,
};

export function createDomainId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createOccurredAt(): string {
  return new Date().toISOString();
}

export function replayEventLog(eventLog: DomainEvent[]): TimelineView {
  const timeline: TimelineView = {
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
    currentSessionId: null,
    currentTaskId: null,
    currentContextSnapshotId: null,
    latestCaptureInspectionId: null,
    latestCaptureRecordId: null,
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
