import {
  createDomainId,
  createOccurredAt,
  replayEventLog,
  type DomainEvent,
  type ObservationAddedEvent,
  type ObservationView,
  type TimelineView,
} from '../state/eventLog';
import {generateObservation} from './geminiObservationEngine';
import {computeTaskEngineMetrics} from '../tasks/metrics';
import {runTaskEngineForObservation, type TaskEngineRunResult} from '../tasks/runTaskEngineForObservation';
import type {
  ObservationEngineInput,
  ObservationRun,
  StructuredObservation,
  WorkflowRecordingRecord,
  WorkflowReplayRecord,
  WorkflowReplayStepResult,
  WorkflowStepExpectation,
  WorkflowStepExpectationKind,
} from './types';

export type WorkflowReplayResult = {
  replay: WorkflowReplayRecord;
  eventLog: DomainEvent[];
  timeline: TimelineView;
  taskMetrics: ReturnType<typeof computeTaskEngineMetrics>;
};

export async function replayWorkflowRecording(args: {
  recording: WorkflowRecordingRecord;
  generateWorkflowObservation?: (
    input: ObservationEngineInput,
  ) => Promise<ObservationRun>;
}): Promise<WorkflowReplayResult> {
  const generateWorkflowObservation =
    args.generateWorkflowObservation ?? generateObservation;
  const sessionId = createDomainId('session');
  let eventLog: DomainEvent[] = [
    {
      id: createDomainId('event'),
      type: 'session_started',
      sessionId,
      title: args.recording.label,
      occurredAt: args.recording.startedAt,
    },
  ];
  let timeline = replayEventLog(eventLog);
  const stepResults: WorkflowReplayStepResult[] = [];
  const recentObservations: StructuredObservation[] = [];

  for (const step of args.recording.steps) {
    const run = await generateWorkflowObservation({
      imageBase64: step.imageBase64,
      imageMimeType: step.imageMimeType,
      ocrText: step.ocrText,
      inspection: step.inspection,
      capture: step.capture,
      currentContext: step.inspection.context,
      recentObservations: recentObservations.slice(-5),
    });

    const observationId = createDomainId('observation');
    const observationEvent: ObservationAddedEvent = {
      id: createDomainId('event'),
      type: 'observation_added',
      observationId,
      sessionId,
      text: run.observation.summary,
      structured: run.observation,
      engineRun: run,
      capturePreviewDataUri: `data:${step.imageMimeType};base64,${step.imageBase64}`,
      occurredAt: step.capture.capturedAt,
    };

    eventLog = [...eventLog, observationEvent];
    timeline = replayEventLog(eventLog);
    recentObservations.push(run.observation);

    const observation = timeline.observationsById[observationId] as ObservationView;
    const taskEngineResult = await runTaskEngineForObservation({
      timeline,
      observation,
      getLatestTimeline: () => timeline,
    });

    if (taskEngineResult != null) {
      eventLog = [...eventLog, ...taskEngineResult.events];
      timeline = replayEventLog(eventLog);
    }

    stepResults.push(
      buildReplayStepResult(step.id, step.expectation, observationId, taskEngineResult),
    );
  }

  const replayedAt = createOccurredAt();
  const matchedCount = stepResults.filter(result => result.matchedExpectation === true).length;
  const mismatchedCount = stepResults.filter(
    result => result.matchedExpectation === false,
  ).length;
  const unlabeledCount = stepResults.filter(
    result => result.matchedExpectation == null,
  ).length;

  return {
    replay: {
      replayedAt,
      stepResults,
      matchedCount,
      mismatchedCount,
      unlabeledCount,
    },
    eventLog,
    timeline,
    taskMetrics: computeTaskEngineMetrics(timeline),
  };
}

export function buildReplayStepResult(
  stepId: string,
  expectation: WorkflowStepExpectation,
  observationId: string,
  taskEngineResult: TaskEngineRunResult | null,
): WorkflowReplayStepResult {
  const actualDecision = taskEngineResult?.selectedCandidate.decision ?? null;
  const comparison = compareWorkflowExpectation(expectation, actualDecision);

  return {
    stepId,
    observationId,
    decision: actualDecision,
    decisionMode: taskEngineResult?.decisionMode ?? null,
    targetSegmentId: taskEngineResult?.selectedCandidate.targetSegmentId ?? null,
    targetLineageId: taskEngineResult?.selectedCandidate.targetLineageId ?? null,
    reasonCodes: taskEngineResult?.selectedCandidate.reasonCodes ?? [],
    matchedExpectation: comparison.matched,
    mismatchReason: comparison.reason,
  };
}

export function compareWorkflowExpectation(
  expectation: WorkflowStepExpectation,
  actualDecision: string | null,
): {matched: boolean | null; reason: string | null} {
  if (
    expectation.expectedKind == null &&
    (expectation.expectedDecision == null || expectation.expectedDecision.length === 0)
  ) {
    return {
      matched: null,
      reason: null,
    };
  }

  if (
    expectation.expectedDecision != null &&
    expectation.expectedDecision.length > 0 &&
    expectation.expectedDecision !== actualDecision
  ) {
    return {
      matched: false,
      reason: `Expected decision ${expectation.expectedDecision} but saw ${actualDecision ?? 'none'}.`,
    };
  }

  if (expectation.expectedKind == null) {
    return {
      matched: true,
      reason: null,
    };
  }

  const expectedDecisions = expectedKindToDecisions(expectation.expectedKind);

  if (actualDecision != null && expectedDecisions.includes(actualDecision)) {
    return {
      matched: true,
      reason: null,
    };
  }

  return {
    matched: false,
    reason: `Expected ${expectation.expectedKind} but saw ${actualDecision ?? 'none'}.`,
  };
}

function expectedKindToDecisions(expectedKind: WorkflowStepExpectationKind): string[] {
  switch (expectedKind) {
    case 'same_task':
      return ['join_current'];
    case 'switch_task':
      return ['start_new', 'branch_side_task'];
    case 'resume_task':
      return ['resume_lineage'];
    case 'temporary_interruption':
      return ['mark_interruption'];
    default:
      return [];
  }
}
