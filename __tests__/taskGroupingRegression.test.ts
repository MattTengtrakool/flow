import { getDayWorklog } from '../src/planner/selectors';
import {
  EMPTY_TIMELINE,
  replayEventLog,
  type DomainEvent,
  type ObservationView,
} from '../src/timeline/eventLog';
import type { StructuredObservation } from '../src/observation/types';
import type { TaskSegmentView } from '../src/tasks/types';
import { buildTaskEventsForDecision } from '../src/tasks/applyDecision';

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

function segment(overrides: Partial<TaskSegmentView> = {}): TaskSegmentView {
  const base: TaskSegmentView = {
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
  return {
    ...base,
    ...overrides,
    entityMemory: {
      ...base.entityMemory,
      ...(overrides.entityMemory ?? {}),
    },
  };
}

describe('live task grouping regression coverage', () => {
  test('repairs gerund-heavy observation hypotheses before live titles render', () => {
    const structured: StructuredObservation = {
      summary:
        'User is troubleshooting a Salesforce integration error in Slack related to invalid OAuth scopes.',
      activityType: 'communication',
      taskHypothesis:
        'Troubleshooting a Salesforce integration error by communicating with a colleague via Slack to resolve an OAuth scope issue.',
      confidence: 0.82,
      sensitivity: 'low',
      sensitivityReason: 'Routine engineering support conversation.',
      artifacts: ['Slack'],
      entities: {
        apps: ['Slack'],
        documents: [],
        tickets: [],
        repos: [],
        urls: [],
        people: ['Jerry Yu'],
      },
      nextAction: 'Ask Jerry Yu to confirm API access.',
    };
    const observation: ObservationView = {
      id: 'obs_oauth',
      sessionId: 'session_1',
      text: structured.summary,
      structured,
      observedAt: '2026-05-03T17:00:00.000Z',
    };
    const selectedCandidate = {
      decision: 'start_new' as const,
      targetSegmentId: null,
      targetLineageId: null,
      score: 1,
      reasonCodes: ['no_active_segment'],
      summary: 'Start a new primary segment.',
    };

    const events = buildTaskEventsForDecision({
      timeline: {
        ...EMPTY_TIMELINE,
        observationsById: { obs_oauth: observation },
        observationOrder: ['obs_oauth'],
        currentSessionId: 'session_1',
      },
      observation,
      selectedCandidate,
      candidateShortlist: [selectedCandidate],
      featureSnapshot: null,
      decisionMode: 'deterministic',
      usedLlm: false,
    });
    const started = events.find(event => event.type === 'task_segment_started');

    expect(started?.type).toBe('task_segment_started');
    if (started?.type !== 'task_segment_started') return;
    expect(started.segment.liveTitle).toBe('Salesforce integration error');
    expect(started.segment.liveTitle).not.toMatch(
      /^(Troubleshooting|Investigating|Working)\b/i,
    );
  });

  test('uses document anchors without adding "Work on" to live titles', () => {
    const structured: StructuredObservation = {
      summary: 'Edited Flow CLAUDE.md in Cursor.',
      activityType: 'writing',
      taskHypothesis: null,
      confidence: 0.88,
      sensitivity: 'low',
      sensitivityReason: 'Routine project documentation.',
      artifacts: ['Flow CLAUDE.md'],
      entities: {
        apps: ['Cursor'],
        documents: ['Flow CLAUDE.md'],
        tickets: [],
        repos: ['flow'],
        urls: [],
        people: [],
      },
      nextAction: null,
    };
    const observation: ObservationView = {
      id: 'obs_claude',
      sessionId: 'session_1',
      text: structured.summary,
      structured,
      observedAt: '2026-05-03T17:02:00.000Z',
    };
    const selectedCandidate = {
      decision: 'start_new' as const,
      targetSegmentId: null,
      targetLineageId: null,
      score: 1,
      reasonCodes: ['no_active_segment'],
      summary: 'Start a new primary segment.',
    };

    const events = buildTaskEventsForDecision({
      timeline: {
        ...EMPTY_TIMELINE,
        observationsById: { obs_claude: observation },
        observationOrder: ['obs_claude'],
        currentSessionId: 'session_1',
      },
      observation,
      selectedCandidate,
      candidateShortlist: [selectedCandidate],
      featureSnapshot: null,
      decisionMode: 'deterministic',
      usedLlm: false,
    });
    const started = events.find(event => event.type === 'task_segment_started');

    expect(started?.type).toBe('task_segment_started');
    if (started?.type !== 'task_segment_started') return;
    expect(started.segment.liveTitle).toBe('Flow CLAUDE.md');
  });

  test('repairs old persisted live titles when rendering the worklog', () => {
    const structured: StructuredObservation = {
      summary: 'Edited Flow CLAUDE.md in Cursor.',
      activityType: 'writing',
      taskHypothesis: null,
      confidence: 0.88,
      sensitivity: 'low',
      sensitivityReason: 'Routine project documentation.',
      artifacts: ['Flow CLAUDE.md'],
      entities: {
        apps: ['Cursor'],
        documents: ['Flow CLAUDE.md'],
        tickets: [],
        repos: ['flow'],
        urls: [],
        people: [],
      },
      nextAction: null,
    };
    const staleSegment = segment();
    staleSegment.liveTitle = 'Work on Flow CLAUDE.md';
    staleSegment.liveSummary = structured.summary;
    staleSegment.entityMemory.documents = ['Flow CLAUDE.md'];
    staleSegment.entityMemory.repos = ['flow'];

    const timeline = replayEventLog([
      {
        id: 'event_session_start',
        type: 'session_started',
        sessionId: 'session_1',
        title: 'Session 1',
        occurredAt: '2026-05-03T17:00:00.000Z',
      },
      captureEvent('capture_1', '2026-05-03T17:00:00.000Z', 'b'.repeat(64)),
      {
        id: 'event_obs_1',
        type: 'observation_added',
        observationId: 'obs_1',
        sessionId: 'session_1',
        text: structured.summary,
        structured,
        occurredAt: '2026-05-03T17:00:00.000Z',
      },
      {
        id: 'event_segment_1',
        type: 'task_segment_started',
        segment: staleSegment,
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
    ]);

    const worklog = getDayWorklog(timeline, '2026-05-03', 'UTC');

    expect(worklog.blocks[0].title).toBe('Flow CLAUDE.md');
  });

  test('does not stretch a lone live observation to a later session stop', () => {
    const structured: StructuredObservation = {
      summary: 'Edited Flow CLAUDE.md in Cursor.',
      activityType: 'writing',
      taskHypothesis: 'Flow CLAUDE.md',
      confidence: 0.88,
      sensitivity: 'low',
      sensitivityReason: 'Routine project documentation.',
      artifacts: ['Flow CLAUDE.md'],
      entities: {
        apps: ['Cursor'],
        documents: ['Flow CLAUDE.md'],
        tickets: [],
        repos: ['flow'],
        urls: [],
        people: [],
      },
      nextAction: null,
    };
    const anchoredSegment = segment();
    anchoredSegment.startTime = '2026-05-03T07:47:00.000Z';
    anchoredSegment.lastActiveTime = '2026-05-03T07:47:00.000Z';
    anchoredSegment.liveTitle = 'Flow CLAUDE.md';
    anchoredSegment.liveSummary = structured.summary;
    anchoredSegment.entityMemory.documents = ['Flow CLAUDE.md'];
    anchoredSegment.entityMemory.repos = ['flow'];

    const timeline = replayEventLog([
      {
        id: 'event_session_start',
        type: 'session_started',
        sessionId: 'session_1',
        title: 'Session 1',
        occurredAt: '2026-05-03T07:47:00.000Z',
      },
      {
        id: 'event_obs_1',
        type: 'observation_added',
        observationId: 'obs_1',
        sessionId: 'session_1',
        text: structured.summary,
        structured,
        occurredAt: '2026-05-03T07:47:00.000Z',
      },
      {
        id: 'event_segment_1',
        type: 'task_segment_started',
        segment: anchoredSegment,
        occurredAt: '2026-05-03T07:47:00.000Z',
      },
      {
        id: 'event_decision_1',
        type: 'task_decision_recorded',
        decisionId: 'decision_1',
        occurredAt: '2026-05-03T07:47:00.000Z',
        decision: {
          id: 'decision_1',
          observationId: 'obs_1',
          occurredAt: '2026-05-03T07:47:00.000Z',
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
      {
        id: 'event_session_stop',
        type: 'session_stopped',
        sessionId: 'session_1',
        occurredAt: '2026-05-03T16:47:00.000Z',
      },
    ]);

    const worklog = getDayWorklog(timeline, '2026-05-03', 'UTC');

    expect(worklog.blocks).toHaveLength(1);
    expect(worklog.blocks[0].title).toBe('Flow CLAUDE.md');
    expect(
      Date.parse(worklog.blocks[0].endTime) -
        Date.parse(worklog.blocks[0].startTime),
    ).toBe(60 * 1000);
  });

  test('hides unanchored one-minute live blips from the worklog', () => {
    const structured: StructuredObservation = {
      summary: 'Looked at the Flow schedule view.',
      activityType: 'planning',
      taskHypothesis: 'Flow schedule view',
      confidence: 0.62,
      sensitivity: 'low',
      sensitivityReason: 'Routine app navigation.',
      artifacts: [],
      entities: {
        apps: ['Flow'],
        documents: [],
        tickets: [],
        repos: [],
        urls: [],
        people: [],
      },
      nextAction: null,
    };
    const weakSegment = segment();
    weakSegment.startTime = '2026-05-03T07:47:00.000Z';
    weakSegment.lastActiveTime = '2026-05-03T07:47:00.000Z';
    weakSegment.liveTitle = 'Flow schedule view';
    weakSegment.liveSummary = structured.summary;
    weakSegment.entityMemory = {
      apps: ['Flow'],
      repos: [],
      ticketIds: [],
      projects: [],
      documents: [],
      people: [],
      urls: [],
    };

    const timeline = replayEventLog([
      {
        id: 'event_session_start',
        type: 'session_started',
        sessionId: 'session_1',
        title: 'Session 1',
        occurredAt: '2026-05-03T07:47:00.000Z',
      },
      {
        id: 'event_obs_1',
        type: 'observation_added',
        observationId: 'obs_1',
        sessionId: 'session_1',
        text: structured.summary,
        structured,
        occurredAt: '2026-05-03T07:47:00.000Z',
      },
      {
        id: 'event_segment_1',
        type: 'task_segment_started',
        segment: weakSegment,
        occurredAt: '2026-05-03T07:47:00.000Z',
      },
      {
        id: 'event_decision_1',
        type: 'task_decision_recorded',
        decisionId: 'decision_1',
        occurredAt: '2026-05-03T07:47:00.000Z',
        decision: {
          id: 'decision_1',
          observationId: 'obs_1',
          occurredAt: '2026-05-03T07:47:00.000Z',
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
      {
        id: 'event_session_stop',
        type: 'session_stopped',
        sessionId: 'session_1',
        occurredAt: '2026-05-03T16:47:00.000Z',
      },
    ]);

    const worklog = getDayWorklog(timeline, '2026-05-03', 'UTC');

    expect(worklog.blocks).toHaveLength(0);
  });

  test('hides long Flow meeting-note status overlays from the worklog', () => {
    const structured: StructuredObservation = {
      summary:
        'Flow is finalizing the recording and preparing transcript notes.',
      activityType: 'other',
      taskHypothesis: 'Finalizing meeting notes',
      confidence: 0.72,
      sensitivity: 'low',
      sensitivityReason: 'Flow status chrome is visible.',
      artifacts: [],
      entities: {
        apps: ['Flow'],
        documents: [],
        tickets: [],
        repos: [],
        urls: [],
        people: [],
      },
      nextAction: null,
    };
    const statusSegment = segment({
      liveTitle: 'Finalizing meeting notes',
      liveSummary: structured.summary,
      entityMemory: {
        apps: ['Flow'],
        repos: [],
        ticketIds: [],
        projects: [],
        documents: [],
        people: [],
        urls: [],
      },
    });

    const events: DomainEvent[] = [
      {
        id: 'event_session_start',
        type: 'session_started',
        sessionId: 'session_1',
        title: 'Session 1',
        occurredAt: '2026-05-03T17:00:00.000Z',
      },
      ...Array.from({ length: 6 }, (_, index) =>
        captureEvent(
          `capture_status_${index + 1}`,
          new Date(
            Date.parse('2026-05-03T17:00:00.000Z') +
              index * 2 * 60 * 1000,
          ).toISOString(),
          'f'.repeat(64),
        ),
      ),
      {
        id: 'event_obs_1',
        type: 'observation_added',
        observationId: 'obs_1',
        sessionId: 'session_1',
        text: structured.summary,
        structured,
        occurredAt: '2026-05-03T17:00:00.000Z',
      },
      {
        id: 'event_segment_1',
        type: 'task_segment_started',
        segment: statusSegment,
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
      {
        id: 'event_session_stop',
        type: 'session_stopped',
        sessionId: 'session_1',
        occurredAt: '2026-05-03T17:12:00.000Z',
      },
    ];

    const timeline = replayEventLog(events);
    const worklog = getDayWorklog(timeline, '2026-05-03', 'UTC');

    expect(worklog.blocks).toHaveLength(0);
  });

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
      ...Array.from({ length: 10 }, (_, index) =>
        captureEvent(
          `capture_${index + 2}`,
          new Date(
            Date.parse('2026-05-03T17:00:00.000Z') +
              (index + 1) * 2 * 60 * 1000,
          ).toISOString(),
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
    expect(
      Date.parse(worklog.blocks[0].endTime) -
        Date.parse(worklog.blocks[0].startTime),
    ).toBe(20 * 60 * 1000);
  });

  test('prefers planner rollups over overlapping live micro segments', () => {
    const observedAt = [
      '2026-05-03T22:53:00.000Z',
      '2026-05-03T22:54:00.000Z',
      '2026-05-03T22:55:00.000Z',
      '2026-05-03T22:56:00.000Z',
    ];
    const taskTitles = [
      'Google Calendar - Week of May 3, 2026',
      'Otter Integration Bot Updates',
      'CRM assignment webhook implementation',
      'Mark Linnell DM',
    ];
    const events: DomainEvent[] = [
      {
        id: 'event_session_start',
        type: 'session_started',
        sessionId: 'session_1',
        title: 'Session 1',
        occurredAt: '2026-05-03T22:53:00.000Z',
      },
      ...observedAt.flatMap((at, index): DomainEvent[] => {
        const observationId = `obs_${index + 1}`;
        const segmentId = `segment_${index + 1}`;
        const lineageId = `lineage_${index + 1}`;
        const structured: StructuredObservation = {
          ...baseObservation,
          summary: `${taskTitles[index]} while checking the broader CRM assignment work.`,
          taskHypothesis: taskTitles[index],
          artifacts: ['Owner'],
          entities: {
            apps: index === 0 ? ['Google Chrome'] : ['Slack'],
            documents: [`${taskTitles[index]}.md`],
            tickets: index === 2 ? ['36170'] : [],
            repos: ['owner/Owner'],
            urls: [`https://example.test/${index + 1}`],
            people: index === 3 ? ['Mark Linnell'] : [],
          },
        };
        return [
          captureEvent(`capture_${index + 1}`, at, `${index + 1}`.repeat(64)),
          {
            id: `event_${observationId}`,
            type: 'observation_added',
            observationId,
            sessionId: 'session_1',
            text: structured.summary,
            structured,
            occurredAt: at,
          },
          {
            id: `event_${segmentId}`,
            type: 'task_segment_started',
            segment: segment({
              id: segmentId,
              lineageId,
              startTime: at,
              lastActiveTime: at,
              liveTitle: taskTitles[index],
              liveSummary: structured.summary,
              entityMemory: {
                apps: structured.entities.apps,
                repos: structured.entities.repos,
                ticketIds: structured.entities.tickets,
                projects: [],
                documents: structured.entities.documents,
                people: structured.entities.people,
                urls: structured.entities.urls,
              },
            }),
            occurredAt: at,
          },
          {
            id: `event_decision_${index + 1}`,
            type: 'task_decision_recorded',
            decisionId: `decision_${index + 1}`,
            occurredAt: at,
            decision: {
              id: `decision_${index + 1}`,
              observationId,
              occurredAt: at,
              decision: 'start_new',
              targetSegmentId: segmentId,
              targetLineageId: lineageId,
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
      }),
      {
        id: 'event_plan',
        type: 'task_plan_revised',
        occurredAt: '2026-05-03T22:58:00.000Z',
        snapshot: {
          snapshotId: 'snapshot_1',
          revisedAt: '2026-05-03T22:58:00.000Z',
          windowStartAt: '2026-05-03T22:50:00.000Z',
          windowEndAt: '2026-05-03T22:58:00.000Z',
          sessionId: 'session_1',
          blocks: [
            {
              id: 'plan_block_1',
              startAt: '2026-05-03T22:53:00.000Z',
              endAt: '2026-05-03T22:57:00.000Z',
              headline: 'CRM assignment webhook implementation',
              narrative:
                'Grouped the calendar check, integration bot updates, CRM implementation, and related DM into the broader webhook work.',
              label: 'worked_on',
              category: 'coding',
              confidence: 0.84,
              keyActivities: [
                'Checked calendar context',
                'Reviewed integration bot updates',
                'Worked on CRM assignment webhook follow-up',
              ],
              artifacts: {
                apps: ['Google Chrome', 'Slack'],
                repositories: ['owner/Owner'],
                urls: ['https://example.test/3'],
                tickets: ['36170'],
                documents: ['crm_assignment_webhook.md'],
                people: ['Mark Linnell'],
              },
              reasonCodes: ['multi_observation_rollup'],
              sourceObservationIds: ['obs_1', 'obs_2', 'obs_3', 'obs_4'],
            },
          ],
          model: 'test',
          promptVersion: 'test',
          durationMs: 1,
          inputObservationCount: 4,
          inputClusterCount: 1,
          previousSnapshotId: null,
          cause: 'manual',
        },
      },
      {
        id: 'event_session_stop',
        type: 'session_stopped',
        sessionId: 'session_1',
        occurredAt: '2026-05-03T23:00:00.000Z',
      },
    ];

    const timeline = replayEventLog(events);
    const worklog = getDayWorklog(timeline, '2026-05-03', 'UTC');

    expect(worklog.blocks).toHaveLength(1);
    expect(worklog.blocks[0]).toMatchObject({
      id: 'plan_block_1',
      source: 'planner',
      title: 'CRM assignment webhook implementation',
      tickets: ['36170'],
    });
    expect(worklog.blocks.map(block => block.title)).not.toContain(
      'Google Calendar - Week of May 3, 2026',
    );
    expect(
      worklog.blocks[0].summary.provenance.supportedByObservationIds,
    ).toEqual(['obs_1', 'obs_2', 'obs_3', 'obs_4']);
  });

  test('remerges related planner blocks across a brief browsing interruption', () => {
    const makeStructured = (
      summary: string,
      taskHypothesis: string,
      activityType: StructuredObservation['activityType'],
      repos: string[] = [],
      documents: string[] = [],
      urls: string[] = [],
    ): StructuredObservation => ({
      ...baseObservation,
      summary,
      activityType,
      taskHypothesis,
      artifacts: documents,
      entities: {
        apps: activityType === 'browsing' ? ['Spotify'] : ['Cursor'],
        documents,
        tickets: [],
        repos,
        urls,
        people: [],
      },
    });
    const observations = [
      {
        id: 'obs_agent_1',
        at: '2026-05-03T18:50:00.000Z',
        structured: makeStructured(
          'Troubleshot agent-1 phone number support in Cursor.',
          'agent-1 phone number support',
          'coding',
          ['agent-1'],
          ['schema.ts'],
        ),
      },
      {
        id: 'obs_agent_2',
        at: '2026-05-03T18:59:00.000Z',
        structured: makeStructured(
          'Continued agent-1 phone number support debugging.',
          'agent-1 phone number support',
          'coding',
          ['agent-1'],
          ['quo.ts'],
        ),
      },
      {
        id: 'obs_hamilton',
        at: '2026-05-03T19:08:00.000Z',
        structured: makeStructured(
          'Browsed Spotify Hamilton musical search results.',
          'Hamilton musical search results',
          'browsing',
          [],
          [],
          ['https://open.spotify.com/search/hamilton'],
        ),
      },
      {
        id: 'obs_agent_3',
        at: '2026-05-03T19:10:00.000Z',
        structured: makeStructured(
          'Adjusted agent-1 docker compose port remapping.',
          'agent-1 docker-compose port remapping',
          'coding',
          ['agent-1'],
          ['docker-compose.override.yml'],
        ),
      },
    ];
    const events: DomainEvent[] = [
      {
        id: 'event_session_start',
        type: 'session_started',
        sessionId: 'session_1',
        title: 'Session 1',
        occurredAt: '2026-05-03T18:50:00.000Z',
      },
      ...observations.map(
        ({ id, at, structured }): DomainEvent => ({
          id: `event_${id}`,
          type: 'observation_added',
          observationId: id,
          sessionId: 'session_1',
          text: structured.summary,
          structured,
          occurredAt: at,
        }),
      ),
      {
        id: 'event_plan',
        type: 'task_plan_revised',
        occurredAt: '2026-05-03T19:14:00.000Z',
        snapshot: {
          snapshotId: 'snapshot_1',
          revisedAt: '2026-05-03T19:14:00.000Z',
          windowStartAt: '2026-05-03T18:45:00.000Z',
          windowEndAt: '2026-05-03T19:14:00.000Z',
          sessionId: 'session_1',
          blocks: [
            {
              id: 'plan_agent_phone',
              startAt: '2026-05-03T18:50:00.000Z',
              endAt: '2026-05-03T19:01:00.000Z',
              headline: 'agent-1 phone number support',
              narrative: 'Debugged phone number support for agent-1.',
              label: 'worked_on',
              category: 'coding',
              confidence: 0.82,
              keyActivities: ['Debugged phone number lookup support.'],
              artifacts: {
                apps: ['Cursor'],
                repositories: ['agent-1'],
                urls: [],
                tickets: [],
                documents: ['schema.ts', 'quo.ts'],
                people: [],
              },
              reasonCodes: ['planner_split'],
              sourceObservationIds: ['obs_agent_1', 'obs_agent_2'],
            },
            {
              id: 'plan_hamilton',
              startAt: '2026-05-03T19:08:00.000Z',
              endAt: '2026-05-03T19:09:00.000Z',
              headline: 'Hamilton musical search results',
              narrative: 'Browsed Spotify search results for Hamilton.',
              label: 'worked_on',
              category: 'browsing',
              confidence: 0.74,
              keyActivities: ['Browsed Spotify search results.'],
              artifacts: {
                apps: ['Spotify'],
                repositories: [],
                urls: ['https://open.spotify.com/search/hamilton'],
                tickets: [],
                documents: [],
                people: [],
              },
              reasonCodes: ['brief_context_switch'],
              sourceObservationIds: ['obs_hamilton'],
            },
            {
              id: 'plan_agent_ports',
              startAt: '2026-05-03T19:09:00.000Z',
              endAt: '2026-05-03T19:13:00.000Z',
              headline: 'agent-1 docker-compose port remapping',
              narrative: 'Adjusted docker-compose port remapping for agent-1.',
              label: 'worked_on',
              category: 'coding',
              confidence: 0.81,
              keyActivities: ['Changed docker-compose port mapping.'],
              artifacts: {
                apps: ['Cursor'],
                repositories: ['agent-1'],
                urls: [],
                tickets: [],
                documents: ['docker-compose.override.yml'],
                people: [],
              },
              reasonCodes: ['planner_split'],
              sourceObservationIds: ['obs_agent_3'],
            },
          ],
          model: 'test',
          promptVersion: 'test',
          durationMs: 1,
          inputObservationCount: 4,
          inputClusterCount: 3,
          previousSnapshotId: null,
          cause: 'manual',
        },
      },
    ];

    const timeline = replayEventLog(events);
    const worklog = getDayWorklog(timeline, '2026-05-03', 'UTC');

    expect(worklog.blocks).toHaveLength(1);
    expect(worklog.blocks[0]).toMatchObject({
      title: 'agent-1 phone number support',
      repos: ['agent-1'],
      documents: ['schema.ts', 'quo.ts', 'docker-compose.override.yml'],
    });
    expect(worklog.blocks[0].summary.provenance.reasonCodes).toContain(
      'read_side_related_block_merge',
    );
    expect(worklog.blocks.map(block => block.title)).not.toContain(
      'Hamilton musical search results',
    );
  });
});
