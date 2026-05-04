import {memo, useEffect, useMemo, useRef} from 'react';

import type {TimelineUiState} from '../types';
import {MeetingCompanion} from './MeetingCompanion';

export const CompanionWindow = memo(function CompanionWindow(props: {
  timelineStore: TimelineUiState;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const activeRecordingId = props.timelineStore.audioRuntimeState.activeRecordingId;
  const candidate = props.timelineStore.activeMeetingCandidate;
  const visible = useMemo(
    () => activeRecordingId != null || candidate?.status === 'prompted',
    [activeRecordingId, candidate?.status],
  );

  useEffect(() => {
    window.flow?.companion.setVisible(visible).catch(() => {});
  }, [visible]);

  useEffect(() => {
    const element = rootRef.current;
    if (element == null) return;
    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry == null) return;
      window.flow?.companion
        .setContentHeight(entry.contentRect.height)
        .catch(() => {});
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <main ref={rootRef} className="companion-window">
      {visible ? <MeetingCompanion timelineStore={props.timelineStore} /> : null}
    </main>
  );
});

