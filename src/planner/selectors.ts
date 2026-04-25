import {
  createOccurredAt,
  type ObservationView,
  type TimelineView,
} from '../timeline/eventLog';
import type {
  WorklogCalendarBlock,
  WorklogDayView,
} from '../worklog/types';
import {pruneOutlierObservationIds} from './revisionEngine';
import {mapBlockToWorklogCalendarBlock, type PlanBlock} from './types';

const READ_TIME_BLOCK_BUFFER_MS = 2 * 60 * 1000;

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
  if (block.sourceObservationIds.length < 2) return block;

  const observationIndex = new Map<string, ObservationView>();
  for (const id of block.sourceObservationIds) {
    const observation = observationsById[id];
    if (observation != null) observationIndex.set(id, observation);
  }

  const prunedIds = pruneOutlierObservationIds(
    block.sourceObservationIds,
    observationIndex,
  );
  if (prunedIds.length === block.sourceObservationIds.length) return block;

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

  const blockStartMs = Date.parse(block.startAt);
  const blockEndMs = Date.parse(block.endAt);
  const newStartMs = Math.max(
    blockStartMs,
    earliestMs - READ_TIME_BLOCK_BUFFER_MS,
  );
  const newEndMs = Math.min(blockEndMs, latestMs + READ_TIME_BLOCK_BUFFER_MS);
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
  const rawBlocks = selectBlocksForDay(timeline, targetDayKey, timezone);
  const blocks = rawBlocks.map(block =>
    cleanBlockOfOutliers(block, timeline.observationsById),
  );
  const worklogBlocks = blocks.map(block => mapBlockToWorklogCalendarBlock(block));
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

function selectBlocksForDay(
  timeline: TimelineView,
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

      if (!isLatestSnapshotForBlockRange(timeline, i, block)) {
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

function isLatestSnapshotForBlockRange(
  timeline: TimelineView,
  currentIndex: number,
  block: PlanBlock,
): boolean {
  const blockStartMs = Date.parse(block.startAt);
  const blockEndMs = Date.parse(block.endAt);
  const midpointMs = blockStartMs + (blockEndMs - blockStartMs) / 2;

  for (let j = timeline.planSnapshots.length - 1; j > currentIndex; j -= 1) {
    const laterSnapshot = timeline.planSnapshots[j];
    const windowStartMs = Date.parse(laterSnapshot.windowStartAt);
    const windowEndMs = Date.parse(laterSnapshot.windowEndAt);
    if (midpointMs >= windowStartMs && midpointMs <= windowEndMs) {
      return false;
    }
  }
  return true;
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

function toDateKey(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
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
  const result: Record<string, WorklogCalendarBlock[]> = {};
  for (const dateIso of dateIsos) {
    const view = getDayWorklog(
      timeline,
      `${dateIso}T12:00:00.000Z`,
      timezone,
    );
    result[view.dateIso] = view.blocks;
  }
  return result;
}

export function getAllPlanCalendarBlocks(
  timeline: TimelineView,
): WorklogCalendarBlock[] {
  const selected: PlanBlock[] = [];
  const seenIds = new Set<string>();
  const seenSourceHashes = new Set<string>();

  for (let i = timeline.planSnapshots.length - 1; i >= 0; i -= 1) {
    const snapshot = timeline.planSnapshots[i];
    for (const block of snapshot.blocks) {
      if (seenIds.has(block.id)) continue;
      const sourceHash = hashSources(block.sourceObservationIds);
      if (sourceHash.length > 0 && seenSourceHashes.has(sourceHash)) continue;
      if (!isLatestSnapshotForBlockRange(timeline, i, block)) continue;

      seenIds.add(block.id);
      if (sourceHash.length > 0) seenSourceHashes.add(sourceHash);
      selected.push(block);
    }
  }

  return selected
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
    .map(block => cleanBlockOfOutliers(block, timeline.observationsById))
    .map(mapBlockToWorklogCalendarBlock);
}
