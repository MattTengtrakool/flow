import type { CalendarStatePayload } from '../../../src/calendar/types';
import type { FlowSettings } from '../../shared/flowApi';
import type { TimelineUiState } from '../types';

export function StatusCenter(props: {
  settings: FlowSettings;
  calendarState: CalendarStatePayload;
  permissionStatus: string;
  timelineStore: TimelineUiState;
}) {
  const { settings, timelineStore } = props;
  return (
    <section className="status-center" aria-label="Flow status">
      <StatusItem
        label="Capture"
        value={
          timelineStore.privacyModeEnabled
            ? 'Paused for privacy'
            : timelineStore.continuousModeState.enabled
            ? 'Running'
            : 'Idle'
        }
        detail={timelineStore.continuousModeState.statusMessage}
      />
      <StatusItem
        label="Last capture"
        value={formatRelative(timelineStore.continuousModeState.lastCapturedAt)}
        detail="Latest sanitized frame metadata"
      />
      <StatusItem
        label="Planner"
        value={
          timelineStore.plannerRuntimeState.inFlight
            ? 'Planning'
            : timelineStore.plannerRuntimeState.lastFailureMessage != null
            ? 'Needs attention'
            : 'Ready'
        }
        detail={
          timelineStore.plannerRuntimeState.lastFailureMessage ??
          formatRelative(timelineStore.plannerRuntimeState.lastRunAt)
        }
      />
      <StatusItem
        label="Meeting notes"
        value={
          timelineStore.activeMeetingRecording != null
            ? 'Transcribing'
            : timelineStore.meetingDetection != null
            ? 'Prompt ready'
            : 'Idle'
        }
        detail={
          timelineStore.activeMeetingRecording?.windowTitle ??
          timelineStore.meetingDetection?.windowTitle ??
          timelineStore.meetingTranscriptionStatus
        }
      />
      <StatusItem
        label="Permissions"
        value={props.permissionStatus.includes('missing') ? 'Missing' : 'Ready'}
        detail={props.permissionStatus}
      />
      <StatusItem
        label="Calendar"
        value={
          props.calendarState.accounts.length > 0
            ? props.calendarState.status === 'syncing'
              ? 'Syncing'
              : 'Connected'
            : 'Not connected'
        }
        detail={
          props.calendarState.errorMessage ??
          formatRelative(props.calendarState.lastSyncedAt)
        }
      />
      <StatusItem
        label="AI provider"
        value="Managed Flow AI"
        detail={
          settings.managedAi.configured
            ? `Relay ready${
                settings.managedAi.authenticated ? ', authenticated' : ''
              }`
            : 'Relay unavailable'
        }
      />
    </section>
  );
}

function StatusItem(props: { label: string; value: string; detail: string }) {
  return (
    <div className="status-item">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      <small>{props.detail}</small>
    </div>
  );
}

function formatRelative(iso: string | null): string {
  if (iso == null) return 'Not yet';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return 'Unknown';
  const deltaSeconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (deltaSeconds < 60) return `${deltaSeconds}s ago`;
  const minutes = Math.round(deltaSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString();
}
