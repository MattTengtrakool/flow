import type {
  FixtureRatingSummary,
  ObservationFixtureRecord,
} from './types';

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return Number((total / values.length).toFixed(2));
}

export function createFixtureRatingSummary(
  fixtures: ObservationFixtureRecord[],
): FixtureRatingSummary {
  const ratedFixtures = fixtures.filter(fixture => fixture.rating != null);
  const usefulness = ratedFixtures
    .map(fixture => fixture.rating?.usefulness)
    .filter((value): value is number => value != null);
  const confidenceCalibration = ratedFixtures
    .map(fixture => fixture.rating?.confidenceCalibration)
    .filter((value): value is number => value != null);
  const sensitivityHandling = ratedFixtures
    .map(fixture => fixture.rating?.sensitivityHandling)
    .filter((value): value is number => value != null);

  return {
    ratedCount: ratedFixtures.length,
    averageUsefulness: average(usefulness),
    averageConfidenceCalibration: average(confidenceCalibration),
    averageSensitivityHandling: average(sensitivityHandling),
  };
}
