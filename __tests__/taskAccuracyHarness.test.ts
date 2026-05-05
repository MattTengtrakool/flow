import {
  createScriptedBoundaryAdjudicator,
  runTaskAccuracyScenario,
  type TaskAccuracySegmentSummary,
} from '../src/tasks/accuracyHarness';

function primaryObservationGroups(segments: TaskAccuracySegmentSummary[]) {
  return segments
    .filter(segment => segment.kind === 'primary')
    .map(segment => segment.observationIds);
}

describe('task accuracy harness', () => {
  test('keeps one task together across research, coding, and terminal apps', async () => {
    const result = await runTaskAccuracyScenario({
      name: 'cross-app task extraction repair',
      observations: [
        {
          id: 'obs_design',
          observedAt: '2026-05-04T16:00:00.000Z',
          summary:
            'Reading the Flow Task Extraction Repair design notes in Chrome.',
          activityType: 'research',
          taskHypothesis: 'Task Extraction Repair',
          apps: ['Google Chrome'],
          repos: ['flow'],
          tickets: ['FLOW-123'],
          documents: ['Task Extraction Repair notes'],
        },
        {
          id: 'obs_code',
          observedAt: '2026-05-04T16:04:00.000Z',
          summary:
            'Editing runTaskEngineForObservation.ts for the Flow Task Extraction Repair.',
          activityType: 'coding',
          taskHypothesis: 'Task Extraction Repair',
          apps: ['Cursor'],
          repos: ['flow'],
          tickets: ['FLOW-123'],
          documents: ['runTaskEngineForObservation.ts'],
        },
        {
          id: 'obs_test',
          observedAt: '2026-05-04T16:08:00.000Z',
          summary:
            'Running the Flow task grouping tests for the Task Extraction Repair in Terminal.',
          activityType: 'coding',
          taskHypothesis: 'Task Extraction Repair',
          apps: ['Terminal'],
          repos: ['flow'],
          tickets: ['FLOW-123'],
          documents: ['taskGroupingRegression.test.ts'],
        },
      ],
      adjudicateBoundary: createScriptedBoundaryAdjudicator({}),
    });

    expect(primaryObservationGroups(result.segments)).toEqual([
      ['obs_design', 'obs_code', 'obs_test'],
    ]);
    expect(result.decisions.map(decision => decision.decision)).toEqual([
      'start_new',
      'join_current',
      'join_current',
    ]);
  });

  test('keeps non-engineering project work together without repos or tickets', async () => {
    const result = await runTaskAccuracyScenario({
      name: 'non engineering project task continuity',
      observations: [
        {
          id: 'obs_deck',
          observedAt: '2026-05-04T16:20:00.000Z',
          summary: 'Editing the Q2 launch deck for the Acme renewal plan.',
          activityType: 'writing',
          taskHypothesis: 'Acme renewal plan',
          apps: ['Keynote'],
          projects: ['Acme renewal'],
          tasks: ['Q2 launch deck'],
          documents: ['Q2 launch deck'],
        },
        {
          id: 'obs_sheet',
          observedAt: '2026-05-04T16:24:00.000Z',
          summary:
            'Checking renewal numbers in a spreadsheet for the Acme renewal plan.',
          activityType: 'research',
          taskHypothesis: 'Acme renewal plan',
          apps: ['Numbers'],
          projects: ['Acme renewal'],
          tasks: ['Q2 launch deck'],
          documents: ['Renewal forecast'],
        },
        {
          id: 'obs_slack',
          observedAt: '2026-05-04T16:28:00.000Z',
          summary:
            'Replying to Priya about next steps for the Acme renewal deck.',
          activityType: 'communication',
          taskHypothesis: 'Acme renewal plan',
          apps: ['Slack'],
          projects: ['Acme renewal'],
          tasks: ['Q2 launch deck'],
          people: ['Priya'],
        },
      ],
      adjudicateBoundary: createScriptedBoundaryAdjudicator({}),
    });

    expect(primaryObservationGroups(result.segments)).toEqual([
      ['obs_deck', 'obs_sheet', 'obs_slack'],
    ]);
    expect(result.decisions.map(decision => decision.decision)).toEqual([
      'start_new',
      'join_current',
      'join_current',
    ]);
  });

  test('holds weak early evidence and reassigns it when later work clarifies the task', async () => {
    const result = await runTaskAccuracyScenario({
      name: 'future evidence workstream assignment',
      observations: [
        {
          id: 'obs_slack_context',
          observedAt: '2026-05-04T16:40:00.000Z',
          summary:
            'Reading a Slack thread about meeting notes being stuck finalizing.',
          activityType: 'communication',
          taskHypothesis: 'new-tech-and-ai channel discussion',
          apps: ['Slack'],
          people: ['Knead Lu'],
        },
        {
          id: 'obs_code_fix',
          observedAt: '2026-05-04T16:44:00.000Z',
          summary:
            'Editing meetingService.ts to fix meeting notes stuck finalizing.',
          activityType: 'coding',
          taskHypothesis: 'Stuck meeting notes finalization',
          apps: ['Cursor'],
          projects: ['Flow meeting notes'],
          tasks: ['Stuck meeting notes finalization'],
          documents: ['meetingService.ts'],
        },
      ],
      adjudicateBoundary: createScriptedBoundaryAdjudicator({}),
    });

    expect(primaryObservationGroups(result.segments)).toEqual([
      ['obs_slack_context', 'obs_code_fix'],
    ]);
    expect(result.decisions.map(decision => decision.decision)).toEqual([
      'hold_pending',
      'start_new',
    ]);
    expect(result.pendingObservationIds).toEqual([]);
  });

  test('does not attach unrelated people research as an interruption to coding work', async () => {
    const result = await runTaskAccuracyScenario({
      name: 'unrelated browsing separates from coding',
      observations: [
        {
          id: 'obs_code',
          observedAt: '2026-05-04T16:50:00.000Z',
          summary: 'Editing CRM assignment webhook code in Cursor.',
          activityType: 'software_development',
          taskHypothesis: 'CRM assignment webhook plan',
          apps: ['Cursor'],
          projects: ['Flow'],
          tasks: ['CRM assignment webhook plan'],
          documents: ['webhook.ts'],
        },
        {
          id: 'obs_people',
          observedAt: '2026-05-04T16:51:00.000Z',
          summary:
            'Viewing Oscar Newman professional profile and resume in a browser.',
          activityType: 'research',
          taskHypothesis: 'Oscar Newman professional profile',
          apps: ['Safari'],
          projects: ['Oscar Newman'],
          tasks: ['Oscar Newman professional profile'],
          documents: ['Oscar Newman resume'],
        },
      ],
      adjudicateBoundary: createScriptedBoundaryAdjudicator({}),
    });

    expect(primaryObservationGroups(result.segments)).toEqual([
      ['obs_code'],
      ['obs_people'],
    ]);
    expect(result.decisions.map(decision => decision.decision)).toEqual([
      'start_new',
      'start_new',
    ]);
  });

  test('splits different tickets into separate primary workstreams', async () => {
    const result = await runTaskAccuracyScenario({
      name: 'same app different ticket split',
      observations: [
        {
          id: 'obs_billing_1',
          observedAt: '2026-05-04T17:00:00.000Z',
          summary: 'Editing the billing webhook retry logic in Cursor.',
          taskHypothesis: 'Billing webhook retry fix',
          apps: ['Cursor'],
          repos: ['flow'],
          tickets: ['FLOW-111'],
          documents: ['billingWebhook.ts'],
        },
        {
          id: 'obs_billing_2',
          observedAt: '2026-05-04T17:04:00.000Z',
          summary: 'Adding tests for the billing webhook retry fix.',
          taskHypothesis: 'Billing webhook retry fix',
          apps: ['Cursor'],
          repos: ['flow'],
          tickets: ['FLOW-111'],
          documents: ['billingWebhook.test.ts'],
        },
        {
          id: 'obs_calendar_1',
          observedAt: '2026-05-04T17:10:00.000Z',
          summary: 'Editing the calendar recurrence editor in Cursor.',
          taskHypothesis: 'Calendar recurrence editor',
          apps: ['Cursor'],
          repos: ['flow'],
          tickets: ['FLOW-222'],
          documents: ['CalendarItemEditor.tsx'],
        },
        {
          id: 'obs_calendar_2',
          observedAt: '2026-05-04T17:14:00.000Z',
          summary: 'Adding tests for calendar recurrence editor validation.',
          taskHypothesis: 'Calendar recurrence editor',
          apps: ['Cursor'],
          repos: ['flow'],
          tickets: ['FLOW-222'],
          documents: ['calendarItems.test.ts'],
        },
      ],
      adjudicateBoundary: createScriptedBoundaryAdjudicator({}),
    });

    expect(result.decisions.map(decision => decision.decision)).toEqual([
      'start_new',
      'join_current',
      'start_new',
      'join_current',
    ]);
    expect(primaryObservationGroups(result.segments)).toEqual([
      ['obs_billing_1', 'obs_billing_2'],
      ['obs_calendar_1', 'obs_calendar_2'],
    ]);
  });

  test('can hold ambiguous supporting context pending and attach it when the task is confirmed', async () => {
    const result = await runTaskAccuracyScenario({
      name: 'pending interruption resolution',
      observations: [
        {
          id: 'obs_impl_1',
          observedAt: '2026-05-04T18:00:00.000Z',
          summary:
            'Implementing the Task Extraction Repair pipeline in timelineService.ts.',
          taskHypothesis: 'Task Extraction Repair',
          apps: ['Cursor'],
          repos: ['flow'],
          tickets: ['FLOW-123'],
          documents: ['timelineService.ts'],
        },
        {
          id: 'obs_slack',
          observedAt: '2026-05-04T18:01:30.000Z',
          summary:
            'Reading a Slack note that mentions FLOW-123 but does not require action yet.',
          activityType: 'communication',
          taskHypothesis: 'Task Extraction Repair follow-up triage',
          apps: ['Slack'],
          repos: ['flow'],
          tickets: ['FLOW-123'],
          people: ['Sam'],
        },
        {
          id: 'obs_impl_2',
          observedAt: '2026-05-04T18:04:00.000Z',
          summary:
            'Back in Cursor wiring Task Extraction Repair tests for timelineService.ts.',
          taskHypothesis: 'Task Extraction Repair',
          apps: ['Cursor'],
          repos: ['flow'],
          tickets: ['FLOW-123'],
          documents: ['timelineService.ts'],
        },
      ],
      adjudicateBoundary: createScriptedBoundaryAdjudicator({
        obs_slack: 'hold_pending',
      }),
    });

    expect(primaryObservationGroups(result.segments)).toEqual([
      ['obs_impl_1', 'obs_slack', 'obs_impl_2'],
    ]);
    expect(result.pendingObservationIds).toEqual([]);
    expect(result.decisions.map(decision => decision.decision)).toEqual([
      'start_new',
      'hold_pending',
      'join_current',
    ]);
    expect(
      result.eventLog.some(
        event =>
          event.type === 'task_pending_resolved' &&
          event.observationIds.includes('obs_slack'),
      ),
    ).toBe(true);
  });
});
