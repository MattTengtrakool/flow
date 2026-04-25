import {useEffect, useMemo, useState} from 'react';

import {useCaptureController} from '../capture/useCaptureController';
import {useContinuousCapture} from '../capture/useContinuousCapture';
import {useObservationRecorder} from '../observation/useObservationRecorder';
import {usePlannerController} from '../planner/usePlannerController';
import {useContextMonitoring} from './useContextMonitoring';
import {useTimelinePersistence, type HydrationStatus} from './useTimelinePersistence';
import {
  createDomainId,
  createOccurredAt,
  type DomainEvent,
  type TimelineView,
} from './eventLog';

export type OrphanedSession = {
  sessionId: string;
  startedAt: string;
  lastActivityAt: string;
  ageMs: number;
};

function findLastSessionActivity(
  eventLog: DomainEvent[],
  sessionId: string,
): string | null {
  for (let index = eventLog.length - 1; index >= 0; index -= 1) {
    const event = eventLog[index];
    if ('sessionId' in event && event.sessionId === sessionId) {
      return event.occurredAt;
    }
  }
  return null;
}

function computeOrphanedSession(
  hydrationStatus: HydrationStatus,
  timeline: TimelineView,
  eventLog: DomainEvent[],
  continuousEnabled: boolean,
): OrphanedSession | null {
  if (
    hydrationStatus !== 'ready' ||
    continuousEnabled ||
    timeline.currentSessionId == null
  ) {
    return null;
  }
  const session = timeline.sessionsById[timeline.currentSessionId];
  if (session == null || session.endedAt != null) return null;
  const lastActivityAt =
    findLastSessionActivity(eventLog, session.id) ?? session.startedAt;
  return {
    sessionId: session.id,
    startedAt: session.startedAt,
    lastActivityAt,
    ageMs: Math.max(0, Date.now() - Date.parse(lastActivityAt)),
  };
}

export function useTimelineStore() {
  const {
    store,
    timelineRef,
    appendEvent,
    appendEvents,
  } = useTimelinePersistence();
  const [nativeErrorMessage, setNativeErrorMessage] = useState<string | null>(null);

  const captureController = useCaptureController({
    appendEvent,
    appendEvents,
    setErrorMessage: setNativeErrorMessage,
  });

  const plannerController = usePlannerController({
    timelineRef,
    hydrationStatus: store.hydrationStatus,
    currentSessionId: store.timeline.currentSessionId,
    appendEvents,
  });

  const observationRecorder = useObservationRecorder({
    timelineRef,
    appendEvent,
    onObservationRecorded: plannerController.maybeKickoffSessionStartPlan,
  });

  const continuousCapture = useContinuousCapture({
    hydrationStatus: store.hydrationStatus,
    runCaptureNow: captureController.runCaptureNow,
    observeCapture: observationRecorder.observeCapture,
  });

  useContextMonitoring({
    hydrationStatus: store.hydrationStatus,
    appendEvent,
    setErrorMessage: setNativeErrorMessage,
  });

  useEffect(() => {
    if (store.hydrationStatus !== 'ready') return;
    let cancelled = false;
    captureController
      .refreshPermissions()
      .then(() => {
        if (cancelled) return;
      })
      .catch(error => {
        if (!cancelled) {
          setNativeErrorMessage(
            error instanceof Error
              ? error.message
              : 'Failed to refresh permission state.',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [store.hydrationStatus]);

  async function startSession() {
    appendEvent({
      id: createDomainId('event'),
      type: 'session_started',
      sessionId: createDomainId('session'),
      title: `Session ${store.timeline.sessionOrder.length + 1}`,
      occurredAt: createOccurredAt(),
    });
    continuousCapture.startContinuousCapture();
  }

  async function stopSession() {
    const sessionId = timelineRef.current.currentSessionId;
    if (sessionId == null) return;
    await plannerController.runPlannerRevisionNow({
      cause: 'session_stop',
      force: true,
    });
    appendEvent({
      id: createDomainId('event'),
      type: 'session_stopped',
      sessionId,
      occurredAt: createOccurredAt(),
    });
    continuousCapture.stopContinuousCapture();
    plannerController.resetSessionStartPlan();
  }

  function closeOrphanedSession() {
    const sessionId = timelineRef.current.currentSessionId;
    if (sessionId == null) return;
    appendEvent({
      id: createDomainId('event'),
      type: 'session_stopped',
      sessionId,
      occurredAt: createOccurredAt(),
    });
  }

  function resumeSession() {
    if (timelineRef.current.currentSessionId == null) return;
    continuousCapture.resumeContinuousCapture();
    plannerController.maybeKickoffSessionStartPlan();
  }

  function updateBlockNotes(args: {
    notesKey: string;
    blockId: string | null;
    notes: string;
  }) {
    appendEvent({
      id: createDomainId('event'),
      type: 'user_block_notes_edited',
      notesKey: args.notesKey,
      blockId: args.blockId,
      notes: args.notes,
      occurredAt: createOccurredAt(),
    });
  }

  const orphanedSession = useMemo(
    () =>
      computeOrphanedSession(
        store.hydrationStatus,
        store.timeline,
        store.eventLog,
        continuousCapture.continuousModeState.enabled,
      ),
    [
      continuousCapture.continuousModeState.enabled,
      store.eventLog,
      store.hydrationStatus,
      store.timeline,
    ],
  );

  return {
    ...store,
    permissions: captureController.permissions,
    latestInspection: captureController.latestInspection,
    latestCapturePreview: captureController.latestCapturePreview,
    continuousModeState: continuousCapture.continuousModeState,
    plannerRuntimeState: plannerController.plannerRuntimeState,
    orphanedSession,
    surfaceErrorMessage: nativeErrorMessage ?? store.errorMessage,
    runPlannerRevisionNow: plannerController.runPlannerRevisionNow,
    runCaptureNow: captureController.runCaptureNow,
    runCaptureInspection: captureController.runCaptureInspection,
    startSession,
    stopSession,
    promptForAccessibility: captureController.promptForAccessibility,
    requestScreenCapturePermission: captureController.requestScreenCapturePermission,
    closeOrphanedSession,
    resumeSession,
    updateBlockNotes,
    getCapturePreview: observationRecorder.getCapturePreview,
    capturePreviewCount: observationRecorder.capturePreviewCount,
  };
}
