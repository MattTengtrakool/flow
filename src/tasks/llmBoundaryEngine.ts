import {GEMINI_API_KEY} from '@env';

import {createOccurredAt} from '../state/eventLog';
import type {ObservationView} from '../state/eventLog';
import type {
  TaskCandidateSummary,
  TaskDecisionKind,
  TaskFeatureSnapshot,
  TaskLineageView,
  TaskSegmentView,
} from './types';

const TASK_BOUNDARY_PROMPT_VERSION = '2026-04-15.task-boundary.v1';

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{text?: string}>;
    };
    finishReason?: string;
  }>;
  error?: {
    message?: string;
  };
};

type LlmBoundaryDecision = {
  decision: TaskDecisionKind;
  targetSegmentId: string | null;
  targetLineageId: string | null;
  confidence: number;
  reason: string;
};

const GEMINI_BOUNDARY_SCHEMA = {
  type: 'OBJECT',
  required: ['decision', 'targetSegmentId', 'targetLineageId', 'confidence', 'reason'],
  properties: {
    decision: {
      type: 'STRING',
      enum: [
        'join_current',
        'start_new',
        'resume_lineage',
        'mark_interruption',
        'branch_side_task',
        'hold_pending',
        'ignore',
      ],
    },
    targetSegmentId: {
      type: 'STRING',
      nullable: true,
    },
    targetLineageId: {
      type: 'STRING',
      nullable: true,
    },
    confidence: {
      type: 'NUMBER',
      minimum: 0,
      maximum: 1,
    },
    reason: {
      type: 'STRING',
    },
  },
} as const;

function extractOutputText(response: GeminiResponse): string | null {
  const candidates = response.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  for (const part of candidates[0]?.content?.parts ?? []) {
    if (typeof part?.text === 'string' && part.text.length > 0) {
      return part.text;
    }
  }

  return null;
}

function buildBoundaryPrompt(args: {
  observation: ObservationView;
  currentSegment: TaskSegmentView | null;
  recentLineages: TaskLineageView[];
  candidates: TaskCandidateSummary[];
  features: TaskFeatureSnapshot | null;
}): string {
  const {observation, currentSegment, recentLineages, candidates, features} = args;

  return [
    'You are deciding how to assign one new observation to a live task timeline.',
    'Choose only among the supplied candidate interpretations.',
    'Do not invent a candidate that is not in the shortlist.',
    'Favor continuity when the user appears to be continuing the same semantic work across apps.',
    'Use mark_interruption for brief detours that should not split the main work thread.',
    'Use resume_lineage only when a prior semantic thread clearly resumes.',
    'Use branch_side_task only for meaningful but still uncertain detours.',
    'Use hold_pending if the evidence is still ambiguous even after considering the shortlist.',
    'Return only JSON.',
    '',
    'New observation:',
    JSON.stringify(
      {
        id: observation.id,
        text: observation.text,
        observedAt: observation.observedAt,
        sessionId: observation.sessionId ?? null,
        structured: observation.structured ?? null,
      },
      null,
      2,
    ),
    '',
    'Current segment:',
    JSON.stringify(currentSegment, null, 2),
    '',
    'Recent lineages:',
    JSON.stringify(
      recentLineages.slice(-3).map(lineage => ({
        id: lineage.id,
        latestLiveTitle: lineage.latestLiveTitle,
        latestLiveSummary: lineage.latestLiveSummary,
        lastActiveTime: lineage.lastActiveTime,
      })),
      null,
      2,
    ),
    '',
    'Feature snapshot:',
    JSON.stringify(features, null, 2),
    '',
    'Allowed candidate decisions:',
    JSON.stringify(
      candidates.map(candidate => ({
        decision: candidate.decision,
        targetSegmentId: candidate.targetSegmentId,
        targetLineageId: candidate.targetLineageId,
      })),
      null,
      2,
    ),
    '',
    'Candidate shortlist:',
    JSON.stringify(candidates, null, 2),
  ].join('\n');
}

function normalizeDecisionAgainstCandidates(
  parsed: LlmBoundaryDecision,
  candidates: TaskCandidateSummary[],
): LlmBoundaryDecision {
  const exactMatch = candidates.find(
    candidate =>
      candidate.decision === parsed.decision &&
      candidate.targetSegmentId === parsed.targetSegmentId &&
      candidate.targetLineageId === parsed.targetLineageId,
  );

  if (exactMatch != null) {
    return parsed;
  }

  const looseMatch = candidates.find(
    candidate =>
      candidate.decision === parsed.decision &&
      (parsed.targetLineageId == null ||
        candidate.targetLineageId === parsed.targetLineageId),
  );

  if (looseMatch != null) {
    return {
      ...parsed,
      targetSegmentId: looseMatch.targetSegmentId,
      targetLineageId: looseMatch.targetLineageId,
    };
  }

  throw new Error('Boundary adjudication returned a decision outside the candidate shortlist.');
}

export async function adjudicateTaskBoundary(args: {
  observation: ObservationView;
  currentSegment: TaskSegmentView | null;
  recentLineages: TaskLineageView[];
  candidates: TaskCandidateSummary[];
  features: TaskFeatureSnapshot | null;
  model?: string;
}): Promise<LlmBoundaryDecision & {model: string; promptVersion: string; generatedAt: string}> {
  const apiKey = (GEMINI_API_KEY ?? '').trim();
  if (apiKey.length === 0) {
    throw new Error('No Gemini API key is configured for boundary adjudication.');
  }

  const model = args.model ?? 'gemini-2.5-flash-lite';
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: buildBoundaryPrompt(args),
              },
            ],
          },
        ],
        generationConfig: {
          response_mime_type: 'application/json',
          response_schema: GEMINI_BOUNDARY_SCHEMA,
          max_output_tokens: 1024,
        },
      }),
    },
  );

  const payload = (await response.json()) as GeminiResponse;
  if (!response.ok) {
    throw new Error(
      payload.error?.message ??
        `Boundary adjudication failed with status ${response.status}.`,
    );
  }

  const outputText = extractOutputText(payload);
  if (outputText == null) {
    throw new Error('Boundary adjudication returned no JSON output.');
  }

  const parsed = JSON.parse(outputText) as LlmBoundaryDecision;
  const normalized = normalizeDecisionAgainstCandidates(parsed, args.candidates);
  return {
    ...normalized,
    model,
    promptVersion: TASK_BOUNDARY_PROMPT_VERSION,
    generatedAt: createOccurredAt(),
  };
}

export {TASK_BOUNDARY_PROMPT_VERSION};
