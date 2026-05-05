import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';

import type {
  ProactiveInsightAction,
  ProactiveInsightView,
} from '../../../src/proactive/types';
import type {
  FlowElectronApi,
  TimelineStatePayload,
} from '../../shared/flowApi';
import type {
  MeetingAudioSource,
  MeetingRuntimeState,
} from '../../../src/meetings/types';
import { useMeetingState } from '../hooks/useMeetingState';
import { useProactiveState } from '../hooks/useProactiveState';

const flowIconUrl = new URL('../../../brand/flow-icon-64.png', import.meta.url)
  .href;
const COMPANION_WINDOW_WIDTH = {
  pill: 276,
  card: 404,
} as const;
const COMPANION_WINDOW_VERTICAL_PADDING = 32;
type CompanionContentMode = keyof typeof COMPANION_WINDOW_WIDTH;

export function CompanionApp(props: { flow?: FlowElectronApi }) {
  const proactive = useProactiveState(props.flow);
  const meetings = useMeetingState(props.flow);
  const runtime = useCompanionRuntime(props.flow, proactive.quieted);
  const shellRef = useRef<HTMLElement | null>(null);
  const insight = proactive.activeInsight;
  const meetingMode =
    meetings.activeRecording != null
      ? 'recording'
      : meetings.currentDetection != null
      ? 'detected'
      : null;
  const contentMode: CompanionContentMode =
    meetingMode != null || insight != null ? 'card' : 'pill';

  useCompanionContentSize(
    props.flow,
    shellRef,
    contentMode,
    proactive.companionEnabled,
  );
  useCompanionMousePassthrough(props.flow, proactive.companionEnabled);

  if (!proactive.companionEnabled) {
    return null;
  }

  return (
    <main
      ref={shellRef}
      className={`companion-shell companion-shell--${proactive.settings.companionPosition} companion-shell--${contentMode}`}
    >
      {meetingMode != null ? (
        <MeetingCard
          mode={meetingMode}
          meetings={meetings}
          onStart={sources => {
            const detectionId = meetings.currentDetection?.id;
            const consentAccepted =
              meetings.consentAccepted ||
              window.confirm(
                'I have permission to record/transcribe this meeting. Flow keeps this reminder local.',
              );
            if (!consentAccepted) return;
            meetings
              .startTranscription(detectionId, consentAccepted, sources)
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
            <span className={`companion-static-status companion-static-status--${runtime.state}`}>
              {runtime.state === 'active' ? 'Active' : 'Idle'}
            </span>
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

function useCompanionMousePassthrough(
  flow: FlowElectronApi | undefined,
  enabled: boolean,
) {
  useEffect(() => {
    if (flow == null) return;
    if (!enabled) {
      flow.companion.setMouseEventsIgnored(true).catch(() => {});
      return;
    }

    let ignored = true;
    const setIgnored = (next: boolean) => {
      if (ignored === next) return;
      ignored = next;
      flow.companion.setMouseEventsIgnored(next).catch(() => {});
    };
    const handleMouseMove = (event: MouseEvent) => {
      const target = event.target;
      const interactive =
        target instanceof Element &&
        target.closest('.companion-pill, .companion-card') != null;
      setIgnored(!interactive);
    };
    const handleMouseLeave = () => setIgnored(true);

    flow.companion.setMouseEventsIgnored(true).catch(() => {});
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseleave', handleMouseLeave);
      flow.companion.setMouseEventsIgnored(false).catch(() => {});
    };
  }, [enabled, flow]);
}

function useCompanionContentSize(
  flow: FlowElectronApi | undefined,
  shellRef: RefObject<HTMLElement | null>,
  mode: CompanionContentMode,
  enabled: boolean,
) {
  useEffect(() => {
    if (flow == null || !enabled) return;
    const shell = shellRef.current;
    if (shell == null) return;

    let animationFrame: number | null = null;
    const resizeToContent = () => {
      const content = shell.querySelector<HTMLElement>(
        '.companion-pill, .companion-card',
      );
      if (content == null) return;
      const contentHeight = Math.max(
        content.scrollHeight,
        content.getBoundingClientRect().height,
      );
      flow.companion
        .setContentSize({
          width: COMPANION_WINDOW_WIDTH[mode],
          height: Math.ceil(contentHeight + COMPANION_WINDOW_VERTICAL_PADDING),
        })
        .catch(() => {});
    };
    const scheduleResize = () => {
      if (animationFrame != null) {
        cancelAnimationFrame(animationFrame);
      }
      animationFrame = requestAnimationFrame(() => {
        animationFrame = null;
        resizeToContent();
      });
    };

    const observer = new ResizeObserver(scheduleResize);
    observer.observe(shell);
    const content = shell.querySelector<HTMLElement>(
      '.companion-pill, .companion-card',
    );
    if (content != null) observer.observe(content);
    scheduleResize();

    return () => {
      if (animationFrame != null) cancelAnimationFrame(animationFrame);
      observer.disconnect();
    };
  }, [enabled, flow, mode, shellRef]);
}

function MeetingCard(props: {
  mode: 'detected' | 'recording';
  meetings: MeetingRuntimeState & {
    startTranscription: (
      detectionId: string | undefined,
      consentAccepted: boolean,
      sources?: MeetingAudioSource[],
    ) => Promise<MeetingRuntimeState>;
    stopTranscription: (meetingId: string) => Promise<MeetingRuntimeState>;
    dismissDetection: (detectionId: string) => Promise<MeetingRuntimeState>;
  };
  onStart: (sources: MeetingAudioSource[]) => void;
  onStop: () => void;
  onDismiss: () => void;
}) {
  const detection = props.meetings.currentDetection;
  const recording = props.meetings.activeRecording;
  const transcriptChunkCount = props.meetings.transcriptProgress.chunkCount;
  const sourceLabel = recording?.sources.includes('system')
    ? recording.sources.includes('microphone')
      ? 'meeting audio + microphone'
      : 'meeting audio'
    : 'microphone';
  const title =
    props.mode === 'recording'
      ? recording?.status === 'finalizing'
        ? 'Finalizing'
        : transcriptChunkCount > 0
        ? 'Transcribing'
        : 'Recording'
      : detection?.calendarEventTitle ?? 'In a meeting?';
  const body =
    props.mode === 'recording'
      ? recording?.status === 'finalizing'
        ? 'Flow is finalizing the recording and preparing transcript notes.'
        : transcriptChunkCount > 0
        ? `Flow is recording ${sourceLabel}. ${transcriptChunkCount} transcript chunk${transcriptChunkCount === 1 ? '' : 's'} captured.`
        : `Flow is recording ${sourceLabel}. Transcript notes will appear after you stop.`
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
              onClick={() => props.onStart(['system', 'microphone'])}
            >
              Record meeting
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={() => props.onStart(['microphone'])}
            >
              Mic only
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
