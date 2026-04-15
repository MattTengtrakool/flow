import {
  createDomainId,
  createOccurredAt,
  type DomainEvent,
  type TimelineView,
} from '../state/eventLog';
import {TASK_ENGINE_VERSION, type TaskReconciliationResult} from './types';

function mode(values: string[]): string | null {
  if (values.length === 0) {
    return null;
  }

  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
}

function summarizeClosedLineage(timeline: TimelineView, lineageId: string) {
  const lineage = timeline.taskLineagesById[lineageId];
  const segmentIds = lineage?.segmentIds ?? [];
  const segments = segmentIds
    .map(segmentId => timeline.taskSegmentsById[segmentId])
    .filter(Boolean);
  const observations = segmentIds.flatMap(segmentId => {
    const segment = timeline.taskSegmentsById[segmentId];
    return (segment?.observationIds ?? [])
      .map(observationId => timeline.observationsById[observationId])
      .filter(Boolean);
  });

  const summaries = observations
    .map(observation => observation.structured?.summary ?? observation.text)
    .filter(text => text.trim().length > 0)
    .slice(0, 6);
  const repos = observations.flatMap(observation => observation.structured?.entities.repos ?? []);
  const tickets = observations.flatMap(
    observation => observation.structured?.entities.tickets ?? [],
  );
  const documents = observations.flatMap(
    observation => observation.structured?.entities.documents ?? [],
  );
  const commonTicket = mode(tickets);
  const commonRepo = mode(repos);
  const commonDocument = mode(documents);
  const finalTitle =
    (commonTicket != null && commonRepo != null
      ? `${commonTicket} in ${commonRepo}`
      : commonTicket != null
        ? commonTicket
        : commonDocument != null
          ? `Work on ${commonDocument}`
          : lineage?.latestLiveTitle) ??
    timeline.taskSegmentsById[segmentIds[0] ?? '']?.liveTitle ??
    'Completed work';
  const finalSummary =
    summaries.length > 0
      ? summaries.join(' ')
      : lineage?.latestLiveSummary ?? 'Completed a work segment.';
  const mergedSegmentIds = segments
    .filter(
      segment =>
        segment.kind === 'side_branch' &&
        segment.startTime != null &&
        segment.endTime != null &&
        Date.parse(segment.endTime) - Date.parse(segment.startTime) <= 2 * 60 * 1000,
    )
    .map(segment => segment.id);

  return {finalTitle, finalSummary, mergedSegmentIds, segmentIds};
}

export function buildReconciliationEvents(timeline: TimelineView): DomainEvent[] {
  const now = createOccurredAt();
  const events: DomainEvent[] = [];

  for (const lineageId of timeline.taskLineageOrder) {
    const lineage = timeline.taskLineagesById[lineageId];
    if (lineage == null || lineage.state === 'finalized') {
      continue;
    }

    const segments = lineage.segmentIds
      .map(segmentId => timeline.taskSegmentsById[segmentId])
      .filter(Boolean);
    const hasOpenSegment = segments.some(segment =>
      segment.state === 'open' || segment.state === 'candidate' || segment.state === 'branched',
    );

    if (hasOpenSegment || segments.length === 0) {
      continue;
    }

    const {finalTitle, finalSummary, mergedSegmentIds, segmentIds} =
      summarizeClosedLineage(timeline, lineageId);
    const reconciliation: TaskReconciliationResult = {
      id: createDomainId('reconciliation'),
      lineageId,
      segmentIds,
      mergedSegmentIds,
      splitSourceSegmentIds: [],
      finalTitle,
      finalSummary,
      confidence: lineage.confidence,
      supersededDecisionIds: [],
      reviewStatus: 'reviewed',
    };

    events.push({
      id: createDomainId('event'),
      occurredAt: now,
      type: 'task_reconciled',
      reconciliation,
      actor: 'system',
      engineVersion: TASK_ENGINE_VERSION,
      reconciliationRunId: reconciliation.id,
    });
    if (mergedSegmentIds.length > 0) {
      events.push({
        id: createDomainId('event'),
        occurredAt: now,
        type: 'task_merged',
        mergedSegmentIds,
        targetLineageId: lineageId,
        targetSegmentId: segmentIds[0] ?? null,
        summary: 'Short-lived side branches were absorbed during reconciliation.',
        actor: 'system',
        engineVersion: TASK_ENGINE_VERSION,
        reconciliationRunId: reconciliation.id,
      });
    }
    events.push({
      id: createDomainId('event'),
      occurredAt: now,
      type: 'task_summary_generated',
      lineageId,
      segmentId: null,
      title: finalTitle,
      summary: finalSummary,
      final: true,
      actor: 'system',
      engineVersion: TASK_ENGINE_VERSION,
      summaryGenerationId: createDomainId('summary'),
    });
    events.push({
      id: createDomainId('event'),
      occurredAt: now,
      type: 'task_finalized',
      lineageId,
      segmentId: null,
      finalTitle,
      finalSummary,
      confidence: reconciliation.confidence,
      actor: 'system',
      engineVersion: TASK_ENGINE_VERSION,
    });
  }

  return events;
}
