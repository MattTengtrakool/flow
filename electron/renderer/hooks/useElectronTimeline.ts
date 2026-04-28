import {useCallback, useEffect, useMemo, useState} from 'react';

import {createEmptyTimeline, type TimelineView} from '../../../src/timeline/eventLog';
import type {FlowElectronApi, TimelineStatePayload} from '../../shared/flowApi';

type HydrationStatus = 'loading' | 'ready' | 'error';

type StoreState = {
  eventLogLength: number;
  timeline: TimelineView;
  hydrationStatus: HydrationStatus;
  storagePath: string | null;
  errorMessage: string | null;
  lastSavedAt: string | null;
  continuousModeState: {
    enabled: boolean;
    currentMode: 'off' | 'capturing' | 'observing' | 'error';
    statusMessage: string;
    lastObservedAt: string | null;
    lastObservedFrameHash: string | null;
    consecutiveFailureCount: number;
  };
  plannerRuntimeState: {
    inFlight: boolean;
    lastRunAt: string | null;
    lastSnapshotId: string | null;
    lastFailureMessage: string | null;
  };
};

function initialState(): StoreState {
  return {
    eventLogLength: 0,
    timeline: createEmptyTimeline(),
    hydrationStatus: 'loading',
    storagePath: null,
    errorMessage: null,
    lastSavedAt: null,
    continuousModeState: {
      enabled: false,
      currentMode: 'off',
      statusMessage: 'Continuous capture is off.',
      lastObservedAt: null,
      lastObservedFrameHash: null,
      consecutiveFailureCount: 0,
    },
    plannerRuntimeState: {
      inFlight: false,
      lastRunAt: null,
      lastSnapshotId: null,
      lastFailureMessage: null,
    },
  };
}

function stateFromPayload(payload: TimelineStatePayload): StoreState {
  return {
    eventLogLength: payload.eventLogLength,
    timeline: payload.timeline,
    hydrationStatus: payload.hydrationStatus,
    storagePath: payload.storagePath,
    errorMessage: payload.errorMessage,
    lastSavedAt: null,
    continuousModeState: {
      enabled: payload.captureEnabled,
      currentMode: payload.captureEnabled ? 'capturing' : 'off',
      statusMessage: payload.captureStatusMessage,
      lastObservedAt: null,
      lastObservedFrameHash: null,
      consecutiveFailureCount: 0,
    },
    plannerRuntimeState: {
      inFlight: payload.plannerInFlight,
      lastRunAt: null,
      lastSnapshotId: null,
      lastFailureMessage: payload.errorMessage,
    },
  };
}

export function useElectronTimeline(flow: FlowElectronApi | undefined) {
  const [store, setStore] = useState<StoreState>(initialState);

  const applyTimelineState = useCallback((payload: TimelineStatePayload) => {
    setStore(stateFromPayload(payload));
  }, []);

  useEffect(() => {
    if (flow == null) {
      setStore(previous => ({
        ...previous,
        hydrationStatus: 'error',
        errorMessage: 'Electron bridge missing.',
      }));
      return;
    }
    let cancelled = false;
    flow.timeline
      .getState()
      .then(payload => {
        if (!cancelled) applyTimelineState(payload);
      })
      .catch(error => {
        if (!cancelled) {
          setStore(previous => ({
            ...previous,
            hydrationStatus: 'error',
            errorMessage:
              error instanceof Error ? error.message : 'Failed to load timeline.',
          }));
        }
      });
    const subscription = flow.timeline.addStateListener(applyTimelineState);
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [applyTimelineState, flow]);

  const runPlannerRevisionNow = useCallback(
    async (force = false) => {
      if (flow?.timeline != null) {
        await flow.timeline.runPlannerRevision(force);
        return;
      }
      throw new Error('Electron timeline bridge missing.');
    },
    [flow],
  );

  const runCaptureNow = useCallback(async () => {
    if (flow?.timeline != null) {
      await flow.timeline.captureNow();
      return;
    }
    throw new Error('Electron timeline bridge missing.');
  }, [flow]);

  const startSession = useCallback(() => {
    if (flow?.timeline != null) {
      flow.timeline.startSession().catch(() => {});
      return;
    }
    setStore(previous => ({
      ...previous,
      errorMessage: 'Electron timeline bridge missing.',
    }));
  }, [flow]);

  const stopSession = useCallback(async () => {
    if (flow?.timeline != null) {
      await flow.timeline.stopSession();
      return;
    }
    throw new Error('Electron timeline bridge missing.');
  }, [flow]);

  return useMemo(
    () => ({
      ...store,
      runCaptureNow,
      runPlannerRevisionNow,
      startSession,
      stopSession,
    }),
    [store, runCaptureNow, runPlannerRevisionNow, startSession, stopSession],
  );
}
