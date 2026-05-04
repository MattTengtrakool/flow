import {useCallback, useEffect, useMemo, useState} from 'react';

import type {AudioRecordingSource} from '../../../src/audio/types';
import {createEmptyTimeline, type TimelineView} from '../../../src/timeline/eventLog';
import type {
  ApiKeyStatus,
  AiConnectionMode,
  ApiProvider,
  FlowElectronApi,
  FlowSettings,
  TimelineStatePayload,
} from '../../shared/flowApi';

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
    currentMode: 'off' | 'capturing' | 'observing' | 'paused' | 'error';
    statusMessage: string;
    lastCapturedAt: string | null;
    lastObservedAt: string | null;
    lastObservedFrameHash: string | null;
    consecutiveFailureCount: number;
  };
  plannerRuntimeState: {
    inFlight: boolean;
    lastRunAt: string | null;
    lastRunCause: TimelineStatePayload['plannerRuntimeState']['lastRunCause'];
    lastSnapshotId: string | null;
    lastFailureMessage: string | null;
    lastSkippedReason: string | null;
    consecutiveFailureCount: number;
    status: 'idle' | 'planning' | 'failed';
  };
  privacyModeEnabled: boolean;
  aiConnectionMode: AiConnectionMode;
  selectedProvider: ApiProvider;
  managedAi: FlowSettings['managedAi'];
  apiKeyStatus: Record<ApiProvider, ApiKeyStatus>;
  recentActivity: TimelineStatePayload['recentActivity'];
  meetingDetection: TimelineStatePayload['meetingDetection'];
  activeMeetingRecording: TimelineStatePayload['activeMeetingRecording'];
  meetingTranscriptionStatus: TimelineStatePayload['meetingTranscriptionStatus'];
  audioRuntimeState: TimelineStatePayload['audioRuntimeState'];
  activeMeetingCandidate: TimelineStatePayload['activeMeetingCandidate'];
  audioPermissionStatus: TimelineStatePayload['audioRuntimeState']['permissionStatus'];
  diagnostics: TimelineStatePayload['diagnostics'] | null;
};

const missingApiKeyStatus: ApiKeyStatus = {
  configured: false,
  source: 'missing',
  encrypted: false,
  lastValidatedAt: null,
  validationStatus: 'untested',
  validationMessage: null,
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
      lastCapturedAt: null,
      lastObservedAt: null,
      lastObservedFrameHash: null,
      consecutiveFailureCount: 0,
    },
    plannerRuntimeState: {
      inFlight: false,
      lastRunAt: null,
      lastRunCause: null,
      lastSnapshotId: null,
      lastFailureMessage: null,
      lastSkippedReason: null,
      consecutiveFailureCount: 0,
      status: 'idle',
    },
    privacyModeEnabled: false,
    aiConnectionMode: 'managed',
    selectedProvider: 'gemini',
    managedAi: {
      configured: false,
      endpoint: null,
      authenticated: false,
    },
    apiKeyStatus: {
      gemini: missingApiKeyStatus,
      anthropic: missingApiKeyStatus,
    },
    recentActivity: [],
    meetingDetection: null,
    activeMeetingRecording: null,
    meetingTranscriptionStatus: 'idle',
    audioRuntimeState: {
      permissionStatus: null,
      activeRecordingId: null,
      inFlight: false,
      lastError: null,
    },
    activeMeetingCandidate: null,
    audioPermissionStatus: null,
    diagnostics: null,
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
      currentMode: payload.privacyModeEnabled
        ? 'off'
        : payload.captureEnabled
          ? 'capturing'
          : payload.timeline.currentSessionId != null
            ? 'paused'
            : 'off',
      statusMessage: payload.captureStatusMessage,
      lastCapturedAt: payload.lastCapturedAt,
      lastObservedAt: payload.lastObservedAt,
      lastObservedFrameHash: null,
      consecutiveFailureCount: 0,
    },
    plannerRuntimeState: {
      inFlight: payload.plannerInFlight,
      lastRunAt: payload.plannerRuntimeState.lastRunAt,
      lastRunCause: payload.plannerRuntimeState.lastRunCause,
      lastSnapshotId: payload.plannerRuntimeState.lastSnapshotId,
      lastFailureMessage:
        payload.plannerRuntimeState.lastFailure?.message ?? null,
      lastSkippedReason: payload.plannerRuntimeState.lastSkippedReason,
      consecutiveFailureCount:
        payload.plannerRuntimeState.consecutiveFailureCount,
      status: payload.plannerStatus,
    },
    privacyModeEnabled: payload.privacyModeEnabled,
    aiConnectionMode: payload.aiConnectionMode,
    selectedProvider: payload.selectedProvider,
    managedAi: payload.managedAi,
    apiKeyStatus: payload.apiKeyStatus,
    recentActivity: payload.recentActivity,
    meetingDetection: payload.meetingDetection,
    activeMeetingRecording: payload.activeMeetingRecording,
    meetingTranscriptionStatus: payload.meetingTranscriptionStatus,
    audioRuntimeState: payload.audioRuntimeState,
    activeMeetingCandidate: payload.activeMeetingCandidate,
    audioPermissionStatus: payload.audioRuntimeState.permissionStatus,
    diagnostics: payload.diagnostics,
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

  const runDiagnosticReplan = useCallback(async () => {
    if (flow?.timeline != null) {
      await flow.timeline.runDiagnosticReplan({
        sessionId: store.timeline.currentSessionId,
      });
      return;
    }
    throw new Error('Electron timeline bridge missing.');
  }, [flow, store.timeline.currentSessionId]);

  const runCaptureNow = useCallback(async () => {
    if (flow?.timeline != null) {
      await flow.timeline.captureNow();
      return;
    }
    throw new Error('Electron timeline bridge missing.');
  }, [flow]);

  const requestAudioPermissions = useCallback(async () => {
    if (flow?.audio != null) {
      await flow.audio.requestPermissions();
      return;
    }
    throw new Error('Electron audio bridge missing.');
  }, [flow]);

  const startMeetingRecording = useCallback(
    async (
      meetingId?: string | null,
      source: AudioRecordingSource = 'microphone',
    ) => {
      if (flow?.audio != null) {
        await flow.audio.startRecording({
          meetingId: meetingId ?? store.activeMeetingCandidate?.meetingId ?? null,
          source,
        });
        return;
      }
      throw new Error('Electron audio bridge missing.');
    },
    [flow, store.activeMeetingCandidate?.meetingId],
  );

  const pauseAudioRecording = useCallback(async () => {
    if (flow?.audio != null) {
      await flow.audio.pauseRecording();
      return;
    }
    throw new Error('Electron audio bridge missing.');
  }, [flow]);

  const resumeAudioRecording = useCallback(async () => {
    if (flow?.audio != null) {
      await flow.audio.resumeRecording();
      return;
    }
    throw new Error('Electron audio bridge missing.');
  }, [flow]);

  const stopAudioRecording = useCallback(async () => {
    if (flow?.audio != null) {
      await flow.audio.stopRecording();
      return;
    }
    throw new Error('Electron audio bridge missing.');
  }, [flow]);

  const dismissMeetingPrompt = useCallback(
    async (meetingId: string) => {
      if (flow?.meeting != null) {
        await flow.meeting.dismissPrompt({meetingId});
        return;
      }
      throw new Error('Electron meeting bridge missing.');
    },
    [flow],
  );

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
      runDiagnosticReplan,
      requestAudioPermissions,
      startMeetingRecording,
      pauseAudioRecording,
      resumeAudioRecording,
      stopAudioRecording,
      dismissMeetingPrompt,
      startSession,
      stopSession,
    }),
    [
      store,
      runCaptureNow,
      runPlannerRevisionNow,
      runDiagnosticReplan,
      requestAudioPermissions,
      startMeetingRecording,
      pauseAudioRecording,
      resumeAudioRecording,
      stopAudioRecording,
      dismissMeetingPrompt,
      startSession,
      stopSession,
    ],
  );
}
