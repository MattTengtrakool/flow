import type {ObservationView, TimelineView} from '../state/eventLog';
import type {TaskDecisionKind} from './types';

export type TaskEnginePolicy = {
  longIdleSeconds: number;
  interruptionToleranceSeconds: number;
  minObservationConfidence: number;
  ambiguityBandLow: number;
  ambiguityBandHigh: number;
};

export type ForcedTaskDecision = {
  decision: TaskDecisionKind;
  reasonCodes: string[];
  reasonText: string;
};

export const DEFAULT_TASK_ENGINE_POLICY: TaskEnginePolicy = {
  longIdleSeconds: 10 * 60,
  interruptionToleranceSeconds: 120,
  minObservationConfidence: 0.45,
  ambiguityBandLow: 0.35,
  ambiguityBandHigh: 0.75,
};

export function evaluateHardConstraints(args: {
  timeline: TimelineView;
  observation: ObservationView;
  policy?: TaskEnginePolicy;
}): ForcedTaskDecision | null {
  const policy = args.policy ?? DEFAULT_TASK_ENGINE_POLICY;
  const {timeline, observation} = args;
  const currentSegment =
    timeline.currentTaskSegmentId != null
      ? timeline.taskSegmentsById[timeline.currentTaskSegmentId] ?? null
      : null;
  const confidence = observation.structured?.confidence ?? 0;

  if (observation.structured == null || confidence < policy.minObservationConfidence) {
    return {
      decision: 'ignore',
      reasonCodes: ['low_observation_confidence'],
      reasonText:
        'The observation is missing structured semantics or falls below the minimum confidence threshold.',
    };
  }

  if (currentSegment == null) {
    return {
      decision: 'start_new',
      reasonCodes: ['no_active_segment'],
      reasonText: 'There is no current primary segment, so the observation starts a new one.',
    };
  }

  if (currentSegment.sessionId !== (observation.sessionId ?? null)) {
    return {
      decision: 'start_new',
      reasonCodes: ['session_boundary'],
      reasonText: 'Segments cannot cross session boundaries, so this observation must start a new segment.',
    };
  }

  const gapSeconds = Math.max(
    0,
    Math.round(
      (Date.parse(observation.observedAt) - Date.parse(currentSegment.lastActiveTime)) / 1000,
    ),
  );

  if (gapSeconds >= policy.longIdleSeconds) {
    return {
      decision: 'start_new',
      reasonCodes: ['long_idle_gap'],
      reasonText:
        'A long idle gap exceeded the policy threshold, so the current segment should close before starting a new one.',
    };
  }

  return null;
}
