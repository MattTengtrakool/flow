import {
  artifactF1,
  intervalIou,
  runPlannerBenchmark,
} from '../scripts/benchmarkPlanner';

describe('planner benchmark harness', () => {
  test('scores interval overlap', () => {
    expect(
      intervalIou(
        {
          startAt: '2026-04-24T16:00:00.000Z',
          endAt: '2026-04-24T16:20:00.000Z',
        },
        {
          startAt: '2026-04-24T16:10:00.000Z',
          endAt: '2026-04-24T16:30:00.000Z',
        },
      ),
    ).toBeCloseTo(1 / 3);
  });

  test('scores artifact overlap with F1', () => {
    const gold = {
      artifacts: {
        apps: ['Cursor'],
        repositories: ['payments-service'],
        tickets: ['PAY-193'],
        documents: ['retry.ts'],
        urls: [],
        people: [],
      },
    };
    const predicted = {
      artifacts: {
        apps: ['Cursor'],
        repositories: ['payments-service'],
        tickets: ['PAY-193'],
        documents: ['other.ts'],
        urls: [],
        people: [],
      },
    };

    expect(artifactF1(predicted, gold)).toBeCloseTo(0.75);
  });

  test('runs the seeded benchmark case', () => {
    const report = runPlannerBenchmark('benchmarks/cases');

    expect(report.summary.caseCount).toBeGreaterThanOrEqual(1);
    expect(report.summary.blockF1).toBeGreaterThan(0);
    expect(report.cases.map(testCase => testCase.id)).toContain(
      'pay-193-retry-flow',
    );
  });
});
