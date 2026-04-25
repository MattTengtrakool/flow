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

