import {
  getCalendarItemBlocksForDates,
  recurrenceLabel,
} from '../src/calendar/selectors';
import type {UserCalendarItem} from '../src/calendar/types';
import {replayEventLog, type DomainEvent} from '../src/timeline/eventLog';

function calendarItem(overrides: Partial<UserCalendarItem> = {}): UserCalendarItem {
  return {
    id: 'calendar_item_1',
    kind: 'event',
    title: 'Design review',
    description: 'Review the prototype with the product team.',
    location: 'Room 4A',
    startAt: '2026-05-04T16:00:00.000Z',
    endAt: '2026-05-04T17:00:00.000Z',
    recurrence: null,
    createdAt: '2026-05-04T15:00:00.000Z',
    updatedAt: '2026-05-04T15:00:00.000Z',
    ...overrides,
  };
}

describe('calendar item event log', () => {
  test('replays created, updated, and deleted user calendar items', () => {
    const eventLog: DomainEvent[] = [
      {
        id: 'event_1',
        type: 'calendar_item_created',
        item: calendarItem(),
        occurredAt: '2026-05-04T15:00:00.000Z',
      },
      {
        id: 'event_2',
        type: 'calendar_item_updated',
        itemId: 'calendar_item_1',
        updates: {
          title: 'Roadmap review',
          location: 'Room 7B',
        },
        occurredAt: '2026-05-04T15:10:00.000Z',
      },
      {
        id: 'event_3',
        type: 'calendar_item_deleted',
        itemId: 'calendar_item_1',
        occurredAt: '2026-05-04T15:20:00.000Z',
      },
    ];

    const timeline = replayEventLog(eventLog);

    expect(timeline.calendarItemOrder).toEqual(['calendar_item_1']);
    expect(timeline.calendarItemsById.calendar_item_1.title).toBe('Roadmap review');
    expect(timeline.calendarItemsById.calendar_item_1.location).toBe('Room 7B');
    expect(timeline.calendarItemsById.calendar_item_1.deletedAt).toBe(
      '2026-05-04T15:20:00.000Z',
    );
  });
});

describe('calendar item selectors', () => {
  test('expands weekly recurring calendar items into matching days', () => {
    const timeline = replayEventLog([
      {
        id: 'event_1',
        type: 'calendar_item_created',
        item: calendarItem({
          recurrence: {
            frequency: 'weekly',
            interval: 1,
            daysOfWeek: [1, 3],
            until: '2026-05-13',
          },
        }),
        occurredAt: '2026-05-04T15:00:00.000Z',
      },
    ]);

    const blocks = getCalendarItemBlocksForDates(
      timeline,
      [
        '2026-05-04',
        '2026-05-05',
        '2026-05-06',
        '2026-05-13',
        '2026-05-20',
      ],
      'UTC',
    );

    expect(blocks['2026-05-04']).toHaveLength(1);
    expect(blocks['2026-05-05']).toHaveLength(0);
    expect(blocks['2026-05-06']).toHaveLength(1);
    expect(blocks['2026-05-13']).toHaveLength(1);
    expect(blocks['2026-05-20']).toHaveLength(0);
    expect(blocks['2026-05-04'][0].calendarItemRecurrenceLabel).toBe(
      'Every week until 2026-05-13',
    );
  });

  test('labels weekday recurrence distinctly', () => {
    expect(
      recurrenceLabel({
        frequency: 'weekly',
        interval: 1,
        daysOfWeek: [1, 2, 3, 4, 5],
        until: null,
      }),
    ).toBe('Every weekday');
  });
});

