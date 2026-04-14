import {
  replayEventLog,
  type DomainEvent,
} from '../src/state/eventLog';

describe('replayEventLog', () => {
  test('rebuilds timeline state from append-only events', () => {
    const eventLog: DomainEvent[] = [
      {
        id: 'event_1',
        type: 'session_started',
        sessionId: 'session_1',
        title: 'Morning Session',
        occurredAt: '2026-04-12T15:00:00.000Z',
      },
      {
        id: 'event_2',
        type: 'task_started',
        taskId: 'task_1',
        sessionId: 'session_1',
        title: 'Inbox Triage',
        occurredAt: '2026-04-12T15:05:00.000Z',
      },
      {
        id: 'event_3',
        type: 'observation_added',
        observationId: 'observation_1',
        sessionId: 'session_1',
        taskId: 'task_1',
        text: 'Reviewed the task board and sorted follow-ups.',
        occurredAt: '2026-04-12T15:06:00.000Z',
      },
      {
        id: 'event_4',
        type: 'task_renamed',
        taskId: 'task_1',
        title: 'Daily Inbox Sweep',
        occurredAt: '2026-04-12T15:07:00.000Z',
      },
      {
        id: 'event_5',
        type: 'observation_deleted',
        observationId: 'observation_1',
        occurredAt: '2026-04-12T15:08:00.000Z',
      },
      {
        id: 'event_6',
        type: 'session_renamed',
        sessionId: 'session_1',
        title: 'Morning Planning Session',
        occurredAt: '2026-04-12T15:09:00.000Z',
      },
    ];

    const timeline = replayEventLog(eventLog);

    expect(timeline.currentSessionId).toBe('session_1');
    expect(timeline.currentTaskId).toBe('task_1');
    expect(timeline.sessionsById.session_1.title).toBe('Morning Planning Session');
    expect(timeline.tasksById.task_1.title).toBe('Daily Inbox Sweep');
    expect(timeline.tasksById.task_1.observationIds).toEqual(['observation_1']);
    expect(timeline.observationsById.observation_1.deletedAt).toBe(
      '2026-04-12T15:08:00.000Z',
    );
  });
});
