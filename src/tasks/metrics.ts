import type {TimelineView} from '../state/eventLog';

export type TaskEngineMetrics = {
  totalDecisions: number;
  llmDecisionPercentage: number;
  fallbackDecisionPercentage: number;
  reviewWorthyPercentage: number;
  finalizedLineageCount: number;
  pendingObservationCount: number;
  interruptionAbsorptionRate: number;
  falseSplitRate: number;
  falseMergeRate: number;
  lineageResumeAccuracy: number;
  llmReversalRate: number;
};

export function computeTaskEngineMetrics(
  timeline: TimelineView,
): TaskEngineMetrics {
  const decisions = timeline.taskDecisionOrder.map(
    decisionId => timeline.taskDecisionsById[decisionId],
  );
  const totalDecisions = decisions.length;
  const llmDecisionCount = decisions.filter(decision => decision.usedLlm).length;
  const fallbackDecisionCount = decisions.filter(
    decision => decision.decisionMode === 'fallback',
  ).length;
  const reviewWorthyCount = timeline.taskLineageOrder
    .map(lineageId => timeline.taskLineagesById[lineageId])
    .filter(lineage => lineage.reviewStatus === 'needs_attention').length;
  const finalizedLineageCount = timeline.taskLineageOrder
    .map(lineageId => timeline.taskLineagesById[lineageId])
    .filter(lineage => lineage.state === 'finalized').length;
  const interruptionMarkedCount = timeline.taskSegmentOrder
    .map(segmentId => timeline.taskSegmentsById[segmentId])
    .reduce((sum, segment) => sum + segment.interruptionSegments.length, 0);
  const shortSideBranchCount = timeline.taskSegmentOrder
    .map(segmentId => timeline.taskSegmentsById[segmentId])
    .filter(segment => segment.kind === 'side_branch').length;
  const mergedSideBranchCount = timeline.taskReconciliationOrder
    .map(reconciliationId => timeline.taskReconciliationsById[reconciliationId])
    .reduce((sum, reconciliation) => sum + reconciliation.mergedSegmentIds.length, 0);
  const resumedLineageCount = timeline.taskDecisionOrder
    .map(decisionId => timeline.taskDecisionsById[decisionId])
    .filter(decision => decision.decision === 'resume_lineage').length;
  const successfulResumeCount = timeline.taskDecisionOrder
    .map(decisionId => timeline.taskDecisionsById[decisionId])
    .filter(
      decision =>
        decision.decision === 'resume_lineage' &&
        decision.targetLineageId != null &&
        decision.errorReason == null,
    ).length;
  const llmDecisionIds = new Set(
    decisions.filter(decision => decision.usedLlm).map(decision => decision.id),
  );
  const llmReversedCount = timeline.taskReconciliationOrder
    .map(reconciliationId => timeline.taskReconciliationsById[reconciliationId])
    .reduce(
      (sum, reconciliation) =>
        sum +
        reconciliation.supersededDecisionIds.filter(decisionId =>
          llmDecisionIds.has(decisionId),
        ).length,
      0,
    );

  return {
    totalDecisions,
    llmDecisionPercentage:
      totalDecisions === 0 ? 0 : llmDecisionCount / totalDecisions,
    fallbackDecisionPercentage:
      totalDecisions === 0 ? 0 : fallbackDecisionCount / totalDecisions,
    reviewWorthyPercentage:
      timeline.taskLineageOrder.length === 0
        ? 0
        : reviewWorthyCount / timeline.taskLineageOrder.length,
    finalizedLineageCount,
    pendingObservationCount: timeline.pendingObservationOrder.length,
    interruptionAbsorptionRate:
      interruptionMarkedCount === 0
        ? 0
        : mergedSideBranchCount / Math.max(interruptionMarkedCount, 1),
    falseSplitRate:
      shortSideBranchCount === 0 ? 0 : mergedSideBranchCount / shortSideBranchCount,
    falseMergeRate:
      finalizedLineageCount === 0
        ? 0
        : timeline.taskLineageOrder
            .map(lineageId => timeline.taskLineagesById[lineageId])
            .filter(lineage => lineage.reviewStatus === 'needs_attention').length /
          finalizedLineageCount,
    lineageResumeAccuracy:
      resumedLineageCount === 0 ? 0 : successfulResumeCount / resumedLineageCount,
    llmReversalRate:
      llmDecisionCount === 0 ? 0 : llmReversedCount / llmDecisionCount,
  };
}
