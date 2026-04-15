import type {
  CaptureInspectionPayload,
  CaptureMetadataPayload,
  ContextSnapshotPayload,
} from '../types/contextCapture';

export const OBSERVATION_ACTIVITY_TYPES = [
  'coding',
  'research',
  'review',
  'writing',
  'communication',
  'planning',
  'browsing',
  'file_management',
  'meeting',
  'other',
] as const;

export const OBSERVATION_SENSITIVITY_LEVELS = [
  'low',
  'medium',
  'high',
] as const;

export type ObservationActivityType =
  (typeof OBSERVATION_ACTIVITY_TYPES)[number];

export type ObservationSensitivity =
  (typeof OBSERVATION_SENSITIVITY_LEVELS)[number];

export type StructuredObservation = {
  summary: string;
  activityType: ObservationActivityType;
  taskHypothesis: string | null;
  confidence: number;
  sensitivity: ObservationSensitivity;
  sensitivityReason: string;
  artifacts: string[];
  entities: {
    apps: string[];
    documents: string[];
    tickets: string[];
    repos: string[];
    urls: string[];
    people: string[];
  };
  nextAction: string | null;
};

export type ObservationRun = {
  model: string;
  promptVersion: string;
  generatedAt: string;
  durationMs: number;
  observation: StructuredObservation;
};

export type ObservationEngineInput = {
  imageBase64: string;
  imageMimeType: string;
  ocrText: string | null;
  inspection: CaptureInspectionPayload;
  capture: CaptureMetadataPayload;
  currentContext: ContextSnapshotPayload | null;
  recentObservations: StructuredObservation[];
};

export type ObservationSettings = {
  apiKey: string;
  model: string;
  savedAt: string | null;
};

export const WORKFLOW_RECORDING_CAPTURE_MODES = ['automatic', 'manual'] as const;

export type WorkflowRecordingCaptureMode =
  (typeof WORKFLOW_RECORDING_CAPTURE_MODES)[number];

export const WORKFLOW_RECORDING_STATUSES = ['recording', 'completed'] as const;

export type WorkflowRecordingStatus =
  (typeof WORKFLOW_RECORDING_STATUSES)[number];

export const WORKFLOW_STEP_EXPECTATION_KINDS = [
  'same_task',
  'switch_task',
  'resume_task',
  'temporary_interruption',
] as const;

export type WorkflowStepExpectationKind =
  (typeof WORKFLOW_STEP_EXPECTATION_KINDS)[number];

export type WorkflowStepTaskDebug = {
  decisionId: string | null;
  decision: string | null;
  decisionMode: string | null;
  targetSegmentId: string | null;
  targetLineageId: string | null;
  reasonCodes: string[];
  reasonText: string | null;
  confidence: number | null;
  usedLlm: boolean;
  eventIds: string[];
};

export type WorkflowStepExpectation = {
  expectedKind: WorkflowStepExpectationKind | null;
  expectedDecision: string | null;
  note: string;
  importance: 'low' | 'medium' | 'high';
  labeledAt: string | null;
};

export type WorkflowReplayStepResult = {
  stepId: string;
  observationId: string;
  decision: string | null;
  decisionMode: string | null;
  targetSegmentId: string | null;
  targetLineageId: string | null;
  reasonCodes: string[];
  matchedExpectation: boolean | null;
  mismatchReason: string | null;
};

export type WorkflowReplayRecord = {
  replayedAt: string;
  stepResults: WorkflowReplayStepResult[];
  matchedCount: number;
  mismatchedCount: number;
  unlabeledCount: number;
};

export type WorkflowRecordingStep = {
  id: string;
  label: string;
  recordedAt: string;
  imageBase64: string;
  imageMimeType: string;
  inspection: CaptureInspectionPayload;
  capture: CaptureMetadataPayload;
  ocrText: string | null;
  recordedObservationId: string | null;
  recordedObservation: ObservationRun | null;
  recordedTaskDebug: WorkflowStepTaskDebug | null;
  expectation: WorkflowStepExpectation;
};

export type WorkflowRecordingRecord = {
  id: string;
  label: string;
  description: string;
  tags: string[];
  createdAt: string;
  startedAt: string;
  completedAt: string | null;
  captureMode: WorkflowRecordingCaptureMode;
  status: WorkflowRecordingStatus;
  steps: WorkflowRecordingStep[];
  lastReplay: WorkflowReplayRecord | null;
};

export type ObservationFixtureRating = {
  usefulness: number | null;
  confidenceCalibration: number | null;
  sensitivityHandling: number | null;
  notes: string;
  ratedAt: string | null;
};

export type ObservationFixtureRecord = {
  id: string;
  label: string;
  createdAt: string;
  imageBase64: string;
  imageMimeType: string;
  inspection: CaptureInspectionPayload;
  capture: CaptureMetadataPayload;
  lastRun: ObservationRun | null;
  rating: ObservationFixtureRating | null;
};

export type FixtureRatingSummary = {
  ratedCount: number;
  averageUsefulness: number | null;
  averageConfidenceCalibration: number | null;
  averageSensitivityHandling: number | null;
};
