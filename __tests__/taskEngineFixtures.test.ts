import {
  createOccurredAt,
  replayEventLog,
  type ObservationView,
  type TimelineView,
} from '../src/state/eventLog';
import {buildTaskEventsForDecision} from '../src/tasks/applyDecision';
import {buildTaskCandidates} from '../src/tasks/candidates';
import {buildTaskFeatureSnapshot} from '../src/tasks/features';
import {DEFAULT_TASK_ENGINE_POLICY, evaluateHardConstraints} from '../src/tasks/policy';
import {buildReconciliationEvents} from '../src/tasks/reconcile';
import {routeTaskCandidates} from '../src/tasks/router';

function createObservation(
  overrides: Partial<ObservationView> = {},
): ObservationView {
  return {
    id: 'observation_1',
    sessionId: 'session_1',
    taskId: undefined,
    text: 'Fixing payment retry logic.',
    observedAt: '2026-04-12T15:01:00.000Z',
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
    ...overrides,
  };
}

function createTimeline(): TimelineView {
  return replayEventLog([
    {
      id: 'event_session',
      type: 'session_started',
      sessionId: 'session_1',
      title: 'Morning Session',
      occurredAt: '2026-04-12T15:00:00.000Z',
    },
  ]);
}

describe('task engine fixtures', () => {
  test('hard constraints force a new segment when no active segment exists', () => {
    const timeline = createTimeline();
    const observation = createObservation();

    const forced = evaluateHardConstraints({
      timeline,
      observation,
      policy: DEFAULT_TASK_ENGINE_POLICY,
    });

    expect(forced?.decision).toBe('start_new');
  });

  test('candidate generation prefers join_current when entities overlap', () => {
    const timeline = createTimeline();
    const observation = createObservation();
    const seededTimeline = replayEventLog([
      ...timeline.sessionOrder.map(() => ({
        id: 'noop',
        type: 'session_started' as const,
        sessionId: 'session_1',
        title: 'Morning Session',
        occurredAt: '2026-04-12T15:00:00.000Z',
      })),
      {
        id: 'event_segment',
        type: 'task_segment_started' as const,
        occurredAt: '2026-04-12T15:00:10.000Z',
        segment: {
          id: 'segment_1',
          lineageId: 'lineage_1',
          sessionId: 'session_1',
          state: 'open' as const,
          kind: 'primary' as const,
          startTime: '2026-04-12T15:00:10.000Z',
          endTime: null,
          lastActiveTime: '2026-04-12T15:00:40.000Z',
          liveTitle: 'Fix PAY-193 retry flow',
          liveSummary: 'Working on retry logic in payments-service.',
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
          confidence: 0.9,
          provisional: true,
          reviewStatus: 'unreviewed' as const,
        },
      },
    ]);
    const featureSnapshot = buildTaskFeatureSnapshot({
      observation,
      currentSegment: seededTimeline.taskSegmentsById.segment_1,
      currentLineage: seededTimeline.taskLineagesById.lineage_1,
      interruptionWindowSeconds: 120,
    });

    const candidates = buildTaskCandidates({
      timeline: seededTimeline,
      observation,
      features: featureSnapshot,
    });

    expect(candidates[0].decision).toBe('join_current');
  });

  test('router escalates ambiguous candidates to hybrid adjudication', () => {
    const routed = routeTaskCandidates({
      candidates: [
        {
          decision: 'join_current',
          targetSegmentId: 'segment_1',
          targetLineageId: 'lineage_1',
          score: 0.55,
          reasonCodes: ['same_repo'],
          summary: 'Continue current segment.',
        },
        {
          decision: 'start_new',
          targetSegmentId: null,
          targetLineageId: null,
          score: 0.45,
          reasonCodes: ['new_semantic_block'],
          summary: 'Start new segment.',
        },
      ],
    });

    expect(routed.shouldCallLlm).toBe(true);
    expect(routed.decisionMode).toBe('hybrid');
  });

  test('router escalates cross-app but semantically continuous workflow cases', () => {
    const routed = routeTaskCandidates({
      candidates: [
        {
          decision: 'join_current',
          targetSegmentId: 'segment_1',
          targetLineageId: 'lineage_1',
          score: 0.81,
          reasonCodes: ['workflow_continuity_hint'],
          summary: 'Continue current segment.',
        },
        {
          decision: 'start_new',
          targetSegmentId: null,
          targetLineageId: null,
          score: 0.43,
          reasonCodes: ['new_semantic_block'],
          summary: 'Start new segment.',
        },
      ],
      featureSnapshot: {
        observationId: 'observation_1',
        timeSinceCurrentSegmentSeconds: 40,
        timeSinceLineageSeconds: 40,
        recentAppMatch: false,
        appSeenInCurrentSegment: true,
        sameActivityType: true,
        sameTaskHypothesis: true,
        sameWindowTitle: false,
        withinInterruptionTolerance: true,
        summaryTokenSimilarity: 0.42,
        titleTokenSimilarity: 0.1,
        recentObservationSummarySimilarity: 0.37,
        recentObservationHypothesisSimilarity: 0.34,
        repoOverlap: 1,
        ticketOverlap: 1,
        documentOverlap: 0.5,
        peopleOverlap: 0,
        urlOverlap: 0,
        appOverlapCount: 1,
        totalEntityOverlap: 2.5,
        sameEntityThread: true,
        workflowContinuityHint: true,
        semanticContinuityScore: 0.61,
        confidenceDelta: 0.05,
        interruptionWindowSeconds: 120,
      },
    });

    expect(routed.shouldCallLlm).toBe(true);
    expect(routed.decisionMode).toBe('hybrid');
  });

  test('hold_pending emits a buffered pending observation', () => {
    const timeline = createTimeline();
    const observation = createObservation({
      id: 'observation_pending',
      observedAt: '2026-04-12T15:02:00.000Z',
    });
    const events = buildTaskEventsForDecision({
      timeline,
      observation,
      selectedCandidate: {
        decision: 'hold_pending',
        targetSegmentId: null,
        targetLineageId: null,
        score: 0.5,
        reasonCodes: ['insufficient_evidence'],
        summary: 'Hold until more evidence arrives.',
      },
      candidateShortlist: [],
      featureSnapshot: null,
      decisionMode: 'fallback',
      usedLlm: false,
      errorReason: 'timeout',
    });

    expect(events.some(event => event.type === 'task_pending_buffered')).toBe(true);
  });

  test('applyDecision creates replayable segment and decision events', () => {
    const timeline = createTimeline();
    const observation = createObservation();
    const events = buildTaskEventsForDecision({
      timeline,
      observation,
      selectedCandidate: {
        decision: 'start_new',
        targetSegmentId: null,
        targetLineageId: null,
        score: 1,
        reasonCodes: ['no_active_segment'],
        summary: 'Start a new segment.',
      },
      candidateShortlist: [],
      featureSnapshot: null,
      decisionMode: 'deterministic',
      usedLlm: false,
    });

    const replayed = replayEventLog([
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
        observationId: observation.id,
        sessionId: observation.sessionId,
        text: observation.text,
        structured: observation.structured,
        occurredAt: observation.observedAt,
      },
      ...events,
    ]);

    expect(replayed.currentTaskSegmentId).not.toBeNull();
    expect(replayed.taskDecisionOrder).toHaveLength(1);
  });

  test('reconciliation finalizes a closed lineage', () => {
    const timeline = replayEventLog([
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
        text: 'Fixed retry logic.',
        structured: createObservation().structured,
        occurredAt: '2026-04-12T15:01:00.000Z',
      },
      ...buildTaskEventsForDecision({
        timeline: createTimeline(),
        observation: createObservation(),
        selectedCandidate: {
          decision: 'start_new',
          targetSegmentId: null,
          targetLineageId: null,
          score: 1,
          reasonCodes: ['no_active_segment'],
          summary: 'Start a new segment.',
        },
        candidateShortlist: [],
        featureSnapshot: null,
        decisionMode: 'deterministic',
        usedLlm: false,
      }),
      {
        id: 'event_close',
        type: 'task_segment_closed',
        segmentId: 'segment_missing',
        endTime: createOccurredAt(),
        occurredAt: createOccurredAt(),
      },
    ]);

    const closedTimeline = replayEventLog([
      ...Object.values(timeline.sessionsById).map(session => ({
        id: `${session.id}_noop`,
        type: 'session_started' as const,
        sessionId: session.id,
        title: session.title,
        occurredAt: session.startedAt,
      })),
      ...timeline.observationOrder.map(observationId => ({
        id: `${observationId}_noop`,
        type: 'observation_added' as const,
        observationId,
        sessionId: timeline.observationsById[observationId].sessionId,
        text: timeline.observationsById[observationId].text,
        structured: timeline.observationsById[observationId].structured,
        occurredAt: timeline.observationsById[observationId].observedAt,
      })),
      ...timeline.taskSegmentOrder.map(segmentId => ({
        id: `${segmentId}_start`,
        type: 'task_segment_started' as const,
        occurredAt: timeline.taskSegmentsById[segmentId].startTime,
        segment: {
          ...timeline.taskSegmentsById[segmentId],
          state: 'closed' as const,
          endTime: '2026-04-12T15:10:00.000Z',
        },
      })),
      ...timeline.taskSegmentOrder.map(segmentId => ({
        id: `${segmentId}_close`,
        type: 'task_segment_closed' as const,
        segmentId,
        endTime: '2026-04-12T15:10:00.000Z',
        nextState: 'closed' as const,
        occurredAt: '2026-04-12T15:10:00.000Z',
      })),
      ...timeline.taskDecisionOrder.map(decisionId => ({
        id: `${decisionId}_decision`,
        type: 'task_decision_recorded' as const,
        decisionId,
        decision: timeline.taskDecisionsById[decisionId],
        occurredAt: '2026-04-12T15:01:00.000Z',
      })),
    ]);

    const reconciliationEvents = buildReconciliationEvents(closedTimeline);
    expect(reconciliationEvents.some(event => event.type === 'task_finalized')).toBe(true);
  });
});
