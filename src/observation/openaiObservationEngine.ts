import {createOccurredAt} from '../state/eventLog';
import type {ObservationEngineInput, ObservationRun} from './types';
import {
  OBSERVATION_PROMPT_VERSION,
  STRUCTURED_OBSERVATION_JSON_SCHEMA,
  parseStructuredObservation,
} from './schema';

const DEFAULT_OBSERVATION_MODEL = 'gpt-5-mini';

type ResponsesApiSuccess = {
  output_text?: string;
  output?: Array<{
    type?: string;
    text?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  error?: {
    message?: string;
  };
};

function extractOutputText(response: ResponsesApiSuccess): string | null {
  if (typeof response.output_text === 'string' && response.output_text.length > 0) {
    return response.output_text;
  }

  const output = Array.isArray(response.output) ? response.output : [];

  for (const item of output) {
    if (typeof item?.text === 'string' && item.text.length > 0) {
      return item.text;
    }

    if (!Array.isArray(item?.content)) {
      continue;
    }

    for (const contentItem of item.content) {
      if (
        contentItem?.type === 'output_text' &&
        typeof contentItem.text === 'string' &&
        contentItem.text.length > 0
      ) {
        return contentItem.text;
      }
    }
  }

  return null;
}

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

  return [
    'You are observing a desktop screenshot for task-tracking.',
    'Return only strict JSON that matches the provided schema.',
    'Base your answer only on visible evidence and supplied metadata.',
    'Do not invent hidden content. Use null or empty arrays when unsure.',
    'Confidence must be between 0 and 1.',
    'Sensitivity should reflect whether the visible content appears routine, somewhat sensitive, or highly sensitive.',
    '',
    'Metadata:',
    JSON.stringify(metadata, null, 2),
  ].join('\n');
}

export async function generateObservationWithOpenAI(
  apiKey: string,
  input: ObservationEngineInput,
  model = DEFAULT_OBSERVATION_MODEL,
): Promise<ObservationRun> {
  const trimmedApiKey = apiKey.trim();

  if (trimmedApiKey.length === 0) {
    throw new Error('An OpenAI API key is required before running observations.');
  }

  const startedAt = Date.now();
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${trimmedApiKey}`,
    },
    body: JSON.stringify({
      model,
      store: false,
      max_output_tokens: 500,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: buildObservationPrompt(input),
            },
            {
              type: 'input_image',
              image_url: `data:${input.imageMimeType};base64,${input.imageBase64}`,
            },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'desktop_observation',
          strict: true,
          schema: STRUCTURED_OBSERVATION_JSON_SCHEMA,
        },
      },
    }),
  });

  const payload = (await response.json()) as ResponsesApiSuccess;

  if (!response.ok) {
    throw new Error(
      payload.error?.message ??
        `Observation request failed with status ${response.status}.`,
    );
  }

  const outputText = extractOutputText(payload);

  if (outputText == null) {
    throw new Error('The observation response did not include any JSON text.');
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
