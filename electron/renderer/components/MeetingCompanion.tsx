import {memo, useCallback, useMemo, useState} from 'react';

import type {TimelineUiState} from '../types';

function RecordingIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <circle cx="7.5" cy="7.5" r="4" fill="currentColor" />
    </svg>
  );
}

export const MeetingCompanion = memo(function MeetingCompanion(props: {
  timelineStore: TimelineUiState;
}) {
  const {timelineStore} = props;
  const [busy, setBusy] = useState(false);
  const candidate = timelineStore.activeMeetingCandidate;
  const activeRecording =
    timelineStore.audioRuntimeState.activeRecordingId == null
      ? null
      : timelineStore.timeline.audioRecordingsById[
          timelineStore.audioRuntimeState.activeRecordingId
        ] ?? null;
  const permission = timelineStore.audioPermissionStatus;
  const title = useMemo(() => {
    if (activeRecording != null) {
      return candidate?.windowTitle ?? candidate?.appName ?? 'Recording meeting';
    }
    return candidate?.windowTitle ?? candidate?.appName ?? 'Meeting detected';
  }, [activeRecording, candidate]);

  const handleStart = useCallback(async (source: 'microphone' | 'system') => {
    if (candidate == null) return;
    setBusy(true);
    try {
      if (source === 'microphone' && permission?.microphoneAccessGranted !== true) {
        await timelineStore.requestAudioPermissions();
      }
      await timelineStore.startMeetingRecording(candidate.meetingId, source);
    } finally {
      setBusy(false);
    }
  }, [candidate, permission?.microphoneAccessGranted, timelineStore]);

  const handleDismiss = useCallback(async () => {
    if (candidate == null) return;
    await timelineStore.dismissMeetingPrompt(candidate.meetingId);
  }, [candidate, timelineStore]);

  if (activeRecording == null && candidate?.status !== 'prompted') {
    return null;
  }

  return (
    <aside className={`meeting-companion ${activeRecording != null ? 'is-recording' : ''}`}>
      <div className="meeting-companion__status">
        <span className="meeting-companion__dot">
          <RecordingIcon />
        </span>
        <div>
          <strong>{activeRecording != null ? 'Recording' : 'Meeting detected'}</strong>
          <p>{title}</p>
        </div>
      </div>

      {timelineStore.audioRuntimeState.lastError != null ? (
        <p className="meeting-companion__error">
          {timelineStore.audioRuntimeState.lastError}
        </p>
      ) : null}

      {activeRecording == null ? (
        <div className="meeting-companion__actions">
          <button
            type="button"
            className="button-primary"
            disabled={busy || timelineStore.audioRuntimeState.inFlight}
            onClick={() => {
              void handleStart('microphone');
            }}>
            Record mic
          </button>
          <button
            type="button"
            className="button-secondary"
            disabled={busy || timelineStore.audioRuntimeState.inFlight}
            onClick={() => {
              void handleStart('system');
            }}>
            Meeting audio
          </button>
          <button
            type="button"
            className="button-secondary"
            disabled={busy}
            onClick={handleDismiss}>
            Not now
          </button>
        </div>
      ) : (
        <div className="meeting-companion__actions">
          {activeRecording.status === 'paused' ? (
            <button
              type="button"
              className="button-secondary"
              onClick={() => timelineStore.resumeAudioRecording()}>
              Resume
            </button>
          ) : (
            <button
              type="button"
              className="button-secondary"
              onClick={() => timelineStore.pauseAudioRecording()}>
              Pause
            </button>
          )}
          <button
            type="button"
            className="button-danger-soft"
            onClick={() => timelineStore.stopAudioRecording()}>
            Stop
          </button>
        </div>
      )}
    </aside>
  );
});
