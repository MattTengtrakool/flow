import {createDomainId, type DomainEvent, type ObservationView, type TimelineView} from '../state/eventLog';
import {buildTaskEventsForDecision} from './applyDecision';
import {buildTaskCandidates} from './candidates';
import {buildTaskFeatureSnapshot} from './features';
import {adjudicateTaskBoundary} from './llmBoundaryEngine';
import {
  DEFAULT_TASK_ENGINE_POLICY,
  evaluateHardConstraints,
  type TaskEnginePolicy,
} from './policy';
import {routeTaskCandidates, type RoutedTaskDecision} from './router';
import {
  getCurrentPrimaryTaskSegment,
  getCurrentTaskLineage,
  getPendingObservations,
  getTaskLineages,
} from './selectors';
import type {TaskCandidateSummary, TaskFeatureSnapshot} from './types';

type TaskEngineLlmDecision = Awaited<ReturnType<typeof adjudicateTaskBoundary>>;

export type TaskEngineRunResult = {
  events: DomainEvent[];
  pendingResolutionEvents: DomainEvent[];
  taskEvents: DomainEvent[];
  candidateShortlist: TaskCandidateSummary[];
  selectedCandidate: TaskCandidateSummary;
  decisionMode: RoutedTaskDecision['decisionMode'];
  featureSnapshot: TaskFeatureSnapshot | null;
  usedLlm: boolean;
  llmMetadata:
    | {model: string; promptVersion: string; schemaVersion: string}
    | null;
  errorReason: string | null;
};

export async function runTaskEngineForObservation(args: {
  timeline: TimelineView;
  observation: ObservationView;
  getLatestTimeline?: () => TimelineView;
  policy?: TaskEnginePolicy;
  adjudicateBoundary?: typeof adjudicateTaskBoundary;
}): Promise<TaskEngineRunResult | null> {
  const policy = args.policy ?? DEFAULT_TASK_ENGINE_POLICY;
  const getLatestTimeline = args.getLatestTimeline ?? (() => args.timeline);
  const adjudicateBoundary = args.adjudicateBoundary ?? adjudicateTaskBoundary;
  const baselineCurrentSegmentId = args.timeline.currentTaskSegmentId;
  const observationId = args.observation.id;

  if (args.timeline.taskDecisionByObservationId[observationId] != null) {
    return null;
  }

  const observation = args.timeline.observationsById[observationId] ?? args.observation;

  if (observation == null || observation.deletedAt != null) {
    return null;
  }

  const currentSegment = getCurrentPrimaryTaskSegment(args.timeline);
  const currentLineage = getCurrentTaskLineage(args.timeline);
  const recentLineages = getTaskLineages(args.timeline).slice(-5);
  const currentSegmentLastObservation =
    currentSegment != null
      ? currentSegment.observationIds
          .map(currentObservationId => args.timeline.observationsById[currentObservationId])
          .filter(Boolean)
          .at(-1) ?? null
      : null;
  const forcedDecision = evaluateHardConstraints({
    timeline: args.timeline,
    observation,
    policy,
  });
  const featureSnapshot = buildTaskFeatureSnapshot({
    observation,
    currentSegment,
    currentLineage,
    interruptionWindowSeconds: policy.interruptionToleranceSeconds,
    currentSegmentLastObservation,
  });

  const candidateShortlist = forcedDecision != null
    ? [
        {
          decision: forcedDecision.decision,
          targetSegmentId: currentSegment?.id ?? null,
          targetLineageId: currentLineage?.id ?? null,
          score: 1,
          reasonCodes: forcedDecision.reasonCodes,
          summary: forcedDecision.reasonText,
        },
      ]
    : buildTaskCandidates({
        timeline: args.timeline,
        observation,
        features: featureSnapshot,
      });

  let routed = routeTaskCandidates({
    candidates: candidateShortlist,
    featureSnapshot,
    policy,
  });
  let selectedCandidate = routed.decision;
  let decisionMode = routed.decisionMode;
  let usedLlm = false;
  let llmMetadata:
    | {model: string; promptVersion: string; schemaVersion: string}
    | null = null;
  let errorReason: string | null = null;

  if (forcedDecision == null && routed.shouldCallLlm) {
    try {
      const llmDecision = await adjudicateBoundary({
        observation,
        currentSegment,
        recentLineages,
        candidates: candidateShortlist,
        features: featureSnapshot,
      });
      selectedCandidate = matchLlmDecisionToCandidate(llmDecision, candidateShortlist);

      const latestTimeline = getLatestTimeline();

      if (
        latestTimeline.taskDecisionByObservationId[observationId] != null ||
        latestTimeline.currentTaskSegmentId !== baselineCurrentSegmentId
      ) {
        selectedCandidate = {
          ...selectedCandidate,
          decision: 'hold_pending',
          targetSegmentId: null,
          targetLineageId: currentLineage?.id ?? null,
          score: 0.4,
          reasonCodes: ['stale_llm_result'],
          summary:
            'The LLM result was superseded by newer live state, so the observation is held pending.',
        };
        decisionMode = 'fallback';
        usedLlm = false;
        errorReason = 'stale_llm_result';
      } else {
        decisionMode = 'llm';
        usedLlm = true;
        llmMetadata = {
          model: llmDecision.model,
          promptVersion: llmDecision.promptVersion,
          schemaVersion: 'task-boundary-v1',
        };
      }
    } catch (error) {
      errorReason =
        error instanceof Error ? error.message : 'Boundary adjudication failed.';
      decisionMode = 'fallback';
      selectedCandidate =
        candidateShortlist.find(candidate => candidate.decision === 'hold_pending') ??
        candidateShortlist[0];
    }
  }

  const pendingObservations = getPendingObservations(args.timeline);
  const decisionEventId =
    selectedCandidate.decision !== 'hold_pending'
      ? createDomainId('task_decision_ref')
      : null;
  const pendingResolutionEvents =
    selectedCandidate.decision !== 'hold_pending' && pendingObservations.length > 0
      ? [
          {
            id: createDomainId('event'),
            occurredAt: observation.observedAt,
            type: 'task_pending_resolved' as const,
            observationIds: pendingObservations.map(
              pendingObservation => pendingObservation.observationId,
            ),
            resolutionDecisionId: decisionEventId,
            actor: 'system' as const,
            causedByObservationId: observation.id,
          },
        ]
      : [];

  const taskEvents = buildTaskEventsForDecision({
    timeline: args.timeline,
    observation,
    selectedCandidate,
    candidateShortlist,
    featureSnapshot,
    decisionMode,
    usedLlm,
    llmMetadata,
    errorReason,
    forcedDecisionId: decisionEventId,
  });

  return {
    events: [...pendingResolutionEvents, ...taskEvents],
    pendingResolutionEvents,
    taskEvents,
    candidateShortlist,
    selectedCandidate,
    decisionMode,
    featureSnapshot,
    usedLlm,
    llmMetadata,
    errorReason,
  };
}

function matchLlmDecisionToCandidate(
  llmDecision: TaskEngineLlmDecision,
  candidates: TaskCandidateSummary[],
): TaskCandidateSummary {
  const matchedCandidate =
    candidates.find(
      candidate =>
        candidate.decision === llmDecision.decision &&
        candidate.targetLineageId === llmDecision.targetLineageId,
    ) ??
    candidates.find(candidate => candidate.decision === llmDecision.decision) ??
    candidates[0];

  return {
    ...matchedCandidate,
    targetSegmentId: llmDecision.targetSegmentId ?? matchedCandidate.targetSegmentId,
    targetLineageId: llmDecision.targetLineageId ?? matchedCandidate.targetLineageId,
    score: llmDecision.confidence,
    summary: llmDecision.reason,
  };
}
