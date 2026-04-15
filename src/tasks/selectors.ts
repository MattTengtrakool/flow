import {
  getCurrentPrimaryTaskSegment,
  getCurrentSideBranchSegment,
  getCurrentTaskLineage,
  getPendingObservations,
  getVisibleObservations,
  getTaskDecisions,
  getTaskLineages,
  getTaskSegments,
  type TimelineView,
} from '../state/eventLog';

export {
  getCurrentPrimaryTaskSegment,
  getCurrentSideBranchSegment,
  getCurrentTaskLineage,
  getPendingObservations,
  getVisibleObservations,
  getTaskDecisions,
  getTaskLineages,
  getTaskSegments,
};

export function getRecentTaskDecisions(
  timeline: TimelineView,
  count = 5,
) {
  return getTaskDecisions(timeline).slice(-count).reverse();
}

export function getLastTaskDecisionAt(
  timeline: TimelineView,
): string | null {
  const lastDecision = getTaskDecisions(timeline).at(-1);
  return lastDecision?.occurredAt ?? null;
}

export function getTaskDecisionCount(timeline: TimelineView): number {
  return timeline.taskDecisionOrder.length;
}

export function getRecentTaskObservations(
  timeline: TimelineView,
  count = 6,
) {
  const currentSegment =
    timeline.currentTaskSegmentId != null
      ? timeline.taskSegmentsById[timeline.currentTaskSegmentId] ?? null
      : null;

  if (currentSegment != null && currentSegment.observationIds.length > 0) {
    return currentSegment.observationIds
      .map(observationId => timeline.observationsById[observationId])
      .filter(Boolean)
      .slice(-count)
      .reverse();
  }

  return getVisibleObservations(timeline).slice(-count).reverse();
}
