export const AUDIO_RECORDING_SOURCES = [
  'microphone',
  'system',
  'combined',
] as const;

export type AudioRecordingSource = (typeof AUDIO_RECORDING_SOURCES)[number];

export const AUDIO_RECORDING_STATUSES = [
  'recording',
  'paused',
  'stopped',
  'failed',
  'deleted',
] as const;

export type AudioRecordingStatus = (typeof AUDIO_RECORDING_STATUSES)[number];

export const AUDIO_PERMISSION_STATES = [
  'granted',
  'denied',
  'not_determined',
  'restricted',
  'unknown',
] as const;

export type AudioPermissionState = (typeof AUDIO_PERMISSION_STATES)[number];

export type AudioPermissionStatus = {
  microphone: AudioPermissionState;
  microphoneAccessGranted: boolean;
  systemAudioCaptureAvailable: boolean;
  checkedAt: string;
};

export type AudioRecordingView = {
  recordingId: string;
  sessionId: string | null;
  meetingId: string | null;
  taskSegmentId: string | null;
  source: AudioRecordingSource;
  status: AudioRecordingStatus;
  startedAt: string;
  pausedAt: string | null;
  resumedAt: string | null;
  stoppedAt: string | null;
  durationMs: number | null;
  filePath: string | null;
  byteLength: number | null;
  errorMessage: string | null;
};

export type AudioTranscriptSegment = {
  startMs: number;
  endMs: number;
  speaker: string | null;
  text: string;
};

export type AudioTranscriptView = {
  transcriptId: string;
  recordingId: string;
  generatedAt: string;
  model: string;
  durationMs: number;
  segments: AudioTranscriptSegment[];
};

export type AudioRecordingRuntimeState = {
  permissionStatus: AudioPermissionStatus | null;
  activeRecordingId: string | null;
  inFlight: boolean;
  lastError: string | null;
};
