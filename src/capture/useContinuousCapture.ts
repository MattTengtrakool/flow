import {useEffect, useRef, useState} from 'react';

import type {CapturePreviewState} from './useCaptureController';
import type {CaptureInspectionPayload} from '../types/contextCapture';
import type {HydrationStatus} from '../timeline/useTimelinePersistence';
import {useStableEvent} from '../timeline/useStableEvent';

const CONTINUOUS_CAPTURE_INTERVAL_MS = 1000;

export type ContinuousModeState = {
  enabled: boolean;
  currentMode: 'off' | 'capturing' | 'observing' | 'paused' | 'error';
  statusMessage: string;
  lastObservedAt: string | null;
  lastObservedFrameHash: string | null;
  consecutiveFailureCount: number;
};

type CaptureResult = {
  preview: CapturePreviewState;
  inspection: CaptureInspectionPayload;
};

export function useContinuousCapture(args: {
  hydrationStatus: HydrationStatus;
  runCaptureNow: () => Promise<CaptureResult | null>;
  observeCapture: (
    preview: CapturePreviewState,
    inspection: CaptureInspectionPayload,
  ) => Promise<{observedAt: string; frameHash: string | null} | null>;
}) {
  const [continuousModeState, setContinuousModeState] =
    useState<ContinuousModeState>({
      enabled: false,
      currentMode: 'off',
      statusMessage: 'Continuous capture is off.',
      lastObservedAt: null,
      lastObservedFrameHash: null,
      consecutiveFailureCount: 0,
    });
  const lastObservedFrameHashRef = useRef<string | null>(null);

  const runContinuousTick = useStableEvent(async () => {
    const result = await args.runCaptureNow();
    if (
      result == null ||
      !continuousModeState.enabled ||
      result.preview.metadata.status !== 'captured'
    ) {
      return;
    }
    const frameHash = result.preview.metadata.frameHash ?? null;
    if (frameHash != null && frameHash === lastObservedFrameHashRef.current) {
      return;
    }

    setContinuousModeState(previous => ({
      ...previous,
      currentMode: 'observing',
      statusMessage: 'Generating a structured observation.',
    }));

    try {
      const observed = await args.observeCapture(result.preview, result.inspection);
      if (observed == null) return;
      lastObservedFrameHashRef.current = observed.frameHash;
      setContinuousModeState(previous => ({
        ...previous,
        currentMode: previous.enabled ? 'capturing' : 'off',
        lastObservedAt: observed.observedAt,
        lastObservedFrameHash: observed.frameHash,
        consecutiveFailureCount: 0,
        statusMessage: 'Captured the latest changed frame.',
      }));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Observation generation failed.';
      setContinuousModeState(previous => ({
        ...previous,
        currentMode: 'error',
        consecutiveFailureCount: previous.consecutiveFailureCount + 1,
        statusMessage: message,
      }));
    }
  });

  useEffect(() => {
    if (!continuousModeState.enabled || args.hydrationStatus !== 'ready') {
      return;
    }
    const intervalId = setInterval(() => {
      runContinuousTick().catch(() => {});
    }, CONTINUOUS_CAPTURE_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [args.hydrationStatus, continuousModeState.enabled, runContinuousTick]);

  function start() {
    setContinuousModeState(previous => ({
      ...previous,
      enabled: true,
      currentMode: 'capturing',
      statusMessage: 'Continuous capture is running.',
    }));
  }

  function stop(reason = 'Continuous capture is off.') {
    setContinuousModeState(previous => ({
      ...previous,
      enabled: false,
      currentMode: 'off',
      statusMessage: reason,
    }));
  }

  function resume() {
    setContinuousModeState(previous => ({
      ...previous,
      enabled: true,
      currentMode: 'capturing',
      statusMessage: 'Continuous capture resumed.',
    }));
  }

  return {
    continuousModeState,
    startContinuousCapture: start,
    stopContinuousCapture: stop,
    resumeContinuousCapture: resume,
  };
}
