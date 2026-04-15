import {GEMINI_API_KEY} from '@env';

import {
  redactSensitiveText,
  sanitizeCaptureMetadata,
  sanitizeContextSnapshot,
  sanitizeInspection,
} from '../privacy/redaction';
import {createOccurredAt} from '../state/eventLog';
import type {ObservationEngineInput, ObservationRun} from './types';
import {
  OBSERVATION_PROMPT_VERSION,
  STRUCTURED_OBSERVATION_JSON_SCHEMA,
  parseStructuredObservation,
} from './schema';

const DEFAULT_OBSERVATION_MODEL = 'gemini-2.5-flash-lite';

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{text?: string}>;
    };
    finishReason?: string;
  }>;
  error?: {
    message?: string;
    code?: number;
    status?: string;
  };
};

function extractOutputText(response: GeminiResponse): string | null {
  const candidates = response.candidates;

  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  const parts = candidates[0]?.content?.parts;

  if (!Array.isArray(parts)) {
    return null;
  }

  for (const part of parts) {
    if (typeof part?.text === 'string' && part.text.length > 0) {
      return part.text;
    }
  }

  return null;
}

const GEMINI_TYPE_MAP: Record<string, string> = {
  string: 'STRING',
  number: 'NUMBER',
  integer: 'INTEGER',
  boolean: 'BOOLEAN',
  object: 'OBJECT',
  array: 'ARRAY',
};

const UNSUPPORTED_KEYS = new Set([
  'minLength',
  'maxLength',
  'maxItems',
  'additionalProperties',
]);

function toGeminiSchema(
  node: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(node)) {
    if (UNSUPPORTED_KEYS.has(key)) {
      continue;
    }

    if (key === 'type') {
      if (Array.isArray(value)) {
        const types = value.filter(t => t !== 'null');
        const hasNull = value.includes('null');

        if (types.length === 1) {
          result.type = GEMINI_TYPE_MAP[types[0] as string] ?? types[0];
        }

        if (hasNull) {
          result.nullable = true;
        }
      } else if (typeof value === 'string') {
        result.type = GEMINI_TYPE_MAP[value] ?? value;
      } else {
        result.type = value;
      }

      continue;
    }

    if (value != null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = toGeminiSchema(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      result[key] = value.map(item =>
        item != null && typeof item === 'object' && !Array.isArray(item)
          ? toGeminiSchema(item as Record<string, unknown>)
          : item,
      );
    } else {
      result[key] = value;
    }
  }

  return result;
}

const GEMINI_OBSERVATION_SCHEMA = toGeminiSchema(
  STRUCTURED_OBSERVATION_JSON_SCHEMA as unknown as Record<string, unknown>,
);

function buildObservationPrompt(input: ObservationEngineInput): string {
  const sanitizedContext = sanitizeContextSnapshot(input.currentContext);
  const sanitizedCapture = sanitizeCaptureMetadata(input.capture);
  const sanitizedInspection = sanitizeInspection(input.inspection);
  const sanitizedOCRText = redactSensitiveText(input.ocrText);
  const recentObservationSummaries = input.recentObservations
    .slice(-3)
    .map(observation => ({
      summary: redactSensitiveText(observation.summary),
      activityType: observation.activityType,
      taskHypothesis: redactSensitiveText(observation.taskHypothesis),
    }));

  const metadata = {
    currentContext: sanitizedContext,
    capture: {
      capturedAt: sanitizedCapture.capturedAt,
      appName: sanitizedCapture.appName,
      bundleIdentifier: sanitizedCapture.bundleIdentifier,
      windowTitle: sanitizedCapture.windowTitle,
      targetType: sanitizedCapture.targetType,
      width: sanitizedCapture.width,
      height: sanitizedCapture.height,
      frameHash: sanitizedCapture.frameHash,
      confidence: sanitizedCapture.confidence,
      privacyRedaction: sanitizedCapture.privacyRedaction,
    },
    inspection: {
      chosenTargetType: sanitizedInspection.chosenTargetType,
      confidence: sanitizedInspection.confidence,
      fallbackReason: sanitizedInspection.fallbackReason,
      chosenTarget: sanitizedInspection.chosenTarget,
    },
    recentObservations: recentObservationSummaries,
  };

  const lines = [
    'You are observing a desktop screenshot for task-tracking.',
    'Return only strict JSON that matches the provided schema.',
    'Base your answer only on visible evidence and supplied metadata.',
    'Do not invent hidden content. Use null or empty arrays when unsure.',
    'Confidence must be between 0 and 1.',
    'Sensitivity should reflect whether the visible content appears routine, somewhat sensitive, or highly sensitive.',
    '',
    'taskHypothesis: derive this FRESH from visible screen content (window titles, file names, UI elements, visible text).',
    'Do NOT copy a previous taskHypothesis unless the current screenshot clearly shows the same specific work.',
    'If the screen shows a different app, document, or focus than the previous observations, write a NEW hypothesis.',
    'Set taskHypothesis to null when the current task is ambiguous or the screen lacks task-specific context.',
    '',
    'Recent observations are provided for temporal context only — re-evaluate all fields independently based on current evidence.',
    '',
    'Metadata:',
    JSON.stringify(metadata, null, 2),
  ];

  if (sanitizedOCRText != null && sanitizedOCRText.length > 0) {
    lines.push('', 'OCR text extracted from the screenshot:', sanitizedOCRText);
  }

  return lines.join('\n');
}

export async function generateObservation(
  input: ObservationEngineInput,
  model = DEFAULT_OBSERVATION_MODEL,
): Promise<ObservationRun> {
  const trimmedApiKey = (GEMINI_API_KEY ?? '').trim();

  if (trimmedApiKey.length === 0) {
    throw new Error(
      'A Google AI API key is required before running observations.',
    );
  }

  const startedAt = Date.now();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': trimmedApiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: buildObservationPrompt(input),
            },
            {
              inline_data: {
                mime_type: input.imageMimeType,
                data: input.imageBase64,
              },
            },
          ],
        },
      ],
      generationConfig: {
        response_mime_type: 'application/json',
        response_schema: GEMINI_OBSERVATION_SCHEMA,
        max_output_tokens: 4096,
        temperature: 0.4,
      },
    }),
  });

  const payload = (await response.json()) as GeminiResponse;

  if (!response.ok) {
    throw new Error(
      payload.error?.message ??
        `Observation request failed with status ${response.status}.`,
    );
  }

  const finishReason = payload.candidates?.[0]?.finishReason;
  const outputText = extractOutputText(payload);

  if (outputText == null) {
    throw new Error(
      finishReason === 'MAX_TOKENS'
        ? 'The model hit the token limit before producing complete output. Try a higher max_output_tokens.'
        : finishReason === 'SAFETY'
          ? 'The model refused to generate output due to safety filters.'
          : `The observation response did not include any JSON text (finishReason: ${finishReason ?? 'unknown'}).`,
    );
  }

  return {
    model,
    promptVersion: OBSERVATION_PROMPT_VERSION,
    generatedAt: createOccurredAt(),
    durationMs: Date.now() - startedAt,
    observation: parseStructuredObservation(outputText),
  };
}

export {DEFAULT_OBSERVATION_MODEL};
