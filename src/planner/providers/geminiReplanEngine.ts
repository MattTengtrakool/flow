import { getConfiguredApiKey } from '../../config/apiKeys';
import { buildReplanPrompt } from '../replanPrompt';
import { expandClusterIds, parseReplanResponseSafely } from '../replanResponse';
import {
  CATEGORY_VALUES,
  WORKLOG_LABELS,
  type ParsedReplanBlock,
  type ReplanInput,
  type ReplanRawBlock,
  type ReplanResult,
} from '../replanTypes';
import { sleep } from '../retry';
import { PLANNER_PROMPT_VERSION, type PlanUsage } from '../types';

const TRANSIENT_RETRY_ATTEMPTS = 3;
const TRANSIENT_RETRY_BASE_DELAY_MS = 1_500;
const TRANSIENT_RETRY_MAX_DELAY_MS = 12_000;

export class GeminiRetryableError extends Error {
  readonly status: number;
  readonly kind: 'overloaded' | 'rate_limited';
  constructor(
    message: string,
    status: number,
    kind: 'overloaded' | 'rate_limited',
  ) {
    super(message);
    this.name = 'GeminiRetryableError';
    this.status = status;
    this.kind = kind;
  }
}

export const DEFAULT_PLANNER_MODEL = 'gemini-2.5-flash';

const PLANNER_SCHEMA = {
  type: 'OBJECT',
  required: ['blocks'],
  properties: {
    blocks: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        required: [
          'startAt',
          'endAt',
          'headline',
          'narrative',
          'notes',
          'label',
          'category',
          'confidence',
          'keyActivities',
          'artifacts',
          'reasonCodes',
          'sourceClusterIds',
        ],
        properties: {
          startAt: { type: 'STRING' },
          endAt: { type: 'STRING' },
          taskKey: { type: 'STRING' },
          lineageKey: { type: 'STRING' },
          headline: { type: 'STRING' },
          narrative: { type: 'STRING' },
          notes: { type: 'STRING' },
          label: { type: 'STRING', enum: [...WORKLOG_LABELS] },
          category: { type: 'STRING' },
          confidence: { type: 'NUMBER' },
          keyActivities: {
            type: 'ARRAY',
            items: { type: 'STRING' },
          },
          nextActions: {
            type: 'ARRAY',
            items: { type: 'STRING' },
          },
          calendarEventIds: {
            type: 'ARRAY',
            items: { type: 'STRING' },
          },
          artifacts: {
            type: 'OBJECT',
            required: [
              'apps',
              'projects',
              'tasks',
              'repositories',
              'urls',
              'tickets',
              'documents',
              'people',
            ],
            properties: {
              apps: { type: 'ARRAY', items: { type: 'STRING' } },
              projects: { type: 'ARRAY', items: { type: 'STRING' } },
              tasks: { type: 'ARRAY', items: { type: 'STRING' } },
              repositories: { type: 'ARRAY', items: { type: 'STRING' } },
              urls: { type: 'ARRAY', items: { type: 'STRING' } },
              tickets: { type: 'ARRAY', items: { type: 'STRING' } },
              documents: { type: 'ARRAY', items: { type: 'STRING' } },
              people: { type: 'ARRAY', items: { type: 'STRING' } },
            },
          },
          reasonCodes: {
            type: 'ARRAY',
            items: { type: 'STRING' },
          },
          backgroundObservationIds: {
            type: 'ARRAY',
            items: { type: 'STRING' },
          },
          assignmentReason: { type: 'STRING' },
          timeConfidence: { type: 'NUMBER' },
          sourceClusterIds: {
            type: 'ARRAY',
            items: { type: 'STRING' },
          },
        },
      },
    },
  },
} as const;

export type GeminiReplanInput = ReplanInput;
export type GeminiReplanRawBlock = ReplanRawBlock;
export type GeminiReplanResult = ReplanResult;
export type { ParsedReplanBlock };

export { buildReplanPrompt } from '../replanPrompt';
export {
  coerceBlocks,
  expandClusterIds,
  parseReplanResponseSafely,
} from '../replanResponse';
export { sleep } from '../retry';

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: {
    message?: string;
  };
};

export async function generateReplanBlocks(
  input: GeminiReplanInput,
): Promise<GeminiReplanResult> {
  const apiKey = (input.apiKey ?? getConfiguredApiKey('GEMINI_API_KEY')).trim();
  if (apiKey.length === 0) {
    throw new Error(
      'A Google AI API key is required before running planner revisions.',
    );
  }

  const model = input.model ?? DEFAULT_PLANNER_MODEL;
  const prompt = buildReplanPrompt(input);
  const startedAt = Date.now();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent`;

  const payload = await fetchReplanWithRetries({
    url,
    apiKey,
    prompt,
  });

  const finishReason = payload.candidates?.[0]?.finishReason;
  const outputText = extractOutputText(payload);
  if (outputText == null) {
    throw new Error(
      finishReason === 'MAX_TOKENS'
        ? 'The replan response hit the token limit before finishing.'
        : finishReason === 'SAFETY'
        ? 'The replan response was blocked by safety filters.'
        : `The replan response did not include any JSON text (finishReason: ${
            finishReason ?? 'unknown'
          }).`,
    );
  }

  const parsed = parseReplanResponseSafely(outputText, finishReason);
  const expanded = expandClusterIds(parsed, input.clusters);

  const usage: PlanUsage | undefined =
    payload.usageMetadata != null
      ? {
          provider: 'gemini',
          inputTokens: payload.usageMetadata.promptTokenCount ?? 0,
          outputTokens: payload.usageMetadata.candidatesTokenCount ?? 0,
        }
      : undefined;

  return {
    blocks: expanded,
    model,
    promptVersion: PLANNER_PROMPT_VERSION,
    durationMs: Date.now() - startedAt,
    usage,
  };
}

async function fetchReplanWithRetries(args: {
  url: string;
  apiKey: string;
  prompt: string;
}): Promise<GeminiResponse> {
  let lastTransientError: GeminiRetryableError | null = null;
  for (let attempt = 0; attempt < TRANSIENT_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await fetchReplanOnce(args);
    } catch (error) {
      if (!(error instanceof GeminiRetryableError)) {
        throw error;
      }
      lastTransientError = error;
      if (attempt === TRANSIENT_RETRY_ATTEMPTS - 1) {
        break;
      }
      const delay = Math.min(
        TRANSIENT_RETRY_BASE_DELAY_MS * Math.pow(2, attempt),
        TRANSIENT_RETRY_MAX_DELAY_MS,
      );
      await sleep(delay);
    }
  }
  if (lastTransientError != null) {
    throw lastTransientError;
  }
  throw new Error('Planner request failed for unknown reasons.');
}

async function fetchReplanOnce(args: {
  url: string;
  apiKey: string;
  prompt: string;
}): Promise<GeminiResponse> {
  const response = await fetch(args.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': args.apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: args.prompt }],
        },
      ],
      generationConfig: {
        response_mime_type: 'application/json',
        response_schema: PLANNER_SCHEMA,
        max_output_tokens: 32768,
        temperature: 0.3,
      },
    }),
  });

  const payload = (await response.json()) as GeminiResponse;
  if (!response.ok) {
    const message =
      payload.error?.message ??
      `Planner request failed with status ${response.status}.`;

    if (response.status === 429 || /rate[- ]?limit/i.test(message)) {
      throw new GeminiRetryableError(message, response.status, 'rate_limited');
    }

    if (
      response.status === 503 ||
      response.status === 502 ||
      /overload|unavailable|high demand|try again later/i.test(message)
    ) {
      throw new GeminiRetryableError(message, response.status, 'overloaded');
    }

    throw new Error(message);
  }

  return payload;
}

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
