import {computeTaskEngineMetrics} from '../src/tasks/metrics';
import {replayEventLog, type DomainEvent} from '../src/state/eventLog';

describe('task metrics', () => {
  test('computes expanded task engine metrics', () => {
    const eventLog: DomainEvent[] = [
      {
        id: 'session_1',
        type: 'session_started',
        sessionId: 'session_1',
        title: 'Morning Session',
        occurredAt: '2026-04-12T15:00:00.000Z',
      },
      {
        id: 'observation_1',
        type: 'observation_added',
        observationId: 'observation_1',
        sessionId: 'session_1',
        text: 'Fix retry logic',
        structured: {
          summary: 'Fix retry logic in payments-service',
          activityType: 'coding',
          taskHypothesis: 'Fix PAY-193 retry flow',
          confidence: 0.82,
          sensitivity: 'low',
          sensitivityReason: 'Only code is visible',
          artifacts: ['retry.ts'],
          entities: {
            apps: ['Cursor'],
            documents: ['retry.ts'],
            tickets: ['PAY-193'],
            repos: ['payments-service'],
            urls: [],
            people: [],
          },
          nextAction: 'Update retry handling',
        },
        occurredAt: '2026-04-12T15:01:00.000Z',
      },
      {
        id: 'segment_start',
        type: 'task_segment_started',
        occurredAt: '2026-04-12T15:01:00.000Z',
        segment: {
          id: 'segment_1',
          lineageId: 'lineage_1',
          sessionId: 'session_1',
          state: 'finalized',
          kind: 'primary',
          startTime: '2026-04-12T15:01:00.000Z',
          endTime: '2026-04-12T15:10:00.000Z',
          lastActiveTime: '2026-04-12T15:10:00.000Z',
          liveTitle: 'Fix PAY-193 retry flow',
          liveSummary: 'Working on retry logic.',
          finalTitle: 'Fix PAY-193 retry flow',
          finalSummary: 'Completed retry work.',
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
          interruptionSegments: [
            {
              startTime: '2026-04-12T15:03:00.000Z',
              endTime: '2026-04-12T15:03:20.000Z',
              reason: 'brief Slack check',
            },
          ],
          confidence: 0.82,
          provisional: false,
          reviewStatus: 'reviewed',
        },
      },
      {
        id: 'decision_1',
        type: 'task_decision_recorded',
        occurredAt: '2026-04-12T15:01:00.000Z',
        decisionId: 'task_decision_1',
        decision: {
          id: 'task_decision_1',
          observationId: 'observation_1',
          decision: 'resume_lineage',
          targetSegmentId: 'segment_1',
          targetLineageId: 'lineage_1',
          decisionMode: 'llm',
          reasonCodes: ['recent_lineage_match'],
          reasonText: 'Resume the active lineage.',
          confidence: 0.88,
          usedLlm: true,
          candidateShortlist: [],
          featureSnapshot: null,
          stale: false,
          errorReason: null,
        },
      },
      {
        id: 'reconcile_1',
        type: 'task_reconciled',
        occurredAt: '2026-04-12T15:11:00.000Z',
        reconciliation: {
          id: 'recon_1',
          lineageId: 'lineage_1',
          segmentIds: ['segment_1'],
          mergedSegmentIds: [],
          splitSourceSegmentIds: [],
          finalTitle: 'Fix PAY-193 retry flow',
          finalSummary: 'Completed retry work.',
          confidence: 0.82,
          supersededDecisionIds: ['task_decision_1'],
          reviewStatus: 'reviewed',
        },
      },
      {
        id: 'finalize_1',
        type: 'task_finalized',
        occurredAt: '2026-04-12T15:11:10.000Z',
        lineageId: 'lineage_1',
        segmentId: 'segment_1',
        finalTitle: 'Fix PAY-193 retry flow',
        finalSummary: 'Completed retry work.',
        confidence: 0.82,
      },
    ];

    const timeline = replayEventLog(eventLog);
    const metrics = computeTaskEngineMetrics(timeline);

    expect(metrics.totalDecisions).toBe(1);
    expect(metrics.llmDecisionPercentage).toBe(1);
    expect(metrics.finalizedLineageCount).toBe(1);
    expect(metrics.lineageResumeAccuracy).toBe(1);
    expect(metrics.llmReversalRate).toBe(1);
  });
});
