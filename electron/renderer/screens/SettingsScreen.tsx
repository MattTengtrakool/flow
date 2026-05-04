import {memo} from 'react';

import type {CostSummary} from '../../../src/planner/costSummary';
import type {TimelineUiState} from '../types';
import {MetricCard} from '../components/MetricCard';
import {Screen} from '../components/common';

export const SettingsScreen = memo(function SettingsScreen(props: {
  version: string;
  permissionStatus: string;
  timelineStore: TimelineUiState;
  costSummary: CostSummary;
  onCaptureNow: () => void;
  onReplanNow: () => void;
}) {
  const {timelineStore} = props;

  return (
    <Screen title="Settings">
      <div className="settings-section">
        <h3>System health</h3>
        <div className="metric-grid">
          <MetricCard label="App version" value={props.version} />
          <MetricCard label="Hydration" value={timelineStore.hydrationStatus} />
          <MetricCard label="Permissions" value={props.permissionStatus} />
          <MetricCard label="Events" value={String(timelineStore.eventLogLength)} />
          <MetricCard label="Observations" value={String(timelineStore.timeline.observationOrder.length)} />
          <MetricCard label="Captures" value={String(timelineStore.timeline.captureRecordOrder.length)} />
          <MetricCard label="Task segments" value={String(timelineStore.timeline.taskSegmentOrder.length)} />
          <MetricCard label="Audio recordings" value={String(timelineStore.timeline.audioRecordingOrder.length)} />
          <MetricCard
            label="Microphone"
            value={timelineStore.audioPermissionStatus?.microphone ?? 'unknown'}
          />
          <MetricCard label="Plan snapshots" value={String(timelineStore.timeline.planSnapshots.length)} />
          <MetricCard label="Storage" value={timelineStore.storagePath ?? 'loading'} />
          <MetricCard label="Last saved" value={timelineStore.lastSavedAt ?? 'not yet'} />
        </div>
      </div>

      <div className="settings-section">
        <h3>Planner and cost</h3>
        <div className="metric-grid">
          <MetricCard
            label="Planner"
            value={
              timelineStore.plannerRuntimeState.inFlight
                ? 'planning'
                : timelineStore.plannerRuntimeState.lastFailureMessage ?? 'ready'
            }
          />
          <MetricCard
            label="Last planner run"
            value={timelineStore.plannerRuntimeState.lastRunAt ?? 'not yet'}
          />
          <MetricCard
            label="Diagnostics"
            value={
              timelineStore.diagnostics?.stalePlanMs != null
                ? 'stale plan'
                : timelineStore.diagnostics?.orphanedSession != null
                  ? 'paused session'
                  : 'clear'
            }
          />
          <MetricCard label="Total cost" value={`$${props.costSummary.allTime.costUsd.toFixed(4)}`} />
          <MetricCard label="Last 7 days" value={`$${props.costSummary.last7Days.costUsd.toFixed(4)}`} />
        </div>
      </div>

      <div className="button-row">
        <button type="button" onClick={props.onCaptureNow}>
          Capture now
        </button>
        <button
          type="button"
          onClick={props.onReplanNow}
          disabled={timelineStore.plannerRuntimeState.inFlight}>
          Replan now
        </button>
        <button
          type="button"
          onClick={() => {
            timelineStore.runDiagnosticReplan().catch(() => {});
          }}
          disabled={timelineStore.plannerRuntimeState.inFlight}>
          Diagnostic replan
        </button>
        <button
          type="button"
          onClick={() => {
            timelineStore.requestAudioPermissions().catch(() => {});
          }}>
          Check microphone
        </button>
      </div>
    </Screen>
  );
});
