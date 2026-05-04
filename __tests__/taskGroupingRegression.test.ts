import {getDayWorklog} from '../src/planner/selectors';
import {
  replayEventLog,
  type DomainEvent,
} from '../src/timeline/eventLog';
import type {StructuredObservation} from '../src/observation/types';
import type {TaskSegmentView} from '../src/tasks/types';

const baseObservation: StructuredObservation = {
  summary: 'Worked on Flow capture planning in Cursor.',
  activityType: 'coding',
  taskHypothesis: 'Flow capture planning repair',
  confidence: 0.9,
  sensitivity: 'low',
  sensitivityReason: 'Routine development work.',
  artifacts: ['Flow'],
  entities: {
    apps: ['Cursor'],
    documents: ['timelineService.ts'],
    tickets: [],
    repos: ['flow'],
    urls: [],
    people: [],
  },
  nextAction: 'Continue wiring task grouping.',
};

function captureEvent(id: string, at: string, hash: string): DomainEvent {
  return {
    id: `event_${id}`,
    type: 'capture_performed',
    captureId: id,
    occurredAt: at,
    capture: {
      capturedAt: at,
      status: 'captured',
      targetType: 'window',
      appName: 'Cursor',
      bundleIdentifier: 'com.todesktop.cursor',
      processId: null,
      windowId: null,
      windowTitle: 'flow - timelineService.ts',
      displayId: 1,
      confidence: 0.9,
      width: 1200,
      height: 900,
      frameHash: hash,
      perceptualHash: hash.slice(0, 16),
      errorMessage: null,
      previewByteLength: 100,
      privacyRedaction: {
        checked: true,
        applied: false,
        version: 'capture-privacy-v1',
        matchCount: 0,
        matchTypes: [],
      },
      staleFrame: false,
      blankFrame: false,
    },
  };
}

function segment(): TaskSegmentView {
  return {
    id: 'segment_1',
    lineageId: 'lineage_1',
    sessionId: 'session_1',
    state: 'open',
    kind: 'primary',
    startTime: '2026-05-03T17:00:00.000Z',
    endTime: null,
    lastActiveTime: '2026-05-03T17:00:00.000Z',
    liveTitle: 'Flow capture planning repair',
    liveSummary: 'Worked on Flow capture planning in Cursor.',
    finalTitle: null,
    finalSummary: null,
    observationIds: [],
    supportingApps: ['Cursor'],
    entityMemory: {
      apps: ['Cursor'],
      repos: ['flow'],
      ticketIds: [],
      projects: [],
      documents: ['timelineService.ts'],
      people: [],
      urls: [],
    },
    interruptionSegments: [],
    confidence: 0.9,
    provisional: true,
    reviewStatus: 'unreviewed',
  };
}

describe('live task grouping regression coverage', () => {
  test('replays live task segment events and uses them before planner snapshots', () => {
    const events: DomainEvent[] = [
      {
        id: 'event_session_start',
        type: 'session_started',
        sessionId: 'session_1',
        title: 'Session 1',
        occurredAt: '2026-05-03T17:00:00.000Z',
      },
      captureEvent('capture_1', '2026-05-03T17:00:00.000Z', 'a'.repeat(64)),
      {
        id: 'event_obs_1',
        type: 'observation_added',
        observationId: 'obs_1',
        sessionId: 'session_1',
        text: baseObservation.summary,
        structured: baseObservation,
        occurredAt: '2026-05-03T17:00:00.000Z',
      },
      {
        id: 'event_segment_1',
        type: 'task_segment_started',
        segment: segment(),
        occurredAt: '2026-05-03T17:00:00.000Z',
      },
      {
        id: 'event_decision_1',
        type: 'task_decision_recorded',
        decisionId: 'decision_1',
        occurredAt: '2026-05-03T17:00:00.000Z',
        decision: {
          id: 'decision_1',
          observationId: 'obs_1',
          occurredAt: '2026-05-03T17:00:00.000Z',
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
      ...Array.from({length: 10}, (_, index) =>
        captureEvent(
          `capture_${index + 2}`,
          new Date(Date.parse('2026-05-03T17:00:00.000Z') + (index + 1) * 2 * 60 * 1000).toISOString(),
          'a'.repeat(64),
        ),
      ),
      {
        id: 'event_plan',
        type: 'task_plan_revised',
        occurredAt: '2026-05-03T17:21:00.000Z',
        snapshot: {
          snapshotId: 'snapshot_1',
          revisedAt: '2026-05-03T17:21:00.000Z',
          windowStartAt: '2026-05-03T16:00:00.000Z',
          windowEndAt: '2026-05-03T17:21:00.000Z',
          sessionId: 'session_1',
          blocks: [
            {
              id: 'plan_block_1',
              startAt: '2026-05-03T17:00:00.000Z',
              endAt: '2026-05-03T17:01:00.000Z',
              headline: 'Tiny planner block',
              narrative: 'Planner only saw one observation.',
              label: 'worked_on',
              category: 'coding',
              confidence: 0.7,
              keyActivities: [],
              artifacts: {
                apps: ['Cursor'],
                repositories: ['flow'],
                urls: [],
                tickets: [],
                documents: [],
                people: [],
              },
              reasonCodes: ['single_observation'],
              sourceObservationIds: ['obs_1'],
            },
          ],
          model: 'test',
          promptVersion: 'test',
          durationMs: 1,
          inputObservationCount: 1,
          inputClusterCount: 1,
          previousSnapshotId: null,
          cause: 'manual',
        },
      },
      {
        id: 'event_session_stop',
        type: 'session_stopped',
        sessionId: 'session_1',
        occurredAt: '2026-05-03T17:30:00.000Z',
      },
    ];

    const timeline = replayEventLog(events);
    const worklog = getDayWorklog(timeline, '2026-05-03', 'UTC');

    expect(timeline.taskSegmentOrder).toEqual(['segment_1']);
    expect(worklog.blocks).toHaveLength(1);
    expect(worklog.blocks[0]).toMatchObject({
      id: 'segment_1',
      title: 'Flow capture planning repair',
      repos: ['flow'],
    });
    expect(Date.parse(worklog.blocks[0].endTime) - Date.parse(worklog.blocks[0].startTime))
      .toBe(20 * 60 * 1000);
  });
});
