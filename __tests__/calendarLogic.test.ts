import {
  buildCalendarContext,
  buildCalendarReconciliation,
  buildScheduledCalendarItems,
  buildTaskFitSuggestions,
  computeAvailabilitySlots,
  isCalendarEventBusy,
} from '../src/calendar/calendarLogic';
import type {
  CalendarSourceView,
  ExternalCalendarEventView,
} from '../src/calendar/types';
import type { WorklogCalendarBlock } from '../src/worklog/types';

function event(
  overrides: Partial<ExternalCalendarEventView>,
): ExternalCalendarEventView {
  return {
    id: 'event_1',
    accountId: 'account_1',
    sourceId: 'source_1',
    provider: 'google',
    externalId: 'google_event_1',
    iCalUID: null,
    title: 'Busy block',
    startTime: '2026-05-04T16:00:00.000Z',
    endTime: '2026-05-04T17:00:00.000Z',
    allDay: false,
    status: 'confirmed',
    transparency: 'opaque',
    visibility: 'default',
    eventType: 'default',
    location: null,
    attendees: [],
    conferenceUrl: null,
    htmlLink: null,
    updatedAt: null,
    syncedAt: '2026-05-04T12:00:00.000Z',
    busy: true,
    ...overrides,
  };
}

function block(overrides: Partial<WorklogCalendarBlock>): WorklogCalendarBlock {
  return {
    id: 'block_1',
    lineageId: 'block_1',
    segmentIds: [],
    startTime: '2026-05-03T18:00:00.000Z',
    endTime: '2026-05-03T19:00:00.000Z',
    label: 'worked_on',
    confidence: 0.8,
    title: 'PAY-193 retry flow',
    summary: {
      headline: 'PAY-193 retry flow',
      narrative: 'Worked on retry follow-up.',
      provenance: {
        supportedByObservationIds: [],
        supportedByEvidenceIds: [],
        keyArtifacts: [],
        reasonCodes: [],
      },
    },
    apps: [],
    repos: [],
    tickets: ['PAY-193'],
    documents: [],
    reasonCodes: [],
    category: 'coding',
    nextActions: ['Finish the retry regression test'],
    continuityLinkage: {
      resumedFromLineageId: null,
      resumedSegmentCount: 0,
    },
    debug: {
      decisionModes: [],
      decisionCount: 0,
      retroAdjusted: false,
    },
    ...overrides,
  };
}

function source(overrides: Partial<CalendarSourceView>): CalendarSourceView {
  return {
    id: 'source_1',
    accountId: 'account_1',
    provider: 'google',
    externalId: 'primary',
    summary: 'Primary',
    description: null,
    color: null,
    primary: true,
    accessRole: 'owner',
    mode: 'scheduled',
    enabled: true,
    ...overrides,
  };
}

describe('calendar availability logic', () => {
  test('transparent, cancelled, and birthday events do not block time', () => {
    expect(isCalendarEventBusy(event({ transparency: 'transparent' }))).toBe(
      false,
    );
    expect(isCalendarEventBusy(event({ status: 'cancelled' }))).toBe(false);
    expect(isCalendarEventBusy(event({ eventType: 'birthday' }))).toBe(false);
    expect(isCalendarEventBusy(event({}))).toBe(true);
  });

  test('subtracts opaque busy events from working availability', () => {
    const slots = computeAvailabilitySlots({
      rangeStartIso: '2026-05-04T15:00:00.000Z',
      rangeEndIso: '2026-05-04T19:00:00.000Z',
      events: [
        event({
          startTime: '2026-05-04T16:00:00.000Z',
          endTime: '2026-05-04T17:00:00.000Z',
        }),
        event({
          id: 'free_event',
          startTime: '2026-05-04T17:30:00.000Z',
          endTime: '2026-05-04T18:00:00.000Z',
          transparency: 'transparent',
          busy: false,
        }),
      ],
    });

    expect(slots.map(slot => slot.durationMinutes)).toEqual([60, 120]);
    expect(slots[0].startTime).toBe('2026-05-04T15:00:00.000Z');
    expect(slots[1].startTime).toBe('2026-05-04T17:00:00.000Z');
  });

  test('fits task suggestions into free calendar slots without writeback', () => {
    const suggestions = buildTaskFitSuggestions({
      rangeStartIso: '2026-05-04T15:00:00.000Z',
      rangeEndIso: '2026-05-04T20:00:00.000Z',
      events: [
        event({
          startTime: '2026-05-04T16:00:00.000Z',
          endTime: '2026-05-04T17:00:00.000Z',
        }),
      ],
      blocks: [block({})],
    });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      sourceKind: 'flow_block',
      sourceBlockId: 'block_1',
      sourceNextAction: 'Finish the retry regression test',
      durationMinutes: 90,
      reasonCodes: ['free_calendar_slot', 'duration_90m'],
    });
    expect(suggestions[0].suggestedStartTime).toBe('2026-05-04T17:00:00.000Z');
  });

  test('builds scheduled items only from scheduled busy events', () => {
    const items = buildScheduledCalendarItems({
      sources: [
        source({}),
        source({
          id: 'source_context',
          externalId: 'context',
          mode: 'context_only',
        }),
      ],
      events: [
        event({ id: 'task_event', sourceId: 'source_1' }),
        event({
          id: 'context_event',
          sourceId: 'source_context',
        }),
        event({
          id: 'free_task_event',
          sourceId: 'source_1',
          transparency: 'transparent',
          busy: false,
        }),
      ],
    });

    expect(items.map(item => item.eventId)).toEqual(['task_event']);
  });

  test('event mode overrides win over source mode', () => {
    const items = buildScheduledCalendarItems({
      sources: [
        source({}),
        source({
          id: 'source_context',
          externalId: 'context',
          mode: 'context_only',
        }),
      ],
      events: [
        event({ id: 'downgraded_event', sourceId: 'source_1' }),
        event({
          id: 'promoted_event',
          sourceId: 'source_context',
        }),
      ],
      annotations: [
        {
          eventId: 'downgraded_event',
          accountId: 'account_1',
          sourceId: 'source_1',
          notes: '',
          outcome: '',
          followUps: [],
          modeOverride: 'context_only',
          confirmedBlockIds: [],
          dismissedBlockIds: [],
          editedAt: '2026-05-04T18:00:00.000Z',
        },
        {
          eventId: 'promoted_event',
          accountId: 'account_1',
          sourceId: 'source_context',
          notes: '',
          outcome: '',
          followUps: [],
          modeOverride: 'scheduled',
          confirmedBlockIds: [],
          dismissedBlockIds: [],
          editedAt: '2026-05-04T18:00:00.000Z',
        },
      ],
    });

    expect(items.map(item => item.eventId)).toEqual(['promoted_event']);
  });

  test('omits annotations from private events in AI calendar context', () => {
    const context = buildCalendarContext({
      sources: [source({})],
      events: [
        event({
          id: 'private_event',
          title: 'Private event',
          visibility: 'private',
        }),
      ],
      annotations: [
        {
          eventId: 'private_event',
          accountId: 'account_1',
          sourceId: 'source_1',
          notes: 'Do not send this note',
          outcome: '',
          followUps: [],
          modeOverride: null,
          confirmedBlockIds: [],
          dismissedBlockIds: [],
          editedAt: '2026-05-04T18:00:00.000Z',
        },
      ],
      windowStartAt: '2026-05-04T15:00:00.000Z',
      windowEndAt: '2026-05-04T19:00:00.000Z',
    });

    expect(context.events).toHaveLength(1);
    expect(context.events[0]).toMatchObject({
      id: 'private_event',
      title: 'Private event',
      annotation: null,
    });
  });

  test('reconciles confirmed links before auto links and keeps totals separate', () => {
    const result = buildCalendarReconciliation({
      sources: [source({})],
      events: [event({ title: 'PAY retry sync' })],
      blocks: [
        block({
          startTime: '2026-05-04T16:10:00.000Z',
          endTime: '2026-05-04T16:50:00.000Z',
          title: 'PAY retry sync notes',
        }),
      ],
      annotations: [
        {
          eventId: 'event_1',
          accountId: 'account_1',
          sourceId: 'source_1',
          notes: 'Prep before the meeting',
          outcome: '',
          followUps: [],
          modeOverride: null,
          confirmedBlockIds: ['block_1'],
          dismissedBlockIds: [],
          editedAt: '2026-05-04T18:00:00.000Z',
        },
      ],
    });

    expect(result.links).toContainEqual({
      eventId: 'event_1',
      blockId: 'block_1',
      status: 'confirmed',
      score: 1,
    });
    expect(result.totals).toMatchObject({
      observedFocusMinutes: 40,
      scheduledBusyMinutes: 60,
      observedWithinScheduledMinutes: 40,
    });
  });

  test('context-only events do not block task fit suggestions', () => {
    const suggestions = buildTaskFitSuggestions({
      rangeStartIso: '2026-05-04T15:00:00.000Z',
      rangeEndIso: '2026-05-04T18:00:00.000Z',
      sources: [source({ mode: 'context_only' })],
      events: [
        event({
          startTime: '2026-05-04T15:00:00.000Z',
          endTime: '2026-05-04T18:00:00.000Z',
        }),
      ],
      blocks: [block({})],
    });

    expect(suggestions[0]?.suggestedStartTime).toBe('2026-05-04T15:00:00.000Z');
  });

  test('turns calendar follow-ups into task-fit suggestions', () => {
    const suggestions = buildTaskFitSuggestions({
      rangeStartIso: '2026-05-04T15:00:00.000Z',
      rangeEndIso: '2026-05-04T18:00:00.000Z',
      sources: [source({})],
      events: [
        event({
          id: 'meeting_event',
          startTime: '2026-05-04T16:00:00.000Z',
          endTime: '2026-05-04T17:00:00.000Z',
        }),
      ],
      annotations: [
        {
          eventId: 'meeting_event',
          accountId: 'account_1',
          sourceId: 'source_1',
          notes: '',
          outcome: '',
          followUps: ['Send recap'],
          modeOverride: null,
          confirmedBlockIds: [],
          dismissedBlockIds: [],
          editedAt: '2026-05-04T18:00:00.000Z',
        },
      ],
      blocks: [],
    });

    expect(suggestions[0]).toMatchObject({
      sourceKind: 'calendar_follow_up',
      sourceBlockId: null,
      sourceEventId: 'meeting_event',
      sourceNextAction: 'Send recap',
      durationMinutes: 30,
      reasonCodes: ['free_calendar_slot', 'calendar_follow_up', 'duration_30m'],
    });
  });
});
