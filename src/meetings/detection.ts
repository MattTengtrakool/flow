import type {
  CalendarStatePayload,
  ExternalCalendarEventView,
} from '../calendar/types';
import type { ContextSnapshotPayload } from '../types/contextCapture';
import type { MeetingDetection } from './types';

export const MEETING_DETECTION_PROMPT_THRESHOLD = 0.75;
export const MEETING_DETECTION_HIGH_CONFIDENCE_THRESHOLD = 0.9;
export const MEETING_DETECTION_DEDUPE_MS = 30 * 60 * 1000;
export const MEETING_DETECTION_EXPIRY_MS = 10 * 60 * 1000;

const BROWSER_BUNDLES = new Set([
  'com.google.Chrome',
  'com.apple.Safari',
  'com.microsoft.edgemac',
  'org.mozilla.firefox',
  'company.thebrowser.Browser',
]);

const BROWSER_APP_NAMES = [
  'google chrome',
  'safari',
  'microsoft edge',
  'firefox',
  'arc',
];

const MEETING_APP_RULES: Array<{
  label: string;
  bundleIncludes: string[];
  appIncludes: string[];
  score: number;
}> = [
  {
    label: 'Zoom',
    bundleIncludes: ['zoom'],
    appIncludes: ['zoom'],
    score: 0.68,
  },
  {
    label: 'Microsoft Teams',
    bundleIncludes: ['teams'],
    appIncludes: ['teams'],
    score: 0.68,
  },
  {
    label: 'Slack huddle',
    bundleIncludes: ['tinyspeck', 'slack'],
    appIncludes: ['slack'],
    score: 0.52,
  },
  {
    label: 'FaceTime',
    bundleIncludes: ['facetime'],
    appIncludes: ['facetime'],
    score: 0.62,
  },
  {
    label: 'Discord',
    bundleIncludes: ['discord'],
    appIncludes: ['discord'],
    score: 0.5,
  },
];

const TITLE_RULES: Array<{ pattern: RegExp; reason: string; score: number }> = [
  {
    pattern: /\bzoom meeting\b/i,
    reason: 'Window title looks like Zoom.',
    score: 0.45,
  },
  {
    pattern: /\bgoogle meet\b/i,
    reason: 'Window title looks like Google Meet.',
    score: 0.58,
  },
  {
    pattern: /^meet(?:\s+-|$)/i,
    reason: 'Window title looks like Google Meet.',
    score: 0.62,
  },
  {
    pattern: /\bmeet\.google\.com\b/i,
    reason: 'Window title is a Google Meet URL.',
    score: 0.6,
  },
  {
    pattern: /\bcamera and microphone recording\b/i,
    reason: 'The browser tab is capturing camera and microphone.',
    score: 0.5,
  },
  { pattern: /\bteams\b/i, reason: 'Window title mentions Teams.', score: 0.3 },
  {
    pattern: /\bhuddle\b/i,
    reason: 'Window title mentions a huddle.',
    score: 0.3,
  },
  {
    pattern: /\b(call|calling|meeting)\b/i,
    reason: 'Window title looks like a call.',
    score: 0.28,
  },
];

export function detectLikelyMeeting(args: {
  context: ContextSnapshotPayload | null;
  calendar: CalendarStatePayload | null;
  now?: Date;
  enabledApps?: string[];
  dismissedDedupeKeys?: Set<string>;
}): MeetingDetection | null {
  const context = args.context;
  if (context == null || context.isIdle) return null;

  const now = args.now ?? new Date();
  const score = scoreMeetingContext({
    context,
    calendar: args.calendar,
    now,
    enabledApps: args.enabledApps,
  });
  if (score.score < MEETING_DETECTION_PROMPT_THRESHOLD) return null;

  const dedupeKey = createMeetingDetectionDedupeKey(
    context,
    score.calendarEvent,
    now,
  );
  if (args.dismissedDedupeKeys?.has(dedupeKey)) return null;

  const detectedAt = now.toISOString();
  return {
    id: `meeting_detection_${stableToken(dedupeKey)}`,
    dedupeKey,
    detectedAt,
    expiresAt: new Date(
      now.getTime() + MEETING_DETECTION_EXPIRY_MS,
    ).toISOString(),
    score: Number(score.score.toFixed(2)),
    confidence:
      score.score >= MEETING_DETECTION_HIGH_CONFIDENCE_THRESHOLD
        ? 'high'
        : 'likely',
    appName: context.appName,
    bundleIdentifier: context.bundleIdentifier,
    windowTitle: context.windowTitle,
    calendarEventId: score.calendarEvent?.id ?? null,
    calendarEventTitle: score.calendarEvent?.title ?? null,
    calendarEventStartTime: score.calendarEvent?.startTime ?? null,
    calendarEventEndTime: score.calendarEvent?.endTime ?? null,
    reasons: score.reasons,
  };
}

export type MeetingDetectionContextSource = {
  context: ContextSnapshotPayload | null;
  observedAt?: string | Date | null;
};

export function detectLikelyMeetingFromRecentSources(args: {
  sources: MeetingDetectionContextSource[];
  calendar: CalendarStatePayload | null;
  now?: Date;
  enabledApps?: string[];
  dismissedDedupeKeys?: Set<string>;
  maxAgeMs?: number;
}): MeetingDetection | null {
  const now = args.now ?? new Date();
  const maxAgeMs = args.maxAgeMs ?? 60_000;
  let best: MeetingDetection | null = null;

  for (const source of args.sources) {
    const context = source.context;
    if (context == null) continue;
    const observedAt = parseObservedAt(source.observedAt ?? context.recordedAt);
    if (observedAt == null || now.getTime() - observedAt.getTime() > maxAgeMs) {
      continue;
    }
    const detection = detectLikelyMeeting({
      context,
      calendar: args.calendar,
      now,
      enabledApps: args.enabledApps,
      dismissedDedupeKeys: args.dismissedDedupeKeys,
    });
    if (detection == null) continue;
    if (
      best == null ||
      detection.score > best.score ||
      (detection.score === best.score &&
        Date.parse(detection.detectedAt) > Date.parse(best.detectedAt))
    ) {
      best = detection;
    }
  }

  return best;
}

export function scoreMeetingContext(args: {
  context: ContextSnapshotPayload;
  calendar: CalendarStatePayload | null;
  now?: Date;
  enabledApps?: string[];
}): {
  score: number;
  reasons: string[];
  calendarEvent: ExternalCalendarEventView | null;
} {
  const now = args.now ?? new Date();
  const appName = args.context.appName ?? '';
  const bundleIdentifier = args.context.bundleIdentifier ?? '';
  const title = args.context.windowTitle ?? '';
  const enabledApps = new Set(
    (args.enabledApps ?? []).map(value => value.trim().toLowerCase()),
  );
  const reasons: string[] = [];
  let score = 0;

  for (const rule of MEETING_APP_RULES) {
    if (
      enabledApps.size > 0 &&
      !enabledApps.has(rule.label.toLowerCase()) &&
      !enabledApps.has(appName.trim().toLowerCase())
    ) {
      continue;
    }
    if (
      includesAny(bundleIdentifier, rule.bundleIncludes) ||
      includesAny(appName, rule.appIncludes)
    ) {
      score += rule.score;
      reasons.push(`${rule.label} is the active app.`);
      break;
    }
  }

  if (
    BROWSER_BUNDLES.has(bundleIdentifier) ||
    includesAny(appName, BROWSER_APP_NAMES)
  ) {
    score += 0.18;
    reasons.push('A browser is the active app.');
  }

  for (const rule of TITLE_RULES) {
    if (rule.pattern.test(title)) {
      score += rule.score;
      reasons.push(rule.reason);
      break;
    }
  }

  const calendarEvent = findCurrentBusyCalendarEvent(args.calendar, now);
  if (calendarEvent != null) {
    score += 0.26;
    reasons.push('A busy calendar event overlaps right now.');
    if (textSuggestsMeeting(calendarEvent.title)) {
      score += 0.1;
      reasons.push('The overlapping calendar event looks meeting-like.');
    }
  }

  return {
    score: Math.min(1, score),
    reasons,
    calendarEvent,
  };
}

export function createMeetingDetectionDedupeKey(
  context: ContextSnapshotPayload,
  calendarEvent: ExternalCalendarEventView | null,
  now: Date,
): string {
  const bucket = Math.floor(now.getTime() / MEETING_DETECTION_DEDUPE_MS);
  const app = normalizeKeyPart(
    context.bundleIdentifier ?? context.appName ?? 'unknown-app',
  );
  const title = normalizeKeyPart(context.windowTitle ?? 'untitled').slice(
    0,
    80,
  );
  const event = normalizeKeyPart(calendarEvent?.id ?? 'no-event');
  return `${app}:${title}:${event}:${bucket}`;
}

function parseObservedAt(value: string | Date | null | undefined): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  if (value == null) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function findCurrentBusyCalendarEvent(
  calendar: CalendarStatePayload | null,
  now: Date,
): ExternalCalendarEventView | null {
  if (calendar == null) return null;
  const nowMs = now.getTime();
  return (
    calendar.events.find(event => {
      if (!event.busy || event.status === 'cancelled') return false;
      const startMs = Date.parse(event.startTime);
      const endMs = Date.parse(event.endTime);
      return Number.isFinite(startMs) && Number.isFinite(endMs)
        ? startMs <= nowMs && endMs >= nowMs
        : false;
    }) ?? null
  );
}

function textSuggestsMeeting(value: string): boolean {
  return /\b(sync|standup|meeting|call|huddle|review|interview|1:1|one-on-one)\b/i.test(
    value,
  );
}

function includesAny(value: string, needles: string[]): boolean {
  const lower = value.toLowerCase();
  return needles.some(needle => lower.includes(needle));
}

function normalizeKeyPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function stableToken(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}
