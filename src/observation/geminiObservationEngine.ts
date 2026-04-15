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

function stripStringLengthConstraints(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schema)) {
    if (key === 'minLength' || key === 'maxLength') {
      continue;
    }

    if (value != null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = stripStringLengthConstraints(
        value as Record<string, unknown>,
      );
    } else if (Array.isArray(value)) {
      result[key] = value.map(item =>
        item != null && typeof item === 'object' && !Array.isArray(item)
          ? stripStringLengthConstraints(item as Record<string, unknown>)
          : item,
      );
    } else {
      result[key] = value;
    }
  }

  return result;
}

const GEMINI_OBSERVATION_SCHEMA = stripStringLengthConstraints(
  STRUCTURED_OBSERVATION_JSON_SCHEMA as unknown as Record<string, unknown>,
);

function buildObservationPrompt(input: ObservationEngineInput): string {
  const recentObservationSummaries = input.recentObservations
    .slice(-3)
    .map(observation => ({
      summary: observation.summary,
      activityType: observation.activityType,
      taskHypothesis: observation.taskHypothesis,
    }));

  const metadata = {
    currentContext: input.currentContext,
    capture: {
      capturedAt: input.capture.capturedAt,
      appName: input.capture.appName,
      bundleIdentifier: input.capture.bundleIdentifier,
      windowTitle: input.capture.windowTitle,
      targetType: input.capture.targetType,
      width: input.capture.width,
      height: input.capture.height,
      frameHash: input.capture.frameHash,
      confidence: input.capture.confidence,
    },
    inspection: {
      chosenTargetType: input.inspection.chosenTargetType,
      confidence: input.inspection.confidence,
      fallbackReason: input.inspection.fallbackReason,
      chosenTarget: input.inspection.chosenTarget,
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
    'Metadata:',
    JSON.stringify(metadata, null, 2),
  ];

  if (input.ocrText != null && input.ocrText.length > 0) {
    lines.push('', 'OCR text extracted from the screenshot:', input.ocrText);
  }

  return lines.join('\n');
}

export async function generateObservation(
  apiKey: string,
  input: ObservationEngineInput,
  model = DEFAULT_OBSERVATION_MODEL,
): Promise<ObservationRun> {
  const trimmedApiKey = apiKey.trim();

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
