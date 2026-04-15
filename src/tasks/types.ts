export const TASK_ENGINE_VERSION = '2026-04-15.hybrid-task-v1';

export type TaskActor = 'system' | 'llm' | 'user';

export type TaskSegmentState =
  | 'candidate'
  | 'open'
  | 'interrupted'
  | 'branched'
  | 'paused'
  | 'closed'
  | 'reconciled'
  | 'finalized';

export type TaskSegmentKind = 'primary' | 'side_branch';

export type TaskDecisionKind =
  | 'join_current'
  | 'start_new'
  | 'resume_lineage'
  | 'mark_interruption'
  | 'branch_side_task'
  | 'hold_pending'
  | 'ignore';

export type TaskDecisionMode = 'deterministic' | 'hybrid' | 'llm' | 'fallback';

export type TaskReviewStatus = 'unreviewed' | 'reviewed' | 'needs_attention';

export type TaskEntityMemory = {
  apps: string[];
  repos: string[];
  ticketIds: string[];
  projects: string[];
  documents: string[];
  people: string[];
  urls: string[];
};

export type TaskInterruptionSegment = {
  startTime: string;
  endTime: string | null;
  reason: string;
};

export type TaskFeatureSnapshot = {
  observationId: string;
  timeSinceCurrentSegmentSeconds: number | null;
  timeSinceLineageSeconds: number | null;
  recentAppMatch: boolean;
  appSeenInCurrentSegment: boolean;
  sameActivityType: boolean;
  sameTaskHypothesis: boolean;
  sameWindowTitle: boolean;
  withinInterruptionTolerance: boolean;
  summaryTokenSimilarity: number;
  titleTokenSimilarity: number;
  recentObservationSummarySimilarity: number;
  recentObservationHypothesisSimilarity: number;
  repoOverlap: number;
  ticketOverlap: number;
  documentOverlap: number;
  peopleOverlap: number;
  urlOverlap: number;
  appOverlapCount: number;
  totalEntityOverlap: number;
  sameEntityThread: boolean;
  workflowContinuityHint: boolean;
  semanticContinuityScore: number;
  confidenceDelta: number;
  interruptionWindowSeconds: number;
};

export type TaskCandidateSummary = {
  decision: TaskDecisionKind;
  targetSegmentId: string | null;
  targetLineageId: string | null;
  score: number;
  reasonCodes: string[];
  summary: string;
};

export type TaskSegmentView = {
  id: string;
  lineageId: string;
  sessionId: string | null;
  state: TaskSegmentState;
  kind: TaskSegmentKind;
  startTime: string;
  endTime: string | null;
  lastActiveTime: string;
  liveTitle: string;
  liveSummary: string;
  finalTitle: string | null;
  finalSummary: string | null;
  observationIds: string[];
  supportingApps: string[];
  entityMemory: TaskEntityMemory;
  interruptionSegments: TaskInterruptionSegment[];
  confidence: number;
  provisional: boolean;
  reviewStatus: TaskReviewStatus;
};

export type TaskLineageView = {
  id: string;
  sessionIds: string[];
  segmentIds: string[];
  state: TaskSegmentState;
  firstStartTime: string;
  lastActiveTime: string;
  latestLiveTitle: string;
  latestLiveSummary: string;
  finalTitle: string | null;
  finalSummary: string | null;
  entityMemory: TaskEntityMemory;
  confidence: number;
  reviewStatus: TaskReviewStatus;
};

export type TaskDecisionView = {
  id: string;
  observationId: string;
  occurredAt: string;
  decision: TaskDecisionKind;
  targetSegmentId: string | null;
  targetLineageId: string | null;
  decisionMode: TaskDecisionMode;
  reasonCodes: string[];
  reasonText: string;
  confidence: number;
  usedLlm: boolean;
  candidateShortlist: TaskCandidateSummary[];
  featureSnapshot: TaskFeatureSnapshot | null;
  stale: boolean;
  errorReason: string | null;
};

export type PendingObservationView = {
  observationId: string;
  bufferedAt: string;
  bufferedUntil: string | null;
  reasonCodes: string[];
  summary: string;
};

export type TaskReconciliationResult = {
  id: string;
  lineageId: string;
  segmentIds: string[];
  mergedSegmentIds: string[];
  splitSourceSegmentIds: string[];
  finalTitle: string;
  finalSummary: string;
  confidence: number;
  supersededDecisionIds: string[];
  reviewStatus: TaskReviewStatus;
};

export type UserTaskCorrectionType =
  | 'merge_confirmed'
  | 'split_confirmed'
  | 'same_task_app_pair_confirmed'
  | 'always_split_transition_confirmed'
  | 'resume_correction_applied';

export type UserTaskCorrection = {
  id: string;
  type: UserTaskCorrectionType;
  segmentIds: string[];
  lineageIds: string[];
  note: string | null;
};

export type TaskEngineInput = {
  observationId: string;
  activeSessionId: string | null;
  currentSegment: TaskSegmentView | null;
  currentLineage: TaskLineageView | null;
  recentSegments: TaskSegmentView[];
  recentLineages: TaskLineageView[];
};

export type TaskEventMetadata = {
  sequenceNumber?: number;
  actor?: TaskActor;
  causedByEventId?: string | null;
  causedByObservationId?: string | null;
  engineVersion?: string;
  model?: string;
  promptVersion?: string;
  schemaVersion?: string;
  decisionForObservationId?: string | null;
  reconciliationRunId?: string | null;
  summaryGenerationId?: string | null;
  lineageResumeAttemptId?: string | null;
  stale?: boolean;
  errorReason?: string | null;
};

export function createEmptyTaskEntityMemory(): TaskEntityMemory {
  return {
    apps: [],
    repos: [],
    ticketIds: [],
    projects: [],
    documents: [],
    people: [],
    urls: [],
  };
}
