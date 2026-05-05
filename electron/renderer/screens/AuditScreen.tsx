import { memo, useMemo } from 'react';

import { getObservationPossibleObjective } from '../../../src/observation/intent';
import type { TimelineView } from '../../../src/timeline/eventLog';
import { Screen } from '../components/common';

type AuditRow = {
  observationId: string;
  observedAt: string;
  summary: string;
  visibleAction: string | null;
  objective: string | null;
  project: string | null;
  task: string | null;
  category: string | null;
  status: 'assigned' | 'pending' | 'ignored' | 'unprocessed';
  decision: string | null;
  evidenceState: string | null;
  batchTitle: string | null;
  batchStatus: 'assigned' | 'background' | null;
  assignmentReason: string | null;
  targetTitle: string | null;
  reasonCodes: string[];
};

const timeFormatter = new Intl.DateTimeFormat([], {
  hour: 'numeric',
  minute: '2-digit',
});

function buildAuditRows(timeline: TimelineView, limit: number): AuditRow[] {
  const observationIds = timeline.observationOrder
    .slice()
    .reverse()
    .slice(0, limit);

  return observationIds.map(observationId => {
    const observation = timeline.observationsById[observationId];
    const decisionId = timeline.taskDecisionByObservationId[observationId];
    const decision =
      decisionId != null ? timeline.taskDecisionsById[decisionId] ?? null : null;
    const pending = timeline.pendingObservationsById[observationId] ?? null;
    const batchBlock = findLatestBatchBlockForObservation(timeline, observationId);
    const backgroundBlock = findLatestBackgroundBlockForObservation(
      timeline,
      observationId,
    );
    const targetSegment =
      decision?.targetSegmentId != null
        ? timeline.taskSegmentsById[decision.targetSegmentId] ?? null
        : null;
    const assignedSegment =
      targetSegment ??
      Object.values(timeline.taskSegmentsById).find(segment =>
        segment.observationIds.includes(observationId),
      ) ??
      null;
    const structured = observation?.structured;
    const status: AuditRow['status'] =
      pending != null
        ? 'pending'
        : decision?.decision === 'ignore'
        ? 'ignored'
        : assignedSegment != null
        ? 'assigned'
        : 'unprocessed';

    return {
      observationId,
      observedAt: observation?.observedAt ?? '',
      summary: structured?.summary ?? observation?.text ?? '',
      visibleAction: structured?.visibleAction ?? null,
      objective:
        structured != null ? getObservationPossibleObjective(structured) : null,
      project:
        structured?.possibleProject ?? structured?.entities.projects?.[0] ?? null,
      task: structured?.possibleTask ?? structured?.entities.tasks?.[0] ?? null,
      category: structured?.activityType ?? null,
      status,
      decision: decision?.decision ?? null,
      evidenceState: decision?.evidenceState ?? pending?.evidenceState ?? null,
      batchTitle: batchBlock?.headline ?? backgroundBlock?.headline ?? null,
      batchStatus:
        batchBlock != null ? 'assigned' : backgroundBlock != null ? 'background' : null,
      assignmentReason:
        batchBlock?.assignmentReason ?? backgroundBlock?.assignmentReason ?? null,
      targetTitle:
        assignedSegment?.finalTitle ??
        assignedSegment?.liveTitle ??
        assignedSegment?.lineageId ??
        null,
      reasonCodes: decision?.reasonCodes ?? pending?.reasonCodes ?? [],
    };
  });
}

export const AuditScreen = memo(function AuditScreen(props: {
  timeline: TimelineView;
}) {
  const rows = useMemo(() => buildAuditRows(props.timeline, 80), [props.timeline]);
  const counts = useMemo(
    () => ({
      assigned: rows.filter(row => row.status === 'assigned').length,
      pending: rows.filter(row => row.status === 'pending').length,
      ignored: rows.filter(row => row.status === 'ignored').length,
      unprocessed: rows.filter(row => row.status === 'unprocessed').length,
    }),
    [rows],
  );

  return (
    <Screen title="Observation audit">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Last {rows.length} observations</p>
          <h2>How Flow formed tasks</h2>
          <p className="hero-caption">
            See which observations became evidence, which were held pending, and
            which task each one supports.
          </p>
        </div>
        <div className="metric-grid compact">
          <div className="metric-card">
            <span>Assigned</span>
            <strong>{counts.assigned}</strong>
          </div>
          <div className="metric-card">
            <span>Pending</span>
            <strong>{counts.pending}</strong>
          </div>
          <div className="metric-card">
            <span>Ignored</span>
            <strong>{counts.ignored}</strong>
          </div>
        </div>
      </section>

      <div className="audit-list">
        {rows.map(row => (
          <article key={row.observationId} className={`audit-row ${row.status}`}>
            <div className="audit-row__meta">
              <span>{formatTime(row.observedAt)}</span>
              <strong>{row.status}</strong>
              {row.decision != null ? <code>{row.decision}</code> : null}
              {row.evidenceState != null ? <code>{row.evidenceState}</code> : null}
              {row.batchStatus != null ? <code>batch:{row.batchStatus}</code> : null}
            </div>
            <div className="audit-row__body">
              <h3>{row.objective ?? row.task ?? row.summary}</h3>
              <p>{row.visibleAction ?? row.summary}</p>
              <div className="chip-row">
                {[
                  row.project,
                  row.task,
                  row.category,
                  row.batchTitle != null ? `batch: ${row.batchTitle}` : null,
                  row.assignmentReason,
                  row.targetTitle != null ? `task: ${row.targetTitle}` : null,
                  ...row.reasonCodes,
                ]
                  .filter((value): value is string => value != null && value.length > 0)
                  .slice(0, 8)
                  .map(value => (
                    <span key={value} className="chip">
                      {value}
                    </span>
                  ))}
              </div>
            </div>
          </article>
        ))}
      </div>
    </Screen>
  );
});

function formatTime(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? timeFormatter.format(new Date(ms)) : 'Unknown';
}

function findLatestBatchBlockForObservation(
  timeline: TimelineView,
  observationId: string,
) {
  for (let i = timeline.planSnapshots.length - 1; i >= 0; i -= 1) {
    const block = timeline.planSnapshots[i].blocks.find(item =>
      item.sourceObservationIds.includes(observationId),
    );
    if (block != null) return block;
  }
  return null;
}

function findLatestBackgroundBlockForObservation(
  timeline: TimelineView,
  observationId: string,
) {
  for (let i = timeline.planSnapshots.length - 1; i >= 0; i -= 1) {
    const block = timeline.planSnapshots[i].blocks.find(item =>
      item.backgroundObservationIds?.includes(observationId),
    );
    if (block != null) return block;
  }
  return null;
}
