import type { ObservationView, TimelineView } from '../timeline/eventLog';
import type { CalendarContext, CalendarContextEvent } from '../calendar/types';
import type { WorklogCalendarBlock } from '../worklog/types';
import { getAllPlanCalendarBlocks } from '../planner/selectors';
import { getObservationPossibleObjective } from '../observation/intent';
import { normalizeProjects, normalizeTasks } from '../workArtifacts';

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
  | 'get_observations_in_range'
  | 'get_meeting_notes_in_range'
  | 'get_calendar_events_in_range'
  | 'get_availability_in_range';

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
      'Aggregate focused minutes across blocks in a time range, broken down by group. Use group="project" for projects/clients/campaigns/accounts. group="task" for concrete tasks or task IDs. group="category" for activity types. group="day" for daily totals.',
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
            'How to aggregate: project | task | category | ticket | day | none (ticket is a legacy alias for task).',
          enum: ['project', 'task', 'category', 'ticket', 'day', 'none'],
        },
        topicFilter: {
          type: 'string',
          description:
            'Optional substring filter (same as get_blocks_in_range).',
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
  {
    name: 'get_meeting_notes_in_range',
    description:
      'Return transcribed meeting notes in a time range, including summaries, decisions, action items, and short transcript snippets. Use this when the user asks what happened in a meeting or asks for decisions/follow-ups from calls.',
    parameters: {
      type: 'object',
      properties: {
        startIso: {
          type: 'string',
          description: 'Start of the range, ISO-8601 timestamp. Inclusive.',
        },
        endIso: {
          type: 'string',
          description: 'End of the range, ISO-8601 timestamp. Inclusive.',
        },
        query: {
          type: 'string',
          description:
            'Optional case-insensitive substring filter applied to meeting title, summary, transcript, decisions, and action items.',
        },
        includeTranscript: {
          type: 'boolean',
          description:
            'Whether to include transcript snippets. Default true, capped to short excerpts.',
        },
      },
      required: ['startIso', 'endIso'],
    },
  },
  {
    name: 'get_calendar_events_in_range',
    description:
      'Return read-only Google Calendar events in a time range, including local Flow annotations when present. Calendar events express schedule intent, not proof that the user completed work unless Flow observations also support it.',
    parameters: {
      type: 'object',
      properties: {
        startIso: {
          type: 'string',
          description: 'Start of the range, ISO-8601 timestamp. Inclusive.',
        },
        endIso: {
          type: 'string',
          description: 'End of the range, ISO-8601 timestamp. Inclusive.',
        },
        includeFreeEvents: {
          type: 'boolean',
          description:
            'Whether to include transparent/free calendar events. Default false.',
        },
      },
      required: ['startIso', 'endIso'],
    },
  },
  {
    name: 'get_availability_in_range',
    description:
      'Return free time windows after subtracting busy scheduled Google Calendar events. Context-only events are visible context but do not block availability.',
    parameters: {
      type: 'object',
      properties: {
        startIso: {
          type: 'string',
          description: 'Start of the range, ISO-8601 timestamp. Inclusive.',
        },
        endIso: {
          type: 'string',
          description: 'End of the range, ISO-8601 timestamp. Inclusive.',
        },
        minMinutes: {
          type: 'number',
          description: 'Minimum free slot duration in minutes. Default 15.',
        },
      },
      required: ['startIso', 'endIso'],
    },
  },
];

/* ----------------------------- Executors ----------------------------- */

export type ChatToolContext = {
  timeline: TimelineView;
  calendarContext?: CalendarContext;
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
    case 'get_meeting_notes_in_range':
      return executeGetMeetingNotesInRange(call.args, context);
    case 'get_calendar_events_in_range':
      return executeGetCalendarEventsInRange(call.args, context);
    case 'get_availability_in_range':
      return executeGetAvailabilityInRange(call.args, context);
    default: {
      const unknownName: never = call.name;
      return { error: `Unknown tool: ${String(unknownName)}` };
    }
  }
}

function executeGetMeetingNotesInRange(
  args: ChatToolArgs,
  context: ChatToolContext,
): ChatToolResult {
  const startMs = parseIsoSafe(args.startIso);
  const endMs = parseIsoSafe(args.endIso);
  if (startMs == null || endMs == null) {
    return { error: 'startIso and endIso must be valid ISO-8601 timestamps.' };
  }
  const query =
    typeof args.query === 'string' ? args.query.trim().toLowerCase() : null;
  const includeTranscript = args.includeTranscript !== false;
  const meetings = context.timeline.meetingRecordingOrder
    .map(meetingId => context.timeline.meetingRecordingsById[meetingId])
    .filter(recording => recording != null)
    .filter(recording => {
      const startedMs = Date.parse(recording.startedAt);
      const stoppedMs =
        recording.stoppedAt != null
          ? Date.parse(recording.stoppedAt)
          : startedMs;
      return (
        Number.isFinite(startedMs) &&
        Number.isFinite(stoppedMs) &&
        startedMs <= endMs &&
        stoppedMs >= startMs
      );
    })
    .map(recording => {
      const summary =
        context.timeline.meetingSummariesByMeetingId[recording.meetingId] ??
        null;
      const transcriptChunks =
        context.timeline.meetingTranscriptChunksByMeetingId[
          recording.meetingId
        ] ?? [];
      return {
        id: recording.meetingId,
        title:
          summary?.title ??
          recording.windowTitle ??
          recording.appName ??
          'Meeting',
        startedAt: recording.startedAt,
        stoppedAt: recording.stoppedAt,
        status: recording.status,
        appName: recording.appName,
        calendarEventId: recording.calendarEventId,
        summary: summary?.summary ?? null,
        decisions: summary?.decisions ?? [],
        actionItems: summary?.actionItems ?? [],
        followUps: summary?.followUps ?? [],
        questions: summary?.questions ?? [],
        transcriptSnippets: includeTranscript
          ? transcriptChunks
              .map(chunk => ({
                chunkId: chunk.chunkId,
                startedAt: chunk.startedAt,
                endedAt: chunk.endedAt,
                text: truncate(chunk.text, 360),
                speakerLabel: chunk.speakerLabel,
              }))
              .slice(0, 8)
          : [],
        transcriptChunkCount: transcriptChunks.length,
      };
    })
    .filter(meeting =>
      query == null ? true : meetingMatchesQuery(meeting, query),
    );

  return {
    range: { startIso: args.startIso, endIso: args.endIso },
    meetingCount: meetings.length,
    meetings,
  };
}

function executeGetCalendarEventsInRange(
  args: ChatToolArgs,
  context: ChatToolContext,
): ChatToolResult {
  const startMs = parseIsoSafe(args.startIso);
  const endMs = parseIsoSafe(args.endIso);
  if (startMs == null || endMs == null) {
    return { error: 'startIso and endIso must be valid ISO-8601 timestamps.' };
  }
  const includeFreeEvents = args.includeFreeEvents === true;
  const events = (context.calendarContext?.events ?? [])
    .filter(event => calendarEventOverlapsRange(event, startMs, endMs))
    .filter(event => includeFreeEvents || event.busy)
    .map(event => ({
      id: event.id,
      title: event.title,
      startTime: event.startTime,
      endTime: event.endTime,
      allDay: event.allDay,
      busy: event.busy,
      eventType: event.eventType,
      mode: event.mode,
      sourceSummary: event.sourceSummary,
      annotation: event.annotation,
    }));

  return {
    range: { startIso: args.startIso, endIso: args.endIso },
    eventCount: events.length,
    events,
  };
}

function executeGetAvailabilityInRange(
  args: ChatToolArgs,
  context: ChatToolContext,
): ChatToolResult {
  const startMs = parseIsoSafe(args.startIso);
  const endMs = parseIsoSafe(args.endIso);
  if (startMs == null || endMs == null) {
    return { error: 'startIso and endIso must be valid ISO-8601 timestamps.' };
  }
  const minMinutes = Math.max(
    1,
    typeof args.minMinutes === 'number' ? Math.floor(args.minMinutes) : 15,
  );
  const busyEvents = (context.calendarContext?.events ?? [])
    .filter(event => event.busy && event.mode === 'scheduled')
    .filter(event => calendarEventOverlapsRange(event, startMs, endMs))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const slots = computeFreeSlots(startMs, endMs, busyEvents)
    .filter(slot => slot.durationMinutes >= minMinutes)
    .slice(0, 20);

  return {
    range: { startIso: args.startIso, endIso: args.endIso },
    minMinutes,
    busyEventCount: busyEvents.length,
    slots,
  };
}

function executeGetBlocksInRange(
  args: ChatToolArgs,
  context: ChatToolContext,
): ChatToolResult {
  const startMs = parseIsoSafe(args.startIso);
  const endMs = parseIsoSafe(args.endIso);
  if (startMs == null || endMs == null) {
    return { error: 'startIso and endIso must be valid ISO-8601 timestamps.' };
  }
  const topicFilter =
    typeof args.topicFilter === 'string'
      ? args.topicFilter.toLowerCase()
      : null;

  const all = getAllPlanCalendarBlocks(context.timeline);
  const matches = all
    .filter(block => blockOverlapsRange(block, startMs, endMs))
    .filter(block =>
      topicFilter ? blockMatchesTopic(block, topicFilter) : true,
    )
    .map(block => summariseBlock(block));

  return {
    range: { startIso: args.startIso, endIso: args.endIso },
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
    return { error: 'startIso and endIso must be valid ISO-8601 timestamps.' };
  }
  const group = typeof args.group === 'string' ? args.group : 'none';
  const topicFilter =
    typeof args.topicFilter === 'string'
      ? args.topicFilter.toLowerCase()
      : null;

  const all = getAllPlanCalendarBlocks(context.timeline);
  const inRange = all
    .filter(block => blockOverlapsRange(block, startMs, endMs))
    .filter(block =>
      topicFilter ? blockMatchesTopic(block, topicFilter) : true,
    );

  const totalMinutes = inRange.reduce(
    (sum, b) => sum + blockDurationMinutes(b),
    0,
  );

  if (group === 'none') {
    return { totalMinutes, blockCount: inRange.length, breakdown: [] };
  }

  const buckets = new Map<string, { minutes: number; blockCount: number }>();
  for (const block of inRange) {
    const minutes = blockDurationMinutes(block);
    const labels = bucketsForBlock(block, group);
    if (labels.length === 0) {
      const fallback =
        group === 'day'
          ? toLocalDayKey(block.startTime, context.timezone)
          : '(unattributed)';
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
    range: { startIso: args.startIso, endIso: args.endIso },
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
  if (
    block == null &&
    typeof args.query === 'string' &&
    args.query.length > 0
  ) {
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
    return { error: 'No matching block found.' };
  }

  const observations = block.summary.provenance.supportedByObservationIds
    .map(id => context.timeline.observationsById[id])
    .filter(
      (observation): observation is ObservationView => observation != null,
    )
    .map(observation => ({
      observedAt: observation.observedAt,
      summary: observation.structured?.summary ?? observation.text,
      taskHypothesis:
        observation.structured != null
          ? getObservationPossibleObjective(observation.structured)
          : null,
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
      nextActions: block.nextActions ?? [],
      artifacts: {
        apps: block.apps,
        projects: normalizeProjects({
          projects: block.projects,
          repos: block.repos,
        }),
        tasks: normalizeTasks({ tasks: block.tasks, tickets: block.tickets }),
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
    return { error: 'startIso and endIso must be valid ISO-8601 timestamps.' };
  }
  const queryRaw =
    typeof args.query === 'string' && args.query.length > 0
      ? args.query.toLowerCase()
      : null;
  const limit = Math.min(
    100,
    Math.max(1, typeof args.limit === 'number' ? Math.floor(args.limit) : 30),
  );

  const matches: Array<{
    observedAt: string;
    summary: string;
    taskHypothesis: string | null;
    possibleObjective?: string | null;
    possibleProject?: string | null;
    possibleTask?: string | null;
    visibleAction?: string | null;
    activityType: string | null;
    apps: string[];
    urls: string[];
  }> = [];

  for (const observationId of context.timeline.observationOrder) {
    const observation = context.timeline.observationsById[observationId];
    if (observation == null || observation.deletedAt != null) continue;
    const observedMs = parseIsoSafe(observation.observedAt);
    if (observedMs == null || observedMs < startMs || observedMs > endMs)
      continue;
    if (queryRaw != null && !observationMatchesQuery(observation, queryRaw))
      continue;

    matches.push({
      observedAt: observation.observedAt,
      summary: observation.structured?.summary ?? observation.text,
      taskHypothesis:
        observation.structured != null
          ? getObservationPossibleObjective(observation.structured)
          : null,
      possibleObjective: observation.structured?.possibleObjective,
      possibleProject: observation.structured?.possibleProject,
      possibleTask: observation.structured?.possibleTask,
      visibleAction: observation.structured?.visibleAction,
      activityType: observation.structured?.activityType ?? null,
      apps: observation.structured?.entities.apps ?? [],
      urls: observation.structured?.entities.urls ?? [],
    });

    if (matches.length >= limit) break;
  }

  return {
    range: { startIso: args.startIso, endIso: args.endIso },
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

function calendarEventOverlapsRange(
  event: Pick<CalendarContextEvent, 'startTime' | 'endTime'>,
  startMs: number,
  endMs: number,
): boolean {
  const eventStart = Date.parse(event.startTime);
  const eventEnd = Date.parse(event.endTime);
  if (!Number.isFinite(eventStart) || !Number.isFinite(eventEnd)) return false;
  return eventStart < endMs && eventEnd > startMs;
}

function computeFreeSlots(
  startMs: number,
  endMs: number,
  busyEvents: CalendarContextEvent[],
): Array<{ startTime: string; endTime: string; durationMinutes: number }> {
  const slots: Array<{
    startTime: string;
    endTime: string;
    durationMinutes: number;
  }> = [];
  let cursor = startMs;
  for (const event of busyEvents) {
    const eventStart = Math.max(Date.parse(event.startTime), startMs);
    const eventEnd = Math.min(Date.parse(event.endTime), endMs);
    if (!Number.isFinite(eventStart) || !Number.isFinite(eventEnd)) continue;
    if (eventEnd <= cursor) continue;
    if (eventStart > cursor) {
      slots.push(makeSlot(cursor, eventStart));
    }
    cursor = Math.max(cursor, eventEnd);
  }
  if (cursor < endMs) {
    slots.push(makeSlot(cursor, endMs));
  }
  return slots;
}

function makeSlot(startMs: number, endMs: number) {
  return {
    startTime: new Date(startMs).toISOString(),
    endTime: new Date(endMs).toISOString(),
    durationMinutes: Math.max(0, Math.round((endMs - startMs) / 60000)),
  };
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
    ...(block.projects ?? []),
    ...(block.tasks ?? []),
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
    nextActions: block.nextActions ?? [],
    artifacts: {
      apps: block.apps,
      projects: normalizeProjects({ projects: block.projects, repos: block.repos }),
      tasks: normalizeTasks({ tasks: block.tasks, tickets: block.tickets }),
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

function bucketsForBlock(block: WorklogCalendarBlock, group: string): string[] {
  switch (group) {
    case 'project': {
      const labels: string[] = [];
      labels.push(...normalizeProjects({ projects: block.projects, repos: block.repos }));
      if (labels.length === 0) labels.push(...block.documents.slice(0, 1));
      if (
        labels.length === 0 &&
        block.summary.provenance.keyArtifacts.length > 0
      ) {
        labels.push(block.summary.provenance.keyArtifacts[0]);
      }
      return labels.slice(0, 1);
    }
    case 'category':
      return [block.category ?? 'other'];
    case 'task':
      return normalizeTasks({ tasks: block.tasks, tickets: block.tickets });
    case 'ticket':
      return normalizeTasks({ tasks: block.tasks, tickets: block.tickets });
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
  buckets: Map<string, { minutes: number; blockCount: number }>,
  label: string,
  minutes: number,
): void {
  const existing = buckets.get(label);
  if (existing != null) {
    existing.minutes += minutes;
    existing.blockCount += 1;
  } else {
    buckets.set(label, { minutes, blockCount: 1 });
  }
}

function scoreBlockForQuery(block: WorklogCalendarBlock, q: string): number {
  let score = 0;
  if (block.title.toLowerCase().includes(q)) score += 10;
  if (block.summary.narrative.toLowerCase().includes(q)) score += 5;
  if ((block.notes ?? '').toLowerCase().includes(q)) score += 4;
  for (const item of normalizeProjects({ projects: block.projects, repos: block.repos }))
    if (item.toLowerCase().includes(q)) score += 3;
  for (const item of normalizeTasks({ tasks: block.tasks, tickets: block.tickets }))
    if (item.toLowerCase().includes(q)) score += 3;
  for (const item of block.documents)
    if (item.toLowerCase().includes(q)) score += 2;
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
    observation.structured != null
      ? getObservationPossibleObjective(observation.structured) ?? ''
      : '',
    ...(observation.structured?.entities.apps ?? []),
    ...(observation.structured?.entities.urls ?? []),
    ...(observation.structured != null
      ? normalizeProjects(observation.structured.entities)
      : []),
    ...(observation.structured != null
      ? normalizeTasks(observation.structured.entities)
      : []),
    ...(observation.structured?.entities.tickets ?? []),
    ...(observation.structured?.entities.repos ?? []),
    ...(observation.structured?.entities.documents ?? []),
  ];
  return fields.join(' ').toLowerCase().includes(query);
}

function meetingMatchesQuery(
  meeting: {
    title: string;
    summary: string | null;
    decisions: string[];
    actionItems: string[];
    followUps: string[];
    questions: string[];
    transcriptSnippets: Array<{ text: string }>;
  },
  query: string,
): boolean {
  return [
    meeting.title,
    meeting.summary ?? '',
    ...meeting.decisions,
    ...meeting.actionItems,
    ...meeting.followUps,
    ...meeting.questions,
    ...meeting.transcriptSnippets.map(snippet => snippet.text),
  ]
    .join(' ')
    .toLowerCase()
    .includes(query);
}
