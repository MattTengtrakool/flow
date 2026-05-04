import {
  createOccurredAt,
  getTaskSegments,
  type ObservationView,
  type TimelineView,
  type UserBlockCorrectionView,
} from '../timeline/eventLog';
import type { WorklogCalendarBlock, WorklogDayView } from '../worklog/types';
import { pruneOutlierObservationIds } from './revisionEngine';
import { mapBlockToWorklogCalendarBlock, type PlanBlock } from './types';
import type { TaskSegmentView } from '../tasks/types';
import { repairTaskTitle } from '../tasks/title';

const READ_TIME_BLOCK_BUFFER_MS = 2 * 60 * 1000;
const COVERAGE_GAP_MS = 3 * 60 * 1000;
const MAX_STABLE_SCREEN_EXTENSION_MS = 30 * 60 * 1000;
const MAX_ANCHORED_SINGLE_OBSERVATION_BLOCK_MS = 45 * 60 * 1000;
const MIN_UNANCHORED_BLOCK_DISPLAY_MS = 3 * 60 * 1000;

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
  const taskBlocks = selectTaskBlocksForDay(timeline, targetDayKey, timezone);
  const worklogBlocks =
    taskBlocks.length > 0
      ? taskBlocks
      : selectPlanBlocksForDay(timeline, targetDayKey, timezone);
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

function selectPlanBlocksForDay(
  timeline: TimelineView,
  targetDayKey: string,
  timezone: string,
): WorklogCalendarBlock[] {
  // Pre-parse snapshot windows once — shared across all blocks in this call
  const snapshotWindowMs = buildSnapshotWindowMs(timeline);
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
    const taskBlocks = selectTaskBlocksForDay(timeline, targetDayKey, timezone);
    if (taskBlocks.length > 0) {
      result[targetDayKey] = taskBlocks;
      continue;
    }
    const rawBlocks = selectBlocksForDay(
      timeline,
      snapshotWindowMs,
      targetDayKey,
      timezone,
    );
    const blocks = rawBlocks.map(block =>
      cleanBlockOfOutliers(block, timeline.observationsById),
    );
    result[targetDayKey] = blocks
      .map(block =>
        applyUserCorrections(mapBlockToWorklogCalendarBlock(block), timeline),
      )
      .filter(isDisplayableWorklogBlock);
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
  const taskDayKeys = new Set(
    taskBlocks.map(block =>
      new Date(block.startTime).toISOString().slice(0, 10),
    ),
  );

  for (let i = timeline.planSnapshots.length - 1; i >= 0; i -= 1) {
    const snapshot = timeline.planSnapshots[i];
    for (const block of snapshot.blocks) {
      if (seenIds.has(block.id)) continue;
      const sourceHash = hashSources(block.sourceObservationIds);
      if (sourceHash.length > 0 && seenSourceHashes.has(sourceHash)) continue;
      if (isBlockSupersededByLaterSnapshot(snapshotWindowMs, i, block))
        continue;
      if (taskDayKeys.has(block.startAt.slice(0, 10))) continue;

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

  return [...taskBlocks, ...planBlocks].sort((a, b) =>
    a.startTime.localeCompare(b.startTime),
  );
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
    observations.at(-1)?.structured?.taskHypothesis ??
    'Working';
  const observationSummaries = observations
    .map(observation => observation.structured?.summary ?? observation.text)
    .filter(value => value.trim().length > 0);
  const title = repairTaskTitle({
    title: rawTitle,
    artifacts: {
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

  const durationMs = Math.max(
    0,
    Date.parse(block.endTime) - Date.parse(block.startTime),
  );
  if (durationMs >= MIN_UNANCHORED_BLOCK_DISPLAY_MS) return true;
  if (block.summary.provenance.supportedByObservationIds.length > 1) {
    return true;
  }
  return hasTaskAnchor(block);
}

function hasTaskAnchor(block: WorklogCalendarBlock): boolean {
  return (
    block.repos.length > 0 ||
    block.tickets.length > 0 ||
    block.documents.length > 0 ||
    (block.urls?.length ?? 0) > 0 ||
    (block.calendarEventIds?.length ?? 0) > 0
  );
}

function hasPlanBlockTaskAnchor(block: PlanBlock): boolean {
  return (
    block.artifacts.repositories.length > 0 ||
    block.artifacts.tickets.length > 0 ||
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
