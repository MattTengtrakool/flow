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

  test('projects task segments, lineages, and decisions without rerunning engine logic', () => {
    const eventLog: DomainEvent[] = [
      {
        id: 'event_session',
        type: 'session_started',
        sessionId: 'session_1',
        title: 'Morning Session',
        occurredAt: '2026-04-12T15:00:00.000Z',
      },
      {
        id: 'event_observation',
        type: 'observation_added',
        observationId: 'observation_1',
        sessionId: 'session_1',
        text: 'Fixing payment retry logic.',
        structured: {
          summary: 'Fixing payment retry logic in the payments-service repo.',
          activityType: 'coding',
          taskHypothesis: 'Fix PAY-193 retry flow',
          confidence: 0.87,
          sensitivity: 'low',
          sensitivityReason: 'Only source code is visible.',
          artifacts: ['retry.ts'],
          entities: {
            apps: ['Cursor'],
            documents: ['retry.ts'],
            tickets: ['PAY-193'],
            repos: ['payments-service'],
            urls: [],
            people: [],
          },
          nextAction: 'Update retry logic.',
        },
        occurredAt: '2026-04-12T15:01:00.000Z',
      },
      {
        id: 'event_segment',
        type: 'task_segment_started',
        occurredAt: '2026-04-12T15:01:00.000Z',
        segment: {
          id: 'segment_1',
          lineageId: 'lineage_1',
          sessionId: 'session_1',
          state: 'open',
          kind: 'primary',
          startTime: '2026-04-12T15:01:00.000Z',
          endTime: null,
          lastActiveTime: '2026-04-12T15:01:00.000Z',
          liveTitle: 'Fix PAY-193 retry flow',
          liveSummary: 'Working on retry logic.',
          finalTitle: null,
          finalSummary: null,
          observationIds: [],
          supportingApps: ['Cursor'],
          entityMemory: {
            apps: ['Cursor'],
            repos: ['payments-service'],
            ticketIds: ['PAY-193'],
            projects: [],
            documents: ['retry.ts'],
            people: [],
            urls: [],
          },
          interruptionSegments: [],
          confidence: 0.87,
          provisional: true,
          reviewStatus: 'unreviewed',
        },
      },
      {
        id: 'event_decision',
        type: 'task_decision_recorded',
        occurredAt: '2026-04-12T15:01:00.000Z',
        decisionId: 'decision_1',
        decision: {
          id: 'decision_1',
          observationId: 'observation_1',
          decision: 'start_new',
          targetSegmentId: 'segment_1',
          targetLineageId: 'lineage_1',
          decisionMode: 'deterministic',
          reasonCodes: ['no_active_segment'],
          reasonText: 'Started a new segment.',
          confidence: 1,
          usedLlm: false,
          candidateShortlist: [],
          featureSnapshot: null,
          stale: false,
          errorReason: null,
        },
      },
    ];

    const timeline = replayEventLog(eventLog);

    expect(timeline.currentTaskSegmentId).toBe('segment_1');
    expect(timeline.currentTaskLineageId).toBe('lineage_1');
    expect(timeline.taskSegmentsById.segment_1.observationIds).toEqual([
      'observation_1',
    ]);
    expect(timeline.taskDecisionByObservationId.observation_1).toBe('decision_1');
    expect(timeline.taskLineagesById.lineage_1.segmentIds).toEqual(['segment_1']);
  });
});
