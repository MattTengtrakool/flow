import {
  createEmptyTimeline,
  EMPTY_TIMELINE,
  replayEventLog,
  stepEvent,
  type DomainEvent,
} from '../src/timeline/eventLog';

describe('replayEventLog', () => {
  test('rebuilds the planner timeline from append-only events', () => {
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
        type: 'observation_added',
        observationId: 'observation_1',
        sessionId: 'session_1',
        text: 'Reviewed the task board and sorted follow-ups.',
        occurredAt: '2026-04-12T15:06:00.000Z',
      },
      {
        id: 'event_3',
        type: 'observation_deleted',
        observationId: 'observation_1',
        occurredAt: '2026-04-12T15:08:00.000Z',
      },
      {
        id: 'event_4',
        type: 'session_renamed',
        sessionId: 'session_1',
        title: 'Morning Planning Session',
        occurredAt: '2026-04-12T15:09:00.000Z',
      },
    ];

    const timeline = replayEventLog(eventLog);

    expect(timeline.currentSessionId).toBe('session_1');
    expect(timeline.sessionsById.session_1.title).toBe('Morning Planning Session');
    expect(timeline.sessionsById.session_1.observationIds).toEqual([
      'observation_1',
    ]);
    expect(timeline.observationsById.observation_1.deletedAt).toBe(
      '2026-04-12T15:08:00.000Z',
    );
  });
});

describe('stepEvent', () => {
  const firstEvent: DomainEvent = {
    id: 'e1',
    type: 'session_started',
    sessionId: 'session_1',
    title: 'Session 1',
    occurredAt: '2026-04-12T15:00:00.000Z',
  };

  const secondEvent: DomainEvent = {
    id: 'e2',
    type: 'observation_added',
    observationId: 'obs_1',
    sessionId: 'session_1',
    text: 'Reviewed docs',
    occurredAt: '2026-04-12T15:01:00.000Z',
  };

  test('incremental stepping matches full replay', () => {
    const fullReplay = replayEventLog([firstEvent, secondEvent]);
    let incremental = createEmptyTimeline();
    incremental = stepEvent(incremental, firstEvent);
    incremental = stepEvent(incremental, secondEvent);

    expect(incremental.currentSessionId).toBe('session_1');
    expect(incremental.sessionOrder).toEqual(['session_1']);
    expect(incremental.observationOrder).toEqual(['obs_1']);
    expect(fullReplay.currentSessionId).toBe(incremental.currentSessionId);
    expect(fullReplay.sessionOrder).toEqual(incremental.sessionOrder);
    expect(fullReplay.observationOrder).toEqual(incremental.observationOrder);
  });

  test('does not mutate the input timeline', () => {
    const base = stepEvent(createEmptyTimeline(), firstEvent);
    const originalSessionsById = base.sessionsById;
    const originalSessionOrder = base.sessionOrder;
    const originalObservationsById = base.observationsById;
    const originalObservationOrder = base.observationOrder;

    const next = stepEvent(base, secondEvent);

    expect(base.sessionsById).toBe(originalSessionsById);
    expect(base.sessionOrder).toBe(originalSessionOrder);
    expect(base.observationsById).toBe(originalObservationsById);
    expect(base.observationOrder).toBe(originalObservationOrder);
    expect(base.observationOrder).toEqual([]);
    expect(next).not.toBe(base);
    expect(next.observationOrder).toEqual(['obs_1']);
    expect(next.observationsById.obs_1).toBeDefined();
  });

  test('does not mutate EMPTY_TIMELINE', () => {
    const result = stepEvent(EMPTY_TIMELINE, firstEvent);

    expect(EMPTY_TIMELINE.sessionOrder).toEqual([]);
    expect(EMPTY_TIMELINE.sessionsById).toEqual({});
    expect(result.sessionOrder).toEqual(['session_1']);
    expect(result).not.toBe(EMPTY_TIMELINE);
  });

  test('updating an existing session clones the session entry', () => {
    const stopEvent: DomainEvent = {
      id: 'e3',
      type: 'session_stopped',
      sessionId: 'session_1',
      occurredAt: '2026-04-12T15:30:00.000Z',
    };
    const afterStart = stepEvent(createEmptyTimeline(), firstEvent);
    const originalSession = afterStart.sessionsById.session_1;
    expect(originalSession.endedAt).toBeUndefined();

    const afterStop = stepEvent(afterStart, stopEvent);

    expect(afterStop.sessionsById.session_1.endedAt).toBe(stopEvent.occurredAt);
    expect(afterStart.sessionsById.session_1).toBe(originalSession);
    expect(originalSession.endedAt).toBeUndefined();
    expect(afterStop.sessionsById.session_1).not.toBe(originalSession);
  });
});
