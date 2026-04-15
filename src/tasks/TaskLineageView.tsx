import React from 'react';
import {Text, View} from 'react-native';

import type {TaskLineageView as TaskLineageRecord, TaskSegmentView} from './types';

type TaskLineageViewProps = {
  lineage: TaskLineageRecord | null;
  segment: TaskSegmentView | null;
  sideBranch: TaskSegmentView | null;
  pendingCount: number;
  lineageCount: number;
  metrics: {
    llmDecisionPercentage: number;
    fallbackDecisionPercentage: number;
    pendingObservationCount: number;
    interruptionAbsorptionRate: number;
  };
  formatNullable: (value?: string | number | null) => string;
  formatList: (values: string[]) => string;
  LabelValue: React.ComponentType<{label: string; value: string}>;
};

export function TaskLineageView({
  lineage,
  segment,
  sideBranch,
  pendingCount,
  lineageCount,
  metrics,
  formatNullable,
  formatList,
  LabelValue,
}: TaskLineageViewProps) {
  return (
    <View>
      <LabelValue label="Current Segment" value={formatNullable(segment?.liveTitle)} />
      <LabelValue label="Current Segment State" value={formatNullable(segment?.state)} />
      <LabelValue label="Current Lineage" value={formatNullable(lineage?.latestLiveTitle)} />
      <LabelValue label="Lineage Sessions" value={formatList(lineage?.sessionIds ?? [])} />
      <LabelValue label="Side Branch" value={formatNullable(sideBranch?.liveTitle)} />
      <LabelValue label="Pending Observations" value={String(pendingCount)} />
      <LabelValue label="Task Lineages" value={String(lineageCount)} />
      <LabelValue
        label="LLM Decision %"
        value={`${(metrics.llmDecisionPercentage * 100).toFixed(0)}%`}
      />
      <LabelValue
        label="Fallback Decision %"
        value={`${(metrics.fallbackDecisionPercentage * 100).toFixed(0)}%`}
      />
      <LabelValue
        label="Interruption Absorption"
        value={`${(metrics.interruptionAbsorptionRate * 100).toFixed(0)}%`}
      />
      <LabelValue
        label="Pending Buffer Size"
        value={String(metrics.pendingObservationCount)}
      />
    </View>
  );
}
