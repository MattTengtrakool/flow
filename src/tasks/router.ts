import {DEFAULT_TASK_ENGINE_POLICY, type TaskEnginePolicy} from './policy';
import type {
  TaskCandidateSummary,
  TaskDecisionMode,
  TaskFeatureSnapshot,
} from './types';

export type RoutedTaskDecision = {
  decision: TaskCandidateSummary;
  decisionMode: TaskDecisionMode;
  shouldCallLlm: boolean;
};

export function routeTaskCandidates(args: {
  candidates: TaskCandidateSummary[];
  featureSnapshot?: TaskFeatureSnapshot | null;
  policy?: TaskEnginePolicy;
}): RoutedTaskDecision {
  const policy = args.policy ?? DEFAULT_TASK_ENGINE_POLICY;
  const [topCandidate, secondCandidate] = args.candidates;
  const features = args.featureSnapshot ?? null;
  const scoreGap =
    topCandidate != null && secondCandidate != null
      ? topCandidate.score - secondCandidate.score
      : 1;
  const crossAppWorkflowAmbiguity =
    features != null &&
    !features.recentAppMatch &&
    features.workflowContinuityHint &&
    topCandidate != null &&
    topCandidate.score < 0.9;

  if (
    topCandidate == null ||
    topCandidate.decision === 'hold_pending' ||
    topCandidate.decision === 'branch_side_task' ||
    crossAppWorkflowAmbiguity ||
    (topCandidate.score >= policy.ambiguityBandLow &&
      topCandidate.score <= policy.ambiguityBandHigh &&
      scoreGap < 0.2)
  ) {
    return {
      decision:
        topCandidate ??
        ({
          decision: 'hold_pending',
          targetSegmentId: null,
          targetLineageId: null,
          score: 0,
          reasonCodes: ['no_candidates'],
          summary: 'No candidate was available, so the observation is held pending.',
        } as TaskCandidateSummary),
      decisionMode: 'hybrid',
      shouldCallLlm: true,
    };
  }

  return {
    decision: topCandidate,
    decisionMode: 'deterministic',
    shouldCallLlm: false,
  };
}
