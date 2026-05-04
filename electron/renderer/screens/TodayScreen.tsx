import { memo } from 'react';

import type { WorklogCalendarBlock } from '../../../src/worklog/types';
import { focusedMinutes } from '../dateUtils';
import { BlockCard } from '../components/BlockCard';
import { MetricCard } from '../components/MetricCard';
import { Screen } from '../components/common';

export const TodayScreen = memo(function TodayScreen(props: {
  todayIso: string;
  blocks: WorklogCalendarBlock[];
  selectedBlockId: string | null;
  captureStatus: string;
  onSelectBlock: (block: WorklogCalendarBlock) => void;
  onStartSession: () => void;
  onCaptureNow: () => void;
  onReplanNow: () => void;
}) {
  const minutes = focusedMinutes(props.blocks);

  return (
    <Screen title="Today">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">{props.todayIso}</p>
          <h2>Work timeline</h2>
          <p className="hero-caption">{props.captureStatus}</p>
        </div>
        <div className="metric-grid compact">
          <MetricCard label="Focused time" value={`${minutes}m`} />
          <MetricCard label="Blocks" value={String(props.blocks.length)} />
        </div>
      </section>

      <div className="button-row">
        <button
          type="button"
          className="button-secondary"
          onClick={props.onStartSession}
        >
          Start session
        </button>
        <button
          type="button"
          className="button-secondary"
          onClick={props.onCaptureNow}
        >
          Capture now
        </button>
        <button
          type="button"
          className="button-secondary"
          onClick={props.onReplanNow}
        >
          Replan now
        </button>
      </div>

      {props.blocks.length === 0 ? (
        <div className="empty-state roomy">
          <strong>No work blocks yet</strong>
          <p>
            Start a session and Flow will turn captures into a daily worklog.
          </p>
        </div>
      ) : (
        <div className="timeline-list">
          {props.blocks.map(block => (
            <BlockCard
              key={block.id}
              block={block}
              selected={block.id === props.selectedBlockId}
              onSelect={props.onSelectBlock}
            />
          ))}
        </div>
      )}
    </Screen>
  );
});
