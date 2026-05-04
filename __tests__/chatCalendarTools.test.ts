import { executeChatTool } from '../src/chat/tools';
import {
  createEmptyTimeline,
  replayEventLog,
  type DomainEvent,
} from '../src/timeline/eventLog';
import type { CalendarContext } from '../src/calendar/types';

const calendarContext: CalendarContext = {
  windowStartAt: '2026-05-04T00:00:00.000Z',
  windowEndAt: '2026-05-05T00:00:00.000Z',
  events: [
    {
      id: 'calendar_event_busy',
      title: 'Launch sync',
      startTime: '2026-05-04T16:00:00.000Z',
      endTime: '2026-05-04T17:00:00.000Z',
      allDay: false,
      busy: true,
      eventType: 'default',
      mode: 'scheduled',
      sourceSummary: 'Primary',
      annotation: {
        notes: 'Prep customer list',
        outcome: '',
        followUps: ['Send recap'],
        modeOverride: null,
        confirmedBlockIds: [],
        dismissedBlockIds: [],
      },
    },
    {
      id: 'calendar_event_free',
      title: 'FYI hold',
      startTime: '2026-05-04T18:00:00.000Z',
      endTime: '2026-05-04T18:30:00.000Z',
      allDay: false,
      busy: false,
      eventType: 'default',
      mode: 'context_only',
      sourceSummary: 'Primary',
    },
    {
      id: 'calendar_event_context_busy',
      title: 'Reference event',
      startTime: '2026-05-04T17:30:00.000Z',
      endTime: '2026-05-04T18:00:00.000Z',
      allDay: false,
      busy: true,
      eventType: 'default',
      mode: 'context_only',
      sourceSummary: 'Primary',
    },
  ],
};

describe('chat calendar tools', () => {
  test('returns busy calendar events in range by default', () => {
    const result = executeChatTool(
      {
        name: 'get_calendar_events_in_range',
        args: {
          startIso: '2026-05-04T15:00:00.000Z',
          endIso: '2026-05-04T19:00:00.000Z',
        },
      },
      {
        timeline: createEmptyTimeline(),
        calendarContext,
        timezone: 'America/Los_Angeles',
      },
    ) as { eventCount: number; events: Array<{ id: string }> };

    expect(result.eventCount).toBe(2);
    expect(result.events[0]).toMatchObject({
      id: 'calendar_event_busy',
      annotation: {
        notes: 'Prep customer list',
        followUps: ['Send recap'],
        modeOverride: null,
      },
    });
  });

  test('returns availability after subtracting busy events', () => {
    const result = executeChatTool(
      {
        name: 'get_availability_in_range',
        args: {
          startIso: '2026-05-04T15:00:00.000Z',
          endIso: '2026-05-04T19:00:00.000Z',
          minMinutes: 30,
        },
      },
      {
        timeline: createEmptyTimeline(),
        calendarContext,
        timezone: 'America/Los_Angeles',
      },
    ) as { slots: Array<{ startTime: string; durationMinutes: number }> };

    expect(result.slots).toEqual([
      {
        startTime: '2026-05-04T15:00:00.000Z',
        endTime: '2026-05-04T16:00:00.000Z',
        durationMinutes: 60,
      },
      {
        startTime: '2026-05-04T17:00:00.000Z',
        endTime: '2026-05-04T19:00:00.000Z',
        durationMinutes: 120,
      },
    ]);
  });

  test('returns meeting notes and transcript snippets in range', () => {
    const events: DomainEvent[] = [
      {
        id: 'meeting-started',
        type: 'meeting_transcription_started',
        occurredAt: '2026-05-04T16:00:00.000Z',
        recording: {
          id: 'recording_1',
          meetingId: 'meeting_1',
          detectionId: null,
          startedAt: '2026-05-04T16:00:00.000Z',
          stoppedAt: '2026-05-04T16:30:00.000Z',
          status: 'stopped',
          appName: 'Zoom',
          bundleIdentifier: 'us.zoom.xos',
          windowTitle: 'Launch sync',
          calendarEventId: 'calendar_event_busy',
          sources: ['system'],
          rawAudioSaved: false,
          errorMessage: null,
        },
      },
      {
        id: 'meeting-transcript',
        type: 'meeting_transcript_chunk_added',
        occurredAt: '2026-05-04T16:05:00.000Z',
        chunk: {
          id: 'transcript_1',
          meetingId: 'meeting_1',
          chunkId: 'chunk_1',
          startedAt: '2026-05-04T16:00:00.000Z',
          endedAt: '2026-05-04T16:00:15.000Z',
          text: 'We decided to launch the beta on Friday.',
          speakerLabel: null,
          confidence: 0.93,
          language: 'en',
          source: 'system',
          transcribedAt: '2026-05-04T16:05:00.000Z',
        },
      },
      {
        id: 'meeting-summary',
        type: 'meeting_summary_generated',
        occurredAt: '2026-05-04T16:35:00.000Z',
        summary: {
          id: 'summary_1',
          meetingId: 'meeting_1',
          generatedAt: '2026-05-04T16:35:00.000Z',
          title: 'Launch sync',
          summary: 'The team picked Friday for the beta launch.',
          decisions: ['Launch beta on Friday.'],
          actionItems: ['Send launch checklist.'],
          followUps: [],
          questions: [],
        },
      },
    ];

    const result = executeChatTool(
      {
        name: 'get_meeting_notes_in_range',
        args: {
          startIso: '2026-05-04T15:00:00.000Z',
          endIso: '2026-05-04T17:00:00.000Z',
          query: 'beta',
        },
      },
      {
        timeline: replayEventLog(events),
        calendarContext,
        timezone: 'America/Los_Angeles',
      },
    ) as {
      meetingCount: number;
      meetings: Array<{ title: string; decisions: string[] }>;
    };

    expect(result.meetingCount).toBe(1);
    expect(result.meetings[0]).toMatchObject({
      title: 'Launch sync',
      decisions: ['Launch beta on Friday.'],
    });
  });
});
