import type { WorklogCalendarBlock } from '../worklog/types';
import type {
  CalendarContext,
  CalendarContextEvent,
  CalendarEventAnnotationView,
  CalendarEventBlockLinkView,
  CalendarReconciliationView,
  CalendarSourceMode,
  CalendarSourceView,
  ExternalCalendarEventView,
  ScheduledCalendarItemView,
  TaskFitSuggestion,
} from './types';

const DEFAULT_WORK_START_MINUTES = 8 * 60;
const DEFAULT_WORK_END_MINUTES = 18 * 60;

const CATEGORY_DURATION_MINUTES: Record<string, number> = {
  coding: 90,
  research: 90,
  writing: 60,
  planning: 60,
  review: 30,
  communication: 30,
  meeting: 30,
  browsing: 45,
  file_management: 45,
  other: 45,
};

export function isCalendarEventBusy(event: ExternalCalendarEventView): boolean {
  return (
    event.status !== 'cancelled' &&
    event.transparency !== 'transparent' &&
    event.eventType !== 'birthday'
  );
}

export function isCalendarSourceActive(
  source: CalendarSourceView | null | undefined,
): boolean {
  return source?.mode !== 'ignored' && source != null;
}

export function isCalendarSourceScheduled(
  source: CalendarSourceView | null | undefined,
): boolean {
  return source?.mode === 'scheduled';
}

export function getCalendarEventMode(
  event: ExternalCalendarEventView,
  source: CalendarSourceView | null | undefined,
  annotation?: CalendarEventAnnotationView | null,
): CalendarSourceMode {
  void event;
  return annotation?.modeOverride ?? source?.mode ?? 'ignored';
}

export function isScheduledCalendarEvent(
  event: ExternalCalendarEventView,
  source: CalendarSourceView | null | undefined,
  annotation?: CalendarEventAnnotationView | null,
): boolean {
  return (
    getCalendarEventMode(event, source, annotation) === 'scheduled' &&
    isCalendarEventBusy(event)
  );
}

export function calendarEventOverlapsRange(
  event: Pick<ExternalCalendarEventView, 'startTime' | 'endTime'>,
  startMs: number,
  endMs: number,
): boolean {
  const eventStartMs = Date.parse(event.startTime);
  const eventEndMs = Date.parse(event.endTime);
  if (!Number.isFinite(eventStartMs) || !Number.isFinite(eventEndMs)) {
    return false;
  }
  return eventStartMs < endMs && eventEndMs > startMs;
}

export function getCalendarEventsInRange(
  events: ExternalCalendarEventView[],
  startIso: string,
  endIso: string,
): ExternalCalendarEventView[] {
  const startMs = Date.parse(startIso);
  const endMs = Date.parse(endIso);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return [];
  return events
    .filter(event => event.status !== 'cancelled')
    .filter(event => calendarEventOverlapsRange(event, startMs, endMs))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}

export function buildCalendarContext(args: {
  events: ExternalCalendarEventView[];
  sources: CalendarSourceView[];
  annotations?: CalendarEventAnnotationView[];
  windowStartAt: string;
  windowEndAt: string;
  maxEvents?: number;
}): CalendarContext {
  const sourceById = new Map(args.sources.map(source => [source.id, source]));
  const annotationByEventId = new Map(
    (args.annotations ?? []).map(annotation => [
      annotation.eventId,
      annotation,
    ]),
  );
  const events = getCalendarEventsInRange(
    args.events,
    args.windowStartAt,
    args.windowEndAt,
  )
    .filter(event => {
      const source = sourceById.get(event.sourceId);
      const annotation = annotationByEventId.get(event.id);
      return getCalendarEventMode(event, source, annotation) !== 'ignored';
    })
    .map<CalendarContextEvent>(event => {
      const source = sourceById.get(event.sourceId);
      const annotation = annotationByEventId.get(event.id);
      const privacyReduced =
        event.visibility === 'private' || event.visibility === 'confidential';
      return {
        id: event.id,
        title: event.title,
        startTime: event.startTime,
        endTime: event.endTime,
        allDay: event.allDay,
        busy: event.busy,
        eventType: event.eventType,
        mode: getCalendarEventMode(event, source, annotation),
        sourceSummary: source?.summary ?? 'Calendar',
        annotation: privacyReduced ? null : annotationSummary(annotation),
      };
    })
    .slice(0, args.maxEvents ?? 40);

  return {
    windowStartAt: args.windowStartAt,
    windowEndAt: args.windowEndAt,
    events,
  };
}

export function buildScheduledCalendarItems(args: {
  events: ExternalCalendarEventView[];
  sources: CalendarSourceView[];
  annotations?: CalendarEventAnnotationView[];
  rangeStartIso?: string;
  rangeEndIso?: string;
}): ScheduledCalendarItemView[] {
  const sourceById = new Map(args.sources.map(source => [source.id, source]));
  const annotationByEventId = new Map(
    (args.annotations ?? []).map(annotation => [
      annotation.eventId,
      annotation,
    ]),
  );
  const rangeStartMs =
    args.rangeStartIso != null ? Date.parse(args.rangeStartIso) : null;
  const rangeEndMs =
    args.rangeEndIso != null ? Date.parse(args.rangeEndIso) : null;

  return args.events
    .filter(event => {
      const source = sourceById.get(event.sourceId);
      const annotation = annotationByEventId.get(event.id);
      if (!isScheduledCalendarEvent(event, source, annotation)) return false;
      if (
        rangeStartMs != null &&
        rangeEndMs != null &&
        Number.isFinite(rangeStartMs) &&
        Number.isFinite(rangeEndMs) &&
        !calendarEventOverlapsRange(event, rangeStartMs, rangeEndMs)
      ) {
        return false;
      }
      return true;
    })
    .map(event => {
      const source = sourceById.get(event.sourceId);
      return {
        id: `scheduled_${event.id}`,
        eventId: event.id,
        accountId: event.accountId,
        sourceId: event.sourceId,
        title: event.title,
        sourceSummary: source?.summary ?? 'Calendar',
        startTime: event.startTime,
        endTime: event.endTime,
        allDay: event.allDay,
        durationMinutes: durationMinutes(event.startTime, event.endTime),
        busy: event.busy,
        status: event.status,
        eventType: event.eventType,
        annotation: annotationByEventId.get(event.id) ?? null,
      } satisfies ScheduledCalendarItemView;
    })
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}

export function buildCalendarReconciliation(args: {
  blocks: WorklogCalendarBlock[];
  events: ExternalCalendarEventView[];
  sources: CalendarSourceView[];
  annotations?: CalendarEventAnnotationView[];
  rangeStartIso?: string;
  rangeEndIso?: string;
}): CalendarReconciliationView {
  const scheduledItems = buildScheduledCalendarItems(args);
  const eventById = new Map(args.events.map(event => [event.id, event]));
  const blockById = new Map(args.blocks.map(block => [block.id, block]));
  const dismissed = new Set<string>();
  const links: CalendarEventBlockLinkView[] = [];
  const linked = new Set<string>();

  for (const annotation of args.annotations ?? []) {
    for (const blockId of annotation.dismissedBlockIds) {
      dismissed.add(linkKey(annotation.eventId, blockId));
    }
    for (const blockId of annotation.confirmedBlockIds) {
      const event = eventById.get(annotation.eventId);
      const block = blockById.get(blockId);
      if (event == null || block == null) continue;
      const key = linkKey(event.id, block.id);
      linked.add(key);
      links.push({
        eventId: event.id,
        blockId: block.id,
        status: 'confirmed',
        score: 1,
      });
    }
  }

  for (const item of scheduledItems) {
    const event = eventById.get(item.eventId);
    if (event == null) continue;
    for (const block of args.blocks) {
      const key = linkKey(event.id, block.id);
      if (linked.has(key) || dismissed.has(key)) continue;
      const score = scoreCalendarBlockMatch(event, block);
      if (score < 0.45) continue;
      linked.add(key);
      links.push({
        eventId: event.id,
        blockId: block.id,
        status: 'auto',
        score,
      });
    }
  }

  return {
    scheduledItems,
    links: links.sort((a, b) => b.score - a.score),
    totals: {
      observedFocusMinutes: args.blocks.reduce(
        (sum, block) => sum + durationMinutes(block.startTime, block.endTime),
        0,
      ),
      scheduledBusyMinutes: scheduledItems.reduce(
        (sum, item) => sum + item.durationMinutes,
        0,
      ),
      observedWithinScheduledMinutes: observedWithinScheduledMinutes(
        args.blocks,
        scheduledItems,
      ),
    },
  };
}

export type AvailabilitySlot = {
  startTime: string;
  endTime: string;
  durationMinutes: number;
};

export function computeAvailabilitySlots(args: {
  events: ExternalCalendarEventView[];
  rangeStartIso: string;
  rangeEndIso: string;
  workStartMinutes?: number;
  workEndMinutes?: number;
}): AvailabilitySlot[] {
  const rangeStartMs = Date.parse(args.rangeStartIso);
  const rangeEndMs = Date.parse(args.rangeEndIso);
  if (!Number.isFinite(rangeStartMs) || !Number.isFinite(rangeEndMs)) {
    return [];
  }

  const workStartMinutes = args.workStartMinutes ?? DEFAULT_WORK_START_MINUTES;
  const workEndMinutes = args.workEndMinutes ?? DEFAULT_WORK_END_MINUTES;
  const busyEvents = args.events
    .filter(isCalendarEventBusy)
    .filter(event =>
      calendarEventOverlapsRange(event, rangeStartMs, rangeEndMs),
    )
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  const slots: AvailabilitySlot[] = [];
  const dayCursor = startOfLocalDay(new Date(rangeStartMs));
  const finalDay = startOfLocalDay(new Date(rangeEndMs));

  while (dayCursor.getTime() <= finalDay.getTime()) {
    const dayStart = new Date(dayCursor);
    dayStart.setMinutes(workStartMinutes, 0, 0);
    const dayEnd = new Date(dayCursor);
    dayEnd.setMinutes(workEndMinutes, 0, 0);
    const windowStart = Math.max(dayStart.getTime(), rangeStartMs);
    const windowEnd = Math.min(dayEnd.getTime(), rangeEndMs);

    if (windowEnd > windowStart) {
      let cursor = windowStart;
      for (const event of busyEvents) {
        const eventStart = Math.max(Date.parse(event.startTime), windowStart);
        const eventEnd = Math.min(Date.parse(event.endTime), windowEnd);
        if (!Number.isFinite(eventStart) || !Number.isFinite(eventEnd)) {
          continue;
        }
        if (eventEnd <= cursor || eventStart >= windowEnd) {
          continue;
        }
        if (eventStart > cursor) {
          slots.push(makeAvailabilitySlot(cursor, eventStart));
        }
        cursor = Math.max(cursor, eventEnd);
      }
      if (cursor < windowEnd) {
        slots.push(makeAvailabilitySlot(cursor, windowEnd));
      }
    }

    dayCursor.setDate(dayCursor.getDate() + 1);
  }

  return slots.filter(slot => slot.durationMinutes >= 15);
}

export function filterScheduledCalendarEvents(args: {
  events: ExternalCalendarEventView[];
  sources: CalendarSourceView[];
  annotations?: CalendarEventAnnotationView[];
}): ExternalCalendarEventView[] {
  const sourceById = new Map(args.sources.map(source => [source.id, source]));
  const annotationByEventId = new Map(
    (args.annotations ?? []).map(annotation => [
      annotation.eventId,
      annotation,
    ]),
  );
  return args.events.filter(event =>
    isScheduledCalendarEvent(
      event,
      sourceById.get(event.sourceId),
      annotationByEventId.get(event.id),
    ),
  );
}

export function buildTaskFitSuggestions(args: {
  blocks: WorklogCalendarBlock[];
  events: ExternalCalendarEventView[];
  sources?: CalendarSourceView[];
  annotations?: CalendarEventAnnotationView[];
  rangeStartIso: string;
  rangeEndIso: string;
  maxSuggestions?: number;
}): TaskFitSuggestion[] {
  const availabilityEvents =
    args.sources != null
      ? filterScheduledCalendarEvents({
          events: args.events,
          sources: args.sources,
          annotations: args.annotations,
        })
      : args.events;
  const slots = computeAvailabilitySlots({
    events: availabilityEvents,
    rangeStartIso: args.rangeStartIso,
    rangeEndIso: args.rangeEndIso,
  });
  const suggestions: TaskFitSuggestion[] = [];
  const candidatesFromBlocks = args.blocks
    .filter(block => block.label !== 'confirmed_completed')
    .filter(
      block =>
        (block.nextActions?.length ?? 0) > 0 ||
        block.label !== 'likely_completed',
    )
    .sort((a, b) => b.endTime.localeCompare(a.endTime))
    .slice(0, 12)
    .map<TaskFitCandidate>(block => {
      const durationMinutes = durationForCategory(block.category);
      return {
        id: `block_${block.id}`,
        sourceKind: 'flow_block',
        sourceBlockId: block.id,
        sourceEventId: null,
        sourceTitle: block.title,
        sourceNextAction: block.nextActions?.[0] ?? null,
        category: block.category ?? null,
        durationMinutes,
        reasonCodes: ['free_calendar_slot', `duration_${durationMinutes}m`],
      };
    });
  const calendarFollowUpCandidates = calendarFollowUpFitCandidates({
    annotations: args.annotations ?? [],
    events: args.events,
    sources: args.sources ?? [],
  });
  const candidates = [...candidatesFromBlocks, ...calendarFollowUpCandidates];

  let slotIndex = 0;
  for (const candidate of candidates) {
    const durationMinutes = candidate.durationMinutes;
    while (
      slotIndex < slots.length &&
      slots[slotIndex].durationMinutes < durationMinutes
    ) {
      slotIndex += 1;
    }
    const slot = slots[slotIndex];
    if (slot == null) break;

    const startMs = Date.parse(slot.startTime);
    const endMs = startMs + durationMinutes * 60_000;
    const nearbyCalendarEventIds = nearbyEvents(
      args.events,
      startMs,
      endMs,
    ).map(event => event.id);

    suggestions.push({
      id: `fit_${candidate.id}_${slot.startTime}`,
      sourceKind: candidate.sourceKind,
      sourceBlockId: candidate.sourceBlockId,
      sourceEventId: candidate.sourceEventId,
      sourceTitle: candidate.sourceTitle,
      sourceNextAction: candidate.sourceNextAction,
      category: candidate.category,
      suggestedStartTime: new Date(startMs).toISOString(),
      suggestedEndTime: new Date(endMs).toISOString(),
      durationMinutes,
      reasonCodes: candidate.reasonCodes,
      nearbyCalendarEventIds,
    });

    const remainingStartMs = endMs;
    if (remainingStartMs < Date.parse(slot.endTime)) {
      slots[slotIndex] = makeAvailabilitySlot(
        remainingStartMs,
        Date.parse(slot.endTime),
      );
    } else {
      slotIndex += 1;
    }

    if (suggestions.length >= (args.maxSuggestions ?? 5)) break;
  }

  return suggestions;
}

function annotationSummary(
  annotation: CalendarEventAnnotationView | null | undefined,
): CalendarContextEvent['annotation'] {
  if (annotation == null) return null;
  return {
    notes: annotation.notes,
    outcome: annotation.outcome,
    followUps: annotation.followUps,
    modeOverride: annotation.modeOverride,
    confirmedBlockIds: annotation.confirmedBlockIds,
    dismissedBlockIds: annotation.dismissedBlockIds,
  };
}

type TaskFitCandidate = {
  id: string;
  sourceKind: TaskFitSuggestion['sourceKind'];
  sourceBlockId: string | null;
  sourceEventId: string | null;
  sourceTitle: string;
  sourceNextAction: string | null;
  category: string | null;
  durationMinutes: number;
  reasonCodes: string[];
};

function calendarFollowUpFitCandidates(args: {
  annotations: CalendarEventAnnotationView[];
  events: ExternalCalendarEventView[];
  sources: CalendarSourceView[];
}): TaskFitCandidate[] {
  const eventById = new Map(args.events.map(event => [event.id, event]));
  const sourceById = new Map(args.sources.map(source => [source.id, source]));
  const candidates: TaskFitCandidate[] = [];
  for (const annotation of args.annotations) {
    const event = eventById.get(annotation.eventId);
    if (event == null) continue;
    const source = sourceById.get(event.sourceId);
    if (getCalendarEventMode(event, source, annotation) === 'ignored') {
      continue;
    }
    annotation.followUps.forEach((followUp, index) => {
      const durationMinutes = CATEGORY_DURATION_MINUTES.communication;
      candidates.push({
        id: `calendar_${event.id}_${index}`,
        sourceKind: 'calendar_follow_up',
        sourceBlockId: null,
        sourceEventId: event.id,
        sourceTitle: event.title,
        sourceNextAction: followUp,
        category: 'communication',
        durationMinutes,
        reasonCodes: [
          'free_calendar_slot',
          'calendar_follow_up',
          `duration_${durationMinutes}m`,
        ],
      });
    });
  }
  return candidates.slice(0, 8);
}

function linkKey(eventId: string, blockId: string): string {
  return `${eventId}::${blockId}`;
}

function scoreCalendarBlockMatch(
  event: ExternalCalendarEventView,
  block: WorklogCalendarBlock,
): number {
  const overlap = overlapMinutes(
    event.startTime,
    event.endTime,
    block.startTime,
    block.endTime,
  );
  if (overlap < 10) return 0;
  const blockDuration = Math.max(
    1,
    durationMinutes(block.startTime, block.endTime),
  );
  const eventDuration = Math.max(
    1,
    durationMinutes(event.startTime, event.endTime),
  );
  const overlapScore = Math.min(
    1,
    Math.max(overlap / blockDuration, overlap / eventDuration),
  );
  const titleScore = tokenSimilarity(
    event.title,
    [
      block.title,
      block.summary.narrative,
      ...(block.people ?? []),
      ...block.documents,
      ...block.tickets,
    ].join(' '),
  );
  const peopleScore = (block.people ?? []).some(person =>
    event.attendees.join(' ').toLowerCase().includes(person.toLowerCase()),
  )
    ? 0.1
    : 0;
  return Math.min(1, overlapScore * 0.75 + titleScore * 0.2 + peopleScore);
}

function tokenSimilarity(left: string, right: string): number {
  const leftTokens = meaningfulTokens(left);
  const rightTokens = meaningfulTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

function meaningfulTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(token => token.length >= 3)
      .filter(
        token =>
          !['the', 'and', 'for', 'with', 'sync', 'meeting', 'call'].includes(
            token,
          ),
      ),
  );
}

function observedWithinScheduledMinutes(
  blocks: WorklogCalendarBlock[],
  scheduledItems: ScheduledCalendarItemView[],
): number {
  return blocks.reduce((sum, block) => {
    const ranges = scheduledItems
      .map(item => ({
        startMs: Math.max(
          Date.parse(block.startTime),
          Date.parse(item.startTime),
        ),
        endMs: Math.min(Date.parse(block.endTime), Date.parse(item.endTime)),
      }))
      .filter(
        range => Number.isFinite(range.startMs) && range.endMs > range.startMs,
      )
      .sort((a, b) => a.startMs - b.startMs);
    const merged: Array<{ startMs: number; endMs: number }> = [];
    for (const range of ranges) {
      const previous = merged[merged.length - 1];
      if (previous == null || range.startMs > previous.endMs) {
        merged.push({ ...range });
      } else {
        previous.endMs = Math.max(previous.endMs, range.endMs);
      }
    }
    return (
      sum +
      merged.reduce(
        (inner, range) =>
          inner + Math.round((range.endMs - range.startMs) / 60_000),
        0,
      )
    );
  }, 0);
}

function overlapMinutes(
  leftStartIso: string,
  leftEndIso: string,
  rightStartIso: string,
  rightEndIso: string,
): number {
  const startMs = Math.max(Date.parse(leftStartIso), Date.parse(rightStartIso));
  const endMs = Math.min(Date.parse(leftEndIso), Date.parse(rightEndIso));
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    endMs <= startMs
  ) {
    return 0;
  }
  return Math.round((endMs - startMs) / 60_000);
}

function durationMinutes(startIso: string, endIso: string): number {
  const startMs = Date.parse(startIso);
  const endMs = Date.parse(endIso);
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    endMs <= startMs
  ) {
    return 0;
  }
  return Math.round((endMs - startMs) / 60_000);
}

function durationForCategory(category: string | undefined): number {
  if (category == null) return CATEGORY_DURATION_MINUTES.other;
  return CATEGORY_DURATION_MINUTES[category] ?? CATEGORY_DURATION_MINUTES.other;
}

function nearbyEvents(
  events: ExternalCalendarEventView[],
  startMs: number,
  endMs: number,
): ExternalCalendarEventView[] {
  const bufferMs = 30 * 60_000;
  return events
    .filter(event => event.status !== 'cancelled')
    .filter(event =>
      calendarEventOverlapsRange(event, startMs - bufferMs, endMs + bufferMs),
    )
    .slice(0, 4);
}

function makeAvailabilitySlot(
  startMs: number,
  endMs: number,
): AvailabilitySlot {
  return {
    startTime: new Date(startMs).toISOString(),
    endTime: new Date(endMs).toISOString(),
    durationMinutes: Math.max(0, Math.round((endMs - startMs) / 60_000)),
  };
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
