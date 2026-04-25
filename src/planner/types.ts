import type {ObservationActivityType} from '../observation/types';
import type {
  WorklogCalendarBlock,
  WorklogLabel,
  WorklogTaskSummary,
} from '../worklog/types';

export const PLANNER_PROMPT_VERSION = '2026-04-17.planner.v1';

export type PlanBlock = {
  id: string;
  startAt: string;
  endAt: string;
  headline: string;
  narrative: string;
  /**
   * Rich markdown notes for the block — bullet-list prose in the style of
   * meeting-note apps like Granola. Rendered as primary body in the detail
   * panel and editable by the user (edits persist across replans via
   * user_block_notes_edited events keyed on source observation hash).
   *
   * Optional for backwards compatibility with snapshots written before the
   * notes field existed. Missing is treated as empty string.
   */
  notes?: string;
  label: WorklogLabel;
  category: ObservationActivityType | 'other';
  confidence: number;
  keyActivities: string[];
  artifacts: {
    apps: string[];
    repositories: string[];
    urls: string[];
    tickets: string[];
    documents: string[];
    people: string[];
  };
  reasonCodes: string[];
  sourceObservationIds: string[];
};

export function computeBlockNotesKey(sourceObservationIds: string[]): string {
  if (sourceObservationIds.length === 0) return '';
  return sourceObservationIds.slice().sort().join('|');
}

export type PlanUsageProvider = 'gemini' | 'anthropic';

export type PlanUsage = {
  provider: PlanUsageProvider;
  inputTokens: number;
  outputTokens: number;
};

export type TaskPlanSnapshot = {
  snapshotId: string;
  revisedAt: string;
  windowStartAt: string;
  windowEndAt: string;
  sessionId: string | null;
  blocks: PlanBlock[];
  model: string;
  promptVersion: string;
  durationMs: number;
  inputObservationCount: number;
  inputClusterCount: number;
  previousSnapshotId: string | null;
  cause: PlannerRevisionCause;
  usage?: PlanUsage;
};

export type PlannerRevisionCause =
  | 'cadence'
  | 'session_start'
  | 'session_stop'
  | 'manual';

export type PlannerFailureReason =
  | 'missing_api_key'
  | 'engine_error'
  | 'schema_validation_failed'
  | 'transient_overload'
  | 'rate_limited';

export type TaskPlanRevisionFailure = {
  failedAt: string;
  cause: PlannerRevisionCause;
  reason: PlannerFailureReason;
  message: string;
  windowStartAt: string;
  windowEndAt: string;
  inputObservationCount: number;
  inputClusterCount: number;
};

export type CondensedObservationEntry = {
  clusterId: string;
  earliestAt: string;
  latestAt: string;
  occurrenceCount: number;
  taskHypothesis: string | null;
  activityType: ObservationActivityType;
  representativeSummaries: string[];
  nextActions: string[];
  artifacts: {
    apps: string[];
    repositories: string[];
    urls: string[];
    tickets: string[];
    documents: string[];
    people: string[];
  };
  sourceObservationIds: string[];
};

export function mapBlockToWorklogCalendarBlock(
  block: PlanBlock,
): WorklogCalendarBlock {
  const summary: WorklogTaskSummary = {
    headline: block.headline,
    narrative: block.narrative,
    provenance: {
      supportedByObservationIds: block.sourceObservationIds,
      supportedByEvidenceIds: [],
      keyArtifacts: flattenArtifacts(block.artifacts),
      reasonCodes: block.reasonCodes,
    },
  };

  return {
    id: block.id,
    lineageId: block.id,
    segmentIds: [],
    startTime: block.startAt,
    endTime: block.endAt,
    label: block.label,
    confidence: block.confidence,
    title: block.headline,
    summary,
    apps: block.artifacts.apps,
    repos: block.artifacts.repositories,
    tickets: block.artifacts.tickets,
    documents: block.artifacts.documents,
    reasonCodes: block.reasonCodes,
    keyActivities: block.keyActivities,
    category: block.category,
    people: block.artifacts.people,
    urls: block.artifacts.urls,
    notes: block.notes,
    notesKey: computeBlockNotesKey(block.sourceObservationIds),
    continuityLinkage: {
      resumedFromLineageId: null,
      resumedSegmentCount: 0,
    },
    debug: {
      decisionModes: [],
      decisionCount: 0,
      retroAdjusted: false,
    },
  };
}

function flattenArtifacts(
  artifacts: PlanBlock['artifacts'],
): string[] {
  const combined = [
    ...artifacts.repositories,
    ...artifacts.tickets,
    ...artifacts.documents,
    ...artifacts.urls,
    ...artifacts.apps,
    ...artifacts.people,
  ];
  return Array.from(new Set(combined.filter(value => value.trim().length > 0))).slice(0, 12);
}
