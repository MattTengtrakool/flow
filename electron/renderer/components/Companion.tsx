import { useEffect, useMemo, useState } from 'react';

import type {
  ProactiveInsightAction,
  ProactiveInsightView,
} from '../../../src/proactive/types';
import type {
  FlowElectronApi,
  TimelineStatePayload,
} from '../../shared/flowApi';
import type { MeetingRuntimeState } from '../../../src/meetings/types';
import { useMeetingState } from '../hooks/useMeetingState';
import { useProactiveState } from '../hooks/useProactiveState';

const flowIconUrl = new URL('../../../brand/flow-icon-64.png', import.meta.url)
  .href;

export function CompanionApp(props: { flow?: FlowElectronApi }) {
  const proactive = useProactiveState(props.flow);
  const meetings = useMeetingState(props.flow);
  const runtime = useCompanionRuntime(props.flow, proactive.quieted);
  const insight = proactive.activeInsight;
  const meetingMode =
    meetings.activeRecording != null
      ? 'recording'
      : meetings.currentDetection != null
      ? 'detected'
      : null;

  if (!proactive.companionEnabled) {
    return null;
  }

  return (
    <main
      className={`companion-shell companion-shell--${proactive.settings.companionPosition}`}
    >
      {meetingMode != null ? (
        <MeetingCard
          mode={meetingMode}
          meetings={meetings}
          onStart={() => {
            const detectionId = meetings.currentDetection?.id;
            const consentAccepted =
              meetings.consentAccepted ||
              window.confirm(
                'I have permission to record/transcribe this meeting. Flow keeps this reminder local.',
              );
            if (!consentAccepted) return;
            meetings
              .startTranscription(detectionId, consentAccepted)
              .catch(() => {});
          }}
          onStop={() => {
            const meetingId = meetings.activeRecording?.meetingId;
            if (meetingId != null) {
              meetings.stopTranscription(meetingId).catch(() => {});
            }
          }}
          onDismiss={() => {
            const detectionId = meetings.currentDetection?.id;
            if (detectionId != null) {
              meetings.dismissDetection(detectionId).catch(() => {});
            }
          }}
        />
      ) : insight == null ? (
        <section
          className={
            proactive.quieted ? 'companion-pill is-quiet' : 'companion-pill'
          }
          aria-label="Flow Companion"
        >
          <FlowMark state={runtime.state} />
          <span className="companion-pill__body">
            <span>{runtime.eyebrow}</span>
            <strong>{runtime.label}</strong>
            <ActivityTrace state={runtime.state} />
          </span>
          <DragGrip />
        </section>
      ) : (
        <InsightCard
          insight={insight}
          onAction={action => {
            if (action.kind === 'dismiss') {
              proactive.dismiss(insight.id).catch(() => {});
              return;
            }
            if (action.kind === 'snooze') {
              proactive.snooze(insight.id, 10).catch(() => {});
              return;
            }
            proactive.action(insight.id, action.id).catch(() => {});
          }}
        />
      )}
    </main>
  );
}

function MeetingCard(props: {
  mode: 'detected' | 'recording';
  meetings: MeetingRuntimeState & {
    startTranscription: (
      detectionId: string | undefined,
      consentAccepted: boolean,
    ) => Promise<MeetingRuntimeState>;
    stopTranscription: (meetingId: string) => Promise<MeetingRuntimeState>;
    dismissDetection: (detectionId: string) => Promise<MeetingRuntimeState>;
  };
  onStart: () => void;
  onStop: () => void;
  onDismiss: () => void;
}) {
  const detection = props.meetings.currentDetection;
  const recording = props.meetings.activeRecording;
  const title =
    props.mode === 'recording'
      ? 'Transcribing'
      : detection?.calendarEventTitle ?? 'In a meeting?';
  const body =
    props.mode === 'recording'
      ? `Flow is listening for meeting audio. ${props.meetings.transcriptProgress.chunkCount} transcript chunks so far.`
      : detection?.reasons[0] ??
        'Flow noticed a likely meeting and can start notes when you say so.';
  return (
    <section className="companion-card companion-card--high">
      <div className="companion-card__header">
        <FlowMark state="active" />
        <div>
          <span>
            {props.mode === 'recording'
              ? 'Meeting notes'
              : detection?.confidence === 'high'
              ? 'Likely meeting'
              : 'Possible meeting'}
          </span>
          <strong>{title}</strong>
        </div>
        <DragGrip />
        {props.mode === 'detected' ? (
          <button type="button" aria-label="Dismiss" onClick={props.onDismiss}>
            ×
          </button>
        ) : null}
      </div>
      <p>{body}</p>
      {props.meetings.lastError != null ? (
        <small className="companion-card__reason">
          {props.meetings.lastError}
        </small>
      ) : null}
      {detection?.windowTitle != null ? (
        <div className="companion-card__chips">
          <span>{detection.windowTitle}</span>
        </div>
      ) : null}
      <div className="companion-card__actions">
        {props.mode === 'recording' ? (
          <button
            type="button"
            className="button-primary"
            onClick={props.onStop}
            disabled={recording == null}
          >
            Stop notes
          </button>
        ) : (
          <>
            <button
              type="button"
              className="button-primary"
              onClick={props.onStart}
            >
              Start notes
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={props.onDismiss}
            >
              Not now
            </button>
          </>
        )}
      </div>
    </section>
  );
}

function InsightCard(props: {
  insight: ProactiveInsightView;
  onAction: (action: ProactiveInsightAction) => void;
}) {
  const actions = orderedActions(props.insight).slice(0, 3);
  return (
    <section
      className={`companion-card companion-card--${props.insight.priority}`}
      aria-label={props.insight.title}
    >
      <div className="companion-card__header">
        <FlowMark state="active" />
        <div>
          <span>Flow Companion</span>
          <strong>{props.insight.title}</strong>
        </div>
        <DragGrip />
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() =>
            props.onAction({ id: 'dismiss', label: 'Dismiss', kind: 'dismiss' })
          }
        >
          ×
        </button>
      </div>
      <p>{props.insight.body}</p>
      {props.insight.reason != null ? (
        <small className="companion-card__reason">{props.insight.reason}</small>
      ) : null}
      {props.insight.relatedArtifactIds != null &&
      props.insight.relatedArtifactIds.length > 0 ? (
        <div className="companion-card__chips">
          {props.insight.relatedArtifactIds.slice(0, 4).map(artifact => (
            <span key={artifact}>{artifact}</span>
          ))}
        </div>
      ) : null}
      <div className="companion-card__actions">
        {actions.map((action, index) => (
          <button
            key={action.id}
            type="button"
            className={index === 0 ? 'button-primary' : 'button-secondary'}
            onClick={() => props.onAction(action)}
          >
            {action.label}
          </button>
        ))}
      </div>
    </section>
  );
}

type CompanionRuntimeState = 'active' | 'idle' | 'quiet';

function useCompanionRuntime(
  flow: FlowElectronApi | undefined,
  quieted: boolean,
) {
  const [timeline, setTimeline] = useState<TimelineStatePayload | null>(null);

  useEffect(() => {
    if (flow == null) return;
    flow.timeline
      .getState()
      .then(setTimeline)
      .catch(() => {});
    const subscription = flow.timeline.addStateListener(setTimeline);
    return () => subscription.remove();
  }, [flow]);

  return useMemo(() => {
    if (quieted || timeline?.privacyModeEnabled) {
      return {
        eyebrow: 'Companion',
        label: timeline?.privacyModeEnabled ? 'Privacy on' : 'Quiet hours',
        state: 'quiet' as const,
      };
    }
    if (timeline?.captureEnabled) {
      return {
        eyebrow: 'Capture on',
        label: 'Monitoring',
        state: 'active' as const,
      };
    }
    if (timeline?.plannerInFlight) {
      return {
        eyebrow: 'Planner',
        label: 'Thinking',
        state: 'active' as const,
      };
    }
    if (
      timeline?.captureStatusMessage === 'Generating a structured observation.'
    ) {
      return {
        eyebrow: 'Capture',
        label: 'Observing',
        state: 'active' as const,
      };
    }
    return {
      eyebrow: 'Companion',
      label: 'Standing by',
      state: 'idle' as const,
    };
  }, [quieted, timeline]);
}

function FlowMark(props: { state: CompanionRuntimeState }) {
  return (
    <span
      className={`companion-flow-mark companion-flow-mark--${props.state}`}
      aria-hidden="true"
    >
      <img src={flowIconUrl} alt="" />
    </span>
  );
}

function ActivityTrace(props: { state: CompanionRuntimeState }) {
  return (
    <span
      className={`companion-activity-trace companion-activity-trace--${props.state}`}
      aria-hidden="true"
    >
      <span />
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}

function DragGrip() {
  return (
    <span className="companion-drag-grip" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

function orderedActions(
  insight: ProactiveInsightView,
): ProactiveInsightAction[] {
  const seen = new Set<string>();
  const actions = [insight.primaryAction, ...insight.actions].filter(
    (action): action is ProactiveInsightAction => action != null,
  );
  return actions.filter(action => {
    if (seen.has(action.id)) return false;
    seen.add(action.id);
    return true;
  });
}
