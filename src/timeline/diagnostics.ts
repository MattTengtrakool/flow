import type {DomainEvent, TimelineView} from './eventLog';

export type TimelineDiagnosticsReport = {
  generatedAt: string;
  lastCaptureAt: string | null;
  lastObservationAt: string | null;
  lastPlanRevisedAt: string | null;
  stalePlanMs: number | null;
  orphanedSession: {
    sessionId: string;
    startedAt: string;
    captureEnabled: boolean;
  } | null;
  captureGapWarnings: Array<{
    startAt: string;
    endAt: string;
    gapMs: number;
  }>;
  tinyBlockWarnings: Array<{
    snapshotId: string;
    blockId: string;
    headline: string;
    durationMs: number;
    sourceSpanMs: number;
  }>;
  stopStartRaceWarnings: Array<{
    stoppedSessionId: string;
    stopAt: string;
    overlappingSessionId: string;
    startedAt: string;
  }>;
};

const STALE_PLAN_WARNING_MS = 30 * 60 * 1000;
const CAPTURE_GAP_WARNING_MS = 15 * 60 * 1000;

export function buildTimelineDiagnostics(args: {
  timeline: TimelineView;
  eventLog: DomainEvent[];
  captureEnabled: boolean;
  now?: string;
}): TimelineDiagnosticsReport {
  const now = args.now ?? new Date().toISOString();
  const lastCaptureAt = latestTime(args.timeline.captureRecordOrder, id =>
    args.timeline.captureRecordsById[id]?.capturedAt ?? null,
  );
  const lastObservationAt = latestTime(args.timeline.observationOrder, id =>
    args.timeline.observationsById[id]?.observedAt ?? null,
  );
  const lastPlan = args.timeline.planSnapshots.at(-1) ?? null;
  const lastPlanRevisedAt = lastPlan?.revisedAt ?? null;
  const stalePlanMs =
    lastPlanRevisedAt == null
      ? null
      : Math.max(0, Date.parse(now) - Date.parse(lastPlanRevisedAt));

  return {
    generatedAt: now,
    lastCaptureAt,
    lastObservationAt,
    lastPlanRevisedAt,
    stalePlanMs:
      stalePlanMs != null && stalePlanMs >= STALE_PLAN_WARNING_MS
        ? stalePlanMs
        : null,
    orphanedSession: buildOrphanedSession(args.timeline, args.captureEnabled),
    captureGapWarnings: buildCaptureGapWarnings(args.timeline),
    tinyBlockWarnings: buildTinyBlockWarnings(args.timeline),
    stopStartRaceWarnings: buildStopStartRaceWarnings(args.eventLog),
  };
}

function latestTime(
  ids: string[],
  read: (id: string) => string | null,
): string | null {
  for (let i = ids.length - 1; i >= 0; i -= 1) {
    const value = read(ids[i]);
    if (value != null) return value;
  }
  return null;
}

function buildOrphanedSession(
  timeline: TimelineView,
  captureEnabled: boolean,
): TimelineDiagnosticsReport['orphanedSession'] {
  if (timeline.currentSessionId == null || captureEnabled) return null;
  const session = timeline.sessionsById[timeline.currentSessionId];
  if (session == null || session.endedAt != null) return null;
  return {
    sessionId: session.id,
    startedAt: session.startedAt,
    captureEnabled,
  };
}

function buildCaptureGapWarnings(
  timeline: TimelineView,
): TimelineDiagnosticsReport['captureGapWarnings'] {
  const warnings: TimelineDiagnosticsReport['captureGapWarnings'] = [];
  let previousAt: string | null = null;
  for (const id of timeline.captureRecordOrder) {
    const record = timeline.captureRecordsById[id];
    if (record == null) continue;
    if (previousAt != null) {
      const gapMs = Date.parse(record.capturedAt) - Date.parse(previousAt);
      if (gapMs >= CAPTURE_GAP_WARNING_MS) {
        warnings.push({
          startAt: previousAt,
          endAt: record.capturedAt,
          gapMs,
        });
      }
    }
    previousAt = record.capturedAt;
  }
  return warnings.slice(-10);
}

function buildTinyBlockWarnings(
  timeline: TimelineView,
): TimelineDiagnosticsReport['tinyBlockWarnings'] {
  const warnings: TimelineDiagnosticsReport['tinyBlockWarnings'] = [];
  for (const snapshot of timeline.planSnapshots.slice(-10)) {
    for (const block of snapshot.blocks) {
      const durationMs = Date.parse(block.endAt) - Date.parse(block.startAt);
      const sourceTimes = block.sourceObservationIds
        .map(id => timeline.observationsById[id]?.observedAt)
        .filter((value): value is string => value != null)
        .sort();
      if (sourceTimes.length < 2) continue;
      const sourceSpanMs =
        Date.parse(sourceTimes[sourceTimes.length - 1]) - Date.parse(sourceTimes[0]);
      if (durationMs <= 5 * 60 * 1000 || durationMs <= sourceSpanMs + 2 * 60 * 1000) {
        warnings.push({
          snapshotId: snapshot.snapshotId,
          blockId: block.id,
          headline: block.headline,
          durationMs,
          sourceSpanMs,
        });
      }
    }
  }
  return warnings.slice(-20);
}

function buildStopStartRaceWarnings(
  eventLog: DomainEvent[],
): TimelineDiagnosticsReport['stopStartRaceWarnings'] {
  const warnings: TimelineDiagnosticsReport['stopStartRaceWarnings'] = [];
  const recentStarts: Array<{sessionId: string; startedAt: string}> = [];
  for (const event of eventLog.slice(-500)) {
    if (event.type === 'session_started') {
      recentStarts.push({sessionId: event.sessionId, startedAt: event.occurredAt});
      continue;
    }
    if (event.type !== 'session_stopped') continue;
    const stopMs = Date.parse(event.occurredAt);
    const overlapping = recentStarts.find(start => {
      const startMs = Date.parse(start.startedAt);
      return start.sessionId !== event.sessionId && startMs < stopMs && stopMs - startMs <= 60 * 1000;
    });
    if (overlapping != null) {
      warnings.push({
        stoppedSessionId: event.sessionId,
        stopAt: event.occurredAt,
        overlappingSessionId: overlapping.sessionId,
        startedAt: overlapping.startedAt,
      });
    }
  }
  return warnings.slice(-10);
}
