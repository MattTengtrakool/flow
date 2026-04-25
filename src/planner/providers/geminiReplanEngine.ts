import {GEMINI_API_KEY} from '@env';

import {OBSERVATION_ACTIVITY_TYPES} from '../../observation/types';
import {sampleObservationIds} from '../condenseObservations';
import {
  PLANNER_PROMPT_VERSION,
  type CondensedObservationEntry,
  type PlanUsage,
  type PlanBlock,
  type TaskPlanSnapshot,
} from '../types';

const MAX_SOURCE_OBSERVATIONS_PER_BLOCK = 40;

const TRANSIENT_RETRY_ATTEMPTS = 3;
const TRANSIENT_RETRY_BASE_DELAY_MS = 1_500;
const TRANSIENT_RETRY_MAX_DELAY_MS = 12_000;

export class GeminiRetryableError extends Error {
  readonly status: number;
  readonly kind: 'overloaded' | 'rate_limited';
  constructor(message: string, status: number, kind: 'overloaded' | 'rate_limited') {
    super(message);
    this.name = 'GeminiRetryableError';
    this.status = status;
    this.kind = kind;
  }
}

export const DEFAULT_PLANNER_MODEL = 'gemini-2.5-flash';

const WORKLOG_LABELS = [
  'worked_on',
  'reviewed',
  'drafted',
  'likely_completed',
  'confirmed_completed',
] as const;

const CATEGORY_VALUES = [...OBSERVATION_ACTIVITY_TYPES, 'other'] as const;

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
          startAt: {type: 'STRING'},
          endAt: {type: 'STRING'},
          headline: {type: 'STRING'},
          narrative: {type: 'STRING'},
          notes: {type: 'STRING'},
          label: {type: 'STRING', enum: [...WORKLOG_LABELS]},
          category: {type: 'STRING', enum: [...CATEGORY_VALUES]},
          confidence: {type: 'NUMBER'},
          keyActivities: {
            type: 'ARRAY',
            items: {type: 'STRING'},
          },
          artifacts: {
            type: 'OBJECT',
            required: [
              'apps',
              'repositories',
              'urls',
              'tickets',
              'documents',
              'people',
            ],
            properties: {
              apps: {type: 'ARRAY', items: {type: 'STRING'}},
              repositories: {type: 'ARRAY', items: {type: 'STRING'}},
              urls: {type: 'ARRAY', items: {type: 'STRING'}},
              tickets: {type: 'ARRAY', items: {type: 'STRING'}},
              documents: {type: 'ARRAY', items: {type: 'STRING'}},
              people: {type: 'ARRAY', items: {type: 'STRING'}},
            },
          },
          reasonCodes: {
            type: 'ARRAY',
            items: {type: 'STRING'},
          },
          sourceClusterIds: {
            type: 'ARRAY',
            items: {type: 'STRING'},
          },
        },
      },
    },
  },
} as const;

type PromptPreviousBlock = {
  startAt: string;
  endAt: string;
  headline: string;
  narrative: string;
  label: PlanBlock['label'];
  category: PlanBlock['category'];
  confidence: number;
};

export type GeminiReplanInput = {
  windowStartAt: string;
  windowEndAt: string;
  clusters: CondensedObservationEntry[];
  previousSnapshot: TaskPlanSnapshot | null;
  apiKey?: string;
  model?: string;
};

export type GeminiReplanRawBlock = {
  startAt: string;
  endAt: string;
  headline: string;
  narrative: string;
  notes?: string;
  label: (typeof WORKLOG_LABELS)[number];
  category: (typeof CATEGORY_VALUES)[number];
  confidence: number;
  keyActivities: string[];
  artifacts: {
    apps: string[];
    repositories: string[];
    urls: string[];
    tickets: string[];
    documents: string[];
    people: string[];
  };
  reasonCodes: string[];
  sourceObservationIds: string[];
};

export type ParsedReplanBlock = Omit<GeminiReplanRawBlock, 'sourceObservationIds'> & {
  sourceClusterIds: string[];
};

export type GeminiReplanResult = {
  blocks: GeminiReplanRawBlock[];
  model: string;
  promptVersion: string;
  durationMs: number;
  usage?: PlanUsage;
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{text?: string}>;
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
  const apiKey = (input.apiKey ?? GEMINI_API_KEY ?? '').trim();
  if (apiKey.length === 0) {
    throw new Error('A Google AI API key is required before running planner revisions.');
  }

  const model = input.model ?? DEFAULT_PLANNER_MODEL;
  const prompt = buildReplanPrompt(input);
  const startedAt = Date.now();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

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
          : `The replan response did not include any JSON text (finishReason: ${finishReason ?? 'unknown'}).`,
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
          parts: [{text: args.prompt}],
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

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

export function expandClusterIds(
  blocks: ParsedReplanBlock[],
  clusters: CondensedObservationEntry[],
): GeminiReplanRawBlock[] {
  const clustersById = new Map<string, CondensedObservationEntry>();
  for (const cluster of clusters) {
    clustersById.set(cluster.clusterId, cluster);
  }

  return blocks.map(block => {
    const observationIds = new Set<string>();
    for (const clusterId of block.sourceClusterIds) {
      const cluster = clustersById.get(clusterId);
      if (cluster == null) continue;
      for (const observationId of cluster.sourceObservationIds) {
        observationIds.add(observationId);
      }
    }
    const {sourceClusterIds: _unused, ...rest} = block;
    if (_unused.length < 0) {
      /* unreachable — keep destructure usage explicit */
    }
    return {
      ...rest,
      sourceObservationIds: sampleObservationIds(
        Array.from(observationIds),
        MAX_SOURCE_OBSERVATIONS_PER_BLOCK,
      ),
    };
  });
}

export function buildReplanPrompt(input: GeminiReplanInput): string {
  const prevBlocks: PromptPreviousBlock[] =
    input.previousSnapshot?.blocks.map(block => ({
      startAt: block.startAt,
      endAt: block.endAt,
      headline: block.headline,
      narrative:
        block.narrative.length > 240
          ? `${block.narrative.slice(0, 240)}…`
          : block.narrative,
      label: block.label,
      category: block.category,
      confidence: block.confidence,
    })) ?? [];

  const promptClusters = input.clusters.map(cluster => ({
    id: cluster.clusterId,
    startAt: cluster.earliestAt,
    endAt: cluster.latestAt,
    count: cluster.occurrenceCount,
    activity: cluster.activityType,
    hypothesis: cluster.taskHypothesis,
    taskAnchors: extractClusterAnchors(cluster),
    summaries: cluster.representativeSummaries,
    nextActions: cluster.nextActions,
    artifacts: cluster.artifacts,
  }));

  const lines = [
    'You are building a personal task calendar from desktop observations.',
    'Produce a list of time blocks covering the requested window.',
    'Each block is ONE task the person was working on.',
    '',
    '═══════════════════════════════════════════════════',
    'THE #1 RULE: HEADLINES NAME TASKS, NOT ACTIVITIES.',
    '═══════════════════════════════════════════════════',
    '',
    'A TASK is what the person was trying to accomplish - a specific feature,',
    'ticket, PR, document, or meeting. An ACTIVITY is the mechanics of HOW',
    '(reviewing, debugging, configuring, rebasing, refactoring, typing).',
    'Headlines MUST name tasks. Activities go in the narrative, never the title.',
    '',
    'BAD HEADLINES (describe activity or are generic):',
    '  ✗ "Git Rebase & Launch Workflow Reviews"  — "git rebase" is a mechanic',
    '  ✗ "Developing & Reviewing Launch Workflows" — "workflows" is abstract',
    '  ✗ "Configuring Olympus Environment & Git"   — "configuring" is activity',
    '  ✗ "Refactoring & Code Review"               — two activities joined',
    '  ✗ "Debugging and testing"                   — all verbs, no noun',
    '  ✗ "Code changes and PR feedback"            — no concrete task',
    '  ✗ "Working on Launch"                       — generic',
    '',
    'GOOD HEADLINES (anchor on a specific thing):',
    '  ✓ "PAY-193 retry flow"                         (ticket anchor)',
    '  ✓ "Pre-consultation form for launch portal"    (named feature)',
    '  ✓ "Brand dedup by viewer role (PR #34603)"     (named PR + intent)',
    '  ✓ "Olympus .env.development config"            (specific artifact)',
    '  ✓ "hestia PR #34619 review"                    (specific PR)',
    '  ✓ "Q2 strategy brief"                          (named doc)',
    '  ✓ "Weekly Launch Product Sync"                 (named meeting)',
    '  ✓ "listBr... role arrays refactor (PR #34609)" (file + PR)',
    '',
    'HEADLINE RULES (all must hold):',
    '1. NEVER start with a gerund (word ending in -ing): Reviewing, Debugging,',
    '   Configuring, Developing, Refactoring, Implementing, Writing, Testing,',
    '   Managing, Setting, Handling, Working, Investigating, Browsing.',
    '2. NEVER use "&" or "and" to join two activities. A block is ONE task.',
    '3. The headline MUST anchor on ONE identifier visible in the clusters.',
    '   Use this priority order:',
    '     (a) Ticket ID from taskAnchors.tickets  (e.g. POS-2221, PAY-193)',
    '     (b) PR reference from taskAnchors.prs   (e.g. #34619, PR #34603)',
    '     (c) Named meeting (if activityType is meeting and a meeting title',
    '         is visible in summaries or hypothesis)',
    '     (d) Specific feature or component name, inferred from the most',
    '         distinctive file in taskAnchors.files (e.g. "dedupeAssignmentsByBrand",',
    '         "pre-consultation form", "listBr role arrays")',
    '     (e) Repo name from taskAnchors.repos if nothing else is specific',
    '4. NEVER use these words alone as a headline: "workflow", "workflows",',
    '   "environment", "config", "setup", "updates", "code", "changes", "work".',
    '5. 3 to 8 words max. Optionally one parenthetical with a PR or ticket ID.',
    '',
    'If you truly cannot identify ONE task the cluster was about, the block',
    'should not exist - lower the confidence to 0 and omit it, leaving the',
    'time as a gap. Do NOT invent a vague headline to cover unclear work.',
    '',
    '═══════════════════════════════════════════════════',
    'BLOCK STRUCTURE — merging AND splitting rules',
    '═══════════════════════════════════════════════════',
    '',
    '- At most 12 blocks total.',
    '- If the person switches activity but stays on the same task (coded, then',
    '  reviewed the PR for the same task, then tested it) — ONE block.',
    '- NEVER emit two adjacent blocks sharing the same ticket, PR, repo, or',
    '  primary file. Merge them.',
    '- Prefer 30-120 min blocks with rich narratives over many small ones.',
    '',
    'BUT — do NOT over-merge. Distinct work belongs in distinct blocks:',
    '',
    '- If two clusters have DIFFERENT primary entities (different repos,',
    '  different tickets, different files, different companies being',
    '  researched, different meetings, different URL hosts) and neither',
    '  cluster references the other\'s entities, they are SEPARATE blocks.',
    '- Temporal proximity alone is NOT a reason to merge. Two things that',
    '  happened 3 minutes apart but are about different topics remain TWO',
    '  blocks, not one.',
    '- Wrong example: a cluster about researching Cognition (Google searches,',
    '  cognition.ai, Wikipedia) + a cluster about authenticating to GitHub',
    '  Enterprise (logging in, 2FA, opening a PR) = TWO blocks, not one.',
    '  The entities do not overlap. Label them separately.',
    '- Wrong example: "Reviewing stage 1 plan in Cursor" + "Researching',
    '  Cognition company" = TWO blocks. Same time window, different topics.',
    '- Right example: "Coding auth flow" + "Reviewing PR #34619 for that same',
    '  auth flow" + "Testing the login against staging" = ONE block, because',
    '  they all anchor on the same feature/PR/ticket.',
    '',
    'TIME-SPAN RULES (critical):',
    '',
    '- A block\'s startAt should be at or just before the FIRST observation',
    '  in its clusters. Its endAt should be at or just after the LAST',
    '  observation. Do NOT extend a block past the last observation to fill',
    '  empty time — if there are no observations for 30 minutes, the person',
    '  was away from the desk, not still on the task.',
    '- Minimum 10 min applies to tasks with continuous observation coverage.',
    '  For short bursts (a quick 2-minute lookup), emit a short block with',
    '  confidence ≥ 0.7, not a padded 10-minute block.',
    '- If a cluster has only 1-3 observations in a single minute, the block',
    '  is roughly that minute plus a small buffer — not 40 minutes.',
    '',
    '═══════════════════════════════════════════════════',
    'NARRATIVE (short preview, shown on cards)',
    '═══════════════════════════════════════════════════',
    '',
    '- 2 sentences max. Past tense, verb-first. Serves as the card preview.',
    '- Name 1-2 concrete artifacts.',
    '',
    '═══════════════════════════════════════════════════',
    'NOTES (Notion-style page, markdown bullets)',
    '═══════════════════════════════════════════════════',
    '',
    'This is the primary body of the block — think Notion-style notes:',
    'clean bullets, hierarchical, written so the reader gets a sharp picture',
    'of what was done. Format as GITHUB-FLAVORED MARKDOWN bullets only.',
    '',
    'CONTENT AND ORDER:',
    '- Bullets are time-ordered (events flow from start of block to end), but',
    '  do NOT include explicit timestamps. No "9:43 AM —" prefixes. Just write',
    '  the bullets in the order they happened.',
    '- 4 to 10 top-level bullets. Pick the number based on what actually',
    '  happened — short blocks may need only 3 strong bullets, long blocks',
    '  with many distinct steps can use 8-10.',
    '- Each top-level bullet is ONE coherent action, decision, artifact, or',
    '  topic. Past tense, verb-first.',
    '- Use nested sub-bullets (indent 2 spaces) for related context: file',
    '  paths, PR numbers, ticket IDs, decisions, follow-ups, blockers.',
    '- Use **bold** for the key names (PR #s, ticket IDs, files, people,',
    '  docs, meetings). Use `code` only for actual file paths or identifiers.',
    '',
    'EXAMPLES — write notes like this:',
    '',
    'Example 1 — hestia PR #34619 review (a 30-minute block):',
    '  - Opened **PR #34619** in `hestia` to review the caching + `todos` cleanup',
    '    - Skimmed the diff and outstanding review threads',
    '    - Flagged cache-TTL concern in `AuthProvider.tsx`',
    '    - Left feedback on `todos` naming inconsistency',
    '  - Scanned failing CI checks and requested a rerun',
    '  - Messaged **Alex** in Slack about the missing test coverage',
    '',
    'Example 2 — Brand dedup by viewer role / PR #34603 (a 75-minute block):',
    '  - Refactored `dedupeAssignmentsByBrand.ts` so viewer role takes',
    '    priority over admin',
    '    - Reused the existing role hierarchy from `roles.ts`',
    '    - Hit a Vite compile error from a stale `AssignmentContext` barrel',
    '      export — fixed by re-exporting the new helpers',
    '  - Ran the full test suite locally; everything green',
    '  - Pushed the branch and opened **PR #34603**',
    '  - Cross-referenced **CBO-96** ticket notes to confirm scope coverage',
    '',
    'Example 3 — Weekly Launch ↔ Product Sync (a meeting block):',
    '  - **Website 2.0** rollout — walked through the updated timeline',
    '  - **Menu Agent** beta results — conversions came in lower than expected',
    '    - Discussed possible causes (search ranking + onboarding copy)',
    '  - Action item: pull KPI numbers from the PostHog dashboard before next sync',
    '  - Side check: Gemini API status mid-meeting (no incidents)',
    '',
    'AVOID in notes:',
    '- Explicit timestamps at the start of bullets — you no longer use them.',
    '- Grouping bullets by topic in a way that breaks chronological flow.',
    '- Generic filler ("worked on stuff", "discussed things").',
    '- Bullets that just describe activity ("Did some coding") with no object.',
    '- Window titles or app chrome as bullet content.',
    '- Wrapping the entire notes in a code block or quote.',
    '- Markdown headers (#, ##) — notes are just bullets.',
    '',
    '═══════════════════════════════════════════════════',
    'REMAINING NARRATIVE RULES',
    '═══════════════════════════════════════════════════',
    '',
    '- Narrative and notes both stay past tense, outcome-focused.',
    '- Describe what was ACCOMPLISHED, not what was observed.',
    '- Prefer outcome verbs: fixed, merged, drafted, replied, reviewed,',
    '  implemented, shipped, deployed, rebased.',
    '',
    '═══════════════════════════════════════════════════',
    'OTHER FIELDS',
    '═══════════════════════════════════════════════════',
    '',
    '- keyActivities: 2-4 bullets, each under 12 words. Specific actions.',
    '- artifacts: real work artifacts only. Ticket IDs in "tickets", repo',
    '  names in "repositories", file paths in "documents", links in "urls".',
    '  NO window titles, app chrome, or breadcrumbs like "Owner.com | Launch".',
    '  Max 6 per list.',
    '- label: worked_on | reviewed | drafted | likely_completed | confirmed_completed.',
    '- category: coding | research | review | writing | communication | planning |',
    '  browsing | file_management | meeting | other.',
    '- confidence: 0.9 for a clearly-identified task, 0.7 with minor noise,',
    '  0.5 for mixed. Below 0.35 → omit the block.',
    '- reasonCodes: 1-4 short tags.',
    '- sourceClusterIds: every cluster.id that contributed. Only real ids.',
    '',
    'Context:',
    JSON.stringify(
      {
        windowStartAt: input.windowStartAt,
        windowEndAt: input.windowEndAt,
        clusters: promptClusters,
        previousPlan:
          prevBlocks.length > 0
            ? {
                note:
                  'Previous plan blocks for reference only. Freely rewrite or delete based on new clusters and the headline rules above.',
                blocks: prevBlocks,
              }
            : null,
      },
      null,
      2,
    ),
  ];

  return lines.join('\n');
}

const TICKET_PATTERN = /\b([A-Z][A-Z0-9]{1,9})-(\d{1,6})\b/g;
const PR_PATTERN = /#(\d{2,7})\b|\bpull\/(\d{2,7})\b/gi;

type ClusterAnchors = {
  tickets: string[];
  prs: string[];
  files: string[];
  repos: string[];
};

function extractClusterAnchors(
  cluster: CondensedObservationEntry,
): ClusterAnchors {
  const textPool = [
    cluster.taskHypothesis ?? '',
    ...cluster.representativeSummaries,
    ...cluster.nextActions,
  ].join(' ');

  const tickets = new Set<string>();
  const prs = new Set<string>();

  for (const ticket of cluster.artifacts.tickets) {
    tickets.add(ticket.trim());
  }
  let ticketMatch: RegExpExecArray | null = TICKET_PATTERN.exec(textPool);
  while (ticketMatch != null) {
    tickets.add(`${ticketMatch[1]}-${ticketMatch[2]}`);
    ticketMatch = TICKET_PATTERN.exec(textPool);
  }
  TICKET_PATTERN.lastIndex = 0;

  let prMatch: RegExpExecArray | null = PR_PATTERN.exec(textPool);
  while (prMatch != null) {
    const num = prMatch[1] ?? prMatch[2];
    if (num != null) prs.add(`#${num}`);
    prMatch = PR_PATTERN.exec(textPool);
  }
  PR_PATTERN.lastIndex = 0;
  for (const url of cluster.artifacts.urls) {
    const urlPr = /\bpull\/(\d{2,7})\b/i.exec(url);
    if (urlPr != null) prs.add(`#${urlPr[1]}`);
  }

  // Files worth anchoring on: prefer source code paths, drop generics.
  const distinctiveFiles: string[] = [];
  for (const candidate of cluster.artifacts.documents) {
    if (isDistinctiveFile(candidate)) {
      distinctiveFiles.push(candidate);
    }
  }

  return {
    tickets: Array.from(tickets).slice(0, 4),
    prs: Array.from(prs).slice(0, 4),
    files: distinctiveFiles.slice(0, 4),
    repos: cluster.artifacts.repositories.slice(0, 3),
  };
}

function isDistinctiveFile(path: string): boolean {
  if (!path.includes('/') && !/\.[a-z0-9]{1,6}$/i.test(path)) return false;
  const basename = path.split('/').pop() ?? path;
  if (/^package(-lock)?\.json$/i.test(basename)) return false;
  if (/^\.env/i.test(basename)) return true;
  if (/^(readme|changelog|license)/i.test(basename)) return false;
  return true;
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

export function parseReplanResponseSafely(
  rawText: string,
  finishReason: string | undefined,
): ParsedReplanBlock[] {
  const trimmed = rawText.trim();

  const firstAttempt = tryParse(trimmed);
  if (firstAttempt != null) {
    return coerceBlocks(firstAttempt, rawText, finishReason);
  }

  const recovered = tryRecoverTruncatedJson(trimmed);
  if (recovered != null) {
    const recoveredParsed = tryParse(recovered);
    if (recoveredParsed != null) {
      return coerceBlocks(recoveredParsed, rawText, finishReason);
    }
  }

  const preview = trimmed.length > 240 ? `${trimmed.slice(0, 240)}…` : trimmed;
  const prefix =
    finishReason === 'MAX_TOKENS'
      ? "The model hit the output token ceiling before finishing the JSON. Try fewer observations or a shorter window."
      : finishReason === 'SAFETY'
        ? 'The model refused to generate output due to safety filters.'
        : `Could not parse the model's JSON`;
  throw new Error(
    `${prefix}${
      finishReason && finishReason !== 'STOP' ? ` (finishReason: ${finishReason})` : ''
    }. Preview: ${preview.length > 0 ? preview : '(empty response)'}`,
  );
}

function tryParse(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function tryRecoverTruncatedJson(text: string): string | null {
  // Best-effort: if the model got cut off mid-block, walk back to the last
  // complete `}` inside blocks[] and close the array + object.
  const blocksStart = text.indexOf('"blocks"');
  if (blocksStart === -1) return null;
  const arrayStart = text.indexOf('[', blocksStart);
  if (arrayStart === -1) return null;

  let depth = 0;
  let lastCompleteBlockEnd = -1;
  let inString = false;
  let escape = false;
  for (let i = arrayStart; i < text.length; i += 1) {
    const char = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === '\\') {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        lastCompleteBlockEnd = i;
      }
    }
  }

  if (lastCompleteBlockEnd === -1) return null;
  const truncated = text.slice(0, lastCompleteBlockEnd + 1);
  // Strip trailing comma if any
  const cleaned = truncated.replace(/,\s*$/, '');
  return `${cleaned}]}`;
}

export function coerceBlocks(
  parsed: unknown,
  rawText: string,
  finishReason: string | undefined,
): ParsedReplanBlock[] {
  if (typeof parsed !== 'object' || parsed == null) {
    throw new Error(
      `Replan JSON did not return an object${
        finishReason ? ` (finishReason: ${finishReason})` : ''
      }. Got: ${typeof parsed}`,
    );
  }

  const blocks = (parsed as {blocks?: unknown}).blocks;
  if (!Array.isArray(blocks)) {
    const preview = rawText.length > 160 ? `${rawText.slice(0, 160)}…` : rawText;
    throw new Error(
      `Replan JSON did not contain a blocks array. Preview: ${preview}`,
    );
  }

  return blocks.map((value, index) => coerceBlock(value, index));
}

function coerceBlock(value: unknown, index: number): ParsedReplanBlock {
  if (typeof value !== 'object' || value == null) {
    throw new Error(`Replan block ${index} was not an object.`);
  }
  const candidate = value as Record<string, unknown>;

  const startAt = requireString(candidate.startAt, `blocks[${index}].startAt`);
  const endAt = requireString(candidate.endAt, `blocks[${index}].endAt`);
  const headline = requireString(candidate.headline, `blocks[${index}].headline`);
  const narrative = requireString(candidate.narrative, `blocks[${index}].narrative`);
  // Notes are new in the planner prompt — accept missing/empty for legacy snapshots.
  const notes =
    typeof candidate.notes === 'string' ? candidate.notes : '';
  const label = requireEnum(
    candidate.label,
    WORKLOG_LABELS,
    `blocks[${index}].label`,
  );
  const category = requireEnum(
    candidate.category,
    CATEGORY_VALUES,
    `blocks[${index}].category`,
  );
  const confidence = requireNumber(
    candidate.confidence,
    `blocks[${index}].confidence`,
  );
  const keyActivities = requireStringArray(
    candidate.keyActivities,
    `blocks[${index}].keyActivities`,
  );
  const reasonCodes = requireStringArray(
    candidate.reasonCodes,
    `blocks[${index}].reasonCodes`,
  );
  const sourceClusterIds = toStringArray(candidate.sourceClusterIds);
  const artifacts = coerceArtifacts(candidate.artifacts, index);

  return {
    startAt,
    endAt,
    headline,
    narrative,
    notes,
    label,
    category,
    confidence,
    keyActivities,
    reasonCodes,
    sourceClusterIds,
    artifacts,
  };
}

function coerceArtifacts(
  value: unknown,
  index: number,
): ParsedReplanBlock['artifacts'] {
  if (typeof value !== 'object' || value == null) {
    throw new Error(`blocks[${index}].artifacts was not an object.`);
  }
  const record = value as Record<string, unknown>;
  return {
    apps: toStringArray(record.apps),
    repositories: toStringArray(record.repositories),
    urls: toStringArray(record.urls),
    tickets: toStringArray(record.tickets),
    documents: toStringArray(record.documents),
    people: toStringArray(record.people),
  };
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${path} was missing or not a non-empty string.`);
  }
  return value;
}

function requireNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${path} was not a finite number.`);
  }
  return value;
}

function requireEnum<Options extends readonly string[]>(
  value: unknown,
  options: Options,
  path: string,
): Options[number] {
  if (typeof value !== 'string' || !options.includes(value as Options[number])) {
    throw new Error(
      `${path} must be one of: ${options.join(', ')}. Got: ${String(value)}`,
    );
  }
  return value as Options[number];
}

function requireStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
    throw new Error(`${path} must be an array of strings.`);
  }
  return value as string[];
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}
