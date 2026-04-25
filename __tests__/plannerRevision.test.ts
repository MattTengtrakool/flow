import {
  EMPTY_TIMELINE,
  replayEventLog,
  type DomainEvent,
  type ObservationView,
  type TimelineView,
} from '../src/timeline/eventLog';
import {condenseObservations} from '../src/planner/condenseObservations';
import {
  isWellFormedTaskHeadline,
  pruneOutlierObservationIds,
  runPlannerRevision,
} from '../src/planner/revisionEngine';
import {getDayWorklog} from '../src/planner/selectors';
import {
  PLANNER_PROMPT_VERSION,
  type TaskPlanSnapshot,
} from '../src/planner/types';
import type {StructuredObservation} from '../src/observation/types';

const WINDOW_MS = 6 * 60 * 60 * 1000;

function makeObservation(overrides: {
  id: string;
  observedAt: string;
  structured?: Partial<StructuredObservation>;
}): ObservationView {
  const base: StructuredObservation = {
    summary: 'Editing payments retry logic.',
    activityType: 'coding',
    taskHypothesis: 'Fix PAY-193 retry flow',
    confidence: 0.8,
    sensitivity: 'low',
    sensitivityReason: 'code only',
    artifacts: ['retry.ts'],
    entities: {
      apps: ['Cursor'],
      documents: ['retry.ts'],
      tickets: ['PAY-193'],
      repos: ['payments-service'],
      urls: [],
      people: [],
    },
    nextAction: null,
  };

  return {
    id: overrides.id,
    text: base.summary,
    structured: {...base, ...overrides.structured},
    observedAt: overrides.observedAt,
  };
}

function timelineWithObservations(
  observations: ObservationView[],
  snapshots: TaskPlanSnapshot[] = [],
  currentSessionId: string | null = 'session_1',
): TimelineView {
  const observationsById: Record<string, ObservationView> = {};
  const observationOrder: string[] = [];
  for (const observation of observations) {
    observationsById[observation.id] = observation;
    observationOrder.push(observation.id);
  }

  return {
    ...EMPTY_TIMELINE,
    observationsById,
    observationOrder,
    planSnapshots: snapshots,
    currentSessionId,
  };
}

describe('condenseObservations', () => {
  test('merges adjacent same-hypothesis observations and unions their artifacts', () => {
    const observations: ObservationView[] = [];
    for (let i = 0; i < 20; i += 1) {
      observations.push(
        makeObservation({
          id: `obs_${i}`,
          observedAt: new Date(1_700_000_000_000 + i * 30_000).toISOString(),
          structured: {
            entities: {
              apps: ['Cursor'],
              documents: [`retry_${i % 3}.ts`],
              tickets: ['PAY-193'],
              repos: ['payments-service'],
              urls: [],
              people: [],
            },
          },
        }),
      );
    }

    const clusters = condenseObservations(observations);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].occurrenceCount).toBe(20);
    expect(clusters[0].artifacts.repositories).toEqual(['payments-service']);
    expect(clusters[0].artifacts.documents.length).toBeGreaterThanOrEqual(3);
    expect(clusters[0].sourceObservationIds).toHaveLength(20);
  });

  test('caps cluster count even with many distinct hypotheses', () => {
    const observations: ObservationView[] = [];
    for (let i = 0; i < 120; i += 1) {
      observations.push(
        makeObservation({
          id: `obs_${i}`,
          observedAt: new Date(1_700_000_000_000 + i * 5 * 60_000).toISOString(),
          structured: {
            taskHypothesis: `task-${i}`,
            summary: `summary ${i}`,
          },
        }),
      );
    }

    const clusters = condenseObservations(observations, {maxEntries: 40});

    expect(clusters.length).toBeLessThanOrEqual(40);
    const total = clusters.reduce((sum, c) => sum + c.occurrenceCount, 0);
    expect(total).toBe(120);
  });

  test('does not merge distinct task hypotheses even when adjacent', () => {
    const observations = [
      makeObservation({
        id: 'obs_1',
        observedAt: '2026-04-17T10:00:00.000Z',
        structured: {taskHypothesis: 'Fix PAY-193'},
      }),
      makeObservation({
        id: 'obs_2',
        observedAt: '2026-04-17T10:00:30.000Z',
        structured: {taskHypothesis: 'Draft quarterly report'},
      }),
    ];

    const clusters = condenseObservations(observations);

    expect(clusters).toHaveLength(2);
    expect(clusters[0].taskHypothesis).toBe('Fix PAY-193');
    expect(clusters[1].taskHypothesis).toBe('Draft quarterly report');
  });
});

describe('runPlannerRevision', () => {
  const now = '2026-04-17T14:00:00.000Z';

  test('returns skipped when there are no observations in the window', async () => {
    const timeline = timelineWithObservations([]);

    const result = await runPlannerRevision({
      timeline,
      now,
      cause: 'cadence',
      windowMs: WINDOW_MS,
      runReplan: async () => {
        throw new Error('should not be called');
      },
    });

    expect(result.kind).toBe('skipped');
  });

  test('returns skipped when no new observations since the last snapshot', async () => {
    const observations = [
      makeObservation({id: 'obs_1', observedAt: '2026-04-17T12:00:00.000Z'}),
      makeObservation({id: 'obs_2', observedAt: '2026-04-17T12:05:00.000Z'}),
    ];
    const priorSnapshot: TaskPlanSnapshot = {
      snapshotId: 'snap_1',
      revisedAt: '2026-04-17T12:10:00.000Z',
      windowStartAt: '2026-04-17T06:10:00.000Z',
      windowEndAt: '2026-04-17T12:10:00.000Z',
      sessionId: 'session_1',
      blocks: [
        {
          id: 'block_1',
          startAt: '2026-04-17T12:00:00.000Z',
          endAt: '2026-04-17T12:10:00.000Z',
          headline: 'Fix retry flow',
          narrative: 'Edited retry.ts to handle expired tokens.',
          label: 'worked_on',
          category: 'coding',
          confidence: 0.8,
          keyActivities: ['Edited retry.ts'],
          artifacts: {
            apps: ['Cursor'],
            repositories: ['payments-service'],
            urls: [],
            tickets: ['PAY-193'],
            documents: ['retry.ts'],
            people: [],
          },
          reasonCodes: ['coding'],
          sourceObservationIds: ['obs_1', 'obs_2'],
        },
      ],
      model: 'test',
      promptVersion: PLANNER_PROMPT_VERSION,
      durationMs: 100,
      inputObservationCount: 2,
      inputClusterCount: 1,
      previousSnapshotId: null,
      cause: 'cadence',
    };
    const timeline = timelineWithObservations(observations, [priorSnapshot]);

    const result = await runPlannerRevision({
      timeline,
      now,
      cause: 'cadence',
      windowMs: WINDOW_MS,
      runReplan: async () => {
        throw new Error('should not be called');
      },
    });

    expect(result.kind).toBe('skipped');
  });

  test('emits a task_plan_revised event on success', async () => {
    const observations = [
      makeObservation({id: 'obs_1', observedAt: '2026-04-17T13:00:00.000Z'}),
      makeObservation({id: 'obs_2', observedAt: '2026-04-17T13:05:00.000Z'}),
    ];
    const timeline = timelineWithObservations(observations);

    const result = await runPlannerRevision({
      timeline,
      now,
      cause: 'cadence',
      windowMs: WINDOW_MS,
      runReplan: async () => ({
        model: 'stub-model',
        promptVersion: PLANNER_PROMPT_VERSION,
        durationMs: 100,
        blocks: [
          {
            startAt: '2026-04-17T13:00:00.000Z',
            endAt: '2026-04-17T13:10:00.000Z',
            headline: 'Fix PAY-193 retry',
            narrative:
              'Edited retry.ts to handle expired tokens and added a regression test for the retry flow.',
            label: 'worked_on' as const,
            category: 'coding' as const,
            confidence: 0.82,
            keyActivities: ['Edited retry.ts', 'Added test for expired tokens'],
            artifacts: {
              apps: ['Cursor'],
              repositories: ['payments-service'],
              urls: [],
              tickets: ['PAY-193'],
              documents: ['retry.ts'],
              people: [],
            },
            reasonCodes: ['coding'],
            sourceObservationIds: ['obs_1', 'obs_2'],
          },
        ],
      }),
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') {
      return;
    }
    expect(result.events).toHaveLength(1);
    expect(result.events[0].type).toBe('task_plan_revised');
    expect(result.snapshot.blocks).toHaveLength(1);
    expect(result.snapshot.blocks[0].headline).toBe('Fix PAY-193 retry');
    expect(result.snapshot.blocks[0].narrative.length).toBeGreaterThan(20);
    expect(result.snapshot.inputObservationCount).toBe(2);
    expect(result.snapshot.cause).toBe('cadence');
    expect(result.snapshot.sessionId).toBe('session_1');
  });

  test('emits a task_plan_revision_failed event when the engine throws', async () => {
    const observations = [
      makeObservation({id: 'obs_1', observedAt: '2026-04-17T13:00:00.000Z'}),
    ];
    const timeline = timelineWithObservations(observations);

    const result = await runPlannerRevision({
      timeline,
      now,
      cause: 'cadence',
      windowMs: WINDOW_MS,
      runReplan: async () => {
        throw new Error('The replan JSON was invalid.');
      },
    });

    expect(result.kind).toBe('failure');
    if (result.kind !== 'failure') {
      return;
    }
    expect(result.events).toHaveLength(1);
    expect(result.events[0].type).toBe('task_plan_revision_failed');
    expect(result.failure.reason).toBe('schema_validation_failed');
  });
});

describe('replayEventLog with planner events', () => {
  test('appends task_plan_revised snapshots to timeline.planSnapshots', () => {
    const snapshot: TaskPlanSnapshot = {
      snapshotId: 'snap_1',
      revisedAt: '2026-04-17T13:10:00.000Z',
      windowStartAt: '2026-04-17T07:10:00.000Z',
      windowEndAt: '2026-04-17T13:10:00.000Z',
      sessionId: 'session_1',
      blocks: [],
      model: 'test',
      promptVersion: PLANNER_PROMPT_VERSION,
      durationMs: 100,
      inputObservationCount: 0,
      inputClusterCount: 0,
      previousSnapshotId: null,
      cause: 'cadence',
    };

    const eventLog: DomainEvent[] = [
      {
        id: 'event_1',
        type: 'task_plan_revised',
        snapshot,
        occurredAt: snapshot.revisedAt,
      },
    ];

    const timeline = replayEventLog(eventLog);

    expect(timeline.planSnapshots).toHaveLength(1);
    expect(timeline.planSnapshots[0].snapshotId).toBe('snap_1');
    expect(timeline.lastPlanRevisionFailure).toBeNull();
  });

  test('records lastPlanRevisionFailure from task_plan_revision_failed', () => {
    const eventLog: DomainEvent[] = [
      {
        id: 'event_1',
        type: 'task_plan_revision_failed',
        failure: {
          failedAt: '2026-04-17T13:10:00.000Z',
          cause: 'cadence',
          reason: 'engine_error',
          message: 'network failed',
          windowStartAt: '2026-04-17T07:10:00.000Z',
          windowEndAt: '2026-04-17T13:10:00.000Z',
          inputObservationCount: 4,
          inputClusterCount: 2,
        },
        occurredAt: '2026-04-17T13:10:00.000Z',
      },
    ];

    const timeline = replayEventLog(eventLog);
    expect(timeline.lastPlanRevisionFailure?.reason).toBe('engine_error');
    expect(timeline.lastPlanRevisionFailure?.message).toBe('network failed');
  });
});

describe('getDayWorklog', () => {
  const timezone = 'UTC';

  function makeSnapshot(overrides: {
    snapshotId: string;
    windowStartAt: string;
    windowEndAt: string;
    blocks: TaskPlanSnapshot['blocks'];
    revisedAt?: string;
  }): TaskPlanSnapshot {
    return {
      snapshotId: overrides.snapshotId,
      revisedAt: overrides.revisedAt ?? overrides.windowEndAt,
      windowStartAt: overrides.windowStartAt,
      windowEndAt: overrides.windowEndAt,
      sessionId: 'session_1',
      blocks: overrides.blocks,
      model: 'test',
      promptVersion: PLANNER_PROMPT_VERSION,
      durationMs: 100,
      inputObservationCount: overrides.blocks.length,
      inputClusterCount: overrides.blocks.length,
      previousSnapshotId: null,
      cause: 'cadence',
    };
  }

  test('renders blocks from the latest snapshot covering the day', () => {
    const snapshot = makeSnapshot({
      snapshotId: 'snap_1',
      windowStartAt: '2026-04-17T08:00:00.000Z',
      windowEndAt: '2026-04-17T14:00:00.000Z',
      blocks: [
        {
          id: 'block_1',
          startAt: '2026-04-17T09:00:00.000Z',
          endAt: '2026-04-17T10:00:00.000Z',
          headline: 'Triage inbox',
          narrative:
            'Cleared weekly inbox, replied to five stakeholder threads, filed two JIRA tickets.',
          label: 'worked_on',
          category: 'communication',
          confidence: 0.8,
          keyActivities: ['Replied to stakeholders'],
          artifacts: {
            apps: ['Mail'],
            repositories: [],
            urls: [],
            tickets: ['OPS-12'],
            documents: [],
            people: [],
          },
          reasonCodes: ['email'],
          sourceObservationIds: ['obs_1'],
        },
      ],
    });

    const timeline: TimelineView = {
      ...EMPTY_TIMELINE,
      planSnapshots: [snapshot],
    };

    const worklog = getDayWorklog(timeline, '2026-04-17T09:00:00.000Z', timezone);
    expect(worklog.blocks).toHaveLength(1);
    expect(worklog.blocks[0].title).toBe('Triage inbox');
    expect(worklog.blocks[0].summary.narrative.length).toBeGreaterThan(10);
    expect(worklog.blocks[0].summary.provenance.supportedByObservationIds).toEqual(['obs_1']);
  });

  test('most recent snapshot overrides older snapshots for overlapping windows', () => {
    const older = makeSnapshot({
      snapshotId: 'snap_old',
      windowStartAt: '2026-04-17T08:00:00.000Z',
      windowEndAt: '2026-04-17T12:00:00.000Z',
      blocks: [
        {
          id: 'block_old',
          startAt: '2026-04-17T09:00:00.000Z',
          endAt: '2026-04-17T10:00:00.000Z',
          headline: 'Old headline',
          narrative: 'Old narrative that should be overridden by the newer snapshot.',
          label: 'worked_on',
          category: 'coding',
          confidence: 0.6,
          keyActivities: [],
          artifacts: {
            apps: [],
            repositories: [],
            urls: [],
            tickets: [],
            documents: [],
            people: [],
          },
          reasonCodes: [],
          sourceObservationIds: ['obs_old'],
        },
      ],
    });
    const newer = makeSnapshot({
      snapshotId: 'snap_new',
      windowStartAt: '2026-04-17T08:00:00.000Z',
      windowEndAt: '2026-04-17T14:00:00.000Z',
      blocks: [
        {
          id: 'block_new',
          startAt: '2026-04-17T09:00:00.000Z',
          endAt: '2026-04-17T10:00:00.000Z',
          headline: 'Refined headline',
          narrative:
            'Newer narrative with more specific detail about what was done this morning.',
          label: 'worked_on',
          category: 'coding',
          confidence: 0.85,
          keyActivities: ['Refined analysis'],
          artifacts: {
            apps: [],
            repositories: [],
            urls: [],
            tickets: [],
            documents: [],
            people: [],
          },
          reasonCodes: ['coding'],
          sourceObservationIds: ['obs_new'],
        },
      ],
    });

    const timeline: TimelineView = {
      ...EMPTY_TIMELINE,
      planSnapshots: [older, newer],
    };

    const worklog = getDayWorklog(timeline, '2026-04-17T09:00:00.000Z', timezone);
    expect(worklog.blocks).toHaveLength(1);
    expect(worklog.blocks[0].title).toBe('Refined headline');
  });

  test('frozen blocks from older snapshots still render when outside the newer window', () => {
    const frozen = makeSnapshot({
      snapshotId: 'snap_frozen',
      windowStartAt: '2026-04-17T00:00:00.000Z',
      windowEndAt: '2026-04-17T06:00:00.000Z',
      blocks: [
        {
          id: 'block_frozen',
          startAt: '2026-04-17T04:00:00.000Z',
          endAt: '2026-04-17T05:00:00.000Z',
          headline: 'Morning research',
          narrative:
            'Read competitor docs and captured notes for the quarterly strategy brief.',
          label: 'worked_on',
          category: 'research',
          confidence: 0.7,
          keyActivities: ['Read competitor docs'],
          artifacts: {
            apps: ['Safari'],
            repositories: [],
            urls: ['https://competitor.example/product'],
            tickets: [],
            documents: [],
            people: [],
          },
          reasonCodes: ['research'],
          sourceObservationIds: ['obs_early'],
        },
      ],
    });
    const live = makeSnapshot({
      snapshotId: 'snap_live',
      windowStartAt: '2026-04-17T08:00:00.000Z',
      windowEndAt: '2026-04-17T14:00:00.000Z',
      blocks: [
        {
          id: 'block_live',
          startAt: '2026-04-17T13:00:00.000Z',
          endAt: '2026-04-17T14:00:00.000Z',
          headline: 'Afternoon coding',
          narrative: "Implemented the login flow redesign based on Nikki's feedback.",
          label: 'worked_on',
          category: 'coding',
          confidence: 0.85,
          keyActivities: ['Built login flow'],
          artifacts: {
            apps: ['Cursor'],
            repositories: ['web-app'],
            urls: [],
            tickets: [],
            documents: [],
            people: ['Nikki'],
          },
          reasonCodes: ['coding'],
          sourceObservationIds: ['obs_late'],
        },
      ],
    });

    const timeline: TimelineView = {
      ...EMPTY_TIMELINE,
      planSnapshots: [frozen, live],
    };

    const worklog = getDayWorklog(timeline, '2026-04-17T10:00:00.000Z', timezone);
    expect(worklog.blocks).toHaveLength(2);
    expect(worklog.blocks[0].title).toBe('Morning research');
    expect(worklog.blocks[1].title).toBe('Afternoon coding');
  });
});

describe('headline task-anchoring', () => {
  test('rejects gerund-first headlines', () => {
    expect(isWellFormedTaskHeadline('Reviewing Hestia PR #34619 Status')).toBe(false);
    expect(isWellFormedTaskHeadline('Debugging retry flow')).toBe(false);
    expect(isWellFormedTaskHeadline('Configuring Olympus Environment & Git')).toBe(false);
    expect(isWellFormedTaskHeadline('Developing & Reviewing Launch Workflows')).toBe(false);
  });

  test('rejects activity-and-activity compounds', () => {
    expect(isWellFormedTaskHeadline('Refactoring & Reviewing code')).toBe(false);
    expect(isWellFormedTaskHeadline('Reviewing and testing PRs')).toBe(false);
  });

  test('rejects generic-noun-only headlines', () => {
    expect(isWellFormedTaskHeadline('workflow')).toBe(false);
    expect(isWellFormedTaskHeadline('Environment setup')).toBe(false);
    expect(isWellFormedTaskHeadline('code changes')).toBe(false);
  });

  test('accepts task-anchored headlines', () => {
    expect(isWellFormedTaskHeadline('PAY-193 retry flow')).toBe(true);
    expect(isWellFormedTaskHeadline('Pre-consultation form for launch portal')).toBe(true);
    expect(isWellFormedTaskHeadline('hestia PR #34619 review')).toBe(true);
    expect(isWellFormedTaskHeadline('Brand dedup by viewer role (PR #34603)')).toBe(true);
    expect(isWellFormedTaskHeadline('Weekly Launch Product Sync')).toBe(true);
    expect(isWellFormedTaskHeadline('Q2 strategy brief')).toBe(true);
  });

  test('repairs a gerund headline using a ticket anchor', async () => {
    const observations = [
      makeObservation({
        id: 'obs_1',
        observedAt: '2026-04-17T13:00:00.000Z',
        structured: {taskHypothesis: 'Fix PAY-193 retry flow'},
      }),
    ];
    const timeline = timelineWithObservations(observations);

    const result = await runPlannerRevision({
      timeline,
      now: '2026-04-17T14:00:00.000Z',
      cause: 'cadence',
      windowMs: WINDOW_MS,
      runReplan: async () => ({
        model: 'stub-model',
        promptVersion: PLANNER_PROMPT_VERSION,
        durationMs: 100,
        blocks: [
          {
            startAt: '2026-04-17T13:00:00.000Z',
            endAt: '2026-04-17T13:20:00.000Z',
            headline: 'Debugging & Reviewing Retry Logic',
            narrative:
              'Edited retry.ts to handle expired tokens and added a regression test.',
            label: 'worked_on' as const,
            category: 'coding' as const,
            confidence: 0.82,
            keyActivities: ['Edited retry.ts', 'Added regression test'],
            artifacts: {
              apps: ['Cursor'],
              repositories: ['payments-service'],
              urls: [],
              tickets: ['PAY-193'],
              documents: ['retry.ts'],
              people: [],
            },
            reasonCodes: ['coding'],
            sourceObservationIds: ['obs_1'],
          },
        ],
      }),
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const repaired = result.snapshot.blocks[0].headline;
    expect(repaired.startsWith('Debugging')).toBe(false);
    expect(repaired.startsWith('PAY-193')).toBe(true);
  });

  test('repairs a generic headline using a distinctive file anchor', async () => {
    const observations = [
      makeObservation({
        id: 'obs_1',
        observedAt: '2026-04-17T13:00:00.000Z',
      }),
    ];
    const timeline = timelineWithObservations(observations);

    const result = await runPlannerRevision({
      timeline,
      now: '2026-04-17T14:00:00.000Z',
      cause: 'cadence',
      windowMs: WINDOW_MS,
      runReplan: async () => ({
        model: 'stub-model',
        promptVersion: PLANNER_PROMPT_VERSION,
        durationMs: 100,
        blocks: [
          {
            startAt: '2026-04-17T13:00:00.000Z',
            endAt: '2026-04-17T13:20:00.000Z',
            headline: 'Refactoring & Reviewing Launch Workflows',
            narrative: 'Refactored brand dedup logic for viewer role priority.',
            label: 'worked_on' as const,
            category: 'coding' as const,
            confidence: 0.82,
            keyActivities: ['Refactored brand dedup logic'],
            artifacts: {
              apps: ['Cursor'],
              repositories: ['hestia'],
              urls: [],
              tickets: [],
              documents: ['src/dedupeAssignmentsByBrand.ts'],
              people: [],
            },
            reasonCodes: ['coding'],
            sourceObservationIds: ['obs_1'],
          },
        ],
      }),
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const repaired = result.snapshot.blocks[0].headline;
    expect(repaired.startsWith('Refactoring')).toBe(false);
    expect(repaired.toLowerCase()).toContain('dedupe');
  });

  test('leaves a well-formed headline untouched', async () => {
    const observations = [
      makeObservation({
        id: 'obs_1',
        observedAt: '2026-04-17T13:00:00.000Z',
      }),
    ];
    const timeline = timelineWithObservations(observations);

    const result = await runPlannerRevision({
      timeline,
      now: '2026-04-17T14:00:00.000Z',
      cause: 'cadence',
      windowMs: WINDOW_MS,
      runReplan: async () => ({
        model: 'stub-model',
        promptVersion: PLANNER_PROMPT_VERSION,
        durationMs: 100,
        blocks: [
          {
            startAt: '2026-04-17T13:00:00.000Z',
            endAt: '2026-04-17T13:20:00.000Z',
            headline: 'PAY-193 retry flow',
            narrative: 'Edited retry.ts to handle expired tokens.',
            label: 'worked_on' as const,
            category: 'coding' as const,
            confidence: 0.82,
            keyActivities: ['Edited retry.ts'],
            artifacts: {
              apps: ['Cursor'],
              repositories: ['payments-service'],
              urls: [],
              tickets: ['PAY-193'],
              documents: ['retry.ts'],
              people: [],
            },
            reasonCodes: ['coding'],
            sourceObservationIds: ['obs_1'],
          },
        ],
      }),
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.snapshot.blocks[0].headline).toBe('PAY-193 retry flow');
  });
});

describe('pruneOutlierObservationIds', () => {
  function indexOf(observations: ObservationView[]): Map<string, ObservationView> {
    const map = new Map<string, ObservationView>();
    for (const observation of observations) {
      map.set(observation.id, observation);
    }
    return map;
  }

  test('returns input unchanged when observations are clustered together', () => {
    const observations = [
      makeObservation({id: 'obs_1', observedAt: '2026-04-22T19:57:00.000Z'}),
      makeObservation({id: 'obs_2', observedAt: '2026-04-22T19:58:00.000Z'}),
      makeObservation({id: 'obs_3', observedAt: '2026-04-22T20:02:00.000Z'}),
    ];
    const ids = observations.map(o => o.id);
    const result = pruneOutlierObservationIds(ids, indexOf(observations));
    expect(result).toEqual(ids);
  });

  test('drops a lone observation isolated by a 40-minute gap', () => {
    const observations = [
      makeObservation({id: 'obs_1', observedAt: '2026-04-22T19:57:00.000Z'}),
      makeObservation({id: 'obs_2', observedAt: '2026-04-22T19:58:00.000Z'}),
      makeObservation({id: 'obs_3', observedAt: '2026-04-22T20:02:00.000Z'}),
      makeObservation({id: 'obs_stray', observedAt: '2026-04-22T20:43:00.000Z'}),
    ];
    const ids = observations.map(o => o.id);
    const result = pruneOutlierObservationIds(ids, indexOf(observations));
    expect(result).toEqual(['obs_1', 'obs_2', 'obs_3']);
  });

  test('keeps the larger of two separated clusters', () => {
    const observations = [
      makeObservation({id: 'small_1', observedAt: '2026-04-22T19:00:00.000Z'}),
      makeObservation({id: 'small_2', observedAt: '2026-04-22T19:01:00.000Z'}),
      makeObservation({id: 'big_1', observedAt: '2026-04-22T19:42:00.000Z'}),
      makeObservation({id: 'big_2', observedAt: '2026-04-22T19:43:00.000Z'}),
      makeObservation({id: 'big_3', observedAt: '2026-04-22T19:44:00.000Z'}),
      makeObservation({id: 'big_4', observedAt: '2026-04-22T19:47:00.000Z'}),
    ];
    const ids = observations.map(o => o.id);
    const result = pruneOutlierObservationIds(ids, indexOf(observations));
    expect(result).toEqual(['big_1', 'big_2', 'big_3', 'big_4']);
  });

  test('passes through single-observation blocks unchanged', () => {
    const observations = [
      makeObservation({id: 'obs_1', observedAt: '2026-04-22T19:00:00.000Z'}),
    ];
    const ids = observations.map(o => o.id);
    const result = pruneOutlierObservationIds(ids, indexOf(observations));
    expect(result).toEqual(ids);
  });
});
