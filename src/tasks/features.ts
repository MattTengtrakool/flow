import type {ObservationView} from '../state/eventLog';
import type {
  TaskEntityMemory,
  TaskFeatureSnapshot,
  TaskLineageView,
  TaskSegmentView,
} from './types';

function tokenize(value: string | null | undefined): string[] {
  if (value == null) {
    return [];
  }

  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map(token => token.trim())
    .filter(token => token.length > 1);
}

function overlapCount(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const rightSet = new Set(right.map(value => value.toLowerCase()));
  return left.filter(value => rightSet.has(value.toLowerCase())).length;
}

function normalizedOverlap(left: string[], right: string[]): number {
  const count = overlapCount(left, right);
  const denominator = Math.max(left.length, right.length, 1);
  return count / denominator;
}

function boundedOverlapCount(value: number): number {
  return Math.min(1, value);
}

function toObservationEntityMemory(observation: ObservationView): TaskEntityMemory {
  const structured = observation.structured;

  return {
    apps: structured?.entities.apps ?? [],
    repos: structured?.entities.repos ?? [],
    ticketIds: structured?.entities.tickets ?? [],
    projects: [],
    documents: structured?.entities.documents ?? [],
    people: structured?.entities.people ?? [],
    urls: structured?.entities.urls ?? [],
  };
}

export function mergeEntityMemory(
  base: TaskEntityMemory,
  observation: ObservationView,
): TaskEntityMemory {
  const next = toObservationEntityMemory(observation);

  return {
    apps: Array.from(new Set([...base.apps, ...next.apps])),
    repos: Array.from(new Set([...base.repos, ...next.repos])),
    ticketIds: Array.from(new Set([...base.ticketIds, ...next.ticketIds])),
    projects: Array.from(new Set([...base.projects, ...next.projects])),
    documents: Array.from(new Set([...base.documents, ...next.documents])),
    people: Array.from(new Set([...base.people, ...next.people])),
    urls: Array.from(new Set([...base.urls, ...next.urls])),
  };
}

export function buildTaskFeatureSnapshot(args: {
  observation: ObservationView;
  currentSegment: TaskSegmentView | null;
  currentLineage: TaskLineageView | null;
  interruptionWindowSeconds: number;
  currentSegmentLastObservation?: ObservationView | null;
}): TaskFeatureSnapshot {
  const {
    observation,
    currentSegment,
    currentLineage,
    interruptionWindowSeconds,
    currentSegmentLastObservation = null,
  } = args;
  const observedAtMs = Date.parse(observation.observedAt);
  const segmentLastActiveMs =
    currentSegment != null ? Date.parse(currentSegment.lastActiveTime) : null;
  const lineageLastActiveMs =
    currentLineage != null ? Date.parse(currentLineage.lastActiveTime) : null;
  const summaryTokens = tokenize(observation.structured?.summary ?? observation.text);
  const hypothesisTokens = tokenize(observation.structured?.taskHypothesis ?? null);
  const segmentTokens = tokenize(currentSegment?.liveSummary ?? '');
  const segmentTitleTokens = tokenize(currentSegment?.liveTitle ?? '');
  const recentSegmentApps =
    currentSegmentLastObservation?.structured?.entities.apps ?? [];
  const recentObservationSummaryTokens = tokenize(
    currentSegmentLastObservation?.structured?.summary ??
      currentSegmentLastObservation?.text ??
      '',
  );
  const recentObservationHypothesisTokens = tokenize(
    currentSegmentLastObservation?.structured?.taskHypothesis ?? null,
  );
  const currentApps = currentSegment?.supportingApps ?? [];
  const observationEntities = toObservationEntityMemory(observation);
  const appOverlap = overlapCount(observationEntities.apps, currentApps);
  const repoOverlap = overlapCount(
    observationEntities.repos,
    currentSegment?.entityMemory.repos ?? [],
  );
  const ticketOverlap = overlapCount(
    observationEntities.ticketIds,
    currentSegment?.entityMemory.ticketIds ?? [],
  );
  const documentOverlap = overlapCount(
    observationEntities.documents,
    currentSegment?.entityMemory.documents ?? [],
  );
  const peopleOverlap = overlapCount(
    observationEntities.people,
    currentSegment?.entityMemory.people ?? [],
  );
  const urlOverlap = overlapCount(
    observationEntities.urls,
    currentSegment?.entityMemory.urls ?? [],
  );
  const timeSinceCurrentSegmentSeconds =
    segmentLastActiveMs == null
      ? null
      : Math.max(0, Math.round((observedAtMs - segmentLastActiveMs) / 1000));
  const titleTokenSimilarity = normalizedOverlap(summaryTokens, segmentTitleTokens);
  const summaryTokenSimilarity = normalizedOverlap(
    summaryTokens,
    [...segmentTokens, ...segmentTitleTokens],
  );
  const recentObservationSummarySimilarity = normalizedOverlap(
    summaryTokens,
    recentObservationSummaryTokens,
  );
  const recentObservationHypothesisSimilarity = normalizedOverlap(
    hypothesisTokens,
    recentObservationHypothesisTokens,
  );
  const sameEntityThread =
    repoOverlap > 0 || ticketOverlap > 0 || documentOverlap > 0 || urlOverlap > 0;
  const semanticContinuityScore =
    summaryTokenSimilarity * 0.28 +
    recentObservationSummarySimilarity * 0.18 +
    normalizedOverlap(hypothesisTokens, [...segmentTokens, ...segmentTitleTokens]) * 0.16 +
    recentObservationHypothesisSimilarity * 0.12 +
    (repoOverlap > 0 ? 0.12 : 0) +
    (ticketOverlap > 0 ? 0.1 : 0) +
    (documentOverlap > 0 ? 0.04 : 0);
  const workflowContinuityHint = Boolean(
    sameEntityThread ||
      recentObservationSummarySimilarity >= 0.22 ||
      recentObservationHypothesisSimilarity >= 0.22 ||
      summaryTokenSimilarity >= 0.28 ||
      (sameTaskHypothesisLike(hypothesisTokens, [...segmentTokens, ...segmentTitleTokens]) &&
        appOverlap > 0) ||
      (appOverlap > 0 && observation.structured?.activityType === currentSegmentLastObservation?.structured?.activityType),
  );

  function sameTaskHypothesisLike(left: string[], right: string[]) {
    return left.length > 0 && normalizedOverlap(left, right) >= 0.3;
  }

  return {
    observationId: observation.id,
    timeSinceCurrentSegmentSeconds,
    timeSinceLineageSeconds:
      lineageLastActiveMs == null
        ? null
        : Math.max(0, Math.round((observedAtMs - lineageLastActiveMs) / 1000)),
    recentAppMatch: overlapCount(observationEntities.apps, recentSegmentApps) > 0,
    appSeenInCurrentSegment: appOverlap > 0,
    sameActivityType:
      observation.structured?.activityType != null &&
      currentSegment?.liveSummary != null &&
      tokenize(currentSegment.liveSummary).includes(
        observation.structured.activityType.toLowerCase(),
      ),
    sameWindowTitle: titleTokenSimilarity > 0.5,
    sameTaskHypothesis: sameTaskHypothesisLike(
      hypothesisTokens,
      [...segmentTokens, ...segmentTitleTokens],
    ),
    withinInterruptionTolerance:
      timeSinceCurrentSegmentSeconds != null &&
      timeSinceCurrentSegmentSeconds <= interruptionWindowSeconds,
    summaryTokenSimilarity,
    titleTokenSimilarity,
    recentObservationSummarySimilarity,
    recentObservationHypothesisSimilarity,
    repoOverlap: boundedOverlapCount(repoOverlap),
    ticketOverlap: boundedOverlapCount(ticketOverlap),
    documentOverlap: boundedOverlapCount(documentOverlap),
    peopleOverlap: boundedOverlapCount(peopleOverlap),
    urlOverlap: boundedOverlapCount(urlOverlap),
    appOverlapCount: boundedOverlapCount(appOverlap),
    totalEntityOverlap:
      boundedOverlapCount(repoOverlap) +
      boundedOverlapCount(ticketOverlap) +
      boundedOverlapCount(documentOverlap) +
      boundedOverlapCount(peopleOverlap) +
      boundedOverlapCount(urlOverlap),
    sameEntityThread,
    workflowContinuityHint,
    semanticContinuityScore,
    confidenceDelta: Math.abs((observation.structured?.confidence ?? 0) - (currentSegment?.confidence ?? 0)),
    interruptionWindowSeconds,
  };
}
