import {
  OBSERVATION_ACTIVITY_TYPES,
  OBSERVATION_SENSITIVITY_LEVELS,
  type StructuredObservation,
} from './types';

export const OBSERVATION_PROMPT_VERSION = '2026-04-13.stage8.v1';

export const STRUCTURED_OBSERVATION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'summary',
    'activityType',
    'taskHypothesis',
    'confidence',
    'sensitivity',
    'sensitivityReason',
    'artifacts',
    'entities',
    'nextAction',
  ],
  properties: {
    summary: {
      type: 'string',
      minLength: 1,
      maxLength: 180,
    },
    activityType: {
      type: 'string',
      enum: [...OBSERVATION_ACTIVITY_TYPES],
    },
    taskHypothesis: {
      type: ['string', 'null'],
      maxLength: 180,
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
    },
    sensitivity: {
      type: 'string',
      enum: [...OBSERVATION_SENSITIVITY_LEVELS],
    },
    sensitivityReason: {
      type: 'string',
      minLength: 1,
      maxLength: 140,
    },
    artifacts: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'string',
        minLength: 1,
        maxLength: 120,
      },
    },
    entities: {
      type: 'object',
      additionalProperties: false,
      required: ['apps', 'documents', 'tickets', 'repos', 'urls', 'people'],
      properties: {
        apps: {
          type: 'array',
          maxItems: 6,
          items: {type: 'string', minLength: 1, maxLength: 120},
        },
        documents: {
          type: 'array',
          maxItems: 6,
          items: {type: 'string', minLength: 1, maxLength: 160},
        },
        tickets: {
          type: 'array',
          maxItems: 6,
          items: {type: 'string', minLength: 1, maxLength: 80},
        },
        repos: {
          type: 'array',
          maxItems: 6,
          items: {type: 'string', minLength: 1, maxLength: 120},
        },
        urls: {
          type: 'array',
          maxItems: 6,
          items: {type: 'string', minLength: 1, maxLength: 240},
        },
        people: {
          type: 'array',
          maxItems: 6,
          items: {type: 'string', minLength: 1, maxLength: 120},
        },
      },
    },
    nextAction: {
      type: ['string', 'null'],
      maxLength: 160,
    },
  },
} as const;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isStructuredObservation(
  value: unknown,
): value is StructuredObservation {
  if (typeof value !== 'object' || value == null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const entities = candidate.entities;

  if (typeof candidate.summary !== 'string' || candidate.summary.trim().length === 0) {
    return false;
  }

  if (
    typeof candidate.activityType !== 'string' ||
    !OBSERVATION_ACTIVITY_TYPES.includes(
      candidate.activityType as (typeof OBSERVATION_ACTIVITY_TYPES)[number],
    )
  ) {
    return false;
  }

  if (
    candidate.taskHypothesis !== null &&
    typeof candidate.taskHypothesis !== 'string'
  ) {
    return false;
  }

  if (
    !isFiniteNumber(candidate.confidence) ||
    candidate.confidence < 0 ||
    candidate.confidence > 1
  ) {
    return false;
  }

  if (
    typeof candidate.sensitivity !== 'string' ||
    !OBSERVATION_SENSITIVITY_LEVELS.includes(
      candidate.sensitivity as (typeof OBSERVATION_SENSITIVITY_LEVELS)[number],
    )
  ) {
    return false;
  }

  if (
    typeof candidate.sensitivityReason !== 'string' ||
    candidate.sensitivityReason.trim().length === 0
  ) {
    return false;
  }

  if (!isStringArray(candidate.artifacts)) {
    return false;
  }

  if (candidate.nextAction !== null && typeof candidate.nextAction !== 'string') {
    return false;
  }

  if (typeof entities !== 'object' || entities == null) {
    return false;
  }

  const entityCandidate = entities as Record<string, unknown>;

  return (
    isStringArray(entityCandidate.apps) &&
    isStringArray(entityCandidate.documents) &&
    isStringArray(entityCandidate.tickets) &&
    isStringArray(entityCandidate.repos) &&
    isStringArray(entityCandidate.urls) &&
    isStringArray(entityCandidate.people)
  );
}

export function parseStructuredObservation(
  rawText: string,
): StructuredObservation {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Observation JSON was not valid JSON: ${error.message}`
        : 'Observation JSON was not valid JSON.',
    );
  }

  if (!isStructuredObservation(parsed)) {
    throw new Error('Observation JSON did not match the expected schema.');
  }

  return parsed;
}
