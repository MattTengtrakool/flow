import { useCallback, useEffect, useMemo, useState } from 'react';

import type { MeetingRuntimeState } from '../../../src/meetings/types';
import type { FlowElectronApi } from '../../shared/flowApi';

const EMPTY_MEETING_STATE: MeetingRuntimeState = {
  assistantEnabled: false,
  consentAccepted: false,
  currentDetection: null,
  activeRecording: null,
  permissionState: {
    helperAvailable: false,
    screenCaptureGranted: null,
    microphoneGranted: null,
  },
  transcriptionStatus: 'idle',
  transcriptProgress: {
    chunkCount: 0,
    lastChunkAt: null,
  },
  lastError: null,
};

export function useMeetingState(flow: FlowElectronApi | undefined) {
  const [state, setState] = useState<MeetingRuntimeState>(EMPTY_MEETING_STATE);

  useEffect(() => {
    if (flow == null) return;
    flow.meetings
      .getState()
      .then(setState)
      .catch(() => {});
    const subscription = flow.meetings.addStateListener(setState);
    return () => subscription.remove();
  }, [flow]);

  const startTranscription = useCallback(
    (detectionId: string | undefined, consentAccepted: boolean) => {
      if (flow == null) return Promise.resolve(state);
      return flow.meetings
        .startTranscription({ detectionId, consentAccepted })
        .then(next => {
          setState(next);
          return next;
        });
    },
    [flow, state],
  );

  const stopTranscription = useCallback(
    (meetingId: string) => {
      if (flow == null) return Promise.resolve(state);
      return flow.meetings.stopTranscription(meetingId).then(next => {
        setState(next);
        return next;
      });
    },
    [flow, state],
  );

  const dismissDetection = useCallback(
    (detectionId: string) => {
      if (flow == null) return Promise.resolve(state);
      return flow.meetings.dismissDetection(detectionId).then(next => {
        setState(next);
        return next;
      });
    },
    [flow, state],
  );

  return useMemo(
    () => ({
      ...state,
      startTranscription,
      stopTranscription,
      dismissDetection,
    }),
    [dismissDetection, startTranscription, state, stopTranscription],
  );
}
