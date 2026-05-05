export type MeetingAssistantSettings = {
  enabled: boolean;
  askBeforeRecording: boolean;
  systemAudioEnabled: boolean;
  microphoneEnabled: boolean;
  saveRawAudio: boolean;
  deleteRawAudioAfterTranscription: boolean;
  defaultConsentReminderAccepted: boolean;
  enabledApps: string[];
};

export const DEFAULT_MEETING_ASSISTANT_SETTINGS: MeetingAssistantSettings = {
  enabled: true,
  askBeforeRecording: true,
  systemAudioEnabled: true,
  microphoneEnabled: false,
  saveRawAudio: false,
  deleteRawAudioAfterTranscription: true,
  defaultConsentReminderAccepted: false,
  enabledApps: [
    'Zoom',
    'Microsoft Teams',
    'Slack',
    'FaceTime',
    'Discord',
    'Google Meet',
  ],
};

export type MeetingAudioSource = 'system' | 'microphone';
export type MeetingMicrophonePermissionStatus =
  | 'granted'
  | 'denied'
  | 'not_determined'
  | 'restricted'
  | 'unknown';

export type MeetingDetectionConfidence = 'likely' | 'high';

export type MeetingDetection = {
  id: string;
  dedupeKey: string;
  detectedAt: string;
  expiresAt: string;
  score: number;
  confidence: MeetingDetectionConfidence;
  appName: string | null;
  bundleIdentifier: string | null;
  windowTitle: string | null;
  calendarEventId: string | null;
  calendarEventTitle: string | null;
  calendarEventStartTime: string | null;
  calendarEventEndTime: string | null;
  reasons: string[];
};

export type MeetingRecordingStatus =
  | 'starting'
  | 'recording'
  | 'finalizing'
  | 'stopped'
  | 'failed';

export type MeetingRecording = {
  id: string;
  meetingId: string;
  detectionId: string | null;
  startedAt: string;
  stoppedAt: string | null;
  status: MeetingRecordingStatus;
  appName: string | null;
  bundleIdentifier: string | null;
  windowTitle: string | null;
  calendarEventId: string | null;
  sources: MeetingAudioSource[];
  rawAudioSaved: boolean;
  errorMessage: string | null;
};

export type MeetingAudioChunkMetadata = {
  meetingId: string;
  chunkId: string;
  startedAt: string;
  endedAt: string;
  source: MeetingAudioSource;
  mimeType: string;
  filePath: string;
  byteLength: number;
};

export type MeetingTranscriptChunk = {
  id: string;
  meetingId: string;
  chunkId: string;
  startedAt: string;
  endedAt: string;
  text: string;
  speakerLabel: string | null;
  confidence: number | null;
  language: string | null;
  source: MeetingAudioSource;
  transcribedAt: string;
};

export type MeetingSummary = {
  id: string;
  meetingId: string;
  generatedAt: string;
  title: string;
  summary: string;
  decisions: string[];
  actionItems: string[];
  followUps: string[];
  questions: string[];
};

export type MeetingPermissionState = {
  helperAvailable: boolean;
  screenCaptureGranted: boolean | null;
  microphoneGranted: boolean | null;
  microphoneStatus: MeetingMicrophonePermissionStatus;
};

export type MeetingRuntimeState = {
  assistantEnabled: boolean;
  consentAccepted: boolean;
  currentDetection: MeetingDetection | null;
  activeRecording: MeetingRecording | null;
  permissionState: MeetingPermissionState;
  transcriptionStatus:
    | 'idle'
    | 'detected'
    | 'starting'
    | 'transcribing'
    | 'finalizing'
    | 'failed';
  transcriptProgress: {
    chunkCount: number;
    lastChunkAt: string | null;
  };
  lastError: string | null;
};

export type StartMeetingTranscriptionArgs = {
  detectionId?: string;
  consentAccepted: boolean;
  sources?: MeetingAudioSource[];
};

export type ManagedAudioTranscriptionInput = {
  meetingId: string;
  chunkId: string;
  startedAt: string;
  endedAt: string;
  source: MeetingAudioSource;
  mimeType: string;
  audioBase64: string;
};

export type ManagedAudioTranscriptionResult = {
  text: string;
  speakerLabel?: string | null;
  confidence?: number | null;
  language?: string | null;
};

export type ManagedMeetingSummaryInput = {
  meetingId: string;
  transcriptChunks: MeetingTranscriptChunk[];
  calendarEvent?: {
    id: string;
    title: string;
    startTime: string;
    endTime: string;
  } | null;
};

export type ManagedMeetingSummaryResult = Omit<
  MeetingSummary,
  'id' | 'meetingId' | 'generatedAt'
>;
