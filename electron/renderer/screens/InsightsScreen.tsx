import { memo, useMemo } from 'react';

import type { CostSummary } from '../../../src/planner/costSummary';
import type { WorklogCalendarBlock } from '../../../src/worklog/types';
import { normalizeProjects, normalizeTasks } from '../../../src/workArtifacts';
import { focusedMinutes } from '../dateUtils';
import { BlockCard } from '../components/BlockCard';
import { MetricCard } from '../components/MetricCard';
import { Screen } from '../components/common';

function topValues(
  blocks: WorklogCalendarBlock[],
  getter: (block: WorklogCalendarBlock) => string[],
) {
  const counts = new Map<string, number>();
  for (const block of blocks) {
    for (const value of getter(block)) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
}

export const InsightsScreen = memo(function InsightsScreen(props: {
  allBlocks: WorklogCalendarBlock[];
  costSummary: CostSummary;
  selectedBlockId: string | null;
  onSelectBlock: (block: WorklogCalendarBlock) => void;
}) {
  const minutes = useMemo(
    () => focusedMinutes(props.allBlocks),
    [props.allBlocks],
  );
  const projects = useMemo(
    () =>
      topValues(props.allBlocks, block =>
        normalizeProjects({ projects: block.projects, repos: block.repos }),
      ),
    [props.allBlocks],
  );
  const tasks = useMemo(
    () =>
      topValues(props.allBlocks, block =>
        normalizeTasks({ tasks: block.tasks, tickets: block.tickets }),
      ),
    [props.allBlocks],
  );

  return (
    <Screen title="Insights">
      <div className="metric-grid">
        <MetricCard label="Blocks" value={String(props.allBlocks.length)} />
        <MetricCard label="Focused time" value={`${minutes}m`} />
        <MetricCard
          label="Plan cost"
          value={`$${props.costSummary.allTime.costUsd.toFixed(4)}`}
        />
        <MetricCard
          label="Last 7 days"
          value={`$${props.costSummary.last7Days.costUsd.toFixed(4)}`}
        />
        <MetricCard
          label="Last 30 days"
          value={`$${props.costSummary.last30Days.costUsd.toFixed(4)}`}
        />
        <MetricCard
          label="Priced plans"
          value={String(props.costSummary.pricedPlanCount)}
        />
      </div>

      <div className="insight-grid">
        <section className="panel-card">
          <h3>Top projects</h3>
          {projects.map(([project, count]) => (
            <div key={project} className="insight-row">
              <span>{project}</span>
              <strong>{count}</strong>
            </div>
          ))}
        </section>
        <section className="panel-card">
          <h3>Top tasks</h3>
          {tasks.map(([task, count]) => (
            <div key={task} className="insight-row">
              <span>{task}</span>
              <strong>{count}</strong>
            </div>
          ))}
        </section>
      </div>

      <div className="timeline-list">
        {props.allBlocks.slice(0, 20).map(block => (
          <BlockCard
            key={block.id}
            block={block}
            selected={block.id === props.selectedBlockId}
            onSelect={props.onSelectBlock}
          />
        ))}
      </div>
    </Screen>
  );
});
