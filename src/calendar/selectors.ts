import type {TimelineView} from '../timeline/eventLog';
import type {WorklogCalendarBlock} from '../worklog/types';
import type {CalendarRecurrenceRule, UserCalendarItem} from './types';

const DEFAULT_TASK_DURATION_MS = 30 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const dateKeyFormatters = new Map<string, Intl.DateTimeFormat>();

function toDateKey(iso: string, timezone: string): string {
  let fmt = dateKeyFormatters.get(timezone);
  if (fmt == null) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    dateKeyFormatters.set(timezone, fmt);
  }
  return fmt.format(new Date(iso));
}

function toLocalDateIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateFromIso(dateIso: string): Date {
  const [year, month, day] = dateIso.split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1, 0, 0, 0, 0);
}

function daysBetween(start: Date, end: Date): number {
  const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endUtc = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.floor((endUtc - startUtc) / MS_PER_DAY);
}

function mondayOf(date: Date): Date {
  const next = new Date(date);
  const dayOfWeek = (next.getDay() + 6) % 7;
  next.setDate(next.getDate() - dayOfWeek);
  next.setHours(0, 0, 0, 0);
  return next;
}

function monthsBetween(start: Date, end: Date): number {
  return (
    (end.getFullYear() - start.getFullYear()) * 12 +
    end.getMonth() -
    start.getMonth()
  );
}

function yearsBetween(start: Date, end: Date): number {
  return end.getFullYear() - start.getFullYear();
}

function normalizedInterval(rule: CalendarRecurrenceRule): number {
  return Math.max(1, Math.floor(rule.interval || 1));
}

function recurrenceMatchesDate(
  item: UserCalendarItem,
  dateIso: string,
): boolean {
  const rule = item.recurrence;
  if (rule == null) {
    return toLocalDateIso(new Date(item.startAt)) === dateIso;
  }

  const seedDate = dateFromIso(toLocalDateIso(new Date(item.startAt)));
  const targetDate = dateFromIso(dateIso);
  if (daysBetween(seedDate, targetDate) < 0) return false;
  if (rule.until != null && rule.until.length > 0 && dateIso > rule.until) {
    return false;
  }

  const interval = normalizedInterval(rule);
  switch (rule.frequency) {
    case 'daily':
      return daysBetween(seedDate, targetDate) % interval === 0;

    case 'weekly': {
      const daysOfWeek = rule.daysOfWeek?.length
        ? rule.daysOfWeek
        : [seedDate.getDay()];
      if (!daysOfWeek.includes(targetDate.getDay())) return false;
      const weekDiff = Math.floor(
        daysBetween(mondayOf(seedDate), mondayOf(targetDate)) / 7,
      );
      return weekDiff % interval === 0;
    }

    case 'monthly':
      return (
        targetDate.getDate() === seedDate.getDate() &&
        monthsBetween(seedDate, targetDate) % interval === 0
      );

    case 'yearly':
      return (
        targetDate.getMonth() === seedDate.getMonth() &&
        targetDate.getDate() === seedDate.getDate() &&
        yearsBetween(seedDate, targetDate) % interval === 0
      );
  }
}

function occurrenceTimesForDate(
  item: UserCalendarItem,
  dateIso: string,
): {startAt: string; endAt: string} {
  const seedStart = new Date(item.startAt);
  const seedEnd = new Date(item.endAt);
  const durationMs = Math.max(
    DEFAULT_TASK_DURATION_MS,
    seedEnd.getTime() - seedStart.getTime(),
  );
  const date = dateFromIso(dateIso);
  date.setHours(
    seedStart.getHours(),
    seedStart.getMinutes(),
    seedStart.getSeconds(),
    seedStart.getMilliseconds(),
  );
  const startMs = date.getTime();
  return {
    startAt: new Date(startMs).toISOString(),
    endAt: new Date(startMs + durationMs).toISOString(),
  };
}

export function recurrenceLabel(
  rule: CalendarRecurrenceRule | null,
): string | null {
  if (rule == null) return null;
  const interval = normalizedInterval(rule);
  const prefix = interval === 1 ? 'Every' : `Every ${interval}`;
  if (
    rule.frequency === 'weekly' &&
    rule.daysOfWeek?.length === 5 &&
    [1, 2, 3, 4, 5].every(day => rule.daysOfWeek?.includes(day))
  ) {
    return 'Every weekday';
  }
  const unit =
    rule.frequency === 'daily'
      ? interval === 1
        ? 'day'
        : 'days'
      : rule.frequency === 'weekly'
        ? interval === 1
          ? 'week'
          : 'weeks'
        : rule.frequency === 'monthly'
          ? interval === 1
            ? 'month'
            : 'months'
          : interval === 1
            ? 'year'
            : 'years';
  const base = `${prefix} ${unit}`;
  return rule.until != null && rule.until.length > 0
    ? `${base} until ${rule.until}`
    : base;
}

function mapCalendarItemToBlock(
  item: UserCalendarItem,
  dateIso: string,
): WorklogCalendarBlock {
  const {startAt, endAt} = occurrenceTimesForDate(item, dateIso);
  const narrative =
    item.description.trim().length > 0
      ? item.description
      : item.kind === 'task'
        ? 'Task added to the calendar.'
        : 'Event added to the calendar.';
  const recurrence = recurrenceLabel(item.recurrence);

  return {
    id: `${item.id}:${dateIso}`,
    lineageId: item.id,
    segmentIds: [],
    startTime: startAt,
    endTime: endAt,
    label: 'worked_on',
    confidence: 1,
    title: item.title,
    summary: {
      headline: item.title,
      narrative,
      provenance: {
        supportedByObservationIds: [],
        supportedByEvidenceIds: [],
        keyArtifacts: item.location.trim().length > 0 ? [item.location] : [],
        reasonCodes: ['user_calendar_item'],
      },
    },
    apps: [],
    projects: item.location.trim().length > 0 ? [item.location] : [],
    tasks: item.kind === 'task' ? [item.title] : [],
    repos: [],
    tickets: [],
    documents: [],
    reasonCodes: ['user_calendar_item'],
    keyActivities: item.kind === 'task' ? ['Task'] : ['Event'],
    category: item.kind,
    people: [],
    urls: [],
    notes: item.description,
    notesKey: `calendar:${item.id}`,
    source: 'user_calendar',
    calendarItemId: item.id,
    calendarItemKind: item.kind,
    calendarItemRecurrence: item.recurrence,
    calendarItemRecurrenceLabel: recurrence,
    calendarItemLocation: item.location,
    continuityLinkage: {
      resumedFromLineageId: null,
      resumedSegmentCount: 0,
    },
    debug: {
      decisionModes: [],
      decisionCount: 0,
      retroAdjusted: false,
    },
  };
}

function visibleCalendarItems(timeline: TimelineView): UserCalendarItem[] {
  return timeline.calendarItemOrder
    .map(id => timeline.calendarItemsById[id])
    .filter(
      (item): item is UserCalendarItem =>
        item != null && item.deletedAt == null,
    );
}

export function getCalendarItemBlocksForDates(
  timeline: TimelineView,
  dateIsos: string[],
  timezone: string,
): Record<string, WorklogCalendarBlock[]> {
  const result: Record<string, WorklogCalendarBlock[]> = {};
  const items = visibleCalendarItems(timeline);

  for (const dateIso of dateIsos) {
    const dateKey = toDateKey(`${dateIso}T12:00:00.000Z`, timezone);
    const blocks = items
      .filter(item => recurrenceMatchesDate(item, dateIso))
      .map(item => mapCalendarItemToBlock(item, dateIso))
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
    result[dateKey] = blocks;
  }

  return result;
}

export function getAllCalendarItemBlocks(
  timeline: TimelineView,
  timezone: string,
): WorklogCalendarBlock[] {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 30);
  const dateIsos = Array.from({length: 396}, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return toLocalDateIso(date);
  });
  return Object.values(
    getCalendarItemBlocksForDates(timeline, dateIsos, timezone),
  )
    .flat()
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}
