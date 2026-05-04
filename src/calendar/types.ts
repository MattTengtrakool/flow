export type CalendarProvider = 'google';

export type CalendarSyncStatus = 'idle' | 'syncing' | 'error';

export type CalendarSourceMode = 'scheduled' | 'context_only' | 'ignored';

export type CalendarAccountView = {
  id: string;
  provider: CalendarProvider;
  email: string;
  displayName: string | null;
  connectedAt: string;
  lastSyncedAt: string | null;
  syncStatus: CalendarSyncStatus;
  syncError: string | null;
};

export type CalendarSourceAccessRole =
  | 'none'
  | 'freeBusyReader'
  | 'reader'
  | 'writer'
  | 'owner';

export type CalendarSourceView = {
  id: string;
  accountId: string;
  provider: CalendarProvider;
  externalId: string;
  summary: string;
  description: string | null;
  color: string | null;
  primary: boolean;
  accessRole: CalendarSourceAccessRole;
  mode: CalendarSourceMode;
  enabled: boolean;
};

export type CalendarEventStatus = 'confirmed' | 'tentative' | 'cancelled';
export type CalendarEventTransparency = 'opaque' | 'transparent';
export type CalendarEventVisibility =
  | 'default'
  | 'public'
  | 'private'
  | 'confidential';

export type ExternalCalendarEventView = {
  id: string;
  accountId: string;
  sourceId: string;
  provider: CalendarProvider;
  externalId: string;
  iCalUID: string | null;
  title: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  status: CalendarEventStatus;
  transparency: CalendarEventTransparency;
  visibility: CalendarEventVisibility;
  eventType: string;
  location: string | null;
  attendees: string[];
  conferenceUrl: string | null;
  htmlLink: string | null;
  updatedAt: string | null;
  syncedAt: string;
  busy: boolean;
};

export type CalendarEventAnnotationView = {
  eventId: string;
  accountId: string;
  sourceId: string;
  notes: string;
  outcome: string;
  followUps: string[];
  modeOverride: CalendarSourceMode | null;
  confirmedBlockIds: string[];
  dismissedBlockIds: string[];
  editedAt: string;
};

export type CalendarEventAnnotationPatch = {
  notes?: string;
  outcome?: string;
  followUps?: string[];
  modeOverride?: CalendarSourceMode | null;
};

export type CalendarEventBlockLinkAction = 'confirm' | 'dismiss' | 'clear';

export type ScheduledCalendarItemView = {
  id: string;
  eventId: string;
  accountId: string;
  sourceId: string;
  title: string;
  sourceSummary: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  durationMinutes: number;
  busy: boolean;
  status: CalendarEventStatus;
  eventType: string;
  annotation: CalendarEventAnnotationView | null;
};

export type CalendarEventBlockLinkView = {
  eventId: string;
  blockId: string;
  status: 'auto' | 'confirmed';
  score: number;
};

export type CalendarReconciliationTotals = {
  observedFocusMinutes: number;
  scheduledBusyMinutes: number;
  observedWithinScheduledMinutes: number;
};

export type CalendarReconciliationView = {
  scheduledItems: ScheduledCalendarItemView[];
  links: CalendarEventBlockLinkView[];
  totals: CalendarReconciliationTotals;
};

export type TaskFitSuggestion = {
  id: string;
  sourceKind: 'flow_block' | 'calendar_follow_up';
  sourceBlockId: string | null;
  sourceEventId?: string | null;
  sourceTitle: string;
  sourceNextAction: string | null;
  category: string | null;
  suggestedStartTime: string;
  suggestedEndTime: string;
  durationMinutes: number;
  reasonCodes: string[];
  nearbyCalendarEventIds: string[];
};

export type CalendarContextEvent = {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  busy: boolean;
  eventType: string;
  mode: CalendarSourceMode;
  sourceSummary: string;
  annotation?: Pick<
    CalendarEventAnnotationView,
    | 'notes'
    | 'outcome'
    | 'followUps'
    | 'modeOverride'
    | 'confirmedBlockIds'
    | 'dismissedBlockIds'
  > | null;
};

export type CalendarContext = {
  windowStartAt: string;
  windowEndAt: string;
  events: CalendarContextEvent[];
};

export type CalendarStatePayload = {
  accounts: CalendarAccountView[];
  sources: CalendarSourceView[];
  events: ExternalCalendarEventView[];
  annotations: CalendarEventAnnotationView[];
  scheduledItems: ScheduledCalendarItemView[];
  taskFitSuggestions: TaskFitSuggestion[];
  status: CalendarSyncStatus;
  errorMessage: string | null;
  lastSyncedAt: string | null;
  oauthClientConfigured: boolean;
};
