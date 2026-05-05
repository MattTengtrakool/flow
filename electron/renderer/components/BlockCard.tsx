import { memo } from 'react';

import type { WorklogCalendarBlock } from '../../../src/worklog/types';
import { presentableWorkArtifacts } from '../../../src/workArtifacts';
import { focusedMinutes } from '../dateUtils';

const timeFormatter = new Intl.DateTimeFormat([], {
  hour: 'numeric',
  minute: '2-digit',
});

export const BlockCard = memo(function BlockCard(props: {
  block: WorklogCalendarBlock;
  selected?: boolean;
  compact?: boolean;
  onSelect: (block: WorklogCalendarBlock) => void;
}) {
  const { block, selected = false, compact = false, onSelect } = props;
  const start = timeFormatter.format(new Date(block.startTime));
  const end = timeFormatter.format(new Date(block.endTime));
  const minutes = focusedMinutes([block]);
  const chips = presentableWorkArtifacts({
    projects: block.projects,
    tasks: block.tasks,
    repositories: block.repos,
    tickets: block.tickets,
    documents: block.documents,
    urls: block.urls,
  });

  return (
    <button
      type="button"
      className={[
        'block-card',
        selected ? 'is-selected' : '',
        compact ? 'is-compact' : '',
        block.category != null ? `category-${block.category}` : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={() => onSelect(block)}
    >
      <span className="block-card__stripe" />
      <span className="block-card__time">
        {start} - {end} · {minutes}m
      </span>
      <strong>{block.title}</strong>
      {!compact ? <span>{block.summary.narrative}</span> : null}
      <span className="chip-row">
        {chips
          .slice(0, compact ? 2 : 5)
          .map(value => (
            <span key={value} className="chip">
              {value}
            </span>
          ))}
      </span>
    </button>
  );
});
