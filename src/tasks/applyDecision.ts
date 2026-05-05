import {
  createDomainId,
  type DomainEvent,
  type ObservationView,
  type TaskDecisionRecordedEvent,
  type TaskPendingBufferedEvent,
  type TimelineView,
} from '../timeline/eventLog';
import { normalizeProjects, normalizeTasks } from '../workArtifacts';
import { evidenceStateForDecision } from './evidence';
import { mergeEntityMemory } from './features';
import { getObservationPossibleObjective, getObservationPossibleTask } from '../observation/intent';
import { repairTaskTitle } from './title';
import {
  TASK_ENGINE_VERSION,
  createEmptyTaskEntityMemory,
  type TaskCandidateSummary,
  type TaskDecisionMode,
  type TaskDecisionView,
  type TaskFeatureSnapshot,
  type TaskSegmentView,
} from './types';

type ApplyTaskDecisionArgs = {
  timeline: TimelineView;
  observation: ObservationView;
  selectedCandidate: TaskCandidateSummary;
  candidateShortlist: TaskCandidateSummary[];
  featureSnapshot: TaskFeatureSnapshot | null;
  decisionMode: TaskDecisionMode;
  usedLlm: boolean;
  llmMetadata?: {
    model: string;
    promptVersion: string;
    schemaVersion: string;
  } | null;
  errorReason?: string | null;
  forcedDecisionId?: string | null;
  pendingBufferSeconds?: number;
};

function buildLiveTitle(
  observation: ObservationView,
  fallback = 'Working',
): string {
  const structured = observation.structured;
  if (structured != null) {
    return repairTaskTitle({
      title:
        getObservationPossibleTask(structured) ??
        getObservationPossibleObjective(structured),
      artifacts: {
        projects: normalizeProjects(structured.entities),
        tasks: normalizeTasks(structured.entities),
        tickets: structured.entities.tickets,
        repositories: structured.entities.repos,
        urls: structured.entities.urls,
        documents: structured.entities.documents,
      },
      keyActivities: [
        structured.summary,
        ...(structured.nextAction != null ? [structured.nextAction] : []),
      ],
      fallback: fallbackTitleForActivity(structured.activityType, fallback),
      preferAnchors: true,
    });
  }
  return fallback;
}

function fallbackTitleForActivity(
  activityType: string,
  fallback: string,
): string {
  switch (activityType) {
    case 'coding':
    case 'software_development':
      return 'Code task';
    case 'debugging':
      return 'Debugging task';
    case 'qa_testing':
      return 'Testing task';
    case 'research':
      return 'Research task';
    case 'review':
    case 'code_review':
    case 'document_review':
      return 'Review task';
    case 'writing':
      return 'Document task';
    case 'analysis':
      return 'Analysis task';
    case 'learning':
      return 'Learning task';
    case 'design':
      return 'Design task';
    case 'communication':
      return 'Communication thread';
    case 'planning':
    case 'planning_strategy':
      return 'Planning task';
    case 'project_management':
      return 'Project coordination';
    case 'sales_customer':
      return 'Customer work';
    case 'recruiting':
      return 'Recruiting task';
    case 'operations_admin':
      return 'Operations task';
    case 'finance':
      return 'Finance task';
    case 'browsing':
      return 'Browser task';
    case 'file_management':
      return 'File management';
    case 'meeting':
      return 'Meeting';
    default:
      return fallback;
  }
}

function buildLiveSummary(observation: ObservationView): string {
  return observation.structured?.summary ?? observation.text;
}

function addSeconds(value: string, seconds: number): string {
  return new Date(Date.parse(value) + seconds * 1000).toISOString();
}

function createDecisionEvent(args: {
  observation: ObservationView;
  selectedCandidate: TaskCandidateSummary;
  candidateShortlist: TaskCandidateSummary[];
  featureSnapshot: TaskFeatureSnapshot | null;
  decisionMode: TaskDecisionMode;
  usedLlm: boolean;
  errorReason?: string | null;
  llmMetadata?: {
    model: string;
    promptVersion: string;
    schemaVersion: string;
  } | null;
  targetSegmentId: string | null;
  targetLineageId: string | null;
  forcedDecisionId?: string | null;
}): TaskDecisionRecordedEvent {
  const decisionId = args.forcedDecisionId ?? createDomainId('task_decision');
  const decision: TaskDecisionView = {
    id: decisionId,
    observationId: args.observation.id,
    occurredAt: args.observation.observedAt,
    decision: args.selectedCandidate.decision,
    targetSegmentId: args.targetSegmentId,
    targetLineageId: args.targetLineageId,
    decisionMode: args.decisionMode,
    reasonCodes: args.selectedCandidate.reasonCodes,
    reasonText: args.selectedCandidate.summary,
    confidence: args.selectedCandidate.score,
    usedLlm: args.usedLlm,
    candidateShortlist: args.candidateShortlist,
    featureSnapshot: args.featureSnapshot,
    evidenceState: evidenceStateForDecision(args.selectedCandidate.decision),
    stale: false,
    errorReason: args.errorReason ?? null,
  };

  return {
    id: createDomainId('event'),
    occurredAt: args.observation.observedAt,
    type: 'task_decision_recorded',
    decisionId,
    decision,
    actor: args.usedLlm ? 'llm' : 'system',
    causedByObservationId: args.observation.id,
    engineVersion: TASK_ENGINE_VERSION,
    decisionForObservationId: args.observation.id,
    model: args.llmMetadata?.model,
    promptVersion: args.llmMetadata?.promptVersion,
    schemaVersion: args.llmMetadata?.schemaVersion,
    errorReason: args.errorReason ?? null,
  };
}

export function buildTaskEventsForDecision(
  args: ApplyTaskDecisionArgs,
): DomainEvent[] {
  const {
    timeline,
    observation,
    selectedCandidate,
    candidateShortlist,
    featureSnapshot,
    decisionMode,
    usedLlm,
    llmMetadata,
    errorReason,
    forcedDecisionId,
    pendingBufferSeconds = 10 * 60,
  } = args;

  const events: DomainEvent[] = [];
  const currentSegment =
    timeline.currentTaskSegmentId != null
      ? timeline.taskSegmentsById[timeline.currentTaskSegmentId] ?? null
      : null;

  switch (selectedCandidate.decision) {
    case 'join_current': {
      if (currentSegment != null) {
        events.push({
          id: createDomainId('event'),
          occurredAt: observation.observedAt,
          type: 'task_summary_generated',
          lineageId: currentSegment.lineageId,
          segmentId: currentSegment.id,
          title: currentSegment.liveTitle,
          summary: buildLiveSummary(observation),
          final: false,
          actor: 'system',
          causedByObservationId: observation.id,
          engineVersion: TASK_ENGINE_VERSION,
          summaryGenerationId: createDomainId('summary'),
        });
        events.push(
          createDecisionEvent({
            observation,
            selectedCandidate,
            candidateShortlist,
            featureSnapshot,
            decisionMode,
            usedLlm,
            errorReason,
            llmMetadata,
            targetSegmentId: currentSegment.id,
            targetLineageId: currentSegment.lineageId,
            forcedDecisionId,
          }),
        );
      }
      break;
    }

    case 'mark_interruption': {
      if (currentSegment != null) {
        events.push({
          id: createDomainId('event'),
          occurredAt: observation.observedAt,
          type: 'task_interruption_marked',
          segmentId: currentSegment.id,
          interruption: {
            startTime: observation.observedAt,
            endTime: observation.observedAt,
            reason: 'brief interruption',
          },
          actor: usedLlm ? 'llm' : 'system',
          causedByObservationId: observation.id,
          engineVersion: TASK_ENGINE_VERSION,
        });
        events.push({
          id: createDomainId('event'),
          occurredAt: observation.observedAt,
          type: 'task_summary_generated',
          lineageId: currentSegment.lineageId,
          segmentId: currentSegment.id,
          title: currentSegment.liveTitle,
          summary: `${
            currentSegment.liveSummary
          } Brief interruption: ${buildLiveSummary(observation)}`,
          final: false,
          actor: 'system',
          causedByObservationId: observation.id,
          engineVersion: TASK_ENGINE_VERSION,
          summaryGenerationId: createDomainId('summary'),
        });
        events.push(
          createDecisionEvent({
            observation,
            selectedCandidate,
            candidateShortlist,
            featureSnapshot,
            decisionMode,
            usedLlm,
            errorReason,
            llmMetadata,
            targetSegmentId: currentSegment.id,
            targetLineageId: currentSegment.lineageId,
            forcedDecisionId,
          }),
        );
      }
      break;
    }

    case 'start_new': {
      const lineageId = createDomainId('lineage');
      const segmentId = createDomainId('segment');
      if (currentSegment != null && currentSegment.endTime == null) {
        events.push({
          id: createDomainId('event'),
          occurredAt: observation.observedAt,
          type: 'task_segment_closed',
          segmentId: currentSegment.id,
          endTime: observation.observedAt,
          nextState: 'closed',
          actor: 'system',
          causedByObservationId: observation.id,
          engineVersion: TASK_ENGINE_VERSION,
        });
      }

      const segment: TaskSegmentView = {
        id: segmentId,
        lineageId,
        sessionId: observation.sessionId ?? null,
        state: 'open',
        kind: 'primary',
        startTime: observation.observedAt,
        endTime: null,
        lastActiveTime: observation.observedAt,
        liveTitle: buildLiveTitle(observation),
        liveSummary: buildLiveSummary(observation),
        finalTitle: null,
        finalSummary: null,
        observationIds: [],
        supportingApps: observation.structured?.entities.apps ?? [],
        entityMemory: mergeEntityMemory(
          createEmptyTaskEntityMemory(),
          observation,
        ),
        interruptionSegments: [],
        confidence: observation.structured?.confidence ?? 0.5,
        provisional: true,
        reviewStatus: 'unreviewed',
      };

      events.push({
        id: createDomainId('event'),
        occurredAt: observation.observedAt,
        type: 'task_segment_started',
        segment,
        actor: 'system',
        causedByObservationId: observation.id,
        engineVersion: TASK_ENGINE_VERSION,
      });
      events.push(
        createDecisionEvent({
          observation,
          selectedCandidate,
          candidateShortlist,
          featureSnapshot,
          decisionMode,
          usedLlm,
          errorReason,
          llmMetadata,
          targetSegmentId: segmentId,
          targetLineageId: lineageId,
          forcedDecisionId,
        }),
      );
      break;
    }

    case 'resume_lineage': {
      const lineageId =
        selectedCandidate.targetLineageId ?? createDomainId('lineage');
      const segmentId = createDomainId('segment');

      if (currentSegment != null && currentSegment.endTime == null) {
        events.push({
          id: createDomainId('event'),
          occurredAt: observation.observedAt,
          type: 'task_segment_closed',
          segmentId: currentSegment.id,
          endTime: observation.observedAt,
          nextState: 'paused',
          actor: 'system',
          causedByObservationId: observation.id,
          engineVersion: TASK_ENGINE_VERSION,
        });
      }

      const priorLineage = timeline.taskLineagesById[lineageId];
      const segment: TaskSegmentView = {
        id: segmentId,
        lineageId,
        sessionId: observation.sessionId ?? null,
        state: 'open',
        kind: 'primary',
        startTime: observation.observedAt,
        endTime: null,
        lastActiveTime: observation.observedAt,
        liveTitle: buildLiveTitle(
          observation,
          priorLineage?.latestLiveTitle ?? 'Resumed work',
        ),
        liveSummary: buildLiveSummary(observation),
        finalTitle: null,
        finalSummary: null,
        observationIds: [],
        supportingApps: observation.structured?.entities.apps ?? [],
        entityMemory: mergeEntityMemory(
          priorLineage?.entityMemory ?? createEmptyTaskEntityMemory(),
          observation,
        ),
        interruptionSegments: [],
        confidence:
          observation.structured?.confidence ?? priorLineage?.confidence ?? 0.5,
        provisional: true,
        reviewStatus: 'unreviewed',
      };

      events.push({
        id: createDomainId('event'),
        occurredAt: observation.observedAt,
        type: 'task_segment_started',
        segment,
        actor: 'system',
        causedByObservationId: observation.id,
        engineVersion: TASK_ENGINE_VERSION,
      });
      events.push({
        id: createDomainId('event'),
        occurredAt: observation.observedAt,
        type: 'task_lineage_resumed',
        lineageId,
        segmentId,
        sessionId: observation.sessionId ?? null,
        resumedAt: observation.observedAt,
        actor: usedLlm ? 'llm' : 'system',
        causedByObservationId: observation.id,
        engineVersion: TASK_ENGINE_VERSION,
      });
      events.push(
        createDecisionEvent({
          observation,
          selectedCandidate,
          candidateShortlist,
          featureSnapshot,
          decisionMode,
          usedLlm,
          errorReason,
          llmMetadata,
          targetSegmentId: segmentId,
          targetLineageId: lineageId,
          forcedDecisionId,
        }),
      );
      break;
    }

    case 'branch_side_task': {
      const existingBranch =
        selectedCandidate.targetSegmentId != null
          ? timeline.taskSegmentsById[selectedCandidate.targetSegmentId] ?? null
          : null;
      const lineageId = existingBranch?.lineageId ?? createDomainId('lineage');
      const segmentId = existingBranch?.id ?? createDomainId('segment');
      const segment: TaskSegmentView = {
        id: segmentId,
        lineageId,
        sessionId: observation.sessionId ?? null,
        state: existingBranch != null ? 'open' : 'branched',
        kind: 'side_branch',
        startTime: existingBranch?.startTime ?? observation.observedAt,
        endTime: existingBranch?.endTime ?? null,
        lastActiveTime: observation.observedAt,
        liveTitle:
          existingBranch?.liveTitle ?? buildLiveTitle(observation, 'Side task'),
        liveSummary:
          existingBranch != null
            ? `${existingBranch.liveSummary} ${buildLiveSummary(observation)}`
            : buildLiveSummary(observation),
        finalTitle: null,
        finalSummary: null,
        observationIds: existingBranch?.observationIds ?? [],
        supportingApps: Array.from(
          new Set([
            ...(existingBranch?.supportingApps ?? []),
            ...(observation.structured?.entities.apps ?? []),
          ]),
        ),
        entityMemory: mergeEntityMemory(
          existingBranch?.entityMemory ?? createEmptyTaskEntityMemory(),
          observation,
        ),
        interruptionSegments: existingBranch?.interruptionSegments ?? [],
        confidence:
          observation.structured?.confidence ??
          existingBranch?.confidence ??
          0.4,
        provisional: true,
        reviewStatus: 'needs_attention',
      };

      if (existingBranch == null) {
        events.push({
          id: createDomainId('event'),
          occurredAt: observation.observedAt,
          type: 'task_branch_started',
          segment,
          parentSegmentId: currentSegment?.id ?? null,
          parentLineageId: currentSegment?.lineageId ?? null,
          actor: usedLlm ? 'llm' : 'system',
          causedByObservationId: observation.id,
          engineVersion: TASK_ENGINE_VERSION,
        });
      } else {
        events.push({
          id: createDomainId('event'),
          occurredAt: observation.observedAt,
          type: 'task_summary_generated',
          lineageId,
          segmentId,
          title: segment.liveTitle,
          summary: segment.liveSummary,
          final: false,
          actor: 'system',
          causedByObservationId: observation.id,
          engineVersion: TASK_ENGINE_VERSION,
          summaryGenerationId: createDomainId('summary'),
        });
      }
      events.push(
        createDecisionEvent({
          observation,
          selectedCandidate,
          candidateShortlist,
          featureSnapshot,
          decisionMode,
          usedLlm,
          errorReason,
          llmMetadata,
          targetSegmentId: segmentId,
          targetLineageId: lineageId,
          forcedDecisionId,
        }),
      );
      break;
    }

    case 'hold_pending': {
      const pendingEvent: TaskPendingBufferedEvent = {
        id: createDomainId('event'),
        occurredAt: observation.observedAt,
        type: 'task_pending_buffered',
        pendingObservationId: observation.id,
        pendingObservationIds: [observation.id],
        evidenceState: 'candidate_evidence',
        bufferedUntil: addSeconds(observation.observedAt, pendingBufferSeconds),
        reasonCodes: selectedCandidate.reasonCodes,
        summary: buildLiveSummary(observation),
        actor: usedLlm ? 'llm' : 'system',
        causedByObservationId: observation.id,
        engineVersion: TASK_ENGINE_VERSION,
      };
      events.push(pendingEvent);
      events.push(
        createDecisionEvent({
          observation,
          selectedCandidate,
          candidateShortlist,
          featureSnapshot,
          decisionMode,
          usedLlm,
          errorReason,
          llmMetadata,
          targetSegmentId: null,
          targetLineageId: selectedCandidate.targetLineageId,
          forcedDecisionId,
        }),
      );
      break;
    }

    case 'ignore':
    default: {
      events.push(
        createDecisionEvent({
          observation,
          selectedCandidate,
          candidateShortlist,
          featureSnapshot,
          decisionMode,
          usedLlm,
          errorReason,
          llmMetadata,
          targetSegmentId: null,
          targetLineageId: null,
          forcedDecisionId,
        }),
      );
      break;
    }
  }

  return events.map((event, index) => ({
    ...event,
    sequenceNumber:
      timeline.taskDecisionOrder.length +
      timeline.observationOrder.length +
      index +
      1,
  }));
}
