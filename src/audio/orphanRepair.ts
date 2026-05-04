import type {
  AudioRecordingFailedEvent,
  TimelineView,
} from '../timeline/eventLog';
import {createDomainId} from '../timeline/eventLog';

export const ORPHANED_AUDIO_RECORDING_MESSAGE =
  'Recording was interrupted because Flow restarted before the native audio helper stopped cleanly.';

export function buildOrphanedAudioRecordingRepairEvent(args: {
  timeline: TimelineView;
  occurredAt: string;
  createEventId?: () => string;
}): AudioRecordingFailedEvent | null {
  const recordingId = args.timeline.activeAudioRecordingId;
  if (recordingId == null) return null;

  const recording = args.timeline.audioRecordingsById[recordingId];
  if (
    recording == null ||
    (recording.status !== 'recording' && recording.status !== 'paused')
  ) {
    return null;
  }

  return {
    id: args.createEventId?.() ?? createDomainId('event'),
    type: 'audio_recording_failed',
    recordingId,
    failedAt: args.occurredAt,
    errorMessage: ORPHANED_AUDIO_RECORDING_MESSAGE,
    occurredAt: args.occurredAt,
  };
}
