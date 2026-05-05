import type {ObservationView, TimelineView} from '../timeline/eventLog';
import { isObservationBlockWorthy } from './evidence';
import type {TaskCandidateSummary, TaskFeatureSnapshot} from './types';

function scoreJoinCurrent(features: TaskFeatureSnapshot): number {
  const temporalBoost =
    features.timeSinceCurrentSegmentSeconds == null
      ? 0
      : features.withinInterruptionTolerance
        ? 0.14
        : features.timeSinceCurrentSegmentSeconds <= features.interruptionWindowSeconds * 3
          ? 0.05
          : -0.1;
  const crossAppPenalty =
    features.recentAppMatch || features.workflowContinuityHint ? 0 : 0.08;
  const noEntityPenalty =
    features.sameEntityThread || features.workflowContinuityHint ? 0 : 0.1;
  const weakSemanticPenalty =
    features.semanticContinuityScore < 0.18 && !features.workflowContinuityHint ? 0.08 : 0;
  const workflowBoost =
    features.workflowContinuityHint && !features.recentAppMatch ? 0.12 : 0;

  return Math.max(
    0,
    Math.min(
      1,
      features.semanticContinuityScore * 0.4 +
        features.summaryTokenSimilarity * 0.05 +
        features.titleTokenSimilarity * 0.05 +
        features.projectOverlap * 0.14 +
        features.taskOverlap * 0.18 +
        features.repoOverlap * 0.08 +
        features.ticketOverlap * 0.1 +
        features.documentOverlap * 0.1 +
        features.peopleOverlap * 0.04 +
        features.urlOverlap * 0.04 +
        (features.recentAppMatch ? 0.08 : 0) +
        (features.appSeenInCurrentSegment ? 0.03 : 0) +
        (features.sameWindowTitle ? 0.03 : 0) +
        (features.sameActivityType ? 0.04 : 0) +
        (features.sameTaskHypothesis ? 0.08 : 0) +
        features.recentObservationSummarySimilarity * 0.08 +
        features.recentObservationHypothesisSimilarity * 0.06 +
        workflowBoost +
        temporalBoost -
        Math.min(0.12, features.confidenceDelta * 0.2) -
        crossAppPenalty -
        noEntityPenalty -
        weakSemanticPenalty,
    ),
  );
}

export function buildTaskCandidates(args: {
  timeline: TimelineView;
  observation: ObservationView;
  features: TaskFeatureSnapshot;
}): TaskCandidateSummary[] {
  const {timeline, features} = args;
  const blockWorthy = isObservationBlockWorthy(args.observation);
  const currentSegment =
    timeline.currentTaskSegmentId != null
      ? timeline.taskSegmentsById[timeline.currentTaskSegmentId] ?? null
      : null;
  const currentLineage =
    timeline.currentTaskLineageId != null
      ? timeline.taskLineagesById[timeline.currentTaskLineageId] ?? null
      : null;
  const currentSideBranch =
    timeline.currentSideBranchSegmentId != null
      ? timeline.taskSegmentsById[timeline.currentSideBranchSegmentId] ?? null
      : null;
  const joinScore = Math.min(1, scoreJoinCurrent(features));
  const relatedToCurrent =
    features.hasPrimaryEntityOverlap ||
    features.sameTaskHypothesis ||
    (features.recentAppMatch && features.semanticContinuityScore >= 0.45);
  const recentLineages = timeline.taskLineageOrder
    .slice(-5)
    .map(lineageId => timeline.taskLineagesById[lineageId])
    .filter(lineage => lineage.id !== currentLineage?.id);

  const candidates: TaskCandidateSummary[] = [];

  if (currentSegment != null) {
    candidates.push({
      decision: 'join_current',
      targetSegmentId: currentSegment.id,
      targetLineageId: currentSegment.lineageId,
      score: joinScore,
      reasonCodes: [
        ...(features.recentAppMatch ? ['recent_app_match'] : []),
        ...(features.appSeenInCurrentSegment ? ['app_seen_in_current_segment'] : []),
        ...(features.projectOverlap > 0 ? ['same_project'] : []),
        ...(features.taskOverlap > 0 ? ['same_task'] : []),
        ...(features.repoOverlap > 0 ? ['same_repo'] : []),
        ...(features.ticketOverlap > 0 ? ['same_ticket'] : []),
        ...(features.workflowContinuityHint ? ['workflow_continuity_hint'] : []),
        ...(features.sameTaskHypothesis ? ['same_task_hypothesis'] : []),
      ],
      summary: 'Continue the current primary segment.',
    });

    if (
      features.withinInterruptionTolerance &&
      joinScore < 0.7 &&
      relatedToCurrent
    ) {
      candidates.push({
        decision: 'mark_interruption',
        targetSegmentId: currentSegment.id,
        targetLineageId: currentSegment.lineageId,
        score:
          0.42 +
          (features.recentAppMatch ? 0.08 : 0) +
          (features.sameActivityType ? 0.06 : 0) +
          (features.hasStrongEntityOverlap ? 0.12 : 0) +
          (features.workflowContinuityHint ? 0.1 : 0),
        reasonCodes: [
          'within_interruption_tolerance',
          ...(features.workflowContinuityHint ? ['workflow_continuity_hint'] : []),
          ...(features.hasStrongEntityOverlap ? ['supporting_context'] : []),
        ],
        summary: 'Treat the observation as a brief interruption inside the current segment.',
      });
    }
  }

  if (currentSideBranch != null) {
    const branchScore = Math.max(
      0,
      Math.min(
        1,
        features.semanticContinuityScore * 0.28 +
          features.recentObservationSummarySimilarity * 0.14 +
          features.recentObservationHypothesisSimilarity * 0.12 +
          features.projectOverlap * 0.12 +
          features.taskOverlap * 0.12 +
          features.repoOverlap * 0.08 +
          features.ticketOverlap * 0.08 +
          (features.recentAppMatch ? 0.08 : 0) +
          (features.workflowContinuityHint ? 0.12 : 0) +
          (features.withinInterruptionTolerance ? 0.08 : 0),
      ),
    );

    candidates.push({
      decision: 'branch_side_task',
      targetSegmentId: currentSideBranch.id,
      targetLineageId: currentSideBranch.lineageId,
      score: branchScore,
      reasonCodes: ['existing_side_branch'],
      summary: 'Continue the existing side branch.',
    });
  }

  candidates.push({
    decision: 'start_new',
    targetSegmentId: null,
    targetLineageId: null,
    score:
      !blockWorthy
        ? 0.1
        : features.withinInterruptionTolerance && features.totalEntityOverlap > 0
        ? Math.max(0.1, 0.65 - joinScore)
        : Math.max(
            0.2,
            0.35 +
              (relatedToCurrent ? 0 : 0.08) +
              (!features.hasStrongEntityOverlap && !relatedToCurrent ? 0.14 : 0) +
              (features.semanticContinuityScore < 0.2 && !relatedToCurrent ? 0.14 : 0) -
              joinScore * 0.35,
          ),
    reasonCodes: blockWorthy
      ? ['new_semantic_block']
      : ['candidate_evidence_without_workstream'],
    summary: blockWorthy
      ? 'Start a new primary segment.'
      : 'Hold the observation as evidence until a meaningful workstream is clear.',
  });

  if (recentLineages.length > 0) {
    for (const lineage of recentLineages.slice(0, 3)) {
      const inactivitySeconds = Math.max(
        0,
        Math.round(
          (Date.parse(args.observation.observedAt) - Date.parse(lineage.lastActiveTime)) / 1000,
        ),
      );
      const score =
        0.18 +
        Math.min(
          0.34,
          features.projectOverlap * 0.12 +
            features.taskOverlap * 0.16 +
            features.repoOverlap * 0.08 +
            features.ticketOverlap * 0.1,
        ) +
        (features.sameTaskHypothesis ? 0.1 : 0) +
        features.recentObservationSummarySimilarity * 0.08 +
        (features.workflowContinuityHint ? 0.08 : 0) +
        (inactivitySeconds <= 45 * 60 ? 0.08 : 0);
      candidates.push({
        decision: 'resume_lineage',
        targetSegmentId: null,
        targetLineageId: lineage.id,
        score,
        reasonCodes: [
          'recent_lineage_match',
          ...(features.workflowContinuityHint ? ['workflow_continuity_hint'] : []),
          ...(inactivitySeconds <= 45 * 60 ? ['within_resume_window'] : []),
        ],
        summary: `Resume lineage ${lineage.id}.`,
      });
    }
  }

  if (
    blockWorthy &&
    currentSegment != null &&
    relatedToCurrent &&
    joinScore < 0.45 &&
    !features.withinInterruptionTolerance
  ) {
    candidates.push({
      decision: 'branch_side_task',
      targetSegmentId: null,
      targetLineageId: null,
      score:
        0.32 +
        (features.hasStrongEntityOverlap ? 0.08 : 0) +
        (!features.recentAppMatch ? 0.04 : 0) +
        (features.workflowContinuityHint ? 0.08 : 0),
      reasonCodes: [
        'possible_side_task',
        ...(features.workflowContinuityHint ? ['workflow_continuity_hint'] : []),
        ...(features.recentAppMatch ? [] : ['recent_app_shift']),
      ],
      summary: 'Create a short-lived side branch while waiting for more evidence.',
    });
  }

  candidates.push({
    decision: 'hold_pending',
    targetSegmentId: null,
    targetLineageId: currentSegment?.lineageId ?? null,
    score:
      !blockWorthy || (joinScore >= 0.35 && joinScore <= 0.72 && relatedToCurrent)
        ? 0.52
        : 0.22,
    reasonCodes: ['insufficient_evidence'],
    summary: 'Hold the observation pending until another observation arrives.',
  });

  candidates.push({
    decision: 'ignore',
    targetSegmentId: null,
    targetLineageId: null,
    score: 0.05,
    reasonCodes: ['fallback_ignore'],
    summary: 'Ignore the observation for task structure.',
  });

  return candidates.sort((left, right) => right.score - left.score);
}
