import {ANTHROPIC_API_KEY} from '@env';

import {OBSERVATION_ACTIVITY_TYPES} from '../../observation/types';
import {sampleObservationIds} from '../condenseObservations';
import {
  buildReplanPrompt,
  coerceBlocks,
  expandClusterIds,
  sleep,
  type GeminiReplanInput,
  type GeminiReplanRawBlock,
  type GeminiReplanResult,
  type ParsedReplanBlock,
} from './geminiReplanEngine';
import {
  PLANNER_PROMPT_VERSION,
  type PlanUsage,
} from '../types';

export const DEFAULT_ANTHROPIC_REPLAN_MODEL = 'claude-sonnet-4-5-20250929';

const MAX_SOURCE_OBSERVATIONS_PER_BLOCK = 40;
const ANTHROPIC_MAX_TOKENS = 16000;

const TRANSIENT_RETRY_ATTEMPTS = 3;
const TRANSIENT_RETRY_BASE_DELAY_MS = 1500;
const TRANSIENT_RETRY_MAX_DELAY_MS = 12000;

const WORKLOG_LABELS = [
  'worked_on',
  'reviewed',
  'drafted',
  'likely_completed',
  'confirmed_completed',
] as const;

const CATEGORY_VALUES = [...OBSERVATION_ACTIVITY_TYPES, 'other'] as const;

const REPLAN_TOOL_INPUT_SCHEMA = {
  type: 'object',
  required: ['blocks'],
  properties: {
    blocks: {
      type: 'array',
      items: {
        type: 'object',
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
          startAt: {type: 'string'},
          endAt: {type: 'string'},
          headline: {type: 'string'},
          narrative: {type: 'string'},
          notes: {type: 'string'},
          label: {type: 'string', enum: [...WORKLOG_LABELS]},
          category: {type: 'string', enum: [...CATEGORY_VALUES]},
          confidence: {type: 'number'},
          keyActivities: {type: 'array', items: {type: 'string'}},
          artifacts: {
            type: 'object',
            required: [
              'apps',
              'repositories',
              'urls',
              'tickets',
              'documents',
              'people',
            ],
            properties: {
              apps: {type: 'array', items: {type: 'string'}},
              repositories: {type: 'array', items: {type: 'string'}},
              urls: {type: 'array', items: {type: 'string'}},
              tickets: {type: 'array', items: {type: 'string'}},
              documents: {type: 'array', items: {type: 'string'}},
              people: {type: 'array', items: {type: 'string'}},
            },
          },
          reasonCodes: {type: 'array', items: {type: 'string'}},
          sourceClusterIds: {type: 'array', items: {type: 'string'}},
        },
      },
    },
  },
} as const;

type AnthropicContentBlock =
  | {type: 'text'; text: string}
  | {
      type: 'tool_use';
      name: string;
      input: unknown;
    };

type AnthropicResponse = {
  content?: AnthropicContentBlock[];
  stop_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  error?: {
    type?: string;
    message?: string;
  };
};

export class AnthropicRetryableError extends Error {
  readonly status: number;
  readonly kind: 'overloaded' | 'rate_limited';
  constructor(message: string, status: number, kind: 'overloaded' | 'rate_limited') {
    super(message);
    this.name = 'AnthropicRetryableError';
    this.status = status;
    this.kind = kind;
  }
}

export async function generateReplanBlocksWithAnthropic(
  input: GeminiReplanInput,
): Promise<GeminiReplanResult> {
  const apiKey = (input.apiKey ?? ANTHROPIC_API_KEY ?? '').trim();
  if (apiKey.length === 0) {
    throw new Error(
      'An Anthropic API key is required to use the Claude fallback. Set ANTHROPIC_API_KEY in .env.',
    );
  }

  const model = input.model ?? DEFAULT_ANTHROPIC_REPLAN_MODEL;
  const prompt = buildReplanPrompt(input);
  const startedAt = Date.now();

  const response = await callAnthropicWithRetries({
    apiKey,
    model,
    prompt,
  });

  const parsed = parseAnthropicResponse(response);
  const expanded = expandClusterIdsWithCap(parsed, input);

  const usage: PlanUsage | undefined =
    response.usage != null
      ? {
          provider: 'anthropic',
          inputTokens: response.usage.input_tokens ?? 0,
          outputTokens: response.usage.output_tokens ?? 0,
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

async function callAnthropicWithRetries(args: {
  apiKey: string;
  model: string;
  prompt: string;
}): Promise<AnthropicResponse> {
  let lastTransientError: AnthropicRetryableError | null = null;
  for (let attempt = 0; attempt < TRANSIENT_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await callAnthropicOnce(args);
    } catch (error) {
      if (!(error instanceof AnthropicRetryableError)) {
        throw error;
      }
      lastTransientError = error;
      if (attempt === TRANSIENT_RETRY_ATTEMPTS - 1) break;
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
  throw new Error('Anthropic replan request failed for unknown reasons.');
}

async function callAnthropicOnce(args: {
  apiKey: string;
  model: string;
  prompt: string;
}): Promise<AnthropicResponse> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': args.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: args.model,
      max_tokens: ANTHROPIC_MAX_TOKENS,
      temperature: 0.3,
      tools: [
        {
          name: 'submit_task_plan',
          description:
            'Submit the structured task-block plan for the current window.',
          input_schema: REPLAN_TOOL_INPUT_SCHEMA,
        },
      ],
      tool_choice: {type: 'tool', name: 'submit_task_plan'},
      messages: [
        {
          role: 'user',
          content: args.prompt,
        },
      ],
    }),
  });

  const payload = (await response.json()) as AnthropicResponse;

  if (!response.ok) {
    const message =
      payload.error?.message ??
      `Anthropic replan request failed with status ${response.status}.`;

    if (response.status === 429 || /rate[- ]?limit/i.test(message)) {
      throw new AnthropicRetryableError(message, response.status, 'rate_limited');
    }
    if (
      response.status === 503 ||
      response.status === 502 ||
      response.status === 529 ||
      /overload|unavailable|high demand|try again later/i.test(message)
    ) {
      throw new AnthropicRetryableError(message, response.status, 'overloaded');
    }
    throw new Error(message);
  }

  return payload;
}

function parseAnthropicResponse(response: AnthropicResponse): ParsedReplanBlock[] {
  const toolBlock = response.content?.find(
    (block): block is Extract<AnthropicContentBlock, {type: 'tool_use'}> =>
      block.type === 'tool_use' && block.name === 'submit_task_plan',
  );

  if (toolBlock == null) {
    if (response.stop_reason === 'max_tokens') {
      throw new Error(
        'Claude hit the output token ceiling before finishing the plan.',
      );
    }
    const textBlock = response.content?.find(
      (block): block is Extract<AnthropicContentBlock, {type: 'text'}> =>
        block.type === 'text',
    );
    const preview = textBlock != null ? textBlock.text.slice(0, 240) : '';
    throw new Error(
      `Claude did not submit a tool_use response (stop_reason: ${
        response.stop_reason ?? 'unknown'
      }). ${preview.length > 0 ? `Preview: ${preview}` : ''}`.trim(),
    );
  }

  return coerceBlocks(
    toolBlock.input,
    JSON.stringify(toolBlock.input),
    response.stop_reason,
  );
}

function expandClusterIdsWithCap(
  parsed: ParsedReplanBlock[],
  input: GeminiReplanInput,
): GeminiReplanRawBlock[] {
  const expanded = expandClusterIds(parsed, input.clusters);
  return expanded.map(block => ({
    ...block,
    sourceObservationIds: sampleObservationIds(
      block.sourceObservationIds,
      MAX_SOURCE_OBSERVATIONS_PER_BLOCK,
    ),
  }));
}
