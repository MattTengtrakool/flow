import type {
  ObservationActivityType,
  StructuredObservation,
} from '../observation/types';
import {
  applyEventInPlace,
  createEmptyTimeline,
  getTaskDecisions,
  getTaskSegments,
  type DomainEvent,
  type TimelineView,
} from '../timeline/eventLog';
import type { TaskEnginePolicy } from './policy';
import { runTaskEngineForObservation } from './runTaskEngineForObservation';
import type {
  TaskDecisionKind,
  TaskDecisionMode,
  TaskSegmentKind,
  TaskSegmentState,
} from './types';

type RunTaskEngineArgs = Parameters<typeof runTaskEngineForObservation>[0];

export type TaskBoundaryAdjudicator = NonNullable<
  RunTaskEngineArgs['adjudicateBoundary']
>;

export type TaskAccuracyObservationFixture = {
  id: string;
  observedAt: string;
  summary: string;
  visibleAction?: string | null;
  possibleObjective?: string | null;
  possibleProject?: string | null;
  possibleTask?: string | null;
  activityType?: ObservationActivityType;
  taskHypothesis?: string | null;
  confidence?: number;
  apps?: string[];
  projects?: string[];
  tasks?: string[];
  documents?: string[];
  tickets?: string[];
  repos?: string[];
  urls?: string[];
  people?: string[];
  artifacts?: string[];
  nextAction?: string | null;
};

export type TaskAccuracyScenario = {
  name: string;
  sessionId?: string;
  sessionTitle?: string;
  observations: TaskAccuracyObservationFixture[];
  policy?: TaskEnginePolicy;
  adjudicateBoundary?: TaskBoundaryAdjudicator;
};

export type TaskAccuracySegmentSummary = {
  id: string;
  lineageId: string;
  kind: TaskSegmentKind;
  state: TaskSegmentState;
  title: string;
  summary: string;
  observationIds: string[];
  startTime: string;
  endTime: string | null;
};

export type TaskAccuracyDecisionSummary = {
  observationId: string;
  decision: TaskDecisionKind;
  decisionMode: TaskDecisionMode;
  usedLlm: boolean;
  targetSegmentId: string | null;
  targetLineageId: string | null;
  reasonCodes: string[];
};

export type TaskAccuracyRunResult = {
  scenarioName: string;
  eventLog: DomainEvent[];
  timeline: TimelineView;
  segments: TaskAccuracySegmentSummary[];
  decisions: TaskAccuracyDecisionSummary[];
  pendingObservationIds: string[];
};

export function createScriptedBoundaryAdjudicator(
  script: Record<string, TaskDecisionKind>,
): TaskBoundaryAdjudicator {
  return async args => {
    const requestedDecision =
      script[args.observation.id] ?? args.candidates[0]?.decision;
    const selected = args.candidates.find(
      candidate => candidate.decision === requestedDecision,
    );

    if (selected == null) {
      throw new Error(
        `No candidate '${requestedDecision}' for observation ${args.observation.id}.`,
      );
    }

    return {
      decision: selected.decision,
      targetSegmentId: selected.targetSegmentId,
      targetLineageId: selected.targetLineageId,
      confidence: Math.max(0.8, selected.score),
      reason: `Scripted task accuracy decision: ${selected.decision}.`,
      model: 'task-accuracy-harness',
      promptVersion: 'task-accuracy-harness-v1',
      generatedAt: args.observation.observedAt,
    };
  };
}

export async function runTaskAccuracyScenario(
  scenario: TaskAccuracyScenario,
): Promise<TaskAccuracyRunResult> {
  if (scenario.observations.length === 0) {
    throw new Error(`Scenario '${scenario.name}' has no observations.`);
  }

  const timeline = createEmptyTimeline();
  const eventLog: DomainEvent[] = [];
  const sessionId = scenario.sessionId ?? `${slugify(scenario.name)}_session`;
  const firstObservedAt = scenario.observations[0].observedAt;

  appendEvent(timeline, eventLog, {
    id: `${sessionId}_started`,
    type: 'session_started',
    sessionId,
    title: scenario.sessionTitle ?? scenario.name,
    occurredAt: firstObservedAt,
  });

  for (const fixture of scenario.observations) {
    appendEvent(timeline, eventLog, observationEvent(sessionId, fixture));

    const observation = timeline.observationsById[fixture.id];
    if (observation == null) {
      throw new Error(`Observation '${fixture.id}' was not added to timeline.`);
    }

    const result = await runTaskEngineForObservation({
      timeline,
      observation,
      policy: scenario.policy,
      adjudicateBoundary: scenario.adjudicateBoundary,
      getLatestTimeline: () => timeline,
    });

    if (result != null) {
      appendEvents(timeline, eventLog, result.events);
    }
  }

  return {
    scenarioName: scenario.name,
    eventLog,
    timeline,
    segments: getTaskSegments(timeline).map(segment => ({
      id: segment.id,
      lineageId: segment.lineageId,
      kind: segment.kind,
      state: segment.state,
      title: segment.liveTitle,
      summary: segment.liveSummary,
      observationIds: segment.observationIds.slice(),
      startTime: segment.startTime,
      endTime: segment.endTime,
    })),
    decisions: getTaskDecisions(timeline).map(decision => ({
      observationId: decision.observationId,
      decision: decision.decision,
      decisionMode: decision.decisionMode,
      usedLlm: decision.usedLlm,
      targetSegmentId: decision.targetSegmentId,
      targetLineageId: decision.targetLineageId,
      reasonCodes: decision.reasonCodes.slice(),
    })),
    pendingObservationIds: timeline.pendingObservationOrder.slice(),
  };
}

function appendEvents(
  timeline: TimelineView,
  eventLog: DomainEvent[],
  events: DomainEvent[],
) {
  for (const event of events) {
    appendEvent(timeline, eventLog, event);
  }
}

function appendEvent(
  timeline: TimelineView,
  eventLog: DomainEvent[],
  event: DomainEvent,
) {
  applyEventInPlace(timeline, event);
  eventLog.push(event);
}

function observationEvent(
  sessionId: string,
  fixture: TaskAccuracyObservationFixture,
): DomainEvent {
  const structured = structuredObservation(fixture);
  return {
    id: `${fixture.id}_event`,
    type: 'observation_added',
    observationId: fixture.id,
    sessionId,
    text: structured.summary,
    structured,
    occurredAt: fixture.observedAt,
  };
}

function structuredObservation(
  fixture: TaskAccuracyObservationFixture,
): StructuredObservation {
  const artifacts = fixture.artifacts ?? [
    ...(fixture.projects ?? []),
    ...(fixture.tasks ?? []),
    ...(fixture.repos ?? []),
    ...(fixture.tickets ?? []),
    ...(fixture.documents ?? []),
    ...(fixture.urls ?? []),
  ];

  return {
    summary: fixture.summary,
    visibleAction: fixture.visibleAction ?? fixture.summary,
    possibleObjective: fixture.possibleObjective ?? fixture.taskHypothesis ?? null,
    possibleProject: fixture.possibleProject ?? fixture.projects?.[0] ?? null,
    possibleTask: fixture.possibleTask ?? fixture.tasks?.[0] ?? fixture.taskHypothesis ?? null,
    activityType: fixture.activityType ?? 'coding',
    taskHypothesis: fixture.taskHypothesis ?? null,
    confidence: fixture.confidence ?? 0.9,
    sensitivity: 'low',
    sensitivityReason: 'Synthetic task accuracy harness fixture.',
    artifacts,
    entities: {
      apps: fixture.apps ?? [],
      documents: fixture.documents ?? [],
      projects: fixture.projects ?? [],
      tasks: fixture.tasks ?? [],
      tickets: fixture.tickets ?? [],
      repos: fixture.repos ?? [],
      urls: fixture.urls ?? [],
      people: fixture.people ?? [],
    },
    nextAction: fixture.nextAction ?? null,
  };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
