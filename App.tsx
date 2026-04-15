import React, {useEffect, useRef, useState} from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {useObservationLab} from './src/observation/useObservationLab';
import type {
  WorkflowRecordingRecord,
  WorkflowReplayRecord,
  WorkflowStepExpectation,
  WorkflowStepExpectationKind,
} from './src/observation/types';
import {TaskDebugger} from './src/tasks/TaskDebugger';

type SectionProps = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
};

type ActionButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'primary' | 'secondary' | 'danger';
  testID?: string;
};

type LabelValueProps = {
  label: string;
  value: string;
};

type ScoreSelectorProps = {
  label: string;
  value: number | null;
  onChange: (value: number) => void;
};

function Section({title, subtitle, children}: SectionProps) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle != null ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      {children}
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  disabled = false,
  tone = 'primary',
  testID,
}: ActionButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        tone === 'secondary' ? styles.buttonSecondary : null,
        tone === 'danger' ? styles.buttonDanger : null,
        disabled ? styles.buttonDisabled : null,
        pressed && !disabled ? styles.buttonPressed : null,
      ]}
      testID={testID}>
      <Text
        style={[
          styles.buttonLabel,
          tone === 'secondary' ? styles.buttonLabelSecondary : null,
          tone === 'danger' ? styles.buttonLabelDanger : null,
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

function LabelValue({label, value}: LabelValueProps) {
  return (
    <View style={styles.labelValueRow}>
      <Text style={styles.labelValueLabel}>{label}</Text>
      <Text style={styles.labelValueValue}>{value}</Text>
    </View>
  );
}

function ScoreSelector({label, value, onChange}: ScoreSelectorProps) {
  return (
    <View style={styles.scoreRow}>
      <Text style={styles.scoreLabel}>{label}</Text>
      <View style={styles.scoreButtons}>
        {[1, 2, 3, 4, 5].map(score => (
          <Pressable
            key={score}
            onPress={() => onChange(score)}
            style={[
              styles.scoreButton,
              value === score ? styles.scoreButtonActive : null,
            ]}>
            <Text
              style={[
                styles.scoreButtonLabel,
                value === score ? styles.scoreButtonLabelActive : null,
              ]}>
              {score}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function formatTimestamp(value?: string | null): string {
  if (value == null) {
    return 'Not set';
  }

  return new Date(value).toLocaleString();
}

function formatNullable(value?: string | number | null): string {
  if (value == null || value === '') {
    return 'Unknown';
  }

  return String(value);
}

function averageToLabel(value: number | null): string {
  return value == null ? 'Not scored' : `${value.toFixed(2)} / 5`;
}

function formatList(values: string[]): string {
  return values.length === 0 ? 'None' : values.join(', ');
}

function formatWorkflowMatch(value: boolean | null | undefined): string {
  if (value == null) {
    return 'Not labeled';
  }

  return value ? 'Matched' : 'Mismatched';
}

type WorkflowStepDraft = Pick<
  WorkflowStepExpectation,
  'expectedKind' | 'expectedDecision' | 'note' | 'importance'
>;

function buildWorkflowComparisonExport(args: {
  recording: WorkflowRecordingRecord;
  replay: WorkflowReplayRecord;
  mismatchesOnly?: boolean;
}): string {
  const {recording, replay, mismatchesOnly = false} = args;
  const lines: string[] = [
    `workflow_label: ${recording.label}`,
    `workflow_id: ${recording.id}`,
    `replayed_at: ${replay.replayedAt}`,
    `summary: matched=${replay.matchedCount}, mismatched=${replay.mismatchedCount}, unlabeled=${replay.unlabeledCount}`,
    '',
    'steps:',
  ];

  recording.steps.forEach((step, index) => {
    const replayStep =
      replay.stepResults.find(result => result.stepId === step.id) ?? null;
    const isMismatch = replayStep?.matchedExpectation === false;

    if (mismatchesOnly && !isMismatch) {
      return;
    }

    lines.push(`- step_index: ${index + 1}`);
    lines.push(`  step_label: ${step.label}`);
    lines.push(`  expected_kind: ${step.expectation.expectedKind ?? 'none'}`);
    lines.push(
      `  expected_decision: ${step.expectation.expectedDecision ?? 'none'}`,
    );
    lines.push(
      `  expectation_note: ${step.expectation.note.trim() || 'none'}`,
    );
    lines.push(
      `  replay_decision: ${replayStep?.decision ?? 'not_replayed'}`,
    );
    lines.push(`  replay_mode: ${replayStep?.decisionMode ?? 'unknown'}`);
    lines.push(
      `  match_status: ${
        replayStep == null
          ? 'not_replayed'
          : replayStep.matchedExpectation == null
            ? 'unlabeled'
            : replayStep.matchedExpectation
              ? 'matched'
              : 'mismatched'
      }`,
    );
    lines.push(
      `  mismatch_reason: ${replayStep?.mismatchReason ?? 'none'}`,
    );
    lines.push('');
  });

  if (mismatchesOnly && replay.mismatchedCount === 0) {
    lines.push('- none');
  }

  return lines.join('\n').trim();
}

function App() {
  const {
    hydrationStatus,
    monitoringEnabled,
    permissions,
    latestInspection,
    latestCapturePreview,
    actionFeedback,
    surfaceErrorMessage,
    currentContext,
    latestObservationRun,
    observeLatestCapture,
    observationBusy,
    fixtures,
    fixturesDirectoryPath,
    selectedFixtureId,
    setSelectedFixtureId,
    selectedFixture,
    fixtureLabelDraft,
    setFixtureLabelDraft,
    saveLatestCaptureAsFixture,
    runFixtureObservation,
    runAllFixtures,
    deleteSelectedFixture,
    fixtureBusy,
    batchBusy,
    ratingDraft,
    setRatingDraft,
    saveSelectedFixtureRating,
    fixtureSummary,
    workflowRecordings,
    workflowRecordingsDirectoryPath,
    selectedWorkflowRecordingId,
    setSelectedWorkflowRecordingId,
    selectedWorkflowRecording,
    activeWorkflowRecording,
    workflowLabelDraft,
    setWorkflowLabelDraft,
    workflowDescriptionDraft,
    setWorkflowDescriptionDraft,
    workflowBusy,
    workflowReplayBusy,
    startWorkflowRecording,
    stopWorkflowRecording,
    recordWorkflowStepNow,
    saveWorkflowStepExpectation,
    replaySelectedWorkflowRecording,
    deleteSelectedWorkflowRecording,
    labFeedback,
    currentPrimaryTaskSegment,
    currentTaskLineage,
    currentSideBranchSegment,
    recentTaskDecisions,
    timeline,
    taskDecisionCount,
    lastTaskDecisionAt,
    pendingTaskObservations,
    taskLineages,
    taskMetrics,
    continuousModeState,
    currentSessionId,
    applyUserTaskCorrection,
    startSession,
    stopSession,
    runTaskReconciliation,
    promptForAccessibility,
    requestScreenCapturePermission,
    runCaptureInspection,
    runCaptureNow,
  } = useObservationLab();

  const capturePreviewUri = latestCapturePreview?.dataUri ?? null;
  const selectedFixturePreviewUri =
    selectedFixture != null
      ? `data:${selectedFixture.imageMimeType};base64,${selectedFixture.imageBase64}`
      : null;
  const controlsDisabled = hydrationStatus !== 'ready';
  const latestObservationJson =
    latestObservationRun != null
      ? JSON.stringify(latestObservationRun.observation, null, 2)
      : null;
  const selectedFixtureObservationJson =
    selectedFixture?.lastRun != null
      ? JSON.stringify(selectedFixture.lastRun.observation, null, 2)
      : null;
  const selectedWorkflowReplay = selectedWorkflowRecording?.lastReplay ?? null;
  const selectedWorkflowMismatchExport =
    selectedWorkflowRecording != null && selectedWorkflowReplay != null
      ? buildWorkflowComparisonExport({
          recording: selectedWorkflowRecording,
          replay: selectedWorkflowReplay,
          mismatchesOnly: true,
        })
      : null;
  const selectedWorkflowFullExport =
    selectedWorkflowRecording != null && selectedWorkflowReplay != null
      ? buildWorkflowComparisonExport({
          recording: selectedWorkflowRecording,
          replay: selectedWorkflowReplay,
        })
      : null;
  const [workflowStepDrafts, setWorkflowStepDrafts] = useState<
    Record<string, WorkflowStepDraft>
  >({});
  const workflowStepAutosaveTimersRef = useRef<
    Record<string, ReturnType<typeof setTimeout>>
  >({});

  useEffect(() => {
    return () => {
      for (const timerId of Object.values(workflowStepAutosaveTimersRef.current)) {
        clearTimeout(timerId);
      }
      workflowStepAutosaveTimersRef.current = {};
    };
  }, []);

  useEffect(() => {
    if (selectedWorkflowRecording == null) {
      setWorkflowStepDrafts({});
      return;
    }

    setWorkflowStepDrafts(previousDrafts => {
      const nextDrafts: Record<string, WorkflowStepDraft> = {};

      for (const step of selectedWorkflowRecording.steps) {
        nextDrafts[step.id] = previousDrafts[step.id] ?? {
          expectedKind: step.expectation.expectedKind,
          expectedDecision: step.expectation.expectedDecision,
          note: step.expectation.note,
          importance: step.expectation.importance,
        };
      }

      return nextDrafts;
    });
  }, [selectedWorkflowRecording?.id, selectedWorkflowRecording?.steps.length]);

  function getWorkflowStepDraft(
    stepId: string,
    fallbackExpectation: WorkflowStepExpectation,
  ): WorkflowStepDraft {
    return (
      workflowStepDrafts[stepId] ?? {
        expectedKind: fallbackExpectation.expectedKind,
        expectedDecision: fallbackExpectation.expectedDecision,
        note: fallbackExpectation.note,
        importance: fallbackExpectation.importance,
      }
    );
  }

  function persistWorkflowStepDraft(
    recordingId: string,
    stepId: string,
    draft: WorkflowStepDraft,
  ) {
    saveWorkflowStepExpectation({
      recordingId,
      stepId,
      expectation: {
        expectedKind: draft.expectedKind,
        expectedDecision: draft.expectedDecision,
        note: draft.note,
        importance: draft.importance,
        labeledAt: null,
      },
    }).catch(() => {});
  }

  function scheduleWorkflowStepAutosave(
    recordingId: string,
    stepId: string,
    draft: WorkflowStepDraft,
  ) {
    const existingTimer = workflowStepAutosaveTimersRef.current[stepId];

    if (existingTimer != null) {
      clearTimeout(existingTimer);
    }

    workflowStepAutosaveTimersRef.current[stepId] = setTimeout(() => {
      persistWorkflowStepDraft(recordingId, stepId, draft);
      delete workflowStepAutosaveTimersRef.current[stepId];
    }, 500);
  }

  function applyMergeCorrection() {
    if (currentTaskLineage == null) {
      return;
    }

    applyUserTaskCorrection({
      id: `merge_${currentTaskLineage.id}`,
      type: 'merge_confirmed',
      segmentIds: currentTaskLineage.segmentIds,
      lineageIds: [currentTaskLineage.id],
      note: 'User confirmed these segments belong together.',
    });
  }

  function applySplitCorrection() {
    if (currentPrimaryTaskSegment == null || currentTaskLineage == null) {
      return;
    }

    applyUserTaskCorrection({
      id: `split_${currentPrimaryTaskSegment.id}`,
      type: 'split_confirmed',
      segmentIds: [currentPrimaryTaskSegment.id],
      lineageIds: [currentTaskLineage.id],
      note: 'User confirmed this should remain a distinct segment.',
    });
  }

  function applyResumeCorrection() {
    if (currentTaskLineage == null) {
      return;
    }

    applyUserTaskCorrection({
      id: `resume_${currentTaskLineage.id}`,
      type: 'resume_correction_applied',
      segmentIds: currentTaskLineage.segmentIds,
      lineageIds: [currentTaskLineage.id],
      note: 'User confirmed the current work resumes an earlier lineage.',
    });
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Section
        title="Observation Lab"
        subtitle="Focused manual test surface for capture, strict JSON observations, and fixture review.">
        <Text style={styles.heroTitle} testID="app-running">
          App running
        </Text>
        <Text style={styles.heroSubtitle}>
          {monitoringEnabled
            ? 'Passive context monitoring is on.'
            : 'Passive context monitoring is still starting.'}
        </Text>
        <LabelValue
          label="Hydration"
          value={hydrationStatus === 'ready' ? 'Ready' : hydrationStatus}
        />
        <LabelValue
          label="Current App"
          value={formatNullable(currentContext?.appName)}
        />
        <LabelValue
          label="Current Window"
          value={formatNullable(currentContext?.windowTitle)}
        />
        <LabelValue
          label="Context Source"
          value={currentContext?.source === 'window' ? 'Precise window' : 'App only'}
        />
        <View style={styles.buttonRow}>
          <ActionButton
            label="Start Session"
            onPress={startSession}
            disabled={controlsDisabled}
          />
          <ActionButton
            label="Stop Session"
            onPress={stopSession}
            disabled={controlsDisabled}
            tone="secondary"
          />
          <ActionButton
            label="Reconcile Tasks"
            onPress={runTaskReconciliation}
            disabled={controlsDisabled}
            tone="secondary"
          />
        </View>
      </Section>

      <Section
        title="Continuous Session"
        subtitle="Continuous capture and automatic observation generation follow the active session.">
        <LabelValue
          label="Mode"
          value={continuousModeState.currentMode}
        />
        <LabelValue
          label="Auto Observe"
          value={continuousModeState.autoObserveEnabled ? 'On' : 'Off'}
        />
        <LabelValue
          label="Queue Length"
          value={String(continuousModeState.observationQueueLength)}
        />
        <LabelValue
          label="Observation In Flight"
          value={continuousModeState.observationInFlight ? 'Yes' : 'No'}
        />
        <LabelValue
          label="Last Observed At"
          value={formatTimestamp(continuousModeState.lastObservedAt)}
        />
        <LabelValue
          label="Last Observation Decision"
          value={formatNullable(continuousModeState.lastObservationDecision)}
        />
        <LabelValue
          label="Consecutive Failures"
          value={String(continuousModeState.consecutiveFailureCount)}
        />
        <Text style={styles.fieldHelp}>
          {continuousModeState.continuousStatusMessage}
        </Text>
        {currentSessionId == null ? (
          <Text style={styles.fieldHelp}>
            Start a session to begin continuous capture and automatic observations.
          </Text>
        ) : null}
      </Section>

      {actionFeedback != null ? (
        <View style={[styles.feedbackCard, styles.feedbackNeutral]}>
          <Text style={styles.feedbackTitle}>Capture Status</Text>
          <Text style={styles.feedbackText}>{actionFeedback.message}</Text>
        </View>
      ) : null}

      {labFeedback != null ? (
        <View
          style={[
            styles.feedbackCard,
            labFeedback.tone === 'success'
              ? styles.feedbackSuccess
              : labFeedback.tone === 'warning'
                ? styles.feedbackWarning
                : labFeedback.tone === 'error'
                  ? styles.feedbackError
                  : styles.feedbackNeutral,
          ]}>
          <Text style={styles.feedbackTitle}>Observation Status</Text>
          <Text style={styles.feedbackText}>{labFeedback.message}</Text>
        </View>
      ) : null}

      {surfaceErrorMessage != null ? (
        <View style={[styles.feedbackCard, styles.feedbackError]}>
          <Text style={styles.feedbackTitle}>Error</Text>
          <Text style={styles.feedbackText}>{surfaceErrorMessage}</Text>
        </View>
      ) : null}

      <Section
        title="Permissions"
        subtitle="Make sure precise context and screen capture are actually available before judging model quality.">
        <LabelValue
          label="Accessibility"
          value={permissions.accessibilityTrusted ? 'Granted' : 'Not granted'}
        />
        <LabelValue
          label="Screen Recording"
          value={permissions.captureAccessGranted ? 'Granted' : 'Not granted'}
        />
        <LabelValue
          label="Running Bundle ID"
          value={formatNullable(permissions.hostBundleIdentifier)}
        />
        <LabelValue
          label="Running App Path"
          value={formatNullable(permissions.hostBundlePath)}
        />
        <Text style={styles.fieldHelp}>
          `Inspect Capture Target` only works after `Screen Recording` shows
          `Granted`. If you just allowed it in System Settings, relaunch the app
          once before testing again.
        </Text>
        <View style={styles.buttonRow}>
          <ActionButton
            label="Prompt Accessibility"
            onPress={promptForAccessibility}
            disabled={controlsDisabled}
          />
        </View>
        <View style={styles.buttonRow}>
          <ActionButton
            label="Request Screen Recording"
            onPress={requestScreenCapturePermission}
            disabled={controlsDisabled}
          />
        </View>
      </Section>

      <Section
        title="Live Capture"
        subtitle="Use these controls to verify target resolution, grab a screenshot, and feed the real observation engine.">
        <View style={styles.buttonRow}>
          <ActionButton
            label="Inspect Capture Target"
            onPress={runCaptureInspection}
            disabled={controlsDisabled}
            testID="inspect-capture-button"
          />
          <ActionButton
            label="Capture Now"
            onPress={runCaptureNow}
            disabled={controlsDisabled}
            testID="capture-now-button"
          />
        </View>
        <LabelValue
          label="Chosen Target"
          value={formatNullable(latestInspection?.chosenTargetType)}
        />
        <LabelValue
          label="Resolver Confidence"
          value={
            latestInspection != null
              ? latestInspection.confidence.toFixed(2)
              : 'Not inspected'
          }
        />
        <LabelValue
          label="Captured At"
          value={formatTimestamp(latestCapturePreview?.metadata.capturedAt)}
        />
        <LabelValue
          label="Frame Hash"
          value={formatNullable(latestCapturePreview?.metadata.frameHash)}
        />
        <LabelValue
          label="Resolver Note"
          value={formatNullable(latestInspection?.fallbackReason)}
        />
        {capturePreviewUri != null ? (
          <Image source={{uri: capturePreviewUri}} style={styles.previewImage} />
        ) : (
          <Text style={styles.emptyState}>
            Capture a screenshot to preview what the observation engine will see.
          </Text>
        )}
      </Section>

      <Section
        title="Observation Engine"
        subtitle="This is the new Stage 8 path: screenshot plus metadata goes to a real vision model and must come back as strict JSON.">
        <View style={styles.buttonRow}>
          <ActionButton
            label={observationBusy ? 'Observing…' : 'Observe Last Capture'}
            onPress={() => {
              observeLatestCapture().catch(() => {});
            }}
            disabled={observationBusy || controlsDisabled}
            testID="observe-last-capture-button"
          />
        </View>
        {latestObservationRun != null ? (
          <>
            <LabelValue label="Model" value={latestObservationRun.model} />
            <LabelValue
              label="Latency"
              value={`${latestObservationRun.durationMs} ms`}
            />
            <Text style={styles.jsonLabel}>Strict JSON Output</Text>
            <Text style={styles.jsonBlock} selectable>
              {latestObservationJson}
            </Text>
          </>
        ) : (
          <Text style={styles.emptyState}>
            No real observation has run yet.
          </Text>
        )}
      </Section>

      <Section
        title="Task Debugger"
        subtitle="Inspect the live task engine state, pending observations, and recent decisions.">
        <TaskDebugger
          currentPrimaryTaskSegment={currentPrimaryTaskSegment}
          currentTaskLineage={currentTaskLineage}
          currentSideBranchSegment={currentSideBranchSegment}
          recentTaskDecisions={recentTaskDecisions}
          observationsById={timeline.observationsById}
          taskDecisionCount={taskDecisionCount}
          lastTaskDecisionAt={lastTaskDecisionAt}
          pendingTaskObservations={pendingTaskObservations}
          taskLineageCount={taskLineages.length}
          taskMetrics={taskMetrics}
          styles={{
            buttonRow: styles.buttonRow,
            emptyState: styles.emptyState,
            fixtureList: styles.fixtureList,
            fixtureRow: styles.fixtureRow,
            fixtureTitle: styles.fixtureTitle,
            fixtureMeta: styles.fixtureMeta,
            fieldHelp: styles.fieldHelp,
            warningBadge: styles.warningBadge,
            warningBadgeText: styles.warningBadgeText,
            taskObservationRow: styles.taskObservationRow,
            taskObservationImage: styles.taskObservationImage,
            taskObservationBody: styles.taskObservationBody,
          }}
          LabelValue={LabelValue}
          ActionButton={ActionButton}
          formatNullable={formatNullable}
          formatList={formatList}
          formatTimestamp={formatTimestamp}
          onMergeConfirm={applyMergeCorrection}
          onSplitConfirm={applySplitCorrection}
          onResumeConfirm={applyResumeCorrection}
          controlsDisabled={controlsDisabled}
        />
      </Section>

      <Section
        title="Workflow Recorder"
        subtitle="Record real screenshot sequences, label what should happen, and replay them later as a benchmark set.">
        <TextInput
          autoCorrect={false}
          onChangeText={setWorkflowLabelDraft}
          placeholder="Workflow label"
          style={styles.input}
          value={workflowLabelDraft}
        />
        <TextInput
          multiline
          onChangeText={setWorkflowDescriptionDraft}
          placeholder="What does this workflow represent?"
          style={[styles.input, styles.notesInput]}
          value={workflowDescriptionDraft}
        />
        <View style={styles.buttonRow}>
          <ActionButton
            label={workflowBusy ? 'Working…' : 'Start Auto Recording'}
            onPress={() => {
              startWorkflowRecording('automatic').catch(() => {});
            }}
            disabled={workflowBusy || activeWorkflowRecording != null}
            testID="start-auto-workflow-button"
          />
          <ActionButton
            label={workflowBusy ? 'Working…' : 'Start Manual Recording'}
            onPress={() => {
              startWorkflowRecording('manual').catch(() => {});
            }}
            disabled={workflowBusy || activeWorkflowRecording != null}
            tone="secondary"
            testID="start-manual-workflow-button"
          />
          <ActionButton
            label={workflowBusy ? 'Stopping…' : 'Stop Recording'}
            onPress={() => {
              stopWorkflowRecording().catch(() => {});
            }}
            disabled={workflowBusy || activeWorkflowRecording == null}
            tone="secondary"
          />
          <ActionButton
            label={workflowBusy ? 'Capturing…' : 'Capture Step Now'}
            onPress={() => {
              recordWorkflowStepNow().catch(() => {});
            }}
            disabled={
              workflowBusy ||
              activeWorkflowRecording == null ||
              activeWorkflowRecording.captureMode !== 'manual'
            }
            testID="capture-workflow-step-button"
          />
        </View>
        <LabelValue
          label="Active Workflow"
          value={formatNullable(activeWorkflowRecording?.label)}
        />
        <LabelValue
          label="Capture Mode"
          value={formatNullable(activeWorkflowRecording?.captureMode)}
        />
        <LabelValue
          label="Recorded Steps"
          value={String(activeWorkflowRecording?.steps.length ?? 0)}
        />
        <LabelValue
          label="Workflows Path"
          value={formatNullable(workflowRecordingsDirectoryPath)}
        />
        {workflowRecordings.length === 0 ? (
          <Text style={styles.emptyState}>
            No workflow recordings yet. Start recording to build your benchmark set.
          </Text>
        ) : (
          <View style={styles.fixtureList}>
            {workflowRecordings.map(recording => {
              const isSelected = recording.id === selectedWorkflowRecordingId;

              return (
                <Pressable
                  key={recording.id}
                  onPress={() => setSelectedWorkflowRecordingId(recording.id)}
                  style={[
                    styles.fixtureRow,
                    isSelected ? styles.fixtureRowSelected : null,
                  ]}>
                  <Text style={styles.fixtureTitle}>{recording.label}</Text>
                  <Text style={styles.fixtureMeta}>
                    {formatTimestamp(recording.createdAt)}
                  </Text>
                  <Text style={styles.fixtureMeta}>
                    {recording.status} · {recording.captureMode} · {recording.steps.length} steps
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </Section>

      <Section
        title="Fixture Set"
        subtitle="Save captures that represent real work, rerun them later, and score whether the observation is useful enough for future clustering.">
        <TextInput
          autoCorrect={false}
          onChangeText={setFixtureLabelDraft}
          placeholder="Fixture label (optional)"
          style={styles.input}
          value={fixtureLabelDraft}
        />
        <View style={styles.buttonRow}>
          <ActionButton
            label={fixtureBusy ? 'Saving…' : 'Save Latest Capture As Fixture'}
            onPress={() => {
              saveLatestCaptureAsFixture().catch(() => {});
            }}
            disabled={fixtureBusy || controlsDisabled}
            testID="save-fixture-button"
          />
          <ActionButton
            label={batchBusy ? 'Running…' : 'Run All Fixtures'}
            onPress={() => {
              runAllFixtures().catch(() => {});
            }}
            disabled={batchBusy || fixtures.length === 0}
            tone="secondary"
          />
        </View>
        <LabelValue
          label="Fixture Count"
          value={String(fixtures.length)}
        />
        <LabelValue
          label="Fixtures Path"
          value={formatNullable(fixturesDirectoryPath)}
        />
        <LabelValue
          label="Rated Fixtures"
          value={String(fixtureSummary.ratedCount)}
        />
        <LabelValue
          label="Avg Usefulness"
          value={averageToLabel(fixtureSummary.averageUsefulness)}
        />
        <LabelValue
          label="Avg Confidence"
          value={averageToLabel(
            fixtureSummary.averageConfidenceCalibration,
          )}
        />
        <LabelValue
          label="Avg Sensitivity"
          value={averageToLabel(fixtureSummary.averageSensitivityHandling)}
        />
        {fixtures.length === 0 ? (
          <Text style={styles.emptyState}>
            No fixtures yet. Capture a real screen and save it.
          </Text>
        ) : (
          <View style={styles.fixtureList}>
            {fixtures.map(fixture => {
              const isSelected = fixture.id === selectedFixtureId;

              return (
                <Pressable
                  key={fixture.id}
                  onPress={() => setSelectedFixtureId(fixture.id)}
                  style={[
                    styles.fixtureRow,
                    isSelected ? styles.fixtureRowSelected : null,
                  ]}>
                  <Text style={styles.fixtureTitle}>{fixture.label}</Text>
                  <Text style={styles.fixtureMeta}>
                    {formatTimestamp(fixture.createdAt)}
                  </Text>
                  <Text style={styles.fixtureMeta}>
                    {fixture.lastRun != null ? 'Observed' : 'Not observed'} ·{' '}
                    {fixture.rating != null ? 'Scored' : 'Unscored'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </Section>

      {selectedFixture != null ? (
        <Section
          title="Selected Fixture"
          subtitle="Run the saved screenshot again, then score whether the JSON is useful enough for later task clustering.">
          <LabelValue label="Label" value={selectedFixture.label} />
          <LabelValue
            label="Created"
            value={formatTimestamp(selectedFixture.createdAt)}
          />
          <View style={styles.buttonRow}>
            <ActionButton
              label={fixtureBusy ? 'Running…' : 'Run Selected Fixture'}
              onPress={() => {
                runFixtureObservation(selectedFixture.id).catch(() => {});
              }}
              disabled={fixtureBusy}
              testID="run-selected-fixture-button"
            />
            <ActionButton
              label="Delete Fixture"
              onPress={() => {
                deleteSelectedFixture().catch(() => {});
              }}
              disabled={fixtureBusy}
              tone="danger"
            />
          </View>
          {selectedFixturePreviewUri != null ? (
            <Image
              source={{uri: selectedFixturePreviewUri}}
              style={styles.previewImage}
            />
          ) : null}
          {selectedFixture.lastRun != null ? (
            <>
              <LabelValue label="Run Model" value={selectedFixture.lastRun.model} />
              <LabelValue
                label="Run Latency"
                value={`${selectedFixture.lastRun.durationMs} ms`}
              />
              <Text style={styles.jsonLabel}>Observed JSON</Text>
              <Text style={styles.jsonBlock} selectable>
                {selectedFixtureObservationJson}
              </Text>
            </>
          ) : (
            <Text style={styles.emptyState}>
              This fixture has not been evaluated yet.
            </Text>
          )}
          <ScoreSelector
            label="Usefulness"
            value={ratingDraft.usefulness}
            onChange={value =>
              setRatingDraft(previousRating => ({
                ...previousRating,
                usefulness: value,
              }))
            }
          />
          <ScoreSelector
            label="Confidence"
            value={ratingDraft.confidenceCalibration}
            onChange={value =>
              setRatingDraft(previousRating => ({
                ...previousRating,
                confidenceCalibration: value,
              }))
            }
          />
          <ScoreSelector
            label="Sensitivity"
            value={ratingDraft.sensitivityHandling}
            onChange={value =>
              setRatingDraft(previousRating => ({
                ...previousRating,
                sensitivityHandling: value,
              }))
            }
          />
          <TextInput
            multiline
            onChangeText={value =>
              setRatingDraft(previousRating => ({
                ...previousRating,
                notes: value,
              }))
            }
            placeholder="What was useful, misleading, or sensitive?"
            style={[styles.input, styles.notesInput]}
            value={ratingDraft.notes}
          />
          <ActionButton
            label={fixtureBusy ? 'Saving…' : 'Save Scores'}
            onPress={() => {
              saveSelectedFixtureRating().catch(() => {});
            }}
            disabled={fixtureBusy}
            tone="secondary"
            testID="save-fixture-scores-button"
          />
        </Section>
      ) : null}

      {selectedWorkflowRecording != null ? (
        <Section
          title="Selected Workflow"
          subtitle="Replay the workflow against the current pipeline and mark what should have happened for each step.">
          <LabelValue label="Label" value={selectedWorkflowRecording.label} />
          <LabelValue
            label="Status"
            value={`${selectedWorkflowRecording.status} · ${selectedWorkflowRecording.captureMode}`}
          />
          <LabelValue
            label="Started"
            value={formatTimestamp(selectedWorkflowRecording.startedAt)}
          />
          <LabelValue
            label="Completed"
            value={formatTimestamp(selectedWorkflowRecording.completedAt)}
          />
          <LabelValue
            label="Replay Summary"
            value={
              selectedWorkflowReplay == null
                ? 'Not replayed'
                : `${selectedWorkflowReplay.matchedCount} matched · ${selectedWorkflowReplay.mismatchedCount} mismatched · ${selectedWorkflowReplay.unlabeledCount} unlabeled`
            }
          />
          {selectedWorkflowReplay != null ? (
            <>
              <Text style={styles.jsonLabel}>Paste To Chat (Mismatches)</Text>
              <Text style={styles.fieldHelp}>
                Click this box, press Cmd+A then Cmd+C, then paste into chat.
              </Text>
              <TextInput
                editable={false}
                multiline
                selectTextOnFocus
                style={[styles.input, styles.codeInput, styles.pasteOutputInput]}
                testID="workflow-mismatches-export"
                value={selectedWorkflowMismatchExport ?? ''}
              />
              <Text style={styles.jsonLabel}>Paste To Chat (All Steps)</Text>
              <TextInput
                editable={false}
                multiline
                selectTextOnFocus
                style={[styles.input, styles.codeInput, styles.pasteOutputInput]}
                testID="workflow-all-steps-export"
                value={selectedWorkflowFullExport ?? ''}
              />
            </>
          ) : null}
          {selectedWorkflowRecording.description.length > 0 ? (
            <Text style={styles.fieldHelp}>{selectedWorkflowRecording.description}</Text>
          ) : null}
          <View style={styles.buttonRow}>
            <ActionButton
              label={workflowReplayBusy ? 'Replaying…' : 'Replay Selected Workflow'}
              onPress={() => {
                replaySelectedWorkflowRecording().catch(() => {});
              }}
              disabled={workflowReplayBusy}
              testID="replay-selected-workflow-button"
            />
            <ActionButton
              label="Delete Workflow"
              onPress={() => {
                deleteSelectedWorkflowRecording().catch(() => {});
              }}
              disabled={workflowBusy}
              tone="danger"
            />
          </View>
          {selectedWorkflowRecording.steps.length === 0 ? (
            <Text style={styles.emptyState}>
              No steps have been recorded for this workflow yet.
            </Text>
          ) : (
            <View style={styles.fixtureList}>
              {selectedWorkflowRecording.steps.map(step => {
                const replayResult =
                  selectedWorkflowReplay?.stepResults.find(
                    result => result.stepId === step.id,
                  ) ?? null;
                const stepDraft = getWorkflowStepDraft(step.id, step.expectation);

                function updateStepDraft(nextDraft: WorkflowStepDraft) {
                  setWorkflowStepDrafts(previousDrafts => ({
                    ...previousDrafts,
                    [step.id]: nextDraft,
                  }));
                }

                function setStepExpectedKind(expectedKind: WorkflowStepExpectationKind) {
                  const nextDraft: WorkflowStepDraft = {
                    ...stepDraft,
                    expectedKind,
                  };
                  updateStepDraft(nextDraft);
                  persistWorkflowStepDraft(
                    selectedWorkflowRecording.id,
                    step.id,
                    nextDraft,
                  );
                }

                return (
                  <View key={step.id} style={styles.fixtureRow}>
                    <Text style={styles.fixtureTitle}>{step.label}</Text>
                    <Text style={styles.fixtureMeta}>
                      {formatTimestamp(step.recordedAt)}
                    </Text>
                    <Text style={styles.fixtureMeta}>
                      Recorded: {formatNullable(step.recordedTaskDebug?.decision)}
                    </Text>
                    <Text style={styles.fixtureMeta}>
                      Replay: {formatNullable(replayResult?.decision)} ·{' '}
                      {formatWorkflowMatch(replayResult?.matchedExpectation)}
                    </Text>
                    <Text style={styles.fixtureMeta}>
                      Expected: {formatNullable(stepDraft.expectedKind)} · Exact:{' '}
                      {formatNullable(stepDraft.expectedDecision)}
                    </Text>
                    {replayResult?.mismatchReason != null ? (
                      <Text style={styles.fieldHelp}>{replayResult.mismatchReason}</Text>
                    ) : null}
                    <View style={styles.buttonRow}>
                      <ActionButton
                        label="Same Task"
                        onPress={() => {
                          setStepExpectedKind('same_task');
                        }}
                        disabled={workflowBusy}
                        tone={
                          stepDraft.expectedKind === 'same_task'
                            ? 'primary'
                            : 'secondary'
                        }
                      />
                      <ActionButton
                        label="Switch"
                        onPress={() => {
                          setStepExpectedKind('switch_task');
                        }}
                        disabled={workflowBusy}
                        tone={
                          stepDraft.expectedKind === 'switch_task'
                            ? 'primary'
                            : 'secondary'
                        }
                      />
                      <ActionButton
                        label="Resume"
                        onPress={() => {
                          setStepExpectedKind('resume_task');
                        }}
                        disabled={workflowBusy}
                        tone={
                          stepDraft.expectedKind === 'resume_task'
                            ? 'primary'
                            : 'secondary'
                        }
                      />
                      <ActionButton
                        label="Interruption"
                        onPress={() => {
                          setStepExpectedKind('temporary_interruption');
                        }}
                        disabled={workflowBusy}
                        tone={
                          stepDraft.expectedKind === 'temporary_interruption'
                            ? 'primary'
                            : 'secondary'
                        }
                      />
                      <ActionButton
                        label={workflowBusy ? 'Saving…' : 'Save Step Labels'}
                        onPress={() => {
                          persistWorkflowStepDraft(
                            selectedWorkflowRecording.id,
                            step.id,
                            stepDraft,
                          );
                        }}
                        disabled={workflowBusy}
                        tone="secondary"
                      />
                    </View>
                    <TextInput
                      autoCorrect={false}
                      onBlur={() => {
                        persistWorkflowStepDraft(
                          selectedWorkflowRecording.id,
                          step.id,
                          stepDraft,
                        );
                      }}
                      onChangeText={value => {
                        const nextDraft: WorkflowStepDraft = {
                          ...stepDraft,
                          expectedDecision: value,
                        };
                        updateStepDraft(nextDraft);
                        scheduleWorkflowStepAutosave(
                          selectedWorkflowRecording.id,
                          step.id,
                          nextDraft,
                        );
                      }}
                      placeholder="Optional exact engine decision"
                      style={styles.input}
                      value={stepDraft.expectedDecision ?? ''}
                    />
                    <TextInput
                      autoCorrect={false}
                      multiline
                      onBlur={() => {
                        persistWorkflowStepDraft(
                          selectedWorkflowRecording.id,
                          step.id,
                          stepDraft,
                        );
                      }}
                      onChangeText={value => {
                        const nextDraft: WorkflowStepDraft = {
                          ...stepDraft,
                          note: value,
                        };
                        updateStepDraft(nextDraft);
                        scheduleWorkflowStepAutosave(
                          selectedWorkflowRecording.id,
                          step.id,
                          nextDraft,
                        );
                      }}
                      placeholder="Why should this behave that way?"
                      style={[styles.input, styles.notesInput]}
                      value={stepDraft.note}
                    />
                  </View>
                );
              })}
            </View>
          )}
        </Section>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    padding: 24,
    gap: 16,
    backgroundColor: '#f6f1e8',
  },
  section: {
    backgroundColor: '#fffaf3',
    borderRadius: 18,
    padding: 18,
    gap: 12,
    borderWidth: 1,
    borderColor: '#dfd1be',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2d2115',
  },
  sectionSubtitle: {
    fontSize: 13,
    lineHeight: 19,
    color: '#6f5b48',
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#2d2115',
  },
  heroSubtitle: {
    fontSize: 14,
    color: '#6f5b48',
  },
  feedbackCard: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
  },
  feedbackNeutral: {
    backgroundColor: '#f1e8da',
    borderColor: '#d7c4a7',
  },
  feedbackSuccess: {
    backgroundColor: '#e8f5ec',
    borderColor: '#a7d0b2',
  },
  feedbackWarning: {
    backgroundColor: '#fff3d9',
    borderColor: '#f2c96d',
  },
  feedbackError: {
    backgroundColor: '#ffe3e3',
    borderColor: '#e89c9c',
  },
  feedbackTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#2d2115',
    marginBottom: 4,
  },
  feedbackText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#463528',
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  button: {
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 11,
    backgroundColor: '#9a3412',
  },
  buttonSecondary: {
    backgroundColor: '#efe1cc',
    borderWidth: 1,
    borderColor: '#c9b59b',
  },
  buttonDanger: {
    backgroundColor: '#fbe2e2',
    borderWidth: 1,
    borderColor: '#d48f8f',
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonLabel: {
    color: '#fffaf3',
    fontSize: 14,
    fontWeight: '700',
  },
  buttonLabelSecondary: {
    color: '#4a3726',
  },
  buttonLabelDanger: {
    color: '#7c1d1d',
  },
  labelValueRow: {
    gap: 2,
  },
  labelValueLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#7a614c',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  labelValueValue: {
    fontSize: 15,
    color: '#2d2115',
  },
  input: {
    borderWidth: 1,
    borderColor: '#d3c2aa',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    backgroundColor: '#fff',
    color: '#2d2115',
  },
  codeInput: {
    fontFamily: 'Menlo',
    fontSize: 13,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#5a4737',
  },
  fieldHelp: {
    fontSize: 12,
    lineHeight: 18,
    color: '#7a614c',
  },
  notesInput: {
    minHeight: 90,
    textAlignVertical: 'top',
  },
  previewImage: {
    width: '100%',
    height: 260,
    borderRadius: 14,
    resizeMode: 'contain',
    backgroundColor: '#efe6d8',
  },
  emptyState: {
    fontSize: 14,
    color: '#7a614c',
    fontStyle: 'italic',
  },
  jsonLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#7a614c',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  jsonBlock: {
    borderRadius: 14,
    padding: 14,
    backgroundColor: '#f2eadf',
    color: '#2d2115',
    fontFamily: 'Menlo',
    fontSize: 12,
    lineHeight: 18,
  },
  fixtureList: {
    gap: 10,
  },
  fixtureRow: {
    borderRadius: 14,
    padding: 12,
    backgroundColor: '#f3ebde',
    borderWidth: 1,
    borderColor: '#deceb7',
    gap: 2,
  },
  fixtureRowSelected: {
    borderColor: '#9a3412',
    backgroundColor: '#fff0df',
  },
  fixtureTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#2d2115',
  },
  fixtureMeta: {
    fontSize: 12,
    color: '#6f5b48',
  },
  taskObservationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  taskObservationImage: {
    width: 96,
    height: 72,
    borderRadius: 10,
    backgroundColor: '#efe6d8',
  },
  taskObservationBody: {
    flex: 1,
    gap: 4,
  },
  warningBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#fff3d9',
    borderWidth: 1,
    borderColor: '#f2c96d',
  },
  warningBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8a5a00',
  },
  scoreRow: {
    gap: 8,
  },
  scoreLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#2d2115',
  },
  scoreButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  scoreButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f0e5d5',
    borderWidth: 1,
    borderColor: '#d4c1a7',
  },
  scoreButtonActive: {
    backgroundColor: '#9a3412',
    borderColor: '#9a3412',
  },
  scoreButtonLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#4a3726',
  },
  scoreButtonLabelActive: {
    color: '#fffaf3',
  },
  pasteOutputInput: {
    minHeight: 130,
    textAlignVertical: 'top',
    fontSize: 12,
    lineHeight: 18,
  },
});

export default App;
