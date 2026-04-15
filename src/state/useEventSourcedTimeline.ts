import {
  startTransition,
  useEffect,
  useReducer,
  useRef,
  useState,
} from 'react';

import {
  addContextSnapshotListener,
  captureNow,
  getPermissionsStatus,
  inspectCaptureTarget,
  requestAccessibilityPrompt,
  requestScreenCaptureAccess,
  startContextMonitoring,
  stopContextMonitoring,
} from '../native/contextCaptureBridge';
import {loadPersistedEventLog, savePersistedEventLog} from '../storage/eventLogStorage';
import type {
  CaptureInspectionPayload,
  CaptureMetadataPayload,
  ContextSnapshotPayload,
  PermissionsStatus,
} from '../types/contextCapture';
import {
  createDomainId,
  createOccurredAt,
  EMPTY_TIMELINE,
  getCurrentContext,
  getVisibleObservations,
  replayEventLog,
  type ObservationAddedEvent,
  type DomainEvent,
  type TimelineView,
} from './eventLog';
import type {ObservationRun, StructuredObservation} from '../observation/types';
import {computeTaskEngineMetrics} from '../tasks/metrics';
import {buildReconciliationEvents} from '../tasks/reconcile';
import {runTaskEngineForObservation, type TaskEngineRunResult} from '../tasks/runTaskEngineForObservation';
import {
  getCurrentPrimaryTaskSegment,
  getCurrentSideBranchSegment,
  getCurrentTaskLineage,
  getLastTaskDecisionAt,
  getPendingObservations,
  getRecentTaskObservations,
  getRecentTaskDecisions,
  getTaskDecisionCount,
  getTaskLineages,
  getTaskSegments,
} from '../tasks/selectors';
import {
  TASK_ENGINE_VERSION,
  type UserTaskCorrection,
} from '../tasks/types';
import {
  generateStructuredObservationForCapture,
  type ObservationCapturePreview,
} from '../observation/runObservationForCapture';
import {
  sanitizeCaptureMetadata,
  sanitizeContextSnapshot,
  sanitizeInspection,
  sanitizeObservationRun,
  sanitizeObservationSummary,
  sanitizeStructuredObservation,
} from '../privacy/redaction';
import {
  coalesceQueuedContinuousObservation,
  evaluateContinuousCaptureDecision,
  shouldAutoPauseContinuousMode,
} from './continuousSessionUtils';

const OBSERVATION_TEMPLATES = [
  'Reviewed a pull request and scanned the latest comments.',
  'Drafted notes in the debug window for the current task.',
  'Switched context briefly to clarify the next action.',
  'Captured a synthetic observation for the event log pipeline.',
  'Validated that the timeline can rebuild from immutable events.',
];

const PERCEPTUAL_HASH_DISTANCE_THRESHOLD = 10;

function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) {
    return Infinity;
  }

  let distance = 0;

  for (let i = 0; i < a.length; i += 1) {
    const xor = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    distance += ((xor >> 3) & 1) + ((xor >> 2) & 1) + ((xor >> 1) & 1) + (xor & 1);
  }

  return distance;
}

const DEFAULT_PERMISSIONS: PermissionsStatus = {
  accessibilityTrusted: false,
  captureAccessGranted: false,
  hostBundleIdentifier: null,
  hostBundlePath: null,
};
const EVENT_LOG_SAVE_DEBOUNCE_MS = 500;

type HydrationStatus = 'loading' | 'ready' | 'error';

type TimelineStore = {
  eventLog: DomainEvent[];
  timeline: TimelineView;
  hydrationStatus: HydrationStatus;
  storagePath: string | null;
  lastSavedAt: string | null;
  lastRebuiltAt: string | null;
  errorMessage: string | null;
};

type TimelineAction =
  | {type: 'hydrate_succeeded'; eventLog: DomainEvent[]; storagePath: string}
  | {type: 'hydrate_failed'; errorMessage: string}
  | {type: 'append_event'; event: DomainEvent}
  | {type: 'append_events'; events: DomainEvent[]}
  | {type: 'rebuild_timeline'; rebuiltAt: string}
  | {type: 'persist_succeeded'; storagePath: string; savedAt: string}
  | {type: 'persist_failed'; errorMessage: string};

type CapturePreviewState = {
  dataUri: string | null;
  mimeType: string | null;
  metadata: CaptureMetadataPayload;
  ocrText: string | null;
};

type ActionFeedback = {
  message: string;
  tone: 'neutral' | 'success' | 'warning' | 'error';
  at: string;
};

type SchedulerState = {
  running: boolean;
  intervalMs: number;
  tickCount: number;
  changedCount: number;
  skippedCount: number;
  busy: boolean;
  lastTickAt: string | null;
  lastDecision: 'changed' | 'skipped' | 'error' | null;
  lastFrameHash: string | null;
};

type ContinuousObservationDecision =
  | 'observed'
  | 'skipped_duplicate'
  | 'skipped_busy'
  | 'error'
  | null;

type ContinuousModePhase = 'off' | 'capturing' | 'observing' | 'paused' | 'error';

type ContinuousModeState = {
  enabled: boolean;
  autoObserveEnabled: boolean;
  observationQueueLength: number;
  observationInFlight: boolean;
  lastObservedAt: string | null;
  lastObservedFrameHash: string | null;
  lastObservationDecision: ContinuousObservationDecision;
  currentMode: ContinuousModePhase;
  continuousStatusMessage: string;
  consecutiveFailureCount: number;
};

type QueuedContinuousObservation = {
  preview: ObservationCapturePreview;
  inspection: CaptureInspectionPayload;
  observedAt: string;
  frameHash: string | null;
};

export type StructuredObservationRecordedPayload = {
  observationId: string;
  observationRun: ObservationRun;
  preview: ObservationCapturePreview;
  inspection: CaptureInspectionPayload;
  taskEngineResult: TaskEngineRunResult | null;
};

type UseEventSourcedTimelineOptions = {
  onStructuredObservationRecorded?: (
    payload: StructuredObservationRecordedPayload,
  ) => void;
};

const INITIAL_STORE: TimelineStore = {
  eventLog: [],
  timeline: EMPTY_TIMELINE,
  hydrationStatus: 'loading',
  storagePath: null,
  lastSavedAt: null,
  lastRebuiltAt: null,
  errorMessage: null,
};

const INITIAL_SCHEDULER_STATE: SchedulerState = {
  running: false,
  intervalMs: 1000,
  tickCount: 0,
  changedCount: 0,
  skippedCount: 0,
  busy: false,
  lastTickAt: null,
  lastDecision: null,
  lastFrameHash: null,
};

const INITIAL_CONTINUOUS_MODE_STATE: ContinuousModeState = {
  enabled: false,
  autoObserveEnabled: false,
  observationQueueLength: 0,
  observationInFlight: false,
  lastObservedAt: null,
  lastObservedFrameHash: null,
  lastObservationDecision: null,
  currentMode: 'off',
  continuousStatusMessage: 'Continuous mode is off.',
  consecutiveFailureCount: 0,
};

function timelineReducer(
  state: TimelineStore,
  action: TimelineAction,
): TimelineStore {
  switch (action.type) {
    case 'hydrate_succeeded':
      return {
        ...state,
        eventLog: action.eventLog,
        timeline: replayEventLog(action.eventLog),
        hydrationStatus: 'ready',
        storagePath: action.storagePath,
        errorMessage: null,
      };

    case 'hydrate_failed':
      return {
        ...state,
        hydrationStatus: 'error',
        errorMessage: action.errorMessage,
      };

    case 'append_event': {
      const nextEventLog = [...state.eventLog, action.event];

      return {
        ...state,
        eventLog: nextEventLog,
        timeline: replayEventLog(nextEventLog),
        errorMessage: null,
      };
    }

    case 'append_events': {
      const nextEventLog = [...state.eventLog, ...action.events];

      return {
        ...state,
        eventLog: nextEventLog,
        timeline: replayEventLog(nextEventLog),
        errorMessage: null,
      };
    }

    case 'rebuild_timeline':
      return {
        ...state,
        timeline: replayEventLog(state.eventLog),
        lastRebuiltAt: action.rebuiltAt,
      };

    case 'persist_succeeded':
      return {
        ...state,
        storagePath: action.storagePath,
        lastSavedAt: action.savedAt,
        errorMessage: null,
      };

    case 'persist_failed':
      return {
        ...state,
        errorMessage: action.errorMessage,
      };
  }
}

function createFakeObservationText(count: number): string {
  const template = OBSERVATION_TEMPLATES[count % OBSERVATION_TEMPLATES.length];
  return `Observation ${count + 1}: ${template}`;
}

function toPermissionsFromSnapshot(
  snapshot: ContextSnapshotPayload,
): PermissionsStatus {
  return {
    accessibilityTrusted: snapshot.accessibilityTrusted,
    captureAccessGranted: snapshot.captureAccessGranted,
    hostBundleIdentifier: snapshot.hostBundleIdentifier,
    hostBundlePath: snapshot.hostBundlePath,
  };
}

function toCaptureMetadataWithFrameChecks(
  metadata: Omit<CaptureMetadataPayload, 'staleFrame' | 'blankFrame'>,
  previewDataUri: string | null,
  previousPreviewDataUri: string | null,
): CaptureMetadataPayload {
  const blankFrame =
    previewDataUri == null ||
    metadata.width == null ||
    metadata.height == null ||
    metadata.width === 0 ||
    metadata.height === 0;
  const staleFrame =
    previewDataUri != null &&
    previousPreviewDataUri != null &&
    previousPreviewDataUri === previewDataUri;

  return {
    ...metadata,
    staleFrame,
    blankFrame,
  };
}

function useStableEvent<ArgumentsType extends unknown[], ReturnType>(
  callback: (...args: ArgumentsType) => ReturnType,
): (...args: ArgumentsType) => ReturnType {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const stableCallbackRef = useRef((...args: ArgumentsType) =>
    callbackRef.current(...args),
  );

  return stableCallbackRef.current;
}

function isTestEnvironment(): boolean {
  const globalWithProcess = globalThis as typeof globalThis & {
    process?: {
      env?: {
        NODE_ENV?: string;
      };
    };
  };

  return globalWithProcess.process?.env?.NODE_ENV === 'test';
}

function createActionFeedback(
  message: string,
  tone: ActionFeedback['tone'] = 'neutral',
): ActionFeedback {
  return {
    message,
    tone,
    at: createOccurredAt(),
  };
}

function getRecentStructuredObservationsForTimeline(
  timeline: TimelineView,
  count = 5,
): StructuredObservation[] {
  return getVisibleObservations(timeline)
    .filter(observation => observation.structured != null)
    .slice(-count)
    .map(observation => observation.structured!);
}

export function useEventSourcedTimeline(
  options: UseEventSourcedTimelineOptions = {},
) {
  const [store, dispatch] = useReducer(timelineReducer, INITIAL_STORE);
  const [monitoringEnabled, setMonitoringEnabled] = useState(false);
  const [permissions, setPermissions] = useState<PermissionsStatus>(
    DEFAULT_PERMISSIONS,
  );
  const [latestInspection, setLatestInspection] =
    useState<CaptureInspectionPayload | null>(null);
  const [latestCapturePreview, setLatestCapturePreview] =
    useState<CapturePreviewState | null>(null);
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback | null>(null);
  const [nativeErrorMessage, setNativeErrorMessage] = useState<string | null>(
    null,
  );
  const [schedulerState, setSchedulerState] = useState<SchedulerState>(
    INITIAL_SCHEDULER_STATE,
  );
  const [continuousModeState, setContinuousModeState] = useState<ContinuousModeState>(
    INITIAL_CONTINUOUS_MODE_STATE,
  );
  const eventLogRef = useRef<DomainEvent[]>(INITIAL_STORE.eventLog);
  const timelineRef = useRef<TimelineView>(INITIAL_STORE.timeline);
  const taskEngineQueueRef = useRef(Promise.resolve());
  const lastPreviewDataUriRef = useRef<string | null>(null);
  const lastScheduledFrameHashRef = useRef<string | null>(null);
  const lastScheduledPerceptualHashRef = useRef<string | null>(null);
  const schedulerBusyRef = useRef(false);
  const continuousModeEnabledRef = useRef(false);
  const continuousObservationBusyRef = useRef(false);
  const continuousFailureCountRef = useRef(0);
  const queuedContinuousObservationRef =
    useRef<QueuedContinuousObservation | null>(null);
  const reconcileAfterContinuousRunRef = useRef(false);
  const emitStructuredObservationRecorded = useStableEvent(
    (payload: StructuredObservationRecordedPayload) => {
      options.onStructuredObservationRecorded?.(payload);
    },
  );

  const appendEvent = useStableEvent((event: DomainEvent) => {
    eventLogRef.current = [...eventLogRef.current, event];
    timelineRef.current = replayEventLog(eventLogRef.current);
    startTransition(() => {
      dispatch({
        type: 'append_event',
        event,
      });
    });
  });

  const appendEvents = useStableEvent((events: DomainEvent[]) => {
    if (events.length === 0) {
      return;
    }

    eventLogRef.current = [...eventLogRef.current, ...events];
    timelineRef.current = replayEventLog(eventLogRef.current);
    startTransition(() => {
      dispatch({
        type: 'append_events',
        events,
      });
    });
  });

  useEffect(() => {
    eventLogRef.current = store.eventLog;
    timelineRef.current = store.timeline;
  }, [store.eventLog, store.timeline]);

  useEffect(() => {
    continuousModeEnabledRef.current =
      continuousModeState.enabled && continuousModeState.autoObserveEnabled;
    continuousFailureCountRef.current = continuousModeState.consecutiveFailureCount;
  }, [
    continuousModeState.autoObserveEnabled,
    continuousModeState.consecutiveFailureCount,
    continuousModeState.enabled,
  ]);

  const handleContextSnapshot = useStableEvent(
    (snapshot: ContextSnapshotPayload) => {
      startTransition(() => {
        setPermissions(toPermissionsFromSnapshot(snapshot));
        setNativeErrorMessage(null);
      });

      appendEvent({
        id: createDomainId('event'),
        type: 'context_snapshot_recorded',
        snapshotId: createDomainId('context'),
        snapshot: sanitizeContextSnapshot(snapshot)!,
        occurredAt: snapshot.recordedAt,
      });
    },
  );

  useEffect(() => {
    let isCancelled = false;

    async function hydrateStore() {
      try {
        const payload = await loadPersistedEventLog();

        if (!isCancelled) {
          startTransition(() => {
            dispatch({
              type: 'hydrate_succeeded',
              eventLog: payload.eventLog,
              storagePath: payload.filePath,
            });
          });
        }
      } catch (error) {
        if (!isCancelled) {
          const message =
            error instanceof Error ? error.message : 'Failed to load the event log.';

          startTransition(() => {
            dispatch({
              type: 'hydrate_failed',
              errorMessage: message,
            });
          });
        }
      }
    }

    hydrateStore();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (store.hydrationStatus !== 'ready' || isTestEnvironment()) {
      return;
    }

    let isCancelled = false;

    async function persistStore() {
      try {
        const payload = await savePersistedEventLog(store.eventLog);

        if (!isCancelled) {
          startTransition(() => {
            dispatch({
              type: 'persist_succeeded',
              storagePath: payload.filePath,
              savedAt: payload.savedAt,
            });
          });
        }
      } catch (error) {
        if (!isCancelled) {
          const message =
            error instanceof Error ? error.message : 'Failed to save the event log.';

          startTransition(() => {
            dispatch({
              type: 'persist_failed',
              errorMessage: message,
            });
          });
        }
      }
    }

    const timeoutId = setTimeout(() => {
      persistStore().catch(() => {});
    }, EVENT_LOG_SAVE_DEBOUNCE_MS);

    return () => {
      isCancelled = true;
      clearTimeout(timeoutId);
    };
  }, [store.eventLog, store.hydrationStatus]);

  useEffect(() => {
    if (store.hydrationStatus !== 'ready') {
      return;
    }

    let isCancelled = false;
    const subscription = addContextSnapshotListener(snapshot => {
      if (!isCancelled) {
        handleContextSnapshot(snapshot);
      }
    });

    async function startMonitoring() {
      try {
        const snapshot = await startContextMonitoring({
          preciseModeEnabled: true,
          idleThresholdSeconds: 60,
        });

        if (!isCancelled) {
          startTransition(() => {
            setMonitoringEnabled(true);
          });
          handleContextSnapshot(snapshot);
        }
      } catch (error) {
        if (!isCancelled) {
          const message =
            error instanceof Error
              ? error.message
              : 'Failed to start passive context monitoring.';

          startTransition(() => {
            setMonitoringEnabled(false);
            setNativeErrorMessage(message);
          });
        }
      }
    }

    startMonitoring();

    return () => {
      isCancelled = true;
      subscription.remove();
      stopContextMonitoring().catch(() => {});
      startTransition(() => {
        setMonitoringEnabled(false);
      });
    };
  }, [handleContextSnapshot, store.hydrationStatus]);

  useEffect(() => {
    if (store.hydrationStatus !== 'ready') {
      return;
    }

    let isCancelled = false;

    async function syncPermissions() {
      try {
        const nextPermissions = await getPermissionsStatus();

        if (!isCancelled) {
          startTransition(() => {
            setPermissions(nextPermissions);
          });
        }
      } catch (error) {
        if (!isCancelled) {
          const message =
            error instanceof Error
              ? error.message
              : 'Failed to refresh permission state.';

          startTransition(() => {
            setNativeErrorMessage(message);
          });
        }
      }
    }

    syncPermissions();

    return () => {
      isCancelled = true;
    };
  }, [store.hydrationStatus]);

  const enqueueTaskEngineForObservation = useStableEvent(
    (
      observationId: string,
      onComplete?: (result: TaskEngineRunResult | null) => void,
    ) => {
      taskEngineQueueRef.current = taskEngineQueueRef.current
        .catch(() => {})
        .then(async () => {
          const timeline = timelineRef.current;
          const observation = timeline.observationsById[observationId];

          if (observation == null || observation.deletedAt != null) {
            onComplete?.(null);
            return;
          }

          const result = await runTaskEngineForObservation({
            timeline,
            observation,
            getLatestTimeline: () => timelineRef.current,
          });

          if (result != null && result.events.length > 0) {
            appendEvents(result.events);
          }

          onComplete?.(result);
        });
    },
  );

  const appendObservationAndRunTaskEngine = useStableEvent(
    (
      event: ObservationAddedEvent,
      onComplete?: (result: TaskEngineRunResult | null) => void,
    ) => {
      appendEvent(event);
      enqueueTaskEngineForObservation(event.observationId, onComplete);
    },
  );

  const stopContinuousMode = useStableEvent((reason?: string) => {
    queuedContinuousObservationRef.current = null;
    reconcileAfterContinuousRunRef.current = false;
    startTransition(() => {
      setContinuousModeState(previousState => ({
        ...previousState,
        enabled: false,
        autoObserveEnabled: false,
        observationQueueLength: 0,
        observationInFlight: false,
        currentMode: 'off',
        continuousStatusMessage: reason ?? 'Continuous mode is off.',
      }));
      setSchedulerState(previousState => ({
        ...previousState,
        running: false,
        busy: false,
      }));
    });
  });

  const pauseContinuousMode = useStableEvent((message: string) => {
    queuedContinuousObservationRef.current = null;
    startTransition(() => {
      setContinuousModeState(previousState => ({
        ...previousState,
        observationQueueLength: 0,
        observationInFlight: false,
        currentMode: 'paused',
        continuousStatusMessage: message,
      }));
      setSchedulerState(previousState => ({
        ...previousState,
        running: false,
        busy: false,
      }));
    });
  });

  const processContinuousObservation = useStableEvent(
    async (queuedObservation: QueuedContinuousObservation) => {
      if (!continuousModeEnabledRef.current) {
        return;
      }

      continuousObservationBusyRef.current = true;
      startTransition(() => {
        setContinuousModeState(previousState => ({
          ...previousState,
          observationInFlight: true,
          observationQueueLength:
            queuedContinuousObservationRef.current != null ? 1 : 0,
          currentMode: 'observing',
          continuousStatusMessage: 'Generating a structured observation for the latest changed capture.',
        }));
      });

      try {
        const timeline = timelineRef.current;
        const run = await generateStructuredObservationForCapture({
          preview: queuedObservation.preview,
          inspection: queuedObservation.inspection,
          currentContext: getCurrentContext(timeline),
          recentObservations: getRecentStructuredObservationsForTimeline(timeline),
        });

        recordStructuredObservation(
          run,
          queuedObservation.observedAt,
          queuedObservation.preview.dataUri ?? null,
          {
            preview: queuedObservation.preview,
            inspection: queuedObservation.inspection,
          },
        );
        startTransition(() => {
          setContinuousModeState(previousState => ({
            ...previousState,
            observationInFlight: false,
            observationQueueLength:
              queuedContinuousObservationRef.current != null ? 1 : 0,
            lastObservedAt: queuedObservation.observedAt,
            lastObservedFrameHash: queuedObservation.frameHash,
            lastObservationDecision: 'observed',
            currentMode: continuousModeEnabledRef.current ? 'capturing' : 'off',
            continuousStatusMessage: `Observed latest changed capture at ${new Date(
              queuedObservation.observedAt,
            ).toLocaleTimeString()}.`,
            consecutiveFailureCount: 0,
          }));
        });
      } catch (error) {
        const nextFailureCount = continuousFailureCountRef.current + 1;
        const message =
          error instanceof Error
            ? error.message
            : 'Continuous observation failed.';

        startTransition(() => {
          setContinuousModeState(previousState => ({
            ...previousState,
            observationInFlight: false,
            observationQueueLength:
              queuedContinuousObservationRef.current != null ? 1 : 0,
            lastObservationDecision: 'error',
            currentMode: shouldAutoPauseContinuousMode(nextFailureCount)
              ? 'paused'
              : 'error',
            continuousStatusMessage:
              shouldAutoPauseContinuousMode(nextFailureCount)
                ? `Continuous mode auto-paused after repeated observation failures: ${message}`
                : `Continuous observation failed: ${message}`,
            consecutiveFailureCount: previousState.consecutiveFailureCount + 1,
          }));
        });

        if (shouldAutoPauseContinuousMode(nextFailureCount)) {
          pauseContinuousMode(
            `Continuous mode auto-paused after repeated observation failures: ${message}`,
          );
        }
      } finally {
        continuousObservationBusyRef.current = false;

        if (!continuousModeEnabledRef.current) {
          if (reconcileAfterContinuousRunRef.current) {
            reconcileAfterContinuousRunRef.current = false;
            runTaskReconciliation();
          }
          return;
        }

        const nextQueuedObservation = queuedContinuousObservationRef.current;
        queuedContinuousObservationRef.current = null;

        if (nextQueuedObservation != null) {
          await processContinuousObservation(nextQueuedObservation);
        }
      }
    },
  );

  const enqueueContinuousObservation = useStableEvent(
    (queuedObservation: QueuedContinuousObservation) => {
      if (!continuousModeEnabledRef.current) {
        return;
      }

      if (continuousObservationBusyRef.current) {
        queuedContinuousObservationRef.current = coalesceQueuedContinuousObservation(
          queuedContinuousObservationRef.current,
          queuedObservation,
        );
        startTransition(() => {
          setContinuousModeState(previousState => ({
            ...previousState,
            observationQueueLength: 1,
            lastObservationDecision: 'skipped_busy',
            continuousStatusMessage:
              'Observation already in flight; keeping only the latest changed capture in the queue.',
          }));
        });
        return;
      }

      processContinuousObservation(queuedObservation).catch(() => {});
    },
  );

  function startContinuousMode() {
    lastScheduledFrameHashRef.current = null;
    lastScheduledPerceptualHashRef.current = null;
    queuedContinuousObservationRef.current = null;
    reconcileAfterContinuousRunRef.current = false;
    startTransition(() => {
      setContinuousModeState(previousState => ({
        ...previousState,
        enabled: true,
        autoObserveEnabled: true,
        observationQueueLength: 0,
        observationInFlight: false,
        currentMode: 'capturing',
        continuousStatusMessage:
          store.timeline.currentSessionId != null
            ? 'Continuous mode is running for the active session.'
            : 'Continuous mode is running without an active session.',
        consecutiveFailureCount: 0,
      }));
      setSchedulerState(previousState => ({
        ...previousState,
        running: true,
        busy: false,
        tickCount: 0,
        changedCount: 0,
        skippedCount: 0,
        lastTickAt: null,
        lastDecision: null,
        lastFrameHash: null,
      }));
    });
  }

  function runTaskReconciliation() {
    const reconciliationEvents = buildReconciliationEvents(timelineRef.current);
    appendEvents(reconciliationEvents);
  }

  function applyUserTaskCorrection(correction: UserTaskCorrection) {
    appendEvent({
      id: createDomainId('event'),
      occurredAt: createOccurredAt(),
      type: 'user_task_edit_applied',
      correction,
      actor: 'user',
      engineVersion: TASK_ENGINE_VERSION,
    });
  }

  function startSession() {
    const sessionNumber = store.timeline.sessionOrder.length + 1;
    const sessionId = createDomainId('session');

    appendEvent({
      id: createDomainId('event'),
      type: 'session_started',
      sessionId,
      title: `Session ${sessionNumber}`,
      occurredAt: createOccurredAt(),
    });
    startContinuousMode();
  }

  function stopSession() {
    if (store.timeline.currentSessionId == null) {
      return;
    }

    appendEvent({
      id: createDomainId('event'),
      type: 'session_stopped',
      sessionId: store.timeline.currentSessionId,
      occurredAt: createOccurredAt(),
    });
    if (continuousModeEnabledRef.current || continuousObservationBusyRef.current) {
      reconcileAfterContinuousRunRef.current = true;
      stopContinuousMode('Continuous mode stopped with the session.');
    } else {
      runTaskReconciliation();
    }
  }

  function renameCurrentSession(title: string) {
    const trimmedTitle = title.trim();

    if (store.timeline.currentSessionId == null || trimmedTitle.length === 0) {
      return;
    }

    appendEvent({
      id: createDomainId('event'),
      type: 'session_renamed',
      sessionId: store.timeline.currentSessionId,
      title: trimmedTitle,
      occurredAt: createOccurredAt(),
    });
  }

  function startTask() {
    const taskNumber = store.timeline.taskOrder.length + 1;
    const taskId = createDomainId('task');

    appendEvent({
      id: createDomainId('event'),
      type: 'task_started',
      taskId,
      sessionId: store.timeline.currentSessionId ?? undefined,
      title: `Task ${taskNumber}`,
      occurredAt: createOccurredAt(),
    });
  }

  function stopTask() {
    if (store.timeline.currentTaskId == null) {
      return;
    }

    appendEvent({
      id: createDomainId('event'),
      type: 'task_stopped',
      taskId: store.timeline.currentTaskId,
      occurredAt: createOccurredAt(),
    });
  }

  function renameCurrentTask(title: string) {
    const trimmedTitle = title.trim();

    if (store.timeline.currentTaskId == null || trimmedTitle.length === 0) {
      return;
    }

    appendEvent({
      id: createDomainId('event'),
      type: 'task_renamed',
      taskId: store.timeline.currentTaskId,
      title: trimmedTitle,
      occurredAt: createOccurredAt(),
    });
  }

  function addFakeObservation() {
    const observationCount = Object.values(store.timeline.observationsById).filter(
      observation => observation.deletedAt == null,
    ).length;

    appendObservationAndRunTaskEngine({
      id: createDomainId('event'),
      type: 'observation_added',
      observationId: createDomainId('observation'),
      sessionId: store.timeline.currentSessionId ?? undefined,
      taskId: store.timeline.currentTaskId ?? undefined,
      text: createFakeObservationText(observationCount),
      occurredAt: createOccurredAt(),
    });
  }

  function deleteObservation(observationId: string) {
    appendEvent({
      id: createDomainId('event'),
      type: 'observation_deleted',
      observationId,
      occurredAt: createOccurredAt(),
    });
  }

  function rebuildFromEventLog() {
    startTransition(() => {
      dispatch({
        type: 'rebuild_timeline',
        rebuiltAt: createOccurredAt(),
      });
    });
  }

  function recordStructuredObservation(
    observationRun: ObservationRun,
    occurredAt = createOccurredAt(),
    capturePreviewDataUri: string | null = null,
    source?: {
      preview: ObservationCapturePreview;
      inspection: CaptureInspectionPayload;
    },
  ): string {
    const observationId = createDomainId('observation');
    const sanitizedObservationRun = sanitizeObservationRun(observationRun);
    const event: ObservationAddedEvent = {
      id: createDomainId('event'),
      type: 'observation_added',
      observationId,
      sessionId: store.timeline.currentSessionId ?? undefined,
      taskId: store.timeline.currentTaskId ?? undefined,
      text: sanitizeObservationSummary(observationRun.observation.summary),
      structured: sanitizeStructuredObservation(observationRun.observation),
      engineRun: sanitizedObservationRun,
      capturePreviewDataUri: null,
      occurredAt,
    };

    appendObservationAndRunTaskEngine(event, taskEngineResult => {
      if (source == null) {
        return;
      }

      emitStructuredObservationRecorded({
        observationId,
        observationRun,
        preview: source.preview,
        inspection: source.inspection,
        taskEngineResult,
      });
    });

    return observationId;
  }

  async function promptForAccessibility() {
    try {
      const nextPermissions = await requestAccessibilityPrompt();

      startTransition(() => {
        setPermissions(nextPermissions);
        setNativeErrorMessage(null);
        setActionFeedback(
          createActionFeedback(
            nextPermissions.accessibilityTrusted
              ? 'Accessibility access is available.'
              : 'Accessibility prompt opened, but access is not granted yet.',
            nextPermissions.accessibilityTrusted ? 'success' : 'warning',
          ),
        );
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to prompt for accessibility access.';

      startTransition(() => {
        setNativeErrorMessage(message);
        setActionFeedback(createActionFeedback(message, 'error'));
      });
    }
  }

  async function requestScreenCapturePermission() {
    try {
      const nextPermissions = await requestScreenCaptureAccess();

      startTransition(() => {
        setPermissions(nextPermissions);
        setNativeErrorMessage(null);
        setActionFeedback(
          createActionFeedback(
            nextPermissions.captureAccessGranted
              ? 'Screen Recording access is available.'
              : 'Screen Recording prompt opened. If you just granted access in System Settings, quit and relaunch the app once, then try Inspect or Capture again.',
            nextPermissions.captureAccessGranted ? 'success' : 'warning',
          ),
        );
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to request screen capture access.';

      startTransition(() => {
        setNativeErrorMessage(message);
        setActionFeedback(createActionFeedback(message, 'error'));
      });
    }
  }

  async function runCaptureInspection() {
    try {
      const inspection = await inspectCaptureTarget();

      startTransition(() => {
        setLatestInspection(inspection);
        setPermissions(toPermissionsFromSnapshot(inspection.context));
        setNativeErrorMessage(null);
        setActionFeedback(
          createActionFeedback(
            inspection.chosenTargetType === 'window'
              ? `Inspect found a window target for ${inspection.chosenTarget?.appName ?? 'the current app'} with confidence ${inspection.confidence.toFixed(2)}.`
              : inspection.chosenTargetType === 'application'
                ? `Inspect fell back to an app-level target for ${inspection.chosenTarget?.appName ?? 'the current app'}.`
                : inspection.captureAccessGranted
                  ? `Inspect did not find a trustworthy target. ${inspection.fallbackReason ?? ''}`.trim()
                  : inspection.fallbackReason ??
                    'Inspect cannot resolve a target until Screen Recording is active.',
            inspection.chosenTargetType === 'none'
              ? 'warning'
              : inspection.chosenTargetType === 'application'
                ? 'warning'
                : 'success',
          ),
        );
      });

      appendEvent({
        id: createDomainId('event'),
        type: 'capture_target_resolved',
        inspectionId: createDomainId('inspection'),
        inspection: sanitizeInspection(inspection),
        occurredAt: inspection.inspectedAt,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to inspect the capture target.';

      startTransition(() => {
        setNativeErrorMessage(message);
        setActionFeedback(createActionFeedback(message, 'error'));
      });
    }
  }

  async function runCaptureNow(): Promise<{
    preview: CapturePreviewState;
    inspection: CaptureInspectionPayload;
  } | null> {
    try {
      const result = await captureNow();
      const previewDataUri =
        result.previewBase64 != null && result.previewMimeType != null
          ? `data:${result.previewMimeType};base64,${result.previewBase64}`
          : null;
      const captureMetadata = toCaptureMetadataWithFrameChecks(
        result.metadata,
        previewDataUri,
        lastPreviewDataUriRef.current,
      );

      lastPreviewDataUriRef.current = previewDataUri;

      startTransition(() => {
        setLatestInspection(result.inspection);
        setPermissions(toPermissionsFromSnapshot(result.inspection.context));
        setLatestCapturePreview({
          dataUri: previewDataUri,
          mimeType: result.previewMimeType,
          metadata: captureMetadata,
          ocrText: result.ocrText,
        });
        setNativeErrorMessage(null);
        setActionFeedback(
          createActionFeedback(
            captureMetadata.status === 'captured'
              ? `Capture succeeded for ${captureMetadata.appName ?? 'the current app'}${captureMetadata.windowTitle != null ? ` · ${captureMetadata.windowTitle}` : ''}.`
              : captureMetadata.status === 'permission_required'
                ? 'Capture is blocked until Screen Recording access is granted.'
                : captureMetadata.errorMessage ?? 'Capture failed.',
            captureMetadata.status === 'captured'
              ? 'success'
              : captureMetadata.status === 'permission_required'
                ? 'warning'
                : 'error',
          ),
        );
      });

      appendEvent({
        id: createDomainId('event'),
        type: 'capture_target_resolved',
        inspectionId: createDomainId('inspection'),
        inspection: sanitizeInspection(result.inspection),
        occurredAt: result.inspection.inspectedAt,
      });

      appendEvent({
        id: createDomainId('event'),
        type: 'capture_performed',
        captureId: createDomainId('capture'),
        capture: sanitizeCaptureMetadata(captureMetadata),
        occurredAt: captureMetadata.capturedAt,
      });

      return {
        preview: {
          dataUri: previewDataUri,
          mimeType: result.previewMimeType,
          metadata: captureMetadata,
          ocrText: result.ocrText,
        },
        inspection: result.inspection,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to capture a screenshot.';

      startTransition(() => {
        setNativeErrorMessage(message);
        setActionFeedback(createActionFeedback(message, 'error'));
      });

      return null;
    }
  }

  const runScheduledTick = useStableEvent(async () => {
    if (schedulerBusyRef.current) {
      return;
    }

    schedulerBusyRef.current = true;
    startTransition(() => {
      setSchedulerState(previousState => ({
        ...previousState,
        busy: true,
      }));
    });

    try {
      const result = await captureNow();
      const previewDataUri =
        result.previewBase64 != null && result.previewMimeType != null
          ? `data:${result.previewMimeType};base64,${result.previewBase64}`
          : null;
      const captureMetadata = toCaptureMetadataWithFrameChecks(
        result.metadata,
        previewDataUri,
        lastPreviewDataUriRef.current,
      );
      const frameHash = captureMetadata.frameHash;
      const perceptualHash = captureMetadata.perceptualHash;
      const isPerceptuallySimilar =
        perceptualHash != null &&
        lastScheduledPerceptualHashRef.current != null &&
        hammingDistance(perceptualHash, lastScheduledPerceptualHashRef.current) <=
          PERCEPTUAL_HASH_DISTANCE_THRESHOLD;
      const didChange =
        captureMetadata.status === 'captured' &&
        perceptualHash != null &&
        perceptualHash.length > 0 &&
        !isPerceptuallySimilar;

      lastPreviewDataUriRef.current = previewDataUri;

      if (didChange) {
        lastScheduledFrameHashRef.current = frameHash;
        lastScheduledPerceptualHashRef.current = perceptualHash;
        if (continuousModeEnabledRef.current && captureMetadata.status === 'captured') {
          const continuousDecision = evaluateContinuousCaptureDecision({
            captureStatus: captureMetadata.status,
            didChange,
            frameHash,
            lastObservedFrameHash: continuousModeState.lastObservedFrameHash,
            observationInFlight: continuousObservationBusyRef.current,
          });

          if (continuousDecision === 'skip_duplicate' || isPerceptuallySimilar) {
            startTransition(() => {
              setContinuousModeState(previousState => ({
                ...previousState,
                lastObservationDecision: 'skipped_duplicate',
                currentMode: 'capturing',
                continuousStatusMessage:
                  'Changed capture skipped because it matched a recently observed frame.',
              }));
            });
          } else if (continuousDecision === 'skip_busy') {
            enqueueContinuousObservation({
              preview: {
                dataUri: previewDataUri,
                mimeType: result.previewMimeType,
                metadata: captureMetadata,
                ocrText: result.ocrText,
              },
              inspection: result.inspection,
              observedAt: captureMetadata.capturedAt,
              frameHash,
            });
          } else if (continuousDecision === 'observe') {
            enqueueContinuousObservation({
              preview: {
                dataUri: previewDataUri,
                mimeType: result.previewMimeType,
                metadata: captureMetadata,
                ocrText: result.ocrText,
              },
              inspection: result.inspection,
              observedAt: captureMetadata.capturedAt,
              frameHash,
            });
          }
        }
      }

      startTransition(() => {
        if (didChange || captureMetadata.status !== 'captured') {
          setLatestInspection(result.inspection);
          setPermissions(toPermissionsFromSnapshot(result.inspection.context));
          setLatestCapturePreview({
            dataUri: previewDataUri,
            mimeType: result.previewMimeType,
            metadata: captureMetadata,
            ocrText: result.ocrText,
          });
          setNativeErrorMessage(null);
        }

        setSchedulerState(previousState => ({
          ...previousState,
          busy: false,
          tickCount: previousState.tickCount + 1,
          changedCount: previousState.changedCount + (didChange ? 1 : 0),
          skippedCount:
            previousState.skippedCount + (didChange ? 0 : 1),
          lastTickAt: captureMetadata.capturedAt,
          lastDecision:
            captureMetadata.status === 'captured'
              ? didChange
                ? 'changed'
                : 'skipped'
              : 'error',
          lastFrameHash: frameHash,
        }));
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'The 1 FPS scheduler failed to capture a frame.';

      startTransition(() => {
        setNativeErrorMessage(message);
        setSchedulerState(previousState => ({
          ...previousState,
          busy: false,
          tickCount: previousState.tickCount + 1,
          lastTickAt: createOccurredAt(),
          lastDecision: 'error',
        }));
        setContinuousModeState(previousState => {
          const nextFailureCount = continuousFailureCountRef.current + 1;
          return {
            ...previousState,
            currentMode: shouldAutoPauseContinuousMode(nextFailureCount)
              ? 'paused'
              : 'error',
            continuousStatusMessage:
              shouldAutoPauseContinuousMode(nextFailureCount)
                ? `Continuous mode auto-paused after repeated capture failures: ${message}`
                : `Continuous capture failed: ${message}`,
            consecutiveFailureCount: nextFailureCount,
            lastObservationDecision: 'error',
          };
        });
      });
      if (
        continuousModeEnabledRef.current &&
        shouldAutoPauseContinuousMode(continuousModeState.consecutiveFailureCount + 1)
      ) {
        pauseContinuousMode(
          `Continuous mode auto-paused after repeated capture failures: ${message}`,
        );
      }
    } finally {
      schedulerBusyRef.current = false;
    }
  });

  useEffect(() => {
    if (!schedulerState.running || store.hydrationStatus !== 'ready') {
      return;
    }

    const intervalId = setInterval(() => {
      runScheduledTick().catch(() => {});
    }, schedulerState.intervalMs);

    return () => {
      clearInterval(intervalId);
    };
  }, [runScheduledTick, schedulerState.intervalMs, schedulerState.running, store.hydrationStatus]);

  function startScheduler() {
    startContinuousMode();
  }

  function stopScheduler() {
    stopContinuousMode();
  }

  const currentPrimaryTaskSegment = getCurrentPrimaryTaskSegment(store.timeline);
  const currentTaskLineage = getCurrentTaskLineage(store.timeline);
  const currentSideBranchSegment = getCurrentSideBranchSegment(store.timeline);
  const recentTaskDecisions = getRecentTaskDecisions(store.timeline, 6);
  const pendingTaskObservations = getPendingObservations(store.timeline);
  const taskSegments = getTaskSegments(store.timeline);
  const taskLineages = getTaskLineages(store.timeline);
  const recentTaskObservations = getRecentTaskObservations(store.timeline, 6);
  const taskDecisionCount = getTaskDecisionCount(store.timeline);
  const lastTaskDecisionAt = getLastTaskDecisionAt(store.timeline);
  const taskMetrics = computeTaskEngineMetrics(store.timeline);

  return {
    ...store,
    monitoringEnabled,
    permissions,
    latestInspection,
    latestCapturePreview,
    actionFeedback,
    schedulerState,
    continuousModeState,
    currentPrimaryTaskSegment,
    currentTaskLineage,
    currentSideBranchSegment,
    recentTaskDecisions,
    recentTaskObservations,
    taskDecisionCount,
    lastTaskDecisionAt,
    pendingTaskObservations,
    taskSegments,
    taskLineages,
    taskMetrics,
    surfaceErrorMessage: nativeErrorMessage ?? store.errorMessage,
    startSession,
    stopSession,
    renameCurrentSession,
    startTask,
    stopTask,
    renameCurrentTask,
    addFakeObservation,
    deleteObservation,
    recordStructuredObservation,
    rebuildFromEventLog,
    promptForAccessibility,
    requestScreenCapturePermission,
    runCaptureInspection,
    runCaptureNow,
    runTaskReconciliation,
    applyUserTaskCorrection,
    startContinuousMode,
    stopContinuousMode,
    startScheduler,
    stopScheduler,
  };
}
