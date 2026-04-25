import {GEMINI_API_KEY} from '@env';

import type {TimelineView} from '../timeline/eventLog';
import {
  CHAT_TOOL_DECLARATIONS,
  executeChatTool,
  type ChatToolCall,
  type ChatToolName,
  type ChatToolResult,
} from './tools';

export type ChatRole = 'user' | 'assistant';

export type ChatToolInvocation = {
  name: ChatToolName;
  args: Record<string, unknown>;
  result: ChatToolResult;
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  toolInvocations?: ChatToolInvocation[];
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
};

const DEFAULT_MODEL = 'gemini-2.5-flash';
const MAX_TOOL_LOOP_ITERATIONS = 6;

type GeminiPart =
  | {text: string}
  | {functionCall: {name: string; args: Record<string, unknown>}}
  | {
      functionResponse: {
        name: string;
        response: {result?: unknown; error?: string};
      };
    };

type GeminiContent = {
  role: 'user' | 'model' | 'function';
  parts: GeminiPart[];
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {parts?: GeminiPart[]};
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: {message?: string};
};

export type RunChatTurnArgs = {
  conversation: ChatMessage[];
  userMessage: string;
  timeline: TimelineView;
  timezone: string;
  apiKey?: string;
  model?: string;
  now?: Date;
};

export type RunChatTurnResult = {
  assistantMessage: ChatMessage;
  toolInvocations: ChatToolInvocation[];
};

export async function runChatTurn(
  args: RunChatTurnArgs,
): Promise<RunChatTurnResult> {
  const apiKey = (args.apiKey ?? GEMINI_API_KEY ?? '').trim();
  if (apiKey.length === 0) {
    throw new Error(
      'A Gemini API key is required for chat. Set GEMINI_API_KEY in .env.',
    );
  }

  const model = args.model ?? DEFAULT_MODEL;
  const now = args.now ?? new Date();
  const startedAt = Date.now();

  const contents: GeminiContent[] = [];
  for (const message of args.conversation) {
    contents.push({
      role: message.role === 'user' ? 'user' : 'model',
      parts: [{text: message.content}],
    });
  }
  contents.push({role: 'user', parts: [{text: args.userMessage}]});

  const systemInstruction = buildSystemInstruction(now, args.timezone);
  const toolDeclarations = {
    functionDeclarations: CHAT_TOOL_DECLARATIONS.map(declaration => ({
      name: declaration.name,
      description: declaration.description,
      parameters: declaration.parameters,
    })),
  };

  const toolInvocations: ChatToolInvocation[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let finalText: string | null = null;

  for (let iteration = 0; iteration < MAX_TOOL_LOOP_ITERATIONS; iteration += 1) {
    const response = await callGemini({
      apiKey,
      model,
      contents,
      tools: [toolDeclarations],
      systemInstruction,
    });

    if (response.usageMetadata != null) {
      totalInputTokens += response.usageMetadata.promptTokenCount ?? 0;
      totalOutputTokens += response.usageMetadata.candidatesTokenCount ?? 0;
    }

    const candidateParts = response.candidates?.[0]?.content?.parts ?? [];
    const functionCalls: Array<{name: string; args: Record<string, unknown>}> = [];
    let textInResponse = '';

    for (const part of candidateParts) {
      if ('functionCall' in part && part.functionCall != null) {
        functionCalls.push(part.functionCall);
      } else if ('text' in part && typeof part.text === 'string') {
        textInResponse += part.text;
      }
    }

    if (functionCalls.length === 0) {
      finalText = textInResponse.trim();
      break;
    }

    contents.push({role: 'model', parts: candidateParts});

    const responseParts: GeminiPart[] = [];
    for (const functionCall of functionCalls) {
      const toolName = functionCall.name as ChatToolName;
      const call: ChatToolCall = {
        name: toolName,
        args: functionCall.args ?? {},
      };
      let toolResult: ChatToolResult;
      try {
        toolResult = executeChatTool(call, {
          timeline: args.timeline,
          timezone: args.timezone,
        });
      } catch (error) {
        toolResult = {
          error:
            error instanceof Error ? error.message : 'Tool execution failed.',
        };
      }
      toolInvocations.push({
        name: toolName,
        args: call.args,
        result: toolResult,
      });
      responseParts.push({
        functionResponse: {
          name: functionCall.name,
          response: {result: toolResult},
        },
      });
    }

    contents.push({role: 'function', parts: responseParts});
  }

  if (finalText == null || finalText.length === 0) {
    finalText =
      'I ran out of tool-call iterations before producing an answer. Try rephrasing your question.';
  }

  const assistantMessage: ChatMessage = {
    id: `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    role: 'assistant',
    content: finalText,
    createdAt: new Date().toISOString(),
    toolInvocations: toolInvocations.length > 0 ? toolInvocations : undefined,
    durationMs: Date.now() - startedAt,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
  };

  return {
    assistantMessage,
    toolInvocations,
  };
}

function buildSystemInstruction(now: Date, timezone: string): string {
  const localNow = now.toLocaleString('en-US', {timeZone: timezone});
  const todayIso = formatLocalDayIso(now, timezone);
  const startOfWeekIso = formatLocalDayIso(getMonday(now), timezone);
  const startOfMonthIso = formatLocalDayIso(getFirstOfMonth(now), timezone);
  return [
    "You are Flow's chat assistant. You have read-only access to the user's tracked work history — task blocks, time spent, notes, and screen-capture observations — through the available tools.",
    '',
    'GUIDELINES:',
    '- Always cite specific work by name: PR numbers, ticket IDs, file paths, meeting titles, people. Never refer to work generically ("some PR", "a meeting").',
    "- Use the tools to look up actual data. Never invent times, blocks, or facts. If a tool returns no results, say so plainly.",
    "- Format multi-bullet answers as concise markdown. Bold the key entities (**PR #123**, **POS-2221**, **Alex**).",
    '- For "standup notes" or "EOD summary" requests: 4-7 bullets. Lead with shipped/completed items, then in-progress, then notable conversations or research. Skip personal/leisure unless directly asked.',
    '- For "how much time on X" questions: state the total in hours/minutes, then a short breakdown by day or sub-task if useful.',
    '- For "what did I learn about X" questions: pull the most relevant blocks with get_blocks_in_range using a topicFilter, then summarise findings, decisions, and follow-ups.',
    '- Only call tools you actually need. Combine information across tool calls when helpful.',
    '- Be conversational but tight. No filler ("Sure!", "Great question!"). Get to the answer.',
    '',
    `CONTEXT:`,
    `- Current local time: ${localNow} (${timezone}).`,
    `- Today (local date): ${todayIso}.`,
    `- Start of this week (Monday): ${startOfWeekIso}.`,
    `- Start of this month: ${startOfMonthIso}.`,
    '- "Today" = the current local day, midnight to now.',
    '- "This week" = Monday 00:00 local to now.',
    '- "Last week" = previous Monday 00:00 to previous Sunday 23:59.',
    '- "This month" = first of this month 00:00 local to now.',
  ].join('\n');
}

function formatLocalDayIso(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function getMonday(date: Date): Date {
  const result = new Date(date);
  const dayOfWeek = (result.getDay() + 6) % 7; // Monday = 0
  result.setDate(result.getDate() - dayOfWeek);
  result.setHours(0, 0, 0, 0);
  return result;
}

function getFirstOfMonth(date: Date): Date {
  const result = new Date(date);
  result.setDate(1);
  result.setHours(0, 0, 0, 0);
  return result;
}

async function callGemini(args: {
  apiKey: string;
  model: string;
  contents: GeminiContent[];
  tools: Array<{
    functionDeclarations: Array<{
      name: string;
      description: string;
      parameters: unknown;
    }>;
  }>;
  systemInstruction: string;
}): Promise<GeminiResponse> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(args.model)}:generateContent`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': args.apiKey,
    },
    body: JSON.stringify({
      contents: args.contents,
      tools: args.tools,
      systemInstruction: {parts: [{text: args.systemInstruction}]},
      generationConfig: {
        temperature: 0.3,
        max_output_tokens: 4096,
      },
    }),
  });

  const payload = (await response.json()) as GeminiResponse;
  if (!response.ok) {
    throw new Error(
      payload.error?.message ??
        `Chat request failed with status ${response.status}.`,
    );
  }
  return payload;
}

export function createUserMessage(content: string): ChatMessage {
  return {
    id: `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    role: 'user',
    content,
    createdAt: new Date().toISOString(),
  };
}
