export const MEETING_CANDIDATE_STATUSES = [
  'candidate',
  'prompted',
  'dismissed',
  'recording',
  'ended',
] as const;

export type MeetingCandidateStatus =
  (typeof MEETING_CANDIDATE_STATUSES)[number];

export type MeetingCandidateView = {
  meetingId: string;
  sessionId: string | null;
  status: MeetingCandidateStatus;
  detectedAt: string;
  updatedAt: string;
  promptShownAt: string | null;
  dismissedAt: string | null;
  endedAt: string | null;
  recordingId: string | null;
  appName: string | null;
  bundleIdentifier: string | null;
  windowTitle: string | null;
  confidence: number;
  reasonCodes: string[];
  sourceEventIds: string[];
};

export type MeetingDetectionResult = {
  candidate: MeetingCandidateView;
  shouldPrompt: boolean;
};
