import {
  generateStructuredObservationForCapture,
  validateCaptureForObservation,
  type ObserveCaptureArgs,
} from '../../../src/observation/runObservationForCapture';
import type { ObservationRun } from '../../../src/observation/types';
import { generateReplanBlocksWithAnthropic } from '../../../src/planner/providers/anthropicReplanEngine';
import { generateReplanBlocks } from '../../../src/planner/providers/geminiReplanEngine';
import type {
  ReplanInput,
  ReplanResult,
} from '../../../src/planner/replanTypes';
import type {
  RunChatTurnArgs,
  RunChatTurnResult,
} from '../../../src/chat/runChat';
import { runChatTurn } from '../../../src/chat/runChat';
import type {
  ProactiveBriefRequest,
  ProactiveBriefResult,
} from '../../../src/proactive/types';
import type {
  ManagedAudioTranscriptionInput,
  ManagedAudioTranscriptionResult,
  ManagedMeetingSummaryInput,
  ManagedMeetingSummaryResult,
} from '../../../src/meetings/types';
import { settingsService } from '../settings/settingsService';

type ManagedAiErrorPayload = {
  error?: {
    message?: string;
  };
  message?: string;
};

export async function generateManagedObservationForCapture(
  args: ObserveCaptureArgs,
): Promise<ObservationRun> {
  const config = settingsService.getManagedAiConfig();
  if (config?.local === true) {
    return generateStructuredObservationForCapture({
      ...args,
      apiKey: settingsService.getApiKey('gemini'),
    });
  }

  const { imageBase64, imageMimeType } = validateCaptureForObservation(args);
  return postManagedAi<ObservationRun>('/v1/observations', {
    model: args.model,
    input: {
      imageBase64,
      imageMimeType,
      ocrText: args.preview?.ocrText ?? null,
      inspection: args.inspection!,
      capture: args.preview!.metadata,
      currentContext: args.currentContext,
      recentObservations: args.recentObservations,
    },
  });
}

export async function generateManagedReplanBlocks(
  input: ReplanInput,
): Promise<ReplanResult> {
  const config = settingsService.getManagedAiConfig();
  if (config?.local === true) {
    const provider = settingsService.getSelectedProvider();
    return provider === 'anthropic'
      ? generateReplanBlocksWithAnthropic({
          ...input,
          apiKey: settingsService.getApiKey('anthropic'),
        })
      : generateReplanBlocks({
          ...input,
          apiKey: settingsService.getApiKey('gemini'),
        });
  }

  return postManagedAi<ReplanResult>('/v1/replans', {
    ...input,
    apiKey: undefined,
  });
}

export async function runManagedChatTurn(
  args: RunChatTurnArgs,
): Promise<RunChatTurnResult> {
  const config = settingsService.getManagedAiConfig();
  if (config?.local === true) {
    return runChatTurn({
      ...args,
      apiKey: settingsService.getApiKey('gemini'),
    });
  }

  return postManagedAi<RunChatTurnResult>('/v1/chat/turn', {
    ...args,
    apiKey: undefined,
  });
}

export async function generateManagedProactiveBrief(
  input: ProactiveBriefRequest,
): Promise<ProactiveBriefResult> {
  const config = settingsService.getManagedAiConfig();
  if (config?.local === true) {
    return createLocalProactiveBrief(input);
  }

  return postManagedAi<ProactiveBriefResult>('/v1/proactive/brief', input);
}

export async function transcribeManagedAudioChunk(
  input: ManagedAudioTranscriptionInput,
): Promise<ManagedAudioTranscriptionResult> {
  const config = settingsService.getManagedAiConfig();
  if (config?.local === true) {
    throw new Error(
      'Transcription endpoint not configured for the local managed adapter.',
    );
  }

  return postManagedAi<ManagedAudioTranscriptionResult>(
    '/v1/audio/transcribe',
    input,
  );
}

export async function summarizeManagedMeeting(
  input: ManagedMeetingSummaryInput,
): Promise<ManagedMeetingSummaryResult> {
  const config = settingsService.getManagedAiConfig();
  if (config?.local === true) {
    return createLocalMeetingSummary(input);
  }

  return postManagedAi<ManagedMeetingSummaryResult>(
    '/v1/meetings/summarize',
    input,
  );
}

async function postManagedAi<T>(pathname: string, body: unknown): Promise<T> {
  const config = settingsService.getManagedAiConfig();
  if (config == null) {
    throw new Error(
      'Managed Flow AI needs FLOW_AI_PROXY_URL before launching Flow.',
    );
  }

  const response = await fetch(managedUrl(config.baseUrl, pathname), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(config.authToken != null
        ? { authorization: `Bearer ${config.authToken}` }
        : {}),
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json()) as T & ManagedAiErrorPayload;
  if (!response.ok) {
    throw new Error(
      payload.error?.message ??
        payload.message ??
        `Managed Flow AI request failed with status ${response.status}.`,
    );
  }
  return payload;
}

function managedUrl(baseUrl: string, pathname: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(pathname.replace(/^\//, ''), base).toString();
}

function createLocalProactiveBrief(
  input: ProactiveBriefRequest,
): ProactiveBriefResult {
  const block = input.relatedBlocks[0];
  const nextAction = input.relatedBlocks.flatMap(item => item.nextActions)[0];
  const artifacts = input.artifacts.slice(0, 3).join(', ');
  const bullets = [
    block != null ? block.headline : input.reason,
    artifacts.length > 0 ? `Relevant context: ${artifacts}.` : null,
    nextAction != null ? `Suggested next step: ${nextAction}` : null,
  ].filter((value): value is string => value != null && value.length > 0);

  return {
    title: input.title,
    bullets: bullets.slice(0, 3),
    suggestedActions: nextAction != null ? [nextAction] : [],
  };
}

function createLocalMeetingSummary(
  input: ManagedMeetingSummaryInput,
): ManagedMeetingSummaryResult {
  const transcriptText = input.transcriptChunks
    .map(chunk => chunk.text.trim())
    .filter(Boolean)
    .join(' ');
  const fallbackTitle = input.calendarEvent?.title ?? 'Meeting notes';
  return {
    title: fallbackTitle,
    summary:
      transcriptText.length > 0
        ? transcriptText.slice(0, 500)
        : 'No transcript text was available for this meeting.',
    decisions: [],
    actionItems: [],
    followUps: [],
    questions: [],
  };
}
