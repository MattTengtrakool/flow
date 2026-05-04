import type { TimelineUiState } from '../types';

export function StatusBanners(props: {
  permissionStatus: string;
  timelineStore: TimelineUiState;
  onRefreshPermissions: () => void;
}) {
  const { permissionStatus, timelineStore, onRefreshPermissions } = props;
  const orphanedSession =
    timelineStore.timeline.currentSessionId != null &&
    !timelineStore.continuousModeState.enabled
      ? timelineStore.timeline.sessionsById[
          timelineStore.timeline.currentSessionId
        ]
      : null;

  return (
    <div className="banner-stack">
      {timelineStore.errorMessage != null ? (
        <div className="status-banner status-banner--danger">
          <span className="status-banner__icon">!</span>
          <strong>Something needs attention</strong>
          <p>{timelineStore.errorMessage}</p>
        </div>
      ) : null}

      {permissionStatus.includes('missing') ? (
        <div className="status-banner status-banner--warning">
          <span className="status-banner__icon">!</span>
          <strong>Grant permissions</strong>
          <p>Accessibility and Screen Recording are required for capture.</p>
          <div className="inline-actions">
            <button
              type="button"
              onClick={() => {
                window.flow?.capture
                  .requestAccessibilityPrompt()
                  .then(onRefreshPermissions)
                  .catch(() => {});
              }}
            >
              Accessibility
            </button>
            <button
              type="button"
              onClick={() => {
                window.flow?.capture
                  .requestScreenCaptureAccess()
                  .then(onRefreshPermissions)
                  .catch(() => {});
              }}
            >
              Screen Recording
            </button>
          </div>
        </div>
      ) : null}

      {timelineStore.plannerRuntimeState.lastFailureMessage != null ? (
        <div className="status-banner status-banner--warning">
          <span className="status-banner__icon">!</span>
          <strong>Plan failed</strong>
          <p>{timelineStore.plannerRuntimeState.lastFailureMessage}</p>
          <button
            type="button"
            className="button-ghost"
            onClick={() => {
              timelineStore.runPlannerRevisionNow(true).catch(() => {});
            }}
          >
            Retry now
          </button>
        </div>
      ) : null}

      {orphanedSession != null ? (
        <div className="status-banner status-banner--warning">
          <span className="status-banner__icon">!</span>
          <strong>Unfinished session</strong>
          <p>Started {new Date(orphanedSession.startedAt).toLocaleString()}.</p>
          <div className="inline-actions">
            <button type="button" onClick={() => timelineStore.startSession()}>
              Resume
            </button>
            <button
              type="button"
              onClick={() => {
                timelineStore.stopSession().catch(() => {});
              }}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
