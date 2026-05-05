import {
  parseStructuredObservation,
  isStructuredObservation,
} from '../src/observation/schema';

describe('observation schema', () => {
  test('accepts valid strict observation JSON', () => {
    const parsed = parseStructuredObservation(
      JSON.stringify({
        summary: 'Reviewing a pull request in GitHub.',
        visibleAction: 'Reviewing a pull request in GitHub.',
        possibleObjective: 'PAY-193 retry flow review',
        possibleProject: 'payments-service',
        possibleTask: 'PAY-193 retry flow',
        activityType: 'code_review',
        taskHypothesis: 'Respond to review comments',
        confidence: 0.86,
        sensitivity: 'low',
        sensitivityReason: 'Only routine engineering content is visible.',
        artifacts: ['GitHub pull request'],
        entities: {
          apps: ['Safari'],
          documents: [],
          projects: ['payments-service'],
          tasks: ['PAY-193 retry flow'],
          tickets: ['PAY-193'],
          repos: ['payments-service'],
          urls: ['https://github.com/example/repo/pull/123'],
          people: ['Matt'],
        },
        nextAction: 'Reply to the latest review comment.',
      }),
    );

    expect(isStructuredObservation(parsed)).toBe(true);
    expect(parsed.activityType).toBe('code_review');
  });

  test('rejects malformed observation JSON', () => {
    expect(() =>
      parseStructuredObservation(
        JSON.stringify({
          summary: 'Missing required fields',
          activityType: 'code_review',
        }),
      ),
    ).toThrow('expected schema');
  });
});
