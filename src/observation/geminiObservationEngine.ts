import { getConfiguredApiKey } from '../config/apiKeys';
import {
  redactSensitiveText,
  sanitizeCaptureMetadata,
  sanitizeContextSnapshot,
  sanitizeInspection,
} from '../privacy/redaction';
import { createOccurredAt } from '../timeline/eventLog';
import type { ObservationEngineInput, ObservationRun } from './types';
import {
  OBSERVATION_PROMPT_VERSION,
  STRUCTURED_OBSERVATION_JSON_SCHEMA,
  parseStructuredObservation,
} from './schema';
import { WORK_CATEGORY_OPTIONS } from '../workCategories';

const DEFAULT_OBSERVATION_MODEL = 'gemini-2.5-flash-lite';

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
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
      visibleAction: redactSensitiveText(observation.visibleAction),
      possibleObjective: redactSensitiveText(observation.possibleObjective),
      possibleProject: redactSensitiveText(observation.possibleProject),
      possibleTask: redactSensitiveText(observation.possibleTask),
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
    'Choose the most specific activityType. Do not use vague legacy labels like "review" or "coding"; use code_review, document_review, software_development, debugging, qa_testing, analysis, etc.',
    `Suggested activity categories: ${WORK_CATEGORY_OPTIONS.map(option => `${option.value}=${option.description}`).join('; ')}. Custom user categories may also be valid if they appear in recent context.`,
    '',
    'Separate visible facts from task inference:',
    '- visibleAction: what the user is visibly doing right now, as an action sentence.',
    '- possibleObjective: the broader likely goal, if visible evidence supports one.',
    '- possibleProject: the broad work container, such as client, account, campaign, product area, course, case, or repo.',
    '- possibleTask: the concrete work item or deliverable, if visible. Use null when the screenshot is just context.',
    '- taskHypothesis is a legacy compatibility field. Set it to possibleTask, then possibleObjective, then null. Do not make it more specific than the evidence.',
    '',
    'Entity extraction should work for any knowledge worker, not only engineers.',
    'Use entities.projects for broad work containers such as clients, accounts, campaigns, launches, courses, cases, repos, or product areas.',
    'Use entities.tasks for the concrete work item such as a named deliverable, ticket, issue, follow-up, candidate loop, invoice, deck, doc, PR, or meeting topic.',
    'Do not treat mechanics as tasks: pushing commits, logging in, opening GitHub, checking localhost, switching branches, or reading a quick status update are usually evidence for the broader task.',
    'Prefer the highest-level visible work object over raw artifact names. For example, use "POS integration status" or "Zeus authentication implementation" instead of "push", "github", "auth.ts", or "owner/agent".',
    'Keep entities.repos and entities.tickets for engineering-specific evidence when visible; also mirror those values into projects/tasks when they identify the broader work.',
    '',
    'possibleTask / taskHypothesis: derive these FRESH from visible screen content (window titles, file names, UI elements, visible text).',
    'Write possibleTask as a short noun phrase that names the work object, not an activity sentence.',
    'Good taskHypothesis examples: "Salesforce OAuth scope issue", "Acme renewal plan", "Q2 launch deck", "Candidate interview loop", "Invoice reconciliation", "Flow CLAUDE.md", "$1B Milestone Launch Recap meeting".',
    'Bad taskHypothesis examples: "Troubleshooting a Salesforce integration error", "Investigating and resolving a data quality issue", "Completing the Receive orders task", "Joining a Zoom meeting".',
    'Do not start possibleTask/taskHypothesis with a gerund or generic verb: Reviewing, Debugging, Troubleshooting, Investigating, Completing, Joining, Discussing, Working.',
    'Put the activity mechanics in summary and nextAction; keep taskHypothesis as the stable noun title.',
    'Do NOT copy a previous taskHypothesis unless the current screenshot clearly shows the same specific work.',
    'If the screen shows a different app, document, or focus than the previous observations, write a NEW hypothesis.',
    'Ignore Flow app chrome and companion/status overlays when naming the task. Labels like "Meeting notes", "Finalizing", "Recording", "Transcribing", "Stop notes", and "Capturing" describe Flow state, not the user task.',
    'If a Flow overlay is visible over another app, name the underlying app/document/task when visible. If only the Flow status overlay has specific text, set taskHypothesis to null.',
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
  apiKey = getConfiguredApiKey('GEMINI_API_KEY'),
): Promise<ObservationRun> {
  const trimmedApiKey = apiKey.trim();

  if (trimmedApiKey.length === 0) {
    throw new Error(
      'A Google AI API key is required before running observations.',
    );
  }

  const startedAt = Date.now();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent`;
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
        : `The observation response did not include any JSON text (finishReason: ${
            finishReason ?? 'unknown'
          }).`,
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

export { DEFAULT_OBSERVATION_MODEL };
