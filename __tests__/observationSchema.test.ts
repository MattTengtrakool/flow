import {
  parseStructuredObservation,
  isStructuredObservation,
} from '../src/observation/schema';
import {createFixtureRatingSummary} from '../src/observation/fixtureSummary';

describe('observation schema', () => {
  test('accepts valid strict observation JSON', () => {
    const parsed = parseStructuredObservation(
      JSON.stringify({
        summary: 'Reviewing a pull request in GitHub.',
        activityType: 'review',
        taskHypothesis: 'Respond to review comments',
        confidence: 0.86,
        sensitivity: 'low',
        sensitivityReason: 'Only routine engineering content is visible.',
        artifacts: ['GitHub pull request'],
        entities: {
          apps: ['Safari'],
          documents: [],
          tickets: ['PAY-193'],
          repos: ['payments-service'],
          urls: ['https://github.com/example/repo/pull/123'],
          people: ['Matt'],
        },
        nextAction: 'Reply to the latest review comment.',
      }),
    );

    expect(isStructuredObservation(parsed)).toBe(true);
    expect(parsed.activityType).toBe('review');
  });

  test('rejects malformed observation JSON', () => {
    expect(() =>
      parseStructuredObservation(
        JSON.stringify({
          summary: 'Missing required fields',
          activityType: 'review',
        }),
      ),
    ).toThrow('expected schema');
  });
});

describe('fixture summary', () => {
  test('averages review scores across rated fixtures', () => {
    const summary = createFixtureRatingSummary([
      {
        id: 'fixture_1',
        label: 'One',
        createdAt: '2026-04-13T10:00:00.000Z',
        imageBase64: 'abc',
        imageMimeType: 'image/png',
        inspection: {} as never,
        capture: {} as never,
        lastRun: null,
        rating: {
          usefulness: 4,
          confidenceCalibration: 3,
          sensitivityHandling: 5,
          notes: '',
          ratedAt: '2026-04-13T10:10:00.000Z',
        },
      },
      {
        id: 'fixture_2',
        label: 'Two',
        createdAt: '2026-04-13T11:00:00.000Z',
        imageBase64: 'def',
        imageMimeType: 'image/png',
        inspection: {} as never,
        capture: {} as never,
        lastRun: null,
        rating: {
          usefulness: 2,
          confidenceCalibration: 5,
          sensitivityHandling: 3,
          notes: '',
          ratedAt: '2026-04-13T11:10:00.000Z',
        },
      },
    ]);

    expect(summary.ratedCount).toBe(2);
    expect(summary.averageUsefulness).toBe(3);
    expect(summary.averageConfidenceCalibration).toBe(4);
    expect(summary.averageSensitivityHandling).toBe(4);
  });
});
