import {
  createOccurredAt,
  getTaskSegments,
  type ObservationView,
  type TimelineView,
  type UserBlockCorrectionView,
} from '../timeline/eventLog';
import type { WorklogCalendarBlock, WorklogDayView } from '../worklog/types';
import { pruneOutlierObservationIds } from './revisionEngine';
import {
  computeBlockNotesKey,
  mapBlockToWorklogCalendarBlock,
  type PlanBlock,
} from './types';
import type { TaskSegmentView } from '../tasks/types';
import { getObservationPossibleObjective } from '../observation/intent';
import { repairTaskTitle } from '../tasks/title';
import { normalizeProjects, normalizeTasks, uniqueWorkArtifacts } from '../workArtifacts';

const READ_TIME_BLOCK_BUFFER_MS = 2 * 60 * 1000;
const COVERAGE_GAP_MS = 3 * 60 * 1000;
const MAX_STABLE_SCREEN_EXTENSION_MS = 30 * 60 * 1000;
const MAX_ANCHORED_SINGLE_OBSERVATION_BLOCK_MS = 45 * 60 * 1000;
const MIN_UNANCHORED_BLOCK_DISPLAY_MS = 3 * 60 * 1000;
const MAX_RELATED_BLOCK_GAP_MS = 12 * 60 * 1000;
const MAX_BRIEF_INTERRUPTION_MS = 2 * 60 * 1000;

function blockProjects(block: WorklogCalendarBlock): string[] {
  return normalizeProjects({
    projects: block.projects,
    repos: block.repos,
  });
}

function blockTasks(block: WorklogCalendarBlock): string[] {
  return normalizeTasks({
    tasks: block.tasks,
    tickets: block.tickets,
  });
}

// Cache formatters by timezone — timezone changes are rare (effectively once per session)
const dateKeyFormatters = new Map<string, Intl.DateTimeFormat>();

function toDateKey(iso: string, timezone: string): string {
  let fmt = dateKeyFormatters.get(timezone);
  if (fmt == null) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    dateKeyFormatters.set(timezone, fmt);
  }
  return fmt.format(new Date(iso));
}

/**
 * Apply outlier pruning + tight time-clamping at READ time.
 *
 * Old snapshots persisted before write-time pruning was added still carry
 * stray observations that the LLM mistakenly merged into a block. Re-running
 * the same gap-detection at read time means those snapshots get cleaned up
 * for display without rewriting persisted data — and once a fresh replan
 * happens for the same window, this becomes a no-op on the new snapshot.
 */
function cleanBlockOfOutliers(
  block: PlanBlock,
  observationsById: Record<string, ObservationView>,
): PlanBlock {
  if (block.sourceObservationIds.length === 0) return block;

  const observationIndex = new Map<string, ObservationView>();
  for (const id of block.sourceObservationIds) {
    const observation = observationsById[id];
    if (observation != null) observationIndex.set(id, observation);
  }
  if (observationIndex.size === 0) return block;

  const originalStartMs = Date.parse(block.startAt);
  const originalEndMs = Date.parse(block.endAt);
  const originalDurationMs =
    Number.isFinite(originalStartMs) && Number.isFinite(originalEndMs)
      ? originalEndMs - originalStartMs
      : Infinity;
  if (
    block.sourceObservationIds.length === 1 &&
    hasPlanBlockTaskAnchor(block) &&
    originalDurationMs <= MAX_ANCHORED_SINGLE_OBSERVATION_BLOCK_MS
  ) {
    return block;
  }

  const prunedIds =
    block.sourceObservationIds.length > 1
      ? pruneOutlierObservationIds(block.sourceObservationIds, observationIndex)
      : block.sourceObservationIds;

  let earliestMs = Infinity;
  let latestMs = -Infinity;
  for (const id of prunedIds) {
    const observation = observationIndex.get(id);
    if (observation == null) continue;
    const ms = Date.parse(observation.observedAt);
    if (Number.isNaN(ms)) continue;
    if (ms < earliestMs) earliestMs = ms;
    if (ms > latestMs) latestMs = ms;
  }
  if (!Number.isFinite(earliestMs) || !Number.isFinite(latestMs)) return block;

  const newStartMs = Math.max(
    Number.isNaN(originalStartMs) ? earliestMs : originalStartMs,
    earliestMs - READ_TIME_BLOCK_BUFFER_MS,
  );
  const newEndMs = Math.min(
    Number.isNaN(originalEndMs) ? latestMs : originalEndMs,
    latestMs + READ_TIME_BLOCK_BUFFER_MS,
  );
  const safeEndMs = Math.max(newEndMs, newStartMs + 60 * 1000);

  return {
    ...block,
    sourceObservationIds: prunedIds,
    startAt: new Date(newStartMs).toISOString(),
    endAt: new Date(safeEndMs).toISOString(),
  };
}

export function getDayWorklog(
  timeline: TimelineView,
  dateIso: string,
  timezone: string,
): WorklogDayView {
  const targetDayKey = toDateKey(dateIso, timezone);
  const worklogBlocks = selectWorklogBlocksForDay(
    timeline,
    targetDayKey,
    timezone,
  );
  const focusedMinutes = worklogBlocks.reduce((sum, block) => {
    const durationMs = Math.max(
      0,
      Date.parse(block.endTime) - Date.parse(block.startTime),
    );
    return sum + Math.round(durationMs / (60 * 1000));
  }, 0);

  return {
    dateIso: targetDayKey,
    timezone,
    generatedAt: createOccurredAt(),
    blocks: worklogBlocks,
    totals: {
      blockCount: worklogBlocks.length,
      focusedMinutes,
    },
  };
}

function selectWorklogBlocksForDay(
  timeline: TimelineView,
  targetDayKey: string,
  timezone: string,
  snapshotWindowMs = buildSnapshotWindowMs(timeline),
): WorklogCalendarBlock[] {
  const planBlocks = selectPlanBlocksForDay(
    timeline,
    targetDayKey,
    timezone,
    snapshotWindowMs,
  );
  const hasPlannerCoverage = planBlocks.length > 0;
  const taskBlocks = hasPlannerCoverage
    ? []
    : selectTaskBlocksForDay(timeline, targetDayKey, timezone);
  return mergePlannerAndTaskBlocks(planBlocks, taskBlocks);
}

function selectPlanBlocksForDay(
  timeline: TimelineView,
  targetDayKey: string,
  timezone: string,
  snapshotWindowMs = buildSnapshotWindowMs(timeline),
): WorklogCalendarBlock[] {
  const rawBlocks = selectBlocksForDay(
    timeline,
    snapshotWindowMs,
    targetDayKey,
    timezone,
  );
  const blocks = rawBlocks.map(block =>
    cleanBlockOfOutliers(block, timeline.observationsById),
  );
  return blocks
    .map(block =>
      applyUserCorrections(mapBlockToWorklogCalendarBlock(block), timeline),
    )
    .filter(isDisplayableWorklogBlock);
}

type SnapshotWindowMs = { startMs: number; endMs: number };

function buildSnapshotWindowMs(timeline: TimelineView): SnapshotWindowMs[] {
  return timeline.planSnapshots.map(s => ({
    startMs: Date.parse(s.windowStartAt),
    endMs: Date.parse(s.windowEndAt),
  }));
}

function selectBlocksForDay(
  timeline: TimelineView,
  snapshotWindowMs: SnapshotWindowMs[],
  targetDayKey: string,
  timezone: string,
): PlanBlock[] {
  const selected: PlanBlock[] = [];
  const seenIds = new Set<string>();
  const seenSourceHashes = new Set<string>();

  for (let i = timeline.planSnapshots.length - 1; i >= 0; i -= 1) {
    const snapshot = timeline.planSnapshots[i];
    for (const block of snapshot.blocks) {
      if (seenIds.has(block.id)) {
        continue;
      }
      const sourceHash = hashSources(block.sourceObservationIds);
      if (sourceHash.length > 0 && seenSourceHashes.has(sourceHash)) {
        continue;
      }

      if (!blockMidpointMatchesDay(block, targetDayKey, timezone)) {
        continue;
      }

      if (isBlockSupersededByLaterSnapshot(snapshotWindowMs, i, block)) {
        continue;
      }

      seenIds.add(block.id);
      if (sourceHash.length > 0) {
        seenSourceHashes.add(sourceHash);
      }
      selected.push(block);
    }
  }

  return selected.sort((a, b) => a.startAt.localeCompare(b.startAt));
}

function isBlockSupersededByLaterSnapshot(
  snapshotWindowMs: SnapshotWindowMs[],
  currentIndex: number,
  block: PlanBlock,
): boolean {
  const blockStartMs = Date.parse(block.startAt);
  const blockEndMs = Date.parse(block.endAt);
  const midpointMs = blockStartMs + (blockEndMs - blockStartMs) / 2;

  for (let j = snapshotWindowMs.length - 1; j > currentIndex; j -= 1) {
    const { startMs, endMs } = snapshotWindowMs[j];
    if (midpointMs >= startMs && midpointMs <= endMs) {
      return true;
    }
  }
  return false;
}

function blockMidpointMatchesDay(
  block: PlanBlock,
  targetDayKey: string,
  timezone: string,
): boolean {
  const startMs = Date.parse(block.startAt);
  const endMs = Date.parse(block.endAt);
  const midpoint = new Date(startMs + (endMs - startMs) / 2).toISOString();
  return toDateKey(midpoint, timezone) === targetDayKey;
}

function hashSources(ids: string[]): string {
  if (ids.length === 0) {
    return '';
  }
  return ids.slice().sort().join('|');
}

export function selectPlanCalendarBlocksForDay(
  timeline: TimelineView,
  dateIso: string,
  timezone: string,
): WorklogCalendarBlock[] {
  return getDayWorklog(timeline, dateIso, timezone).blocks;
}

export function getWorklogForDates(
  timeline: TimelineView,
  dateIsos: string[],
  timezone: string,
): Record<string, WorklogCalendarBlock[]> {
  // Build snapshot window ranges once for all dates
  const snapshotWindowMs = buildSnapshotWindowMs(timeline);
  const result: Record<string, WorklogCalendarBlock[]> = {};
  for (const dateIso of dateIsos) {
    const targetDayKey = toDateKey(`${dateIso}T12:00:00.000Z`, timezone);
    result[targetDayKey] = selectWorklogBlocksForDay(
      timeline,
      targetDayKey,
      timezone,
      snapshotWindowMs,
    );
  }
  return result;
}

export function getAllPlanCalendarBlocks(
  timeline: TimelineView,
): WorklogCalendarBlock[] {
  const taskBlocks = selectAllTaskBlocks(timeline);
  const selected: PlanBlock[] = [];
  const seenIds = new Set<string>();
  const seenSourceHashes = new Set<string>();
  const snapshotWindowMs = buildSnapshotWindowMs(timeline);

  for (let i = timeline.planSnapshots.length - 1; i >= 0; i -= 1) {
    const snapshot = timeline.planSnapshots[i];
    for (const block of snapshot.blocks) {
      if (seenIds.has(block.id)) continue;
      const sourceHash = hashSources(block.sourceObservationIds);
      if (sourceHash.length > 0 && seenSourceHashes.has(sourceHash)) continue;
      if (isBlockSupersededByLaterSnapshot(snapshotWindowMs, i, block))
        continue;

      seenIds.add(block.id);
      if (sourceHash.length > 0) seenSourceHashes.add(sourceHash);
      selected.push(block);
    }
  }

  const planBlocks = selected
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
    .map(block => cleanBlockOfOutliers(block, timeline.observationsById))
    .map(block =>
      applyUserCorrections(mapBlockToWorklogCalendarBlock(block), timeline),
    )
    .filter(isDisplayableWorklogBlock);

  return mergePlannerAndTaskBlocks(planBlocks, taskBlocks);
}

function mergePlannerAndTaskBlocks(
  planBlocks: WorklogCalendarBlock[],
  taskBlocks: WorklogCalendarBlock[],
): WorklogCalendarBlock[] {
  const normalizedPlanBlocks = coalesceRelatedWorklogBlocks(planBlocks);
  const normalizedTaskBlocks = coalesceRelatedWorklogBlocks(taskBlocks);
  if (normalizedPlanBlocks.length === 0) return normalizedTaskBlocks;
  if (normalizedTaskBlocks.length === 0) return normalizedPlanBlocks;

  const retainedPlanBlocks = normalizedPlanBlocks.filter(
    block => !isWeakPlannerDuplicateOfTask(block, normalizedTaskBlocks),
  );
  const retainedTaskBlocks = normalizedTaskBlocks.filter(
    taskBlock =>
      !retainedPlanBlocks.some(planBlock =>
        blocksRepresentSameWork(planBlock, taskBlock),
      ),
  );

  return coalesceRelatedWorklogBlocks(
    retainedPlanBlocks.concat(retainedTaskBlocks),
  );
}

function coalesceRelatedWorklogBlocks(
  blocks: WorklogCalendarBlock[],
): WorklogCalendarBlock[] {
  if (blocks.length <= 1) return blocks;
  const sorted = blocks.slice().sort(compareWorklogBlocks);
  const withoutBriefInterruptions = sorted.filter(
    (block, index) =>
      !isBriefInterruptionBetweenRelatedWork(sorted, index, block),
  );
  const merged: WorklogCalendarBlock[] = [];
  for (const block of withoutBriefInterruptions) {
    const previous = merged.at(-1);
    if (
      previous != null &&
      shouldMergeSequentialWorklogBlocks(previous, block)
    ) {
      merged[merged.length - 1] = mergeWorklogBlockPair(previous, block);
    } else {
      merged.push(block);
    }
  }
  return merged.sort(compareWorklogBlocks);
}

function isBriefInterruptionBetweenRelatedWork(
  blocks: WorklogCalendarBlock[],
  index: number,
  block: WorklogCalendarBlock,
): boolean {
  if (!isBriefInterstitialBlock(block)) return false;
  const previous = blocks[index - 1];
  const next = blocks[index + 1];
  if (previous == null || next == null) return false;
  if (hasUserCorrection(previous) || hasUserCorrection(next)) return false;
  if (!areRelatedWorklogBlocks(previous, next)) return false;
  return gapBetweenBlocksMs(previous, next) <= MAX_RELATED_BLOCK_GAP_MS;
}

function isBriefInterstitialBlock(block: WorklogCalendarBlock): boolean {
  if (block.source === 'user_calendar') return false;
  if (hasUserCorrection(block)) return false;
  if (blockDurationMs(block) > MAX_BRIEF_INTERRUPTION_MS) return false;
  if (hasStrongTaskAnchor(block)) return false;
  return (
    block.category === 'browsing' ||
    block.category === 'other' ||
    block.category === 'communication'
  );
}

function shouldMergeSequentialWorklogBlocks(
  previous: WorklogCalendarBlock,
  next: WorklogCalendarBlock,
): boolean {
  if (previous.source === 'user_calendar' || next.source === 'user_calendar') {
    return false;
  }
  if (hasUserCorrection(previous) || hasUserCorrection(next)) return false;
  if (gapBetweenBlocksMs(previous, next) > MAX_RELATED_BLOCK_GAP_MS) {
    return false;
  }
  return areRelatedWorklogBlocks(previous, next);
}

function areRelatedWorklogBlocks(
  a: WorklogCalendarBlock,
  b: WorklogCalendarBlock,
): boolean {
  if (sharedValue(blockTasks(a), blockTasks(b)) != null) return true;
  if (sharedValue(a.calendarEventIds ?? [], b.calendarEventIds ?? []) != null) {
    return true;
  }
  if (
    sharedValue(normalizedDocuments(a), normalizedDocuments(b)) != null &&
    relatedCategories(a, b)
  ) {
    return true;
  }

  const sharedProject = sharedValue(blockProjects(a), blockProjects(b));
  const hasTitleOverlap = hasDistinctiveTitleTokenOverlap(a, b);
  if (sharedProject != null && hasTitleOverlap) return true;
  return hasTitleOverlap && relatedCategories(a, b);
}

function relatedCategories(
  a: WorklogCalendarBlock,
  b: WorklogCalendarBlock,
): boolean {
  if (a.category == null || b.category == null) return true;
  if (a.category === b.category) return true;
  const workCategories = new Set([
    'coding',
    'software_development',
    'debugging',
    'qa_testing',
    'review',
    'code_review',
    'document_review',
    'research',
    'analysis',
    'planning',
    'planning_strategy',
    'project_management',
  ]);
  return workCategories.has(a.category) && workCategories.has(b.category);
}

function hasDistinctiveTitleTokenOverlap(
  a: WorklogCalendarBlock,
  b: WorklogCalendarBlock,
): boolean {
  const left = new Set(distinctiveTitleTokens(a.title));
  if (left.size === 0) return false;
  return distinctiveTitleTokens(b.title).some(token => left.has(token));
}

function distinctiveTitleTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9#-]+/)
    .map(token => token.trim())
    .filter(
      token =>
        token.length > 0 &&
        !GENERIC_TITLE_TOKENS.has(token) &&
        (token.length >= 5 || /[#0-9-]/.test(token)),
    );
}

const GENERIC_TITLE_TOKENS = new Set([
  'support',
  'development',
  'implementation',
  'platform',
  'function',
  'search',
  'results',
  'review',
  'meeting',
  'update',
  'updates',
  'remapping',
]);

function mergeWorklogBlockPair(
  a: WorklogCalendarBlock,
  b: WorklogCalendarBlock,
): WorklogCalendarBlock {
  const sourceObservationIds = uniqueValues(
    a.summary.provenance.supportedByObservationIds.concat(
      b.summary.provenance.supportedByObservationIds,
    ),
  );
  const title = chooseMergedTitle(a, b);
  const notesKey =
    sourceObservationIds.length > 0
      ? computeBlockNotesKey(sourceObservationIds)
      : a.notesKey ?? b.notesKey;

  return {
    ...a,
    id: `${a.id}__merged__${b.id}`,
    lineageId: a.lineageId,
    segmentIds: uniqueValues(a.segmentIds.concat(b.segmentIds)),
    startTime: a.startTime <= b.startTime ? a.startTime : b.startTime,
    endTime: a.endTime >= b.endTime ? a.endTime : b.endTime,
    label: b.label === 'confirmed_completed' ? b.label : a.label,
    confidence: Math.min(a.confidence, b.confidence),
    title,
    summary: {
      headline: title,
      narrative: combineNarratives(a.summary.narrative, b.summary.narrative),
      provenance: {
        supportedByObservationIds: sourceObservationIds,
        supportedByEvidenceIds: uniqueValues(
          a.summary.provenance.supportedByEvidenceIds.concat(
            b.summary.provenance.supportedByEvidenceIds,
          ),
        ),
        keyArtifacts: uniqueValues(
          a.summary.provenance.keyArtifacts.concat(
            b.summary.provenance.keyArtifacts,
          ),
        ).slice(0, 12),
        reasonCodes: uniqueValues(
          a.summary.provenance.reasonCodes.concat(
            b.summary.provenance.reasonCodes,
            ['read_side_related_block_merge'],
          ),
        ),
      },
    },
    apps: uniqueValues(a.apps.concat(b.apps)),
    projects: uniqueWorkArtifacts([blockProjects(a), blockProjects(b)]),
    tasks: uniqueWorkArtifacts([blockTasks(a), blockTasks(b)]),
    repos: uniqueValues(a.repos.concat(b.repos)),
    tickets: uniqueValues(a.tickets.concat(b.tickets)),
    documents: uniqueValues(a.documents.concat(b.documents)),
    reasonCodes: uniqueValues(
      a.reasonCodes.concat(b.reasonCodes, ['read_side_related_block_merge']),
    ),
    keyActivities: uniqueValues(
      (a.keyActivities ?? []).concat(b.keyActivities ?? []),
    ).slice(-6),
    nextActions: uniqueValues(
      (a.nextActions ?? []).concat(b.nextActions ?? []),
    ),
    calendarEventIds: uniqueValues(
      (a.calendarEventIds ?? []).concat(b.calendarEventIds ?? []),
    ),
    people: uniqueValues((a.people ?? []).concat(b.people ?? [])),
    urls: uniqueValues((a.urls ?? []).concat(b.urls ?? [])),
    notes: combineOptionalText(a.notes, b.notes),
    notesKey,
    source: a.source === b.source ? a.source : a.source ?? b.source,
    continuityLinkage: {
      resumedFromLineageId:
        a.continuityLinkage.resumedFromLineageId ??
        b.continuityLinkage.resumedFromLineageId,
      resumedSegmentCount: Math.max(
        a.continuityLinkage.resumedSegmentCount,
        b.continuityLinkage.resumedSegmentCount,
      ),
    },
    debug: {
      decisionModes: uniqueValues(
        a.debug.decisionModes.concat(b.debug.decisionModes),
      ),
      decisionCount: a.debug.decisionCount + b.debug.decisionCount,
      retroAdjusted: a.debug.retroAdjusted || b.debug.retroAdjusted,
    },
  };
}

function chooseMergedTitle(
  a: WorklogCalendarBlock,
  b: WorklogCalendarBlock,
): string {
  const aDuration = blockDurationMs(a);
  const bDuration = blockDurationMs(b);
  if (bDuration > aDuration * 1.5) return b.title;
  return a.title;
}

function combineNarratives(a: string, b: string): string {
  if (a.trim().length === 0) return b;
  if (b.trim().length === 0 || a === b) return a;
  return `${a} ${b}`;
}

function combineOptionalText(
  a: string | undefined,
  b: string | undefined,
): string | undefined {
  const combined = combineNarratives(a ?? '', b ?? '').trim();
  return combined.length > 0 ? combined : undefined;
}

function gapBetweenBlocksMs(
  a: WorklogCalendarBlock,
  b: WorklogCalendarBlock,
): number {
  return Math.max(0, Date.parse(b.startTime) - Date.parse(a.endTime));
}

function normalizedDocuments(block: WorklogCalendarBlock): string[] {
  return block.documents.map(document => {
    const basename = document.split('/').pop() ?? document;
    return basename.toLowerCase();
  });
}

function hasUserCorrection(block: WorklogCalendarBlock): boolean {
  return block.userCorrection != null;
}

function sharedValue(
  a: readonly string[],
  b: readonly string[],
): string | null {
  const left = new Set(
    a.map(value => value.trim().toLowerCase()).filter(Boolean),
  );
  for (const value of b) {
    const normalized = value.trim().toLowerCase();
    if (left.has(normalized)) return normalized;
  }
  return null;
}

function uniqueValues(values: readonly string[]): string[] {
  return Array.from(
    new Set(values.map(value => value.trim()).filter(value => value.length > 0)),
  );
}

function isWeakPlannerDuplicateOfTask(
  planBlock: WorklogCalendarBlock,
  taskBlocks: WorklogCalendarBlock[],
): boolean {
  if (isStrongPlannerBlock(planBlock)) return false;
  const planDurationMs = blockDurationMs(planBlock);
  return taskBlocks.some(
    taskBlock =>
      blocksRepresentSameWork(planBlock, taskBlock) &&
      blockDurationMs(taskBlock) > planDurationMs,
  );
}

function isStrongPlannerBlock(block: WorklogCalendarBlock): boolean {
  if (block.userCorrection != null) return true;
  const sourceObservationCount = new Set(
    block.summary.provenance.supportedByObservationIds,
  ).size;
  if (sourceObservationCount > 1) return true;
  return blockDurationMs(block) >= MIN_UNANCHORED_BLOCK_DISPLAY_MS;
}

function blocksRepresentSameWork(
  a: WorklogCalendarBlock,
  b: WorklogCalendarBlock,
): boolean {
  if (shareObservationSupport(a, b)) return true;
  return blocksMeaningfullyOverlap(a, b);
}

function shareObservationSupport(
  a: WorklogCalendarBlock,
  b: WorklogCalendarBlock,
): boolean {
  const aSources = new Set(a.summary.provenance.supportedByObservationIds);
  if (aSources.size === 0) return false;
  return b.summary.provenance.supportedByObservationIds.some(id =>
    aSources.has(id),
  );
}

function blocksMeaningfullyOverlap(
  a: WorklogCalendarBlock,
  b: WorklogCalendarBlock,
): boolean {
  const aStartMs = Date.parse(a.startTime);
  const aEndMs = Date.parse(a.endTime);
  const bStartMs = Date.parse(b.startTime);
  const bEndMs = Date.parse(b.endTime);
  if (
    [aStartMs, aEndMs, bStartMs, bEndMs].some(value => Number.isNaN(value))
  ) {
    return false;
  }

  const overlapMs = Math.min(aEndMs, bEndMs) - Math.max(aStartMs, bStartMs);
  if (overlapMs <= 0) return false;

  const smallerDurationMs = Math.max(
    60 * 1000,
    Math.min(aEndMs - aStartMs, bEndMs - bStartMs),
  );
  if (overlapMs >= smallerDurationMs * 0.5) return true;

  const aMidpointMs = aStartMs + (aEndMs - aStartMs) / 2;
  const bMidpointMs = bStartMs + (bEndMs - bStartMs) / 2;
  return (
    isPointInsideRange(aMidpointMs, bStartMs, bEndMs) ||
    isPointInsideRange(bMidpointMs, aStartMs, aEndMs)
  );
}

function isPointInsideRange(pointMs: number, startMs: number, endMs: number) {
  return pointMs >= startMs && pointMs <= endMs;
}

function blockDurationMs(block: WorklogCalendarBlock): number {
  return Math.max(0, Date.parse(block.endTime) - Date.parse(block.startTime));
}

function compareWorklogBlocks(
  a: WorklogCalendarBlock,
  b: WorklogCalendarBlock,
): number {
  const startCompare = a.startTime.localeCompare(b.startTime);
  if (startCompare !== 0) return startCompare;
  const sourceCompare = sourceSortRank(a) - sourceSortRank(b);
  if (sourceCompare !== 0) return sourceCompare;
  const endCompare = a.endTime.localeCompare(b.endTime);
  if (endCompare !== 0) return endCompare;
  return a.id.localeCompare(b.id);
}

function sourceSortRank(block: WorklogCalendarBlock): number {
  if (block.source === 'user_calendar') return 0;
  if (block.source === 'planner') return 1;
  return 2;
}

function selectTaskBlocksForDay(
  timeline: TimelineView,
  targetDayKey: string,
  timezone: string,
): WorklogCalendarBlock[] {
  return selectAllTaskBlocks(timeline)
    .filter(block =>
      blockMidpointMatchesDay(
        {
          id: block.id,
          startAt: block.startTime,
          endAt: block.endTime,
          headline: block.title,
          narrative: block.summary.narrative,
          label: block.label,
          category: (block.category ?? 'other') as PlanBlock['category'],
          confidence: block.confidence,
          keyActivities: block.keyActivities ?? [],
          artifacts: {
            apps: block.apps,
            projects: blockProjects(block),
            tasks: blockTasks(block),
            repositories: block.repos,
            urls: block.urls ?? [],
            tickets: block.tickets,
            documents: block.documents,
            people: block.people ?? [],
          },
          reasonCodes: block.reasonCodes,
          sourceObservationIds:
            block.summary.provenance.supportedByObservationIds,
        },
        targetDayKey,
        timezone,
      ),
    )
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}

function selectAllTaskBlocks(timeline: TimelineView): WorklogCalendarBlock[] {
  return getTaskSegments(timeline)
    .filter(segment => segment.kind === 'primary')
    .filter(segment => segment.observationIds.length > 0)
    .map(segment => mapTaskSegmentToWorklogBlock(segment, timeline))
    .filter((block): block is WorklogCalendarBlock => block != null)
    .map(block => applyUserCorrections(block, timeline))
    .filter(isDisplayableWorklogBlock)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}

function mapTaskSegmentToWorklogBlock(
  segment: TaskSegmentView,
  timeline: TimelineView,
): WorklogCalendarBlock | null {
  const range = computeTaskSegmentRange(segment, timeline);
  if (range == null) return null;
  const observations = segment.observationIds
    .map(id => timeline.observationsById[id])
    .filter(
      (observation): observation is ObservationView => observation != null,
    );
  const reasonCodes = Array.from(
    new Set(
      timeline.taskDecisionOrder
        .map(id => timeline.taskDecisionsById[id])
        .filter(
          (decision): decision is NonNullable<typeof decision> =>
            decision != null && decision.targetSegmentId === segment.id,
        )
        .flatMap(decision => decision.reasonCodes),
    ),
  );
  const decisionModes = Array.from(
    new Set(
      timeline.taskDecisionOrder
        .map(id => timeline.taskDecisionsById[id])
        .filter(
          (decision): decision is NonNullable<typeof decision> =>
            decision != null && decision.targetSegmentId === segment.id,
        )
        .map(decision => decision.decisionMode),
    ),
  );
  const rawTitle =
    segment.finalTitle ??
    segment.liveTitle ??
    (observations.at(-1)?.structured != null
      ? getObservationPossibleObjective(observations.at(-1)!.structured!)
      : null) ??
    'Working';
  const observationSummaries = observations
    .map(observation => observation.structured?.summary ?? observation.text)
    .filter(value => value.trim().length > 0);
  const title = repairTaskTitle({
    title: rawTitle,
    artifacts: {
      projects: segment.entityMemory.projects,
      tasks: segment.entityMemory.tasks,
      tickets: segment.entityMemory.ticketIds,
      repositories: segment.entityMemory.repos,
      documents: segment.entityMemory.documents,
      urls: segment.entityMemory.urls,
    },
    keyActivities: observationSummaries.slice(-4),
    fallback: 'Working',
    preferAnchors: true,
  });
  const narrative =
    segment.finalSummary ??
    segment.liveSummary ??
    observations.at(-1)?.text ??
    title;
  const category = mode(
    observations.flatMap(observation =>
      observation.structured?.activityType != null
        ? [observation.structured.activityType]
        : [],
    ),
  );
  const keyArtifacts = flattenTaskArtifacts(segment);

  return {
    id: segment.id,
    lineageId: segment.lineageId,
    segmentIds: [segment.id],
    startTime: range.startAt,
    endTime: range.endAt,
    label:
      segment.state === 'finalized' || segment.state === 'reconciled'
        ? 'confirmed_completed'
        : 'worked_on',
    confidence: segment.confidence,
    title,
    summary: {
      headline: title,
      narrative,
      provenance: {
        supportedByObservationIds: segment.observationIds,
        supportedByEvidenceIds: [],
        keyArtifacts,
        reasonCodes,
      },
    },
    apps: segment.entityMemory.apps,
    projects: segment.entityMemory.projects,
    tasks: segment.entityMemory.tasks,
    repos: segment.entityMemory.repos,
    tickets: segment.entityMemory.ticketIds,
    documents: segment.entityMemory.documents,
    reasonCodes,
    keyActivities: observationSummaries.slice(-4),
    category: category ?? 'other',
    people: segment.entityMemory.people,
    urls: segment.entityMemory.urls,
    notes: segment.finalSummary ?? undefined,
    notesKey: computeTaskNotesKey(segment),
    continuityLinkage: {
      resumedFromLineageId: null,
      resumedSegmentCount:
        timeline.taskLineagesById[segment.lineageId]?.segmentIds.length ?? 1,
    },
    debug: {
      decisionModes,
      decisionCount: decisionModes.length,
      retroAdjusted:
        segment.state === 'reconciled' || segment.state === 'finalized',
    },
  };
}

function computeTaskNotesKey(segment: TaskSegmentView): string {
  if (segment.observationIds.length === 0) return `segment:${segment.id}`;
  return segment.observationIds.slice().sort().join('|');
}

function flattenTaskArtifacts(segment: TaskSegmentView): string[] {
  return Array.from(
    new Set(
      [
        ...segment.entityMemory.projects,
        ...(segment.entityMemory.tasks ?? []),
        ...segment.entityMemory.repos,
        ...segment.entityMemory.ticketIds,
        ...segment.entityMemory.documents,
        ...segment.entityMemory.urls,
        ...segment.entityMemory.apps,
        ...segment.entityMemory.people,
      ].filter(value => value.trim().length > 0),
    ),
  ).slice(0, 12);
}

function mode(values: string[]): string | null {
  if (values.length === 0) return null;
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function computeTaskSegmentRange(
  segment: TaskSegmentView,
  timeline: TimelineView,
): { startAt: string; endAt: string } | null {
  const observationTimes = segment.observationIds
    .map(id => timeline.observationsById[id]?.observedAt)
    .filter((value): value is string => value != null)
    .sort();
  if (observationTimes.length === 0) return null;

  const startMs = Date.parse(segment.startTime);
  const hardEndMs = Date.parse(
    segment.endTime ??
      timeline.sessionsById[segment.sessionId ?? '']?.endedAt ??
      latestCaptureAt(timeline) ??
      segment.lastActiveTime,
  );
  const firstObservationMs = Date.parse(observationTimes[0]);
  const lastObservationMs = Date.parse(
    observationTimes[observationTimes.length - 1],
  );
  const coverageEndMs = computeStableCoverageEndMs(
    timeline,
    lastObservationMs,
    Number.isNaN(hardEndMs) ? lastObservationMs : hardEndMs,
  );
  const evidenceEndMs = coverageEndMs;
  const endMs = Math.max(
    lastObservationMs + 60 * 1000,
    Math.min(
      Number.isNaN(hardEndMs) ? evidenceEndMs : hardEndMs,
      Math.max(evidenceEndMs, lastObservationMs),
    ),
  );
  const safeStartMs =
    Number.isNaN(startMs) ||
    startMs < firstObservationMs - READ_TIME_BLOCK_BUFFER_MS
      ? firstObservationMs
      : startMs;

  return {
    startAt: new Date(safeStartMs).toISOString(),
    endAt: new Date(endMs).toISOString(),
  };
}

function latestCaptureAt(timeline: TimelineView): string | null {
  for (let i = timeline.captureRecordOrder.length - 1; i >= 0; i -= 1) {
    const record = timeline.captureRecordsById[timeline.captureRecordOrder[i]];
    if (record != null) return record.capturedAt;
  }
  return null;
}

function captureSignatureAt(
  timeline: TimelineView,
  observedMs: number,
): string | null {
  let best: { delta: number; signature: string } | null = null;
  for (const id of timeline.captureRecordOrder) {
    const record = timeline.captureRecordsById[id];
    if (record == null || record.capture.status !== 'captured') continue;
    const capturedMs = Date.parse(record.capturedAt);
    const delta = Math.abs(capturedMs - observedMs);
    if (delta > 1500) continue;
    const signature = captureSignature(record.capture);
    if (signature == null) continue;
    if (best == null || delta < best.delta) best = { delta, signature };
  }
  return best?.signature ?? null;
}

function captureSignature(capture: {
  targetType: string;
  appName: string | null;
  bundleIdentifier: string | null;
  windowTitle: string | null;
  displayId: number | null;
}): string | null {
  if (capture.appName == null && capture.windowTitle == null) return null;
  return [
    capture.targetType,
    capture.bundleIdentifier ?? capture.appName ?? '',
    capture.windowTitle ?? '',
    capture.displayId ?? '',
  ].join('|');
}

function computeStableCoverageEndMs(
  timeline: TimelineView,
  observedMs: number,
  hardEndMs: number,
): number {
  const signature = captureSignatureAt(timeline, observedMs);
  if (signature == null) return observedMs;

  let latestMs = observedMs;
  let previousMs = observedMs;
  const maxExtensionMs = Math.min(
    hardEndMs,
    observedMs + MAX_STABLE_SCREEN_EXTENSION_MS,
  );
  for (const id of timeline.captureRecordOrder) {
    const record = timeline.captureRecordsById[id];
    if (record == null || record.capture.status !== 'captured') continue;
    const capturedMs = Date.parse(record.capturedAt);
    if (capturedMs <= observedMs) continue;
    if (capturedMs > maxExtensionMs) break;
    if (capturedMs - previousMs > COVERAGE_GAP_MS) break;
    if (isIdleAt(timeline, capturedMs)) break;
    if (captureSignature(record.capture) !== signature) break;
    latestMs = capturedMs;
    previousMs = capturedMs;
  }
  return latestMs;
}

function isDisplayableWorklogBlock(block: WorklogCalendarBlock): boolean {
  if (block.source === 'user_calendar') return true;
  if (isFlowInternalStatusBlock(block)) return false;

  const durationMs = Math.max(
    0,
    Date.parse(block.endTime) - Date.parse(block.startTime),
  );
  if (durationMs < MIN_UNANCHORED_BLOCK_DISPLAY_MS && !hasStrongTaskAnchor(block)) {
    return false;
  }
  if (durationMs >= MIN_UNANCHORED_BLOCK_DISPLAY_MS) return true;
  if (block.summary.provenance.supportedByObservationIds.length > 1) {
    return true;
  }
  return hasTaskAnchor(block);
}

function isFlowInternalStatusBlock(block: WorklogCalendarBlock): boolean {
  if (hasTaskAnchor(block)) return false;

  const text = [
    block.title,
    block.summary.headline,
    block.summary.narrative,
    ...(block.keyActivities ?? []),
  ]
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (text.length === 0) return false;

  return (
    /\bflow is (?:finalizing|recording|transcribing|capturing)\b/.test(text) ||
    /\b(?:meeting notes|stop notes|transcript notes)\b/.test(text) ||
    /^(?:finalizing|recording|transcribing|capturing|working)$/.test(text)
  );
}

function hasTaskAnchor(block: WorklogCalendarBlock): boolean {
  return (
    block.repos.length > 0 ||
    (block.projects?.length ?? 0) > 0 ||
    block.tickets.length > 0 ||
    (block.tasks?.length ?? 0) > 0 ||
    block.documents.length > 0 ||
    (block.urls?.length ?? 0) > 0 ||
    (block.calendarEventIds?.length ?? 0) > 0
  );
}

function hasStrongTaskAnchor(block: WorklogCalendarBlock): boolean {
  return (
    block.repos.length > 0 ||
    (block.projects?.length ?? 0) > 0 ||
    block.tickets.length > 0 ||
    (block.tasks?.length ?? 0) > 0 ||
    block.documents.length > 0 ||
    (block.calendarEventIds?.length ?? 0) > 0
  );
}

function hasPlanBlockTaskAnchor(block: PlanBlock): boolean {
  return (
    block.artifacts.repositories.length > 0 ||
    (block.artifacts.projects?.length ?? 0) > 0 ||
    block.artifacts.tickets.length > 0 ||
    (block.artifacts.tasks?.length ?? 0) > 0 ||
    block.artifacts.documents.length > 0 ||
    block.artifacts.urls.length > 0 ||
    (block.calendarEventIds?.length ?? 0) > 0
  );
}

function isIdleAt(timeline: TimelineView, atMs: number): boolean {
  let latest: { ms: number; isIdle: boolean } | null = null;
  for (const id of timeline.contextSnapshotOrder) {
    const snapshot = timeline.contextSnapshotsById[id];
    if (snapshot == null) continue;
    const ms = Date.parse(snapshot.recordedAt);
    if (Number.isNaN(ms) || ms > atMs) continue;
    if (latest == null || ms > latest.ms) {
      latest = { ms, isIdle: snapshot.isIdle };
    }
  }
  return latest?.isIdle === true;
}

function applyUserCorrections(
  block: WorklogCalendarBlock,
  timeline: TimelineView,
): WorklogCalendarBlock {
  const correction = findCorrection(block, timeline.userBlockCorrections);
  if (correction == null) return block;

  const title = correction.title ?? block.title;
  const category = correction.category ?? block.category;
  return {
    ...block,
    title,
    category,
    summary: {
      ...block.summary,
      headline: title,
    },
    userCorrection: {
      title: correction.title,
      category: correction.category,
      markedWrong: correction.markedWrong,
      feedback: correction.feedback,
      mergeWithBlockId: correction.mergeWithBlockId,
      splitAt: correction.splitAt,
      editedAt: correction.editedAt,
    },
  };
}

function findCorrection(
  block: WorklogCalendarBlock,
  corrections: Record<string, UserBlockCorrectionView>,
): UserBlockCorrectionView | null {
  if (block.notesKey != null && corrections[block.notesKey] != null) {
    return corrections[block.notesKey];
  }
  return corrections[block.id] ?? null;
}
