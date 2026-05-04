export type ProactiveInsightKind =
  | 'pre_meeting_brief'
  | 'post_meeting_notes'
  | 'return_to_task'
  | 'low_confidence_block'
  | 'end_of_day_summary';

export type ProactiveInsightPriority = 'low' | 'normal' | 'high';

export type ProactiveInsightAction = {
  id: string;
  label: string;
  kind: 'open' | 'snooze' | 'dismiss' | 'review';
};

export type ProactiveInsightDisplayMode = 'pill' | 'card' | 'brief';

export type CompanionCustomPosition = {
  x: number;
  y: number;
};

export type ProactiveInsight = {
  id: string;
  kind: ProactiveInsightKind;
  title: string;
  body: string;
  reason?: string;
  priority: ProactiveInsightPriority;
  relatedBlockIds: string[];
  relatedCalendarEventIds: string[];
  relatedArtifactIds?: string[];
  relatedObservationIds?: string[];
  actions: ProactiveInsightAction[];
  primaryAction?: ProactiveInsightAction;
  displayMode?: ProactiveInsightDisplayMode;
  generatedAt: string;
  expiresAt?: string;
};

export type ProactiveSettings = {
  proactiveEnabled: boolean;
  companionEnabled: boolean;
  preMeetingBriefsEnabled: boolean;
  postMeetingNotesEnabled: boolean;
  returnToTaskEnabled: boolean;
  lowConfidenceCorrectionsEnabled: boolean;
  endOfDaySummaryEnabled: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  intensity: 'quiet' | 'balanced' | 'active';
  companionPosition: 'bottom-right' | 'right-center' | 'bottom-left';
  companionCustomPosition: CompanionCustomPosition | null;
};

export type ProactiveInsightStatus = 'active' | 'dismissed' | 'snoozed';

export type ProactiveInsightView = ProactiveInsight & {
  status: ProactiveInsightStatus;
  dismissedAt?: string;
  snoozedUntil?: string;
  actionedAt?: string;
  lastActionId?: string;
};

export type ProactiveState = {
  enabled: boolean;
  companionEnabled: boolean;
  quieted: boolean;
  settings: ProactiveSettings;
  insights: ProactiveInsightView[];
  activeInsight: ProactiveInsightView | null;
};

export type ProactiveBriefRequest = {
  kind: ProactiveInsightKind;
  title: string;
  reason?: string;
  calendarEvent?: {
    id: string;
    title: string;
    startTime: string;
    endTime: string;
    attendeesCount: number;
    location: string | null;
  };
  relatedBlocks: Array<{
    id: string;
    headline: string;
    narrative: string;
    notes?: string;
    nextActions: string[];
    artifacts: string[];
  }>;
  artifacts: string[];
};

export type ProactiveBriefResult = {
  title: string;
  bullets: string[];
  suggestedActions: string[];
};

export const DEFAULT_PROACTIVE_SETTINGS: ProactiveSettings = {
  proactiveEnabled: true,
  companionEnabled: true,
  preMeetingBriefsEnabled: true,
  postMeetingNotesEnabled: false,
  returnToTaskEnabled: false,
  lowConfidenceCorrectionsEnabled: false,
  endOfDaySummaryEnabled: false,
  quietHoursEnabled: false,
  quietHoursStart: '18:00',
  quietHoursEnd: '08:00',
  intensity: 'balanced',
  companionPosition: 'bottom-right',
  companionCustomPosition: null,
};
