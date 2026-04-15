import React from 'react';
import {Text, View} from 'react-native';

import {TaskDecisionList} from './TaskDecisionList';
import {TaskLineageView} from './TaskLineageView';
import type {ObservationView} from '../state/eventLog';
import type {
  TaskDecisionView,
  TaskLineageView as TaskLineageRecord,
  TaskSegmentView,
} from './types';

type TaskDebuggerProps = {
  currentPrimaryTaskSegment: TaskSegmentView | null;
  currentTaskLineage: TaskLineageRecord | null;
  currentSideBranchSegment: TaskSegmentView | null;
  recentTaskDecisions: TaskDecisionView[];
  observationsById: Record<string, ObservationView>;
  taskDecisionCount: number;
  lastTaskDecisionAt: string | null;
  pendingTaskObservations: {observationId: string}[];
  taskLineageCount: number;
  taskMetrics: {
    llmDecisionPercentage: number;
    fallbackDecisionPercentage: number;
    pendingObservationCount: number;
    interruptionAbsorptionRate: number;
  };
  styles: {
    buttonRow: object;
    emptyState: object;
    fixtureList: object;
    fixtureRow: object;
    fixtureTitle: object;
    fixtureMeta: object;
    fieldHelp: object;
    warningBadge: object;
    warningBadgeText: object;
    taskObservationRow: object;
    taskObservationImage: object;
    taskObservationBody: object;
  };
  LabelValue: React.ComponentType<{label: string; value: string}>;
  ActionButton: React.ComponentType<{
    label: string;
    onPress: () => void;
    disabled?: boolean;
    tone?: 'primary' | 'secondary' | 'danger';
  }>;
  formatNullable: (value?: string | number | null) => string;
  formatList: (values: string[]) => string;
  formatTimestamp: (value?: string | null) => string;
  onMergeConfirm: () => void;
  onSplitConfirm: () => void;
  onResumeConfirm: () => void;
  controlsDisabled: boolean;
};

export function TaskDebugger(props: TaskDebuggerProps) {
  const {
    currentPrimaryTaskSegment,
    currentTaskLineage,
    currentSideBranchSegment,
    recentTaskDecisions,
    observationsById,
    taskDecisionCount,
    lastTaskDecisionAt,
    pendingTaskObservations,
    taskLineageCount,
    taskMetrics,
    styles,
    LabelValue,
    ActionButton,
    formatNullable,
    formatList,
    formatTimestamp,
    onMergeConfirm,
    onSplitConfirm,
    onResumeConfirm,
    controlsDisabled,
  } = props;

  return (
    <View>
      <TaskLineageView
        lineage={currentTaskLineage}
        segment={currentPrimaryTaskSegment}
        sideBranch={currentSideBranchSegment}
        pendingCount={pendingTaskObservations.length}
        lineageCount={taskLineageCount}
        metrics={taskMetrics}
        formatNullable={formatNullable}
        formatList={formatList}
        LabelValue={LabelValue}
      />
      <LabelValue
        label="Decision Count"
        value={String(taskDecisionCount)}
      />
      <LabelValue
        label="Last Task Decision At"
        value={formatTimestamp(lastTaskDecisionAt)}
      />
      <View style={styles.buttonRow}>
        <ActionButton
          label="Confirm Merge Pattern"
          onPress={onMergeConfirm}
          disabled={controlsDisabled || currentTaskLineage == null}
          tone="secondary"
        />
        <ActionButton
          label="Confirm Split Pattern"
          onPress={onSplitConfirm}
          disabled={controlsDisabled || currentPrimaryTaskSegment == null}
          tone="secondary"
        />
        <ActionButton
          label="Confirm Resume Pattern"
          onPress={onResumeConfirm}
          disabled={controlsDisabled || currentTaskLineage == null}
          tone="secondary"
        />
      </View>
      <TaskDecisionList
        decisions={recentTaskDecisions}
        observationsById={observationsById}
        formatTimestamp={formatTimestamp}
        styles={styles}
      />
      {pendingTaskObservations.length > 0 ? (
        <Text style={styles.fixtureMeta}>
          Pending observation ids: {pendingTaskObservations.map(item => item.observationId).join(', ')}
        </Text>
      ) : null}
    </View>
  );
}
