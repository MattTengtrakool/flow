import type {
  CaptureInspectionPayload,
  CaptureMetadataPayload,
  ContextSnapshotPayload,
} from '../types/contextCapture';

export const OBSERVATION_ACTIVITY_TYPES = [
  'software_development',
  'debugging',
  'qa_testing',
  'code_review',
  'research',
  'analysis',
  'learning',
  'writing',
  'document_review',
  'design',
  'communication',
  'meeting',
  'planning_strategy',
  'project_management',
  'sales_customer',
  'recruiting',
  'operations_admin',
  'finance',
  'browsing',
  'file_management',
  'coding',
  'review',
  'planning',
  'other',
] as const;

export const PREFERRED_OBSERVATION_ACTIVITY_TYPES = [
  'software_development',
  'debugging',
  'qa_testing',
  'code_review',
  'research',
  'analysis',
  'learning',
  'writing',
  'document_review',
  'design',
  'communication',
  'meeting',
  'planning_strategy',
  'project_management',
  'sales_customer',
  'recruiting',
  'operations_admin',
  'finance',
  'browsing',
  'file_management',
  'other',
] as const;

export const OBSERVATION_SENSITIVITY_LEVELS = [
  'low',
  'medium',
  'high',
] as const;

export type ObservationActivityType =
  | (typeof OBSERVATION_ACTIVITY_TYPES)[number]
  | (string & {});

export type ObservationSensitivity =
  (typeof OBSERVATION_SENSITIVITY_LEVELS)[number];

export type StructuredObservation = {
  summary: string;
  visibleAction?: string | null;
  possibleObjective?: string | null;
  possibleProject?: string | null;
  possibleTask?: string | null;
  activityType: ObservationActivityType;
  /**
   * Legacy task-like title. New code should prefer possibleTask /
   * possibleObjective so a single observation does not overclaim the final task.
   */
  taskHypothesis: string | null;
  confidence: number;
  sensitivity: ObservationSensitivity;
  sensitivityReason: string;
  artifacts: string[];
  entities: {
    apps: string[];
    documents: string[];
    projects?: string[];
    tasks?: string[];
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
