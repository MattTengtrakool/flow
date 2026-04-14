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
  setNativePreciseModeEnabled,
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
  replayEventLog,
  type DomainEvent,
  type TimelineView,
} from './eventLog';
import type {ObservationRun} from '../observation/types';

const OBSERVATION_TEMPLATES = [
  'Reviewed a pull request and scanned the latest comments.',
  'Drafted notes in the debug window for the current task.',
  'Switched context briefly to clarify the next action.',
  'Captured a synthetic observation for the event log pipeline.',
  'Validated that the timeline can rebuild from immutable events.',
];

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
  | {type: 'rebuild_timeline'; rebuiltAt: string}
  | {type: 'persist_succeeded'; storagePath: string; savedAt: string}
  | {type: 'persist_failed'; errorMessage: string};

type CapturePreviewState = {
  dataUri: string | null;
  mimeType: string | null;
  metadata: CaptureMetadataPayload;
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

function createScheduledObservationText(snapshot: ContextSnapshotPayload): string {
  const appLabel = snapshot.appName ?? 'Unknown app';
  const windowLabel =
    snapshot.windowTitle != null && snapshot.windowTitle.length > 0
      ? `: ${snapshot.windowTitle}`
      : '';

  if (snapshot.isIdle) {
    return `1 FPS scheduler saw a visual change while the machine was idle in ${appLabel}${windowLabel}.`;
  }

  return `1 FPS scheduler saw a visual change in ${appLabel}${windowLabel}.`;
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

export function useEventSourcedTimeline() {
  const [store, dispatch] = useReducer(timelineReducer, INITIAL_STORE);
  const [monitoringEnabled, setMonitoringEnabled] = useState(false);
  const [preciseModeEnabled, setPreciseModeEnabled] = useState(false);
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
  const lastPreviewDataUriRef = useRef<string | null>(null);
  const lastScheduledFrameHashRef = useRef<string | null>(null);
  const schedulerBusyRef = useRef(false);

  const appendEvent = useStableEvent((event: DomainEvent) => {
    startTransition(() => {
      dispatch({
        type: 'append_event',
        event,
      });
    });
  });

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
        snapshot,
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
          preciseModeEnabled: false,
          idleThresholdSeconds: 60,
        });

        if (!isCancelled) {
          startTransition(() => {
            setMonitoringEnabled(true);
            setPreciseModeEnabled(false);
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

    appendEvent({
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
  ) {
    appendEvent({
      id: createDomainId('event'),
      type: 'observation_added',
      observationId: createDomainId('observation'),
      sessionId: store.timeline.currentSessionId ?? undefined,
      taskId: store.timeline.currentTaskId ?? undefined,
      text: observationRun.observation.summary,
      structured: observationRun.observation,
      engineRun: observationRun,
      occurredAt,
    });
  }

  async function applyPreciseMode(nextValue: boolean) {
    startTransition(() => {
      setPreciseModeEnabled(nextValue);
    });

    if (!monitoringEnabled) {
      return;
    }

    try {
      const snapshot = await setNativePreciseModeEnabled(nextValue);
      handleContextSnapshot(snapshot);
      startTransition(() => {
        setActionFeedback(
          createActionFeedback(
            nextValue
              ? snapshot.source === 'window'
                ? 'Precise mode is on and window-level context is coming through.'
                : 'Precise mode is on, but the current app is still only giving app-level context.'
              : 'Precise mode is off. The app is using app-level context only.',
            nextValue && snapshot.source !== 'window' ? 'warning' : 'success',
          ),
        );
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to update precise mode.';

      startTransition(() => {
        setNativeErrorMessage(message);
        setActionFeedback(createActionFeedback(message, 'error'));
      });
    }
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
        inspection,
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

  async function runCaptureNow() {
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
        inspection: result.inspection,
        occurredAt: result.inspection.inspectedAt,
      });

      appendEvent({
        id: createDomainId('event'),
        type: 'capture_performed',
        captureId: createDomainId('capture'),
        capture: captureMetadata,
        occurredAt: captureMetadata.capturedAt,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to capture a screenshot.';

      startTransition(() => {
        setNativeErrorMessage(message);
        setActionFeedback(createActionFeedback(message, 'error'));
      });
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
      const didChange =
        captureMetadata.status === 'captured' &&
        frameHash != null &&
        frameHash.length > 0 &&
        frameHash !== lastScheduledFrameHashRef.current;

      lastPreviewDataUriRef.current = previewDataUri;

      if (didChange) {
        lastScheduledFrameHashRef.current = frameHash;

        appendEvent({
          id: createDomainId('event'),
          type: 'observation_added',
          observationId: createDomainId('observation'),
          sessionId: store.timeline.currentSessionId ?? undefined,
          taskId: store.timeline.currentTaskId ?? undefined,
          text: createScheduledObservationText(result.inspection.context),
          occurredAt: captureMetadata.capturedAt,
        });
      }

      startTransition(() => {
        if (didChange || captureMetadata.status !== 'captured') {
          setLatestInspection(result.inspection);
          setPermissions(toPermissionsFromSnapshot(result.inspection.context));
          setLatestCapturePreview({
            dataUri: previewDataUri,
            mimeType: result.previewMimeType,
            metadata: captureMetadata,
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
      });
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
    lastScheduledFrameHashRef.current = null;
    startTransition(() => {
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

  function stopScheduler() {
    startTransition(() => {
      setSchedulerState(previousState => ({
        ...previousState,
        running: false,
        busy: false,
      }));
    });
  }

  return {
    ...store,
    monitoringEnabled,
    preciseModeEnabled,
    permissions,
    latestInspection,
    latestCapturePreview,
    actionFeedback,
    schedulerState,
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
    setPreciseModeEnabled: applyPreciseMode,
    promptForAccessibility,
    requestScreenCapturePermission,
    runCaptureInspection,
    runCaptureNow,
    startScheduler,
    stopScheduler,
  };
}
