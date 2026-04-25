import {
  createDomainId,
  createOccurredAt,
  type DomainEvent,
  type ObservationView,
  type TimelineView,
} from '../timeline/eventLog';
import {condenseObservations} from './condenseObservations';
import {
  AnthropicRetryableError,
  generateReplanBlocksWithAnthropic,
} from './providers/anthropicReplanEngine';
import {
  dedupeArtifactsCaseInsensitive,
  looksLikeWindowChrome,
} from './artifactDisplay';
import {
  generateReplanBlocks,
  GeminiRetryableError,
  type GeminiReplanInput,
  type GeminiReplanRawBlock,
  type GeminiReplanResult,
} from './providers/geminiReplanEngine';
import {
  PLANNER_PROMPT_VERSION,
  type PlannerRevisionCause,
  type PlannerFailureReason,
  type PlanBlock,
  type TaskPlanRevisionFailure,
  type TaskPlanSnapshot,
} from './types';

export type RunPlannerRevisionArgs = {
  timeline: TimelineView;
  now?: string;
  cause: PlannerRevisionCause;
  windowMs: number;
  maxObservationsInPrompt?: number;
  force?: boolean;
  apiKey?: string;
  model?: string;
  runReplan?: (input: GeminiReplanInput) => Promise<GeminiReplanResult>;
  runFallbackReplan?: (
    input: GeminiReplanInput,
  ) => Promise<GeminiReplanResult>;
};

export type RunPlannerRevisionResult =
  | {
      kind: 'success';
      events: DomainEvent[];
      snapshot: TaskPlanSnapshot;
    }
  | {
      kind: 'skipped';
      reason: 'no_observations' | 'no_new_observations';
    }
  | {
      kind: 'failure';
      events: DomainEvent[];
      failure: TaskPlanRevisionFailure;
    };

const MIN_BLOCK_DURATION_MS = 60 * 1000;

export async function runPlannerRevision(
  args: RunPlannerRevisionArgs,
): Promise<RunPlannerRevisionResult> {
  const {timeline} = args;
  const nowMs = args.now != null ? Date.parse(args.now) : Date.now();
  const windowStartMs = nowMs - args.windowMs;
  const windowStartAt = new Date(windowStartMs).toISOString();
  const windowEndAt = new Date(nowMs).toISOString();

  const observationsInWindow = collectObservationsInWindow(
    timeline,
    windowStartMs,
    nowMs,
  );

  if (observationsInWindow.length === 0) {
    return {kind: 'skipped', reason: 'no_observations'};
  }

  const previousSnapshot = findMostRecentSnapshotForSession(
    timeline,
    timeline.currentSessionId,
  );

  if (
    !args.force &&
    previousSnapshot != null &&
    matchesPreviousSnapshotInputs(previousSnapshot, observationsInWindow)
  ) {
    return {kind: 'skipped', reason: 'no_new_observations'};
  }

  const clusters = condenseObservations(observationsInWindow, {
    maxEntries: args.maxObservationsInPrompt,
  });

  const primaryRunReplan = args.runReplan ?? generateReplanBlocks;
  const fallbackRunReplan =
    args.runFallbackReplan ?? generateReplanBlocksWithAnthropic;

  const replanInput: GeminiReplanInput = {
    windowStartAt,
    windowEndAt,
    clusters,
    previousSnapshot,
    apiKey: args.apiKey,
    model: args.model,
  };

  try {
    let result: GeminiReplanResult;
    try {
      result = await primaryRunReplan(replanInput);
    } catch (primaryError) {
      if (!shouldTryFallback(primaryError)) {
        throw primaryError;
      }
      try {
        result = await fallbackRunReplan({
          ...replanInput,
          // Clear apiKey/model so the fallback picks up its own defaults.
          apiKey: undefined,
          model: undefined,
        });
      } catch (fallbackError) {
        throw combineFallbackErrors(primaryError, fallbackError);
      }
    }

    const normalized = result.blocks
      .map(block =>
        normalizeBlock(block, windowStartMs, nowMs, observationsInWindow),
      )
      .filter((block): block is PlanBlock => block != null);
    const merged = mergeAdjacentBlocks(normalized);
    const blocks = merged.map(block => repairBlockHeadline(block));

    const snapshot: TaskPlanSnapshot = {
      snapshotId: createDomainId('plan_snapshot'),
      revisedAt: createOccurredAt(),
      windowStartAt,
      windowEndAt,
      sessionId: timeline.currentSessionId,
      blocks,
      model: result.model,
      promptVersion: result.promptVersion ?? PLANNER_PROMPT_VERSION,
      durationMs: result.durationMs,
      inputObservationCount: observationsInWindow.length,
      inputClusterCount: clusters.length,
      previousSnapshotId: previousSnapshot?.snapshotId ?? null,
      cause: args.cause,
      usage: result.usage,
    };

    return {
      kind: 'success',
      snapshot,
      events: [
        {
          id: createDomainId('event'),
          type: 'task_plan_revised',
          snapshot,
          occurredAt: snapshot.revisedAt,
        },
      ],
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Planner failed with unknown error.';
    const reason: PlannerFailureReason =
      error instanceof GeminiRetryableError ||
      error instanceof AnthropicRetryableError
        ? error.kind === 'rate_limited'
          ? 'rate_limited'
          : 'transient_overload'
        : message.includes('API key') || message.includes('api key')
          ? 'missing_api_key'
          : message.includes('JSON') || message.includes('schema')
            ? 'schema_validation_failed'
            : 'engine_error';

    const failure: TaskPlanRevisionFailure = {
      failedAt: createOccurredAt(),
      cause: args.cause,
      reason,
      message,
      windowStartAt,
      windowEndAt,
      inputObservationCount: observationsInWindow.length,
      inputClusterCount: clusters.length,
    };

    return {
      kind: 'failure',
      failure,
      events: [
        {
          id: createDomainId('event'),
          type: 'task_plan_revision_failed',
          failure,
          occurredAt: failure.failedAt,
        },
      ],
    };
  }
}

/**
 * Detect and repair activity-style headlines that slipped past the prompt.
 *
 * The replan prompt is explicit: headlines name TASKS, not activities. But LLMs
 * regress. If we see a gerund-first or "and-joined-activities" headline, we
 * rebuild it using the block's own anchors (ticket > PR > distinctive file >
 * repo). This runs AFTER the adjacent-merge pass so merged blocks also benefit.
 */
function repairBlockHeadline(block: PlanBlock): PlanBlock {
  if (isWellFormedTaskHeadline(block.headline)) {
    return block;
  }
  const synthesized = synthesizeHeadlineFromBlock(block);
  if (synthesized == null || synthesized === block.headline) {
    return block;
  }
  return {...block, headline: synthesized};
}

const GERUND_PREFIX_RE = /^(?:reviewing|debugging|configuring|developing|refactoring|implementing|writing|testing|managing|setting|handling|working|investigating|browsing|coding|planning|preparing|updating|fixing|building|checking|reading|monitoring|researching|drafting|deploying|syncing|triaging|analyzing|running|setting up)\b/i;
const GENERIC_ALONE_RE = /^(?:workflow|workflows|environment|config|configuration|setup|updates|code|changes|work|task|miscellaneous)(?:\s|$)/i;
const TWO_ACTIVITIES_RE = /^[a-z]+ing\s+(?:&|and)\s+[a-z]+/i;

export function isWellFormedTaskHeadline(headline: string): boolean {
  const trimmed = headline.trim();
  if (trimmed.length === 0) return false;
  if (GERUND_PREFIX_RE.test(trimmed)) return false;
  if (TWO_ACTIVITIES_RE.test(trimmed)) return false;
  if (GENERIC_ALONE_RE.test(trimmed)) return false;
  return true;
}

function synthesizeHeadlineFromBlock(block: PlanBlock): string | null {
  const ticket = block.artifacts.tickets[0];
  if (ticket != null && ticket.length > 0) {
    const suffix = guessShortTopic(block);
    return suffix != null ? `${ticket}: ${suffix}` : ticket;
  }

  const prFromUrl = firstPrNumber(block.artifacts.urls);
  if (prFromUrl != null) {
    const suffix = guessShortTopic(block);
    return suffix != null
      ? `${suffix} (PR ${prFromUrl})`
      : `PR ${prFromUrl}`;
  }

  const distinctiveFile = block.artifacts.documents.find(value =>
    isBlockDistinctiveFile(value),
  );
  if (distinctiveFile != null) {
    const basename = distinctiveFile.split('/').pop() ?? distinctiveFile;
    const stem = basename.replace(/\.[a-z0-9]{1,6}$/i, '');
    const humanStem = humanizeIdentifier(stem);
    return humanStem.length > 0 ? humanStem : basename;
  }

  const repo = block.artifacts.repositories[0];
  if (repo != null && repo.length > 0) {
    const topic = guessShortTopic(block);
    return topic != null ? `${repo}: ${topic}` : repo;
  }

  return null;
}

function firstPrNumber(urls: string[]): string | null {
  for (const url of urls) {
    const match = /\bpull\/(\d{2,7})\b/i.exec(url);
    if (match != null) return `#${match[1]}`;
  }
  return null;
}

function isBlockDistinctiveFile(path: string): boolean {
  const basename = path.split('/').pop() ?? path;
  if (/^package(-lock)?\.json$/i.test(basename)) return false;
  if (/^(readme|changelog|license)/i.test(basename)) return false;
  if (!/\.[a-z0-9]{1,6}$/i.test(basename) && !path.includes('/')) return false;
  return true;
}

function humanizeIdentifier(value: string): string {
  // e.g. dedupeAssignmentsByBrand -> "Dedupe assignments by brand"
  const spaced = value
    .replace(/[_\-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  if (spaced.length === 0) return value;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function guessShortTopic(block: PlanBlock): string | null {
  // Use the first key activity as a short topic, stripped of leading gerunds.
  const activity = block.keyActivities[0];
  if (activity == null) return null;
  const stripped = activity
    .replace(/^(reviewing|debugging|configuring|developing|refactoring|implementing|writing|testing|managing|setting|handling|working|investigating|browsing|coding|updating|fixing|building|checking|reading|researching|drafting|deploying|syncing|triaging|analyzing|running)\s+/i, '')
    .trim();
  if (stripped.length === 0 || stripped.length > 40) return null;
  return stripped;
}

/**
 * Drop observations that sit in an isolated time cluster inside a block.
 *
 * We sort the observation IDs by timestamp and split them at any gap wider
 * than OUTLIER_GAP_THRESHOLD_MS (15 min). If the split produces more than one
 * group, we keep the largest group (by observation count, then by time span)
 * and drop the rest. If all groups are the same size, we keep the earliest
 * one as a tiebreaker.
 *
 * This catches the common failure mode of the LLM merging one stray "glanced
 * at the Applications folder 40 min later" observation into an otherwise
 * coherent block.
 */
export function pruneOutlierObservationIds(
  sourceObservationIds: string[],
  observationIndex: Map<string, ObservationView>,
): string[] {
  if (sourceObservationIds.length < 2) return sourceObservationIds;

  const entries: Array<{id: string; ms: number; index: number}> = [];
  for (let i = 0; i < sourceObservationIds.length; i += 1) {
    const id = sourceObservationIds[i];
    const observation = observationIndex.get(id);
    if (observation == null) continue;
    const ms = Date.parse(observation.observedAt);
    if (Number.isNaN(ms)) continue;
    entries.push({id, ms, index: i});
  }

  if (entries.length < 2) return sourceObservationIds;

  entries.sort((a, b) => a.ms - b.ms);

  const groups: Array<Array<(typeof entries)[number]>> = [[entries[0]]];
  for (let i = 1; i < entries.length; i += 1) {
    const previous = entries[i - 1];
    const current = entries[i];
    if (current.ms - previous.ms > OUTLIER_GAP_THRESHOLD_MS) {
      groups.push([current]);
    } else {
      groups[groups.length - 1].push(current);
    }
  }

  if (groups.length === 1) return sourceObservationIds;

  let bestGroup = groups[0];
  let bestCount = bestGroup.length;
  let bestSpan = bestGroup[bestGroup.length - 1].ms - bestGroup[0].ms;
  for (let i = 1; i < groups.length; i += 1) {
    const group = groups[i];
    const count = group.length;
    const span = group[group.length - 1].ms - group[0].ms;
    if (count > bestCount || (count === bestCount && span > bestSpan)) {
      bestGroup = group;
      bestCount = count;
      bestSpan = span;
    }
  }

  const keptIds = new Set(bestGroup.map(entry => entry.id));
  return sourceObservationIds.filter(id => keptIds.has(id));
}

function shouldTryFallback(error: unknown): boolean {
  return error instanceof GeminiRetryableError;
}

function combineFallbackErrors(primary: unknown, fallback: unknown): Error {
  const primaryMessage =
    primary instanceof Error ? primary.message : String(primary);
  const fallbackMessage =
    fallback instanceof Error ? fallback.message : String(fallback);
  const combined = new Error(
    `Gemini failed (${primaryMessage}); Claude fallback also failed (${fallbackMessage}).`,
  );
  if (fallback instanceof AnthropicRetryableError) {
    return Object.assign(
      new AnthropicRetryableError(
        combined.message,
        fallback.status,
        fallback.kind,
      ),
    );
  }
  return combined;
}

function collectObservationsInWindow(
  timeline: TimelineView,
  windowStartMs: number,
  windowEndMs: number,
): ObservationView[] {
  const results: ObservationView[] = [];
  for (const observationId of timeline.observationOrder) {
    const observation = timeline.observationsById[observationId];
    if (observation == null || observation.deletedAt != null) {
      continue;
    }
    const observedMs = Date.parse(observation.observedAt);
    if (Number.isNaN(observedMs)) {
      continue;
    }
    if (observedMs < windowStartMs || observedMs > windowEndMs) {
      continue;
    }
    results.push(observation);
  }
  return results;
}

function findMostRecentSnapshotForSession(
  timeline: TimelineView,
  sessionId: string | null,
): TaskPlanSnapshot | null {
  for (let i = timeline.planSnapshots.length - 1; i >= 0; i -= 1) {
    const snapshot = timeline.planSnapshots[i];
    if (sessionId == null || snapshot.sessionId === sessionId) {
      return snapshot;
    }
  }
  return null;
}

function matchesPreviousSnapshotInputs(
  snapshot: TaskPlanSnapshot,
  observations: ObservationView[],
): boolean {
  if (snapshot.inputObservationCount !== observations.length) {
    return false;
  }
  const previousIds = new Set(
    snapshot.blocks.flatMap(block => block.sourceObservationIds),
  );
  for (const observation of observations) {
    if (!previousIds.has(observation.id)) {
      return false;
    }
  }
  return true;
}

const BLOCK_OBSERVATION_BUFFER_MS = 2 * 60 * 1000;
const OUTLIER_GAP_THRESHOLD_MS = 15 * 60 * 1000;

function normalizeBlock(
  raw: GeminiReplanRawBlock,
  windowStartMs: number,
  windowEndMs: number,
  observations: ObservationView[],
): PlanBlock | null {
  const startMs = Date.parse(raw.startAt);
  const endMs = Date.parse(raw.endAt);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return null;
  }

  const confidence = Math.max(0, Math.min(1, raw.confidence));
  const observationIndex = new Map<string, ObservationView>();
  for (const observation of observations) {
    observationIndex.set(observation.id, observation);
  }

  const validSourceIds = raw.sourceObservationIds.filter(id =>
    observationIndex.has(id),
  );

  // Drop isolated outliers — observations separated from the block's main
  // cluster by a huge gap. The LLM occasionally lumps a brief unrelated
  // screen event into a block ("looked at the Applications folder for a
  // moment 40 min after finishing the task"); this prunes those so the
  // block's time range and highlights stay honest.
  const sourceObservationIds = pruneOutlierObservationIds(
    validSourceIds,
    observationIndex,
  );

  // Tight-clamp the block's time range to the actual observation span so the
  // model can't extend a block into empty minutes. We allow a small buffer on
  // each side (±2 min) to cover work that happened just before the first
  // capture or just after the last one.
  let effectiveStartMs = Math.max(windowStartMs, startMs);
  let effectiveEndMs = Math.min(
    windowEndMs,
    Math.max(endMs, effectiveStartMs + MIN_BLOCK_DURATION_MS),
  );

  if (sourceObservationIds.length > 0) {
    let earliestObservationMs = Infinity;
    let latestObservationMs = -Infinity;
    for (const id of sourceObservationIds) {
      const observation = observationIndex.get(id);
      if (observation == null) continue;
      const ms = Date.parse(observation.observedAt);
      if (Number.isNaN(ms)) continue;
      if (ms < earliestObservationMs) earliestObservationMs = ms;
      if (ms > latestObservationMs) latestObservationMs = ms;
    }
    if (
      Number.isFinite(earliestObservationMs) &&
      Number.isFinite(latestObservationMs)
    ) {
      const floorStart = Math.max(
        windowStartMs,
        earliestObservationMs - BLOCK_OBSERVATION_BUFFER_MS,
      );
      const ceilEnd = Math.min(
        windowEndMs,
        latestObservationMs + BLOCK_OBSERVATION_BUFFER_MS,
      );
      // Prefer what the model said but never let it stretch past the real
      // observation span in either direction.
      effectiveStartMs = Math.max(effectiveStartMs, floorStart);
      effectiveEndMs = Math.min(effectiveEndMs, ceilEnd);
    }
  }

  const clampedStart = effectiveStartMs;
  const clampedEnd = Math.max(
    effectiveEndMs,
    clampedStart + MIN_BLOCK_DURATION_MS,
  );

  if (clampedEnd - clampedStart < MIN_BLOCK_DURATION_MS) {
    return null;
  }

  return {
    id: `plan_block_${clampedStart}_${sourceObservationIds[0] ?? 'none'}`,
    startAt: new Date(clampedStart).toISOString(),
    endAt: new Date(clampedEnd).toISOString(),
    headline: raw.headline.trim(),
    narrative: raw.narrative.trim(),
    notes: typeof raw.notes === 'string' ? raw.notes.trim() : '',
    label: raw.label,
    category: raw.category,
    confidence,
    keyActivities: dedupeArtifactsCaseInsensitive(
      raw.keyActivities.map(value => value.trim()).filter(v => v.length > 0),
    ),
    artifacts: {
      apps: cleanArtifactList(raw.artifacts.apps, {stripChrome: false}),
      repositories: cleanArtifactList(raw.artifacts.repositories, {stripChrome: false}),
      urls: cleanArtifactList(raw.artifacts.urls, {stripChrome: false}),
      tickets: cleanArtifactList(raw.artifacts.tickets, {stripChrome: false}),
      documents: cleanArtifactList(raw.artifacts.documents, {stripChrome: true}),
      people: cleanArtifactList(raw.artifacts.people, {stripChrome: false}),
    },
    reasonCodes: dedupeArtifactsCaseInsensitive(raw.reasonCodes),
    sourceObservationIds,
  };
}

function cleanArtifactList(
  values: string[],
  options: {stripChrome: boolean},
): string[] {
  const filtered = options.stripChrome
    ? values.filter(value => !looksLikeWindowChrome(value))
    : values;
  return dedupeArtifactsCaseInsensitive(filtered);
}

const ADJACENT_MERGE_GAP_MS = 5 * 60 * 1000;

export function mergeAdjacentBlocks(
  blocks: PlanBlock[],
): PlanBlock[] {
  if (blocks.length < 2) return blocks;
  const sorted = [...blocks].sort((a, b) => a.startAt.localeCompare(b.startAt));

  let changed = true;
  let current = sorted;
  let safety = 0;
  while (changed && safety < 10) {
    changed = false;
    safety += 1;
    const next: PlanBlock[] = [];
    for (const block of current) {
      const last = next[next.length - 1];
      if (last != null && shouldMergeAdjacent(last, block)) {
        next[next.length - 1] = mergeBlocks(last, block);
        changed = true;
      } else {
        next.push(block);
      }
    }
    current = next;
  }
  return current;
}

function shouldMergeAdjacent(a: PlanBlock, b: PlanBlock): boolean {
  const gapMs = Date.parse(b.startAt) - Date.parse(a.endAt);
  if (gapMs > ADJACENT_MERGE_GAP_MS) return false;

  const aRepo = a.artifacts.repositories[0]?.toLowerCase();
  const bRepo = b.artifacts.repositories[0]?.toLowerCase();
  if (aRepo != null && bRepo != null && aRepo === bRepo) return true;

  if (sharesAny(a.artifacts.tickets, b.artifacts.tickets)) return true;
  if (sharesAny(a.artifacts.documents, b.artifacts.documents)) return true;

  const aPrimaryFile = firstFileArtifact(a);
  const bPrimaryFile = firstFileArtifact(b);
  if (
    aPrimaryFile != null &&
    bPrimaryFile != null &&
    aPrimaryFile.toLowerCase() === bPrimaryFile.toLowerCase()
  ) {
    return true;
  }

  const sharedCount = countSharedArtifacts(a, b);
  const total = countArtifacts(a) + countArtifacts(b);
  if (total === 0) return false;
  return (sharedCount * 2) / total >= 0.5;
}

function sharesAny(left: string[], right: string[]): boolean {
  if (left.length === 0 || right.length === 0) return false;
  const rightSet = new Set(right.map(value => value.toLowerCase()));
  return left.some(value => rightSet.has(value.toLowerCase()));
}

function firstFileArtifact(block: PlanBlock): string | null {
  for (const value of block.artifacts.documents) {
    if (value.includes('/') || /\.[\w]{1,6}$/.test(value)) {
      return value;
    }
  }
  return null;
}

function countSharedArtifacts(
  a: PlanBlock,
  b: PlanBlock,
): number {
  const fields: Array<keyof PlanBlock['artifacts']> = [
    'repositories',
    'tickets',
    'documents',
    'people',
    'urls',
    'apps',
  ];
  let shared = 0;
  for (const field of fields) {
    const rightSet = new Set(
      b.artifacts[field].map(value => value.toLowerCase()),
    );
    for (const value of a.artifacts[field]) {
      if (rightSet.has(value.toLowerCase())) shared += 1;
    }
  }
  return shared;
}

function countArtifacts(block: PlanBlock): number {
  return (
    block.artifacts.repositories.length +
    block.artifacts.tickets.length +
    block.artifacts.documents.length +
    block.artifacts.people.length +
    block.artifacts.urls.length +
    block.artifacts.apps.length
  );
}

function mergeBlocks(
  a: PlanBlock,
  b: PlanBlock,
): PlanBlock {
  const primary = durationMs(a) >= durationMs(b) ? a : b;
  const secondary = primary === a ? b : a;

  const mergedArtifacts = {
    apps: dedupeArtifactsCaseInsensitive([
      ...a.artifacts.apps,
      ...b.artifacts.apps,
    ]),
    repositories: dedupeArtifactsCaseInsensitive([
      ...a.artifacts.repositories,
      ...b.artifacts.repositories,
    ]),
    urls: dedupeArtifactsCaseInsensitive([...a.artifacts.urls, ...b.artifacts.urls]),
    tickets: dedupeArtifactsCaseInsensitive([
      ...a.artifacts.tickets,
      ...b.artifacts.tickets,
    ]),
    documents: dedupeArtifactsCaseInsensitive([
      ...a.artifacts.documents,
      ...b.artifacts.documents,
    ]),
    people: dedupeArtifactsCaseInsensitive([
      ...a.artifacts.people,
      ...b.artifacts.people,
    ]),
  };

  const mergedObservationIds = Array.from(
    new Set([...a.sourceObservationIds, ...b.sourceObservationIds]),
  ).slice(0, 40);

  return {
    id: a.id,
    startAt: a.startAt,
    endAt: b.endAt,
    headline: primary.headline,
    narrative: combineNarratives(primary.narrative, secondary.narrative),
    notes: combineNotes(primary.notes ?? '', secondary.notes ?? ''),
    label: primary.label,
    category: primary.category,
    confidence: (a.confidence + b.confidence) / 2,
    keyActivities: dedupeArtifactsCaseInsensitive([
      ...primary.keyActivities,
      ...secondary.keyActivities,
    ]).slice(0, 6),
    artifacts: mergedArtifacts,
    reasonCodes: dedupeArtifactsCaseInsensitive([
      ...a.reasonCodes,
      ...b.reasonCodes,
    ]).slice(0, 6),
    sourceObservationIds: mergedObservationIds,
  };
}

function combineNotes(primary: string, secondary: string): string {
  const primaryTrimmed = primary.trim();
  const secondaryTrimmed = secondary.trim();
  if (secondaryTrimmed.length === 0) return primaryTrimmed;
  if (primaryTrimmed.length === 0) return secondaryTrimmed;
  if (
    primaryTrimmed.toLowerCase() === secondaryTrimmed.toLowerCase() ||
    primaryTrimmed.includes(secondaryTrimmed) ||
    secondaryTrimmed.includes(primaryTrimmed)
  ) {
    return primaryTrimmed.length >= secondaryTrimmed.length
      ? primaryTrimmed
      : secondaryTrimmed;
  }
  return `${primaryTrimmed}\n${secondaryTrimmed}`;
}

function durationMs(block: PlanBlock): number {
  return Math.max(0, Date.parse(block.endAt) - Date.parse(block.startAt));
}

function combineNarratives(primary: string, secondary: string): string {
  const primaryTrimmed = primary.trim();
  const secondaryTrimmed = secondary.trim();
  if (secondaryTrimmed.length === 0) return primaryTrimmed;
  if (primaryTrimmed.length === 0) return secondaryTrimmed;
  if (
    primaryTrimmed.toLowerCase().includes(secondaryTrimmed.toLowerCase()) ||
    secondaryTrimmed.toLowerCase().includes(primaryTrimmed.toLowerCase())
  ) {
    return primaryTrimmed.length >= secondaryTrimmed.length
      ? primaryTrimmed
      : secondaryTrimmed;
  }
  const separator = primaryTrimmed.endsWith('.') ? ' ' : '. ';
  return `${primaryTrimmed}${separator}${secondaryTrimmed}`;
}
