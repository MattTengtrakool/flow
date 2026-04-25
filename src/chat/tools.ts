import type {ObservationView, TimelineView} from '../timeline/eventLog';
import type {WorklogCalendarBlock} from '../worklog/types';
import {getAllPlanCalendarBlocks} from '../planner/selectors';

/**
 * Tools the chat assistant can call to answer questions about the user's
 * tracked work. Every tool is a pure function over the timeline — no
 * mutation, no side effects, safe to retry.
 *
 * Each tool returns plain JSON the LLM can stringify into its answer.
 */

export type ChatToolName =
  | 'get_blocks_in_range'
  | 'get_total_time'
  | 'get_block_details'
  | 'get_observations_in_range';

export type ChatToolArgs = Record<string, unknown>;
export type ChatToolResult = unknown;

export type ChatToolCall = {
  id?: string;
  name: ChatToolName;
  args: ChatToolArgs;
};

export type ChatToolDeclaration = {
  name: ChatToolName;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<
      string,
      {
        type: string;
        description: string;
        enum?: string[];
      }
    >;
    required: string[];
  };
};

export const CHAT_TOOL_DECLARATIONS: ChatToolDeclaration[] = [
  {
    name: 'get_blocks_in_range',
    description:
      'Return all task blocks in a time range. Each block summarises one task the user worked on (title, start/end, duration, narrative, key topics, notes). Optionally filter by a topic substring (e.g., "hestia", "POS-2212", "Bieber") that must match somewhere in the block title, narrative, notes, or artifacts.',
    parameters: {
      type: 'object',
      properties: {
        startIso: {
          type: 'string',
          description:
            'Start of the range, ISO-8601 timestamp. Inclusive. Example: 2026-04-22T00:00:00.000Z',
        },
        endIso: {
          type: 'string',
          description:
            'End of the range, ISO-8601 timestamp. Inclusive. Example: 2026-04-22T23:59:59.000Z',
        },
        topicFilter: {
          type: 'string',
          description:
            'Optional case-insensitive substring filter applied to titles, narratives, notes, and artifacts. Omit to get all blocks in range.',
        },
      },
      required: ['startIso', 'endIso'],
    },
  },
  {
    name: 'get_total_time',
    description:
      'Aggregate focused minutes across blocks in a time range, broken down by group. Use group="project" to break down by repository / primary artifact. group="category" for activity types (coding, meeting, research…). group="ticket" for ticket IDs. group="day" for daily totals.',
    parameters: {
      type: 'object',
      properties: {
        startIso: {
          type: 'string',
          description: 'Start of the range, ISO-8601.',
        },
        endIso: {
          type: 'string',
          description: 'End of the range, ISO-8601.',
        },
        group: {
          type: 'string',
          description:
            'How to aggregate: project | category | ticket | day | none (just total).',
          enum: ['project', 'category', 'ticket', 'day', 'none'],
        },
        topicFilter: {
          type: 'string',
          description: 'Optional substring filter (same as get_blocks_in_range).',
        },
      },
      required: ['startIso', 'endIso', 'group'],
    },
  },
  {
    name: 'get_block_details',
    description:
      'Get full details (notes, artifacts, supporting observations) for a specific block, looked up by id OR by a free-text query that matches the block title or narrative. Use this when the user asks "tell me more about X" or refers to a specific task.',
    parameters: {
      type: 'object',
      properties: {
        blockId: {
          type: 'string',
          description: 'Exact block id, if known.',
        },
        query: {
          type: 'string',
          description:
            'Free-text query to find the most relevant block (matched against title and narrative). Used when blockId is unknown.',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_observations_in_range',
    description:
      'Return raw screen-capture observations in a time range. Each observation is a finer-grained moment than a block — useful when the user asks "what was I doing at 3pm?" or "what did I learn from researching X?". Optionally filter by a substring against the observation summary.',
    parameters: {
      type: 'object',
      properties: {
        startIso: {
          type: 'string',
          description: 'Start of the range, ISO-8601.',
        },
        endIso: {
          type: 'string',
          description: 'End of the range, ISO-8601.',
        },
        query: {
          type: 'string',
          description:
            'Optional case-insensitive substring filter applied to observation summary, hypothesis, and entities.',
        },
        limit: {
          type: 'number',
          description:
            'Max number of observations to return. Default 30, hard cap 100.',
        },
      },
      required: ['startIso', 'endIso'],
    },
  },
];

/* ----------------------------- Executors ----------------------------- */

export type ChatToolContext = {
  timeline: TimelineView;
  timezone: string;
};

export function executeChatTool(
  call: ChatToolCall,
  context: ChatToolContext,
): ChatToolResult {
  switch (call.name) {
    case 'get_blocks_in_range':
      return executeGetBlocksInRange(call.args, context);
    case 'get_total_time':
      return executeGetTotalTime(call.args, context);
    case 'get_block_details':
      return executeGetBlockDetails(call.args, context);
    case 'get_observations_in_range':
      return executeGetObservationsInRange(call.args, context);
    default: {
      const unknownName: never = call.name;
      return {error: `Unknown tool: ${String(unknownName)}`};
    }
  }
}

function executeGetBlocksInRange(
  args: ChatToolArgs,
  context: ChatToolContext,
): ChatToolResult {
  const startMs = parseIsoSafe(args.startIso);
  const endMs = parseIsoSafe(args.endIso);
  if (startMs == null || endMs == null) {
    return {error: 'startIso and endIso must be valid ISO-8601 timestamps.'};
  }
  const topicFilter =
    typeof args.topicFilter === 'string' ? args.topicFilter.toLowerCase() : null;

  const all = getAllPlanCalendarBlocks(context.timeline);
  const matches = all
    .filter(block => blockOverlapsRange(block, startMs, endMs))
    .filter(block => (topicFilter ? blockMatchesTopic(block, topicFilter) : true))
    .map(block => summariseBlock(block));

  return {
    range: {startIso: args.startIso, endIso: args.endIso},
    topicFilter: topicFilter ?? null,
    blockCount: matches.length,
    totalMinutes: matches.reduce((sum, b) => sum + b.durationMinutes, 0),
    blocks: matches,
  };
}

function executeGetTotalTime(
  args: ChatToolArgs,
  context: ChatToolContext,
): ChatToolResult {
  const startMs = parseIsoSafe(args.startIso);
  const endMs = parseIsoSafe(args.endIso);
  if (startMs == null || endMs == null) {
    return {error: 'startIso and endIso must be valid ISO-8601 timestamps.'};
  }
  const group = typeof args.group === 'string' ? args.group : 'none';
  const topicFilter =
    typeof args.topicFilter === 'string' ? args.topicFilter.toLowerCase() : null;

  const all = getAllPlanCalendarBlocks(context.timeline);
  const inRange = all
    .filter(block => blockOverlapsRange(block, startMs, endMs))
    .filter(block => (topicFilter ? blockMatchesTopic(block, topicFilter) : true));

  const totalMinutes = inRange.reduce(
    (sum, b) => sum + blockDurationMinutes(b),
    0,
  );

  if (group === 'none') {
    return {totalMinutes, blockCount: inRange.length, breakdown: []};
  }

  const buckets = new Map<string, {minutes: number; blockCount: number}>();
  for (const block of inRange) {
    const minutes = blockDurationMinutes(block);
    const labels = bucketsForBlock(block, group);
    if (labels.length === 0) {
      const fallback =
        group === 'day' ? toLocalDayKey(block.startTime, context.timezone) : '(unattributed)';
      addToBucket(buckets, fallback, minutes);
      continue;
    }
    for (const label of labels) {
      addToBucket(buckets, label, minutes);
    }
  }

  const breakdown = Array.from(buckets.entries())
    .map(([label, value]) => ({
      label,
      minutes: value.minutes,
      blockCount: value.blockCount,
    }))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 20);

  return {
    range: {startIso: args.startIso, endIso: args.endIso},
    topicFilter: topicFilter ?? null,
    group,
    totalMinutes,
    blockCount: inRange.length,
    breakdown,
  };
}

function executeGetBlockDetails(
  args: ChatToolArgs,
  context: ChatToolContext,
): ChatToolResult {
  const all = getAllPlanCalendarBlocks(context.timeline);
  let block: WorklogCalendarBlock | null = null;

  if (typeof args.blockId === 'string' && args.blockId.length > 0) {
    block = all.find(candidate => candidate.id === args.blockId) ?? null;
  }
  if (block == null && typeof args.query === 'string' && args.query.length > 0) {
    const q = args.query.toLowerCase();
    block =
      all
        .map(candidate => ({
          candidate,
          score: scoreBlockForQuery(candidate, q),
        }))
        .filter(entry => entry.score > 0)
        .sort((a, b) => b.score - a.score)[0]?.candidate ?? null;
  }

  if (block == null) {
    return {error: 'No matching block found.'};
  }

  const observations = block.summary.provenance.supportedByObservationIds
    .map(id => context.timeline.observationsById[id])
    .filter((observation): observation is ObservationView => observation != null)
    .map(observation => ({
      observedAt: observation.observedAt,
      summary: observation.structured?.summary ?? observation.text,
      taskHypothesis: observation.structured?.taskHypothesis ?? null,
      activityType: observation.structured?.activityType ?? null,
      apps: observation.structured?.entities.apps ?? [],
      urls: observation.structured?.entities.urls ?? [],
    }))
    .slice(0, 20);

  return {
    block: {
      id: block.id,
      title: block.title,
      startTime: block.startTime,
      endTime: block.endTime,
      durationMinutes: blockDurationMinutes(block),
      label: block.label,
      category: block.category ?? null,
      confidence: block.confidence,
      narrative: block.summary.narrative,
      notes: block.notes ?? '',
      keyActivities: block.keyActivities ?? [],
      artifacts: {
        apps: block.apps,
        repos: block.repos,
        tickets: block.tickets,
        documents: block.documents,
        urls: block.urls ?? [],
        people: block.people ?? [],
      },
    },
    supportingObservations: observations,
  };
}

function executeGetObservationsInRange(
  args: ChatToolArgs,
  context: ChatToolContext,
): ChatToolResult {
  const startMs = parseIsoSafe(args.startIso);
  const endMs = parseIsoSafe(args.endIso);
  if (startMs == null || endMs == null) {
    return {error: 'startIso and endIso must be valid ISO-8601 timestamps.'};
  }
  const queryRaw =
    typeof args.query === 'string' && args.query.length > 0 ? args.query.toLowerCase() : null;
  const limit = Math.min(
    100,
    Math.max(1, typeof args.limit === 'number' ? Math.floor(args.limit) : 30),
  );

  const matches: Array<{
    observedAt: string;
    summary: string;
    taskHypothesis: string | null;
    activityType: string | null;
    apps: string[];
    urls: string[];
  }> = [];

  for (const observationId of context.timeline.observationOrder) {
    const observation = context.timeline.observationsById[observationId];
    if (observation == null || observation.deletedAt != null) continue;
    const observedMs = parseIsoSafe(observation.observedAt);
    if (observedMs == null || observedMs < startMs || observedMs > endMs) continue;
    if (queryRaw != null && !observationMatchesQuery(observation, queryRaw)) continue;

    matches.push({
      observedAt: observation.observedAt,
      summary: observation.structured?.summary ?? observation.text,
      taskHypothesis: observation.structured?.taskHypothesis ?? null,
      activityType: observation.structured?.activityType ?? null,
      apps: observation.structured?.entities.apps ?? [],
      urls: observation.structured?.entities.urls ?? [],
    });

    if (matches.length >= limit) break;
  }

  return {
    range: {startIso: args.startIso, endIso: args.endIso},
    query: queryRaw ?? null,
    observationCount: matches.length,
    observations: matches,
  };
}

/* ----------------------------- Helpers ----------------------------- */

function parseIsoSafe(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function blockOverlapsRange(
  block: WorklogCalendarBlock,
  startMs: number,
  endMs: number,
): boolean {
  const blockStart = Date.parse(block.startTime);
  const blockEnd = Date.parse(block.endTime);
  if (!Number.isFinite(blockStart) || !Number.isFinite(blockEnd)) return false;
  return blockStart <= endMs && blockEnd >= startMs;
}

function blockMatchesTopic(
  block: WorklogCalendarBlock,
  topic: string,
): boolean {
  const haystack = [
    block.title,
    block.summary.narrative,
    block.notes ?? '',
    ...block.repos,
    ...block.tickets,
    ...block.documents,
    ...(block.urls ?? []),
    ...(block.people ?? []),
    ...block.apps,
    ...(block.keyActivities ?? []),
    ...block.summary.provenance.keyArtifacts,
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(topic);
}

function summariseBlock(block: WorklogCalendarBlock) {
  return {
    id: block.id,
    title: block.title,
    startTime: block.startTime,
    endTime: block.endTime,
    durationMinutes: blockDurationMinutes(block),
    label: block.label,
    category: block.category ?? null,
    narrative: block.summary.narrative,
    notes: truncate(block.notes ?? '', 1200),
    keyActivities: block.keyActivities ?? [],
    artifacts: {
      apps: block.apps,
      repos: block.repos,
      tickets: block.tickets,
      documents: block.documents,
      urls: block.urls ?? [],
      people: block.people ?? [],
    },
  };
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars - 1).trimEnd()}…`;
}

function blockDurationMinutes(block: WorklogCalendarBlock): number {
  const ms = Math.max(
    0,
    Date.parse(block.endTime) - Date.parse(block.startTime),
  );
  return Math.round(ms / 60000);
}

function bucketsForBlock(
  block: WorklogCalendarBlock,
  group: string,
): string[] {
  switch (group) {
    case 'project': {
      const labels: string[] = [];
      labels.push(...block.repos);
      if (labels.length === 0) labels.push(...block.documents.slice(0, 1));
      if (labels.length === 0 && block.summary.provenance.keyArtifacts.length > 0) {
        labels.push(block.summary.provenance.keyArtifacts[0]);
      }
      return labels.slice(0, 1);
    }
    case 'category':
      return [block.category ?? 'other'];
    case 'ticket':
      return block.tickets;
    case 'day':
      return [block.startTime.slice(0, 10)];
    default:
      return [];
  }
}

function toLocalDayKey(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

function addToBucket(
  buckets: Map<string, {minutes: number; blockCount: number}>,
  label: string,
  minutes: number,
): void {
  const existing = buckets.get(label);
  if (existing != null) {
    existing.minutes += minutes;
    existing.blockCount += 1;
  } else {
    buckets.set(label, {minutes, blockCount: 1});
  }
}

function scoreBlockForQuery(
  block: WorklogCalendarBlock,
  q: string,
): number {
  let score = 0;
  if (block.title.toLowerCase().includes(q)) score += 10;
  if (block.summary.narrative.toLowerCase().includes(q)) score += 5;
  if ((block.notes ?? '').toLowerCase().includes(q)) score += 4;
  for (const item of block.repos) if (item.toLowerCase().includes(q)) score += 3;
  for (const item of block.tickets) if (item.toLowerCase().includes(q)) score += 3;
  for (const item of block.documents) if (item.toLowerCase().includes(q)) score += 2;
  for (const item of block.summary.provenance.keyArtifacts) {
    if (item.toLowerCase().includes(q)) score += 2;
  }
  return score;
}

function observationMatchesQuery(
  observation: ObservationView,
  query: string,
): boolean {
  const fields: string[] = [
    observation.structured?.summary ?? observation.text,
    observation.structured?.taskHypothesis ?? '',
    ...(observation.structured?.entities.apps ?? []),
    ...(observation.structured?.entities.urls ?? []),
    ...(observation.structured?.entities.tickets ?? []),
    ...(observation.structured?.entities.repos ?? []),
    ...(observation.structured?.entities.documents ?? []),
  ];
  return fields.join(' ').toLowerCase().includes(query);
}
