import type React from 'react';

import type {WorklogCalendarBlock} from '../../../src/worklog/types';

export function Screen(props: {title: string; children: React.ReactNode}) {
  return (
    <section className="screen">
      <h1>{props.title}</h1>
      {props.children}
    </section>
  );
}

export function Metric(props: {label: string; value: string}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] p-3 shadow-[var(--shadow-1)]">
      <span className="text-[var(--font-caption)] font-black uppercase tracking-[0.1em] text-[var(--text-faint)]">
        {props.label}
      </span>
      <strong className="mt-2 block overflow-wrap-anywhere text-lg font-bold tracking-[-0.03em] text-[var(--text)]">
        {props.value}
      </strong>
    </div>
  );
}

export function BlockList(props: {
  blocks: WorklogCalendarBlock[];
  selectedBlockId: string | null;
  onSelect: (block: WorklogCalendarBlock) => void;
}) {
  if (props.blocks.length === 0) {
    return (
      <p className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-elevated)] p-6 text-[var(--text-muted)]">
        No blocks yet.
      </p>
    );
  }
  return (
    <div className="grid gap-3">
      {props.blocks.map(block => (
        <button
          key={block.id}
          className={block.id === props.selectedBlockId ? 'block active' : 'block'}
          type="button"
          onClick={() => props.onSelect(block)}>
          <span>
            {new Date(block.startTime).toLocaleTimeString([], {
              hour: 'numeric',
              minute: '2-digit',
            })}
          </span>
          <strong>{block.title}</strong>
          <small>{block.repos[0] ?? block.apps[0] ?? block.category ?? 'work'}</small>
        </button>
      ))}
    </div>
  );
}

export function SmallList(props: {label: string; values: string[]}) {
  if (props.values.length === 0) return null;
  return (
    <div className="grid gap-1.5">
      <strong className="text-[var(--font-caption)] font-black uppercase tracking-[0.1em] text-[var(--text-faint)]">
        {props.label}
      </strong>
      <span className="text-[var(--text-muted)]">{props.values.join(', ')}</span>
    </div>
  );
}

export function MarkdownText(props: {text: string}) {
  const lines = props.text.split('\n');
  return (
    <div className="markdown-text">
      {lines.map((line, index) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('- ')) {
          return <li key={index}>{trimmed.slice(2)}</li>;
        }
        return <p key={index}>{line}</p>;
      })}
    </div>
  );
}
