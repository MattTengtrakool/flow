import React from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';
import {Text} from '../Text';

import type {CostSummary} from '../../planner/costSummary';
import {formatTokens, formatUsd} from '../../planner/pricing';
import type {PermissionsStatus} from '../../types/contextCapture';

export type SettingsScreenProps = {
  permissions: PermissionsStatus;
  onPromptAccessibility: () => void;
  onPromptScreenRecording: () => void;
  replanIntervalMs: number;
  replanWindowMs: number;
  replanMaxObservations: number;
  lastReplanAt: string | null;
  lastReplanBlockCount: number;
  lastPlanModel: string | null;
  lastFailureMessage: string | null;
  onReplanNow: () => void;
  replanInFlight: boolean;
  replanDisabled: boolean;
  hasSession: boolean;
  storagePath: string | null;
  costSummary: CostSummary;
  performance: {
    eventCount: number;
    observationCount: number;
    planCount: number;
    contextSnapshotCount: number;
    capturePreviewCount: number;
    lastPersistDurationMs: number | null;
    lastPersistBytes: number | null;
  };
};

function formatInterval(ms: number): string {
  if (ms < 60 * 1000) return `${Math.round(ms / 1000)}s`;
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${hours}h`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function describeModel(model: string | null): string {
  if (model == null) return '—';
  if (model.startsWith('gemini')) return `${model} (Google)`;
  if (model.startsWith('claude')) return `${model} (Anthropic)`;
  return model;
}

function formatTimestamp(value: string | null): string {
  if (value == null) return '—';
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

type RowProps = {
  label: string;
  value: string;
  hint?: string;
};

function Row({label, value, hint}: RowProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowValueColumn}>
        <Text style={styles.rowValue}>{value}</Text>
        {hint != null ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
    </View>
  );
}

export function SettingsScreen(props: SettingsScreenProps) {
  const accessibilityOk = props.permissions.accessibilityTrusted;
  const screenRecordingOk = props.permissions.captureAccessGranted;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Text style={styles.overline}>SETTINGS</Text>
        <Text style={styles.heading}>Flow configuration</Text>
        <Text style={styles.subheading}>
          Flow runs locally. Permissions and plan cadence are controlled here.
        </Text>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Permissions</Text>
          <Text style={styles.cardSubtitle}>
            Required to capture screen activity and identify the active window.
          </Text>
        </View>
        <View style={styles.permissionRow}>
          <View style={styles.permissionInfo}>
            <View style={styles.permissionHeaderRow}>
              <View
                style={[
                  styles.permissionBadge,
                  accessibilityOk
                    ? styles.permissionBadgeOk
                    : styles.permissionBadgeWarning,
                ]}>
                <Text
                  style={[
                    styles.permissionBadgeLabel,
                    accessibilityOk
                      ? styles.permissionBadgeLabelOk
                      : styles.permissionBadgeLabelWarning,
                  ]}>
                  {accessibilityOk ? 'Granted' : 'Not granted'}
                </Text>
              </View>
              <Text style={styles.permissionLabel}>Accessibility</Text>
            </View>
            <Text style={styles.permissionHint}>
              Lets Flow read the active window title so it can attribute work to
              the right task.
            </Text>
          </View>
          {!accessibilityOk ? (
            <Pressable
              onPress={props.onPromptAccessibility}
              style={({pressed}) => [
                styles.smallButton,
                pressed ? styles.buttonPressed : null,
              ]}>
              <Text style={styles.smallButtonLabel}>Grant</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.permissionRow}>
          <View style={styles.permissionInfo}>
            <View style={styles.permissionHeaderRow}>
              <View
                style={[
                  styles.permissionBadge,
                  screenRecordingOk
                    ? styles.permissionBadgeOk
                    : styles.permissionBadgeWarning,
                ]}>
                <Text
                  style={[
                    styles.permissionBadgeLabel,
                    screenRecordingOk
                      ? styles.permissionBadgeLabelOk
                      : styles.permissionBadgeLabelWarning,
                  ]}>
                  {screenRecordingOk ? 'Granted' : 'Not granted'}
                </Text>
              </View>
              <Text style={styles.permissionLabel}>Screen recording</Text>
            </View>
            <Text style={styles.permissionHint}>
              Required to take screenshots. If you just granted it in System
              Settings, quit and relaunch Flow before starting a session.
            </Text>
          </View>
          {!screenRecordingOk ? (
            <Pressable
              onPress={props.onPromptScreenRecording}
              style={({pressed}) => [
                styles.smallButton,
                pressed ? styles.buttonPressed : null,
              ]}>
              <Text style={styles.smallButtonLabel}>Grant</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Planner</Text>
          <Text style={styles.cardSubtitle}>
            Flow writes a fresh plan every {formatInterval(props.replanIntervalMs)},
            rewriting the most recent {formatInterval(props.replanWindowMs)} of
            work each time.
          </Text>
        </View>
        <Row
          label="Planner"
          value="Planner"
          hint="Observations are captured continuously and summarized in batches."
        />
        <Row
          label="Plan cadence"
          value={formatInterval(props.replanIntervalMs)}
        />
        <Row label="Lookback window" value={formatInterval(props.replanWindowMs)} />
        <Row
          label="Max observations per plan"
          value={String(props.replanMaxObservations)}
          hint="Soft cap on how many condensed observation clusters we send to the model."
        />
        <Row
          label="Last plan"
          value={formatTimestamp(props.lastReplanAt)}
          hint={
            props.lastReplanBlockCount > 0
              ? `${props.lastReplanBlockCount} ${
                  props.lastReplanBlockCount === 1 ? 'block' : 'blocks'
                }`
              : undefined
          }
        />
        <Row
          label="Last plan model"
          value={describeModel(props.lastPlanModel)}
          hint={
            props.lastPlanModel?.startsWith('claude')
              ? 'Flow fell back to Claude because Gemini was unavailable.'
              : undefined
          }
        />
        {props.lastFailureMessage != null ? (
          <View style={styles.failureBanner}>
            <Text style={styles.failureTitle}>Last plan failed</Text>
            <Text style={styles.failureBody}>{props.lastFailureMessage}</Text>
          </View>
        ) : null}
        <View style={styles.actionRow}>
          <Pressable
            onPress={props.onReplanNow}
            disabled={props.replanDisabled}
            style={({pressed}) => [
              styles.primaryButton,
              props.replanDisabled ? styles.buttonDisabled : null,
              pressed && !props.replanDisabled ? styles.buttonPressed : null,
            ]}>
            <Text style={styles.primaryButtonLabel}>
              {props.replanInFlight ? 'Planning…' : 'Replan now'}
            </Text>
          </Pressable>
          {!props.hasSession ? (
            <Text style={styles.inlineHint}>
              Start a session first — replans run against captured observations.
            </Text>
          ) : null}
        </View>
      </View>

      <CostUsageCard summary={props.costSummary} />

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Performance</Text>
          <Text style={styles.cardSubtitle}>
            Click lag happens when the event log gets huge or persistence takes
            too long. These numbers should stay steady.
          </Text>
        </View>
        <Row
          label="Events in log"
          value={props.performance.eventCount.toLocaleString()}
        />
        <Row
          label="Observations"
          value={props.performance.observationCount.toLocaleString()}
        />
        <Row
          label="Plans written"
          value={props.performance.planCount.toLocaleString()}
        />
        <Row
          label="Context snapshots"
          value={props.performance.contextSnapshotCount.toLocaleString()}
        />
        <Row
          label="Screenshots in memory"
          value={props.performance.capturePreviewCount.toLocaleString()}
          hint="In-memory thumbnails for this session only. Never persisted."
        />
        <Row
          label="Last persist"
          value={
            props.performance.lastPersistDurationMs == null
              ? '—'
              : `${props.performance.lastPersistDurationMs} ms`
          }
          hint={
            props.performance.lastPersistBytes == null
              ? undefined
              : `≈ ${formatBytes(props.performance.lastPersistBytes)} on disk`
          }
        />
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Data & storage</Text>
          <Text style={styles.cardSubtitle}>
            Everything Flow captures is stored locally. Deleting the file below
            wipes all plans and observations.
          </Text>
        </View>
        <Row label="Event log path" value={props.storagePath ?? 'Not yet saved'} />
      </View>

      <View style={styles.footerInfo}>
        <Text style={styles.footerInfoText}>
          Built on react-native-macos · planner revisions
        </Text>
      </View>
    </ScrollView>
  );
}

type CostUsageCardProps = {
  summary: CostSummary;
};

function CostUsageCard({summary}: CostUsageCardProps) {
  const hasAny = summary.pricedPlanCount > 0 || summary.unpricedPlanCount > 0;
  const hasPriced = summary.pricedPlanCount > 0;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>Cost & usage</Text>
        <Text style={styles.cardSubtitle}>
          Every rolling plan records how many tokens were sent and received.
          Costs below are estimates based on public list pricing.
        </Text>
      </View>

      {!hasAny ? (
        <Text style={styles.emptyUsageText}>
          No plans yet. Start a session — your first replan will appear here.
        </Text>
      ) : (
        <>
          <View style={styles.costStatsRow}>
            <CostStat
              label="All time"
              costUsd={summary.allTime.costUsd}
              tokens={summary.allTime.inputTokens + summary.allTime.outputTokens}
              planCount={summary.allTime.planCount}
            />
            <CostStat
              label="Last 30 days"
              costUsd={summary.last30Days.costUsd}
              tokens={
                summary.last30Days.inputTokens + summary.last30Days.outputTokens
              }
              planCount={summary.last30Days.planCount}
            />
            <CostStat
              label="Last 7 days"
              costUsd={summary.last7Days.costUsd}
              tokens={
                summary.last7Days.inputTokens + summary.last7Days.outputTokens
              }
              planCount={summary.last7Days.planCount}
            />
          </View>

          {summary.byProvider.length > 0 ? (
            <View style={styles.providerList}>
              <Text style={styles.sectionLabel}>By provider</Text>
              {summary.byProvider.map(entry => (
                <View key={entry.provider} style={styles.providerRow}>
                  <View style={styles.providerLabelColumn}>
                    <Text style={styles.providerName}>{entry.friendlyName}</Text>
                    <Text style={styles.providerMeta}>
                      {entry.planCount}{' '}
                      {entry.planCount === 1 ? 'plan' : 'plans'} ·{' '}
                      {formatTokens(entry.inputTokens)} in ·{' '}
                      {formatTokens(entry.outputTokens)} out
                    </Text>
                  </View>
                  <Text style={styles.providerCost}>
                    {formatUsd(entry.costUsd)}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          {summary.lastPlan != null ? (
            <View style={styles.lastPlanBlock}>
              <Text style={styles.sectionLabel}>Last plan</Text>
              <View style={styles.lastPlanRow}>
                <Text style={styles.lastPlanModel} numberOfLines={1}>
                  {summary.lastPlan.model}
                </Text>
                <Text style={styles.lastPlanCost}>
                  {formatUsd(summary.lastPlan.costUsd)}
                </Text>
              </View>
              <Text style={styles.lastPlanTokens}>
                {formatTokens(summary.lastPlan.inputTokens)} input ·{' '}
                {formatTokens(summary.lastPlan.outputTokens)} output
              </Text>
            </View>
          ) : null}

          {!hasPriced && summary.unpricedPlanCount > 0 ? (
            <Text style={styles.costCaveat}>
              Your recent plans used a model Flow doesn't have pricing for yet,
              so costs show as $0. Token counts are still accurate.
            </Text>
          ) : summary.unpricedPlanCount > 0 ? (
            <Text style={styles.costCaveat}>
              {summary.unpricedPlanCount}{' '}
              {summary.unpricedPlanCount === 1 ? 'plan' : 'plans'} used models
              without known pricing and are excluded from the dollar totals.
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}

type CostStatProps = {
  label: string;
  costUsd: number;
  tokens: number;
  planCount: number;
};

function CostStat({label, costUsd, tokens, planCount}: CostStatProps) {
  return (
    <View style={styles.costStatCard}>
      <Text style={styles.costStatLabel}>{label}</Text>
      <Text style={styles.costStatValue}>{formatUsd(costUsd)}</Text>
      <Text style={styles.costStatFooter}>
        {formatTokens(tokens)} tokens · {planCount}{' '}
        {planCount === 1 ? 'plan' : 'plans'}
      </Text>
    </View>
  );
}


const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 32,
    paddingVertical: 24,
    gap: 18,
    maxWidth: 780,
  },
  header: {
    gap: 6,
  },
  overline: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8a8478',
    letterSpacing: 1.4,
  },
  heading: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1a1a1a',
    letterSpacing: -0.3,
  },
  subheading: {
    fontSize: 13,
    color: '#6b6b6b',
    maxWidth: 520,
    lineHeight: 19,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ece7dd',
    padding: 18,
    gap: 14,
  },
  cardHeader: {
    gap: 4,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  cardSubtitle: {
    fontSize: 12,
    color: '#6b6b6b',
    lineHeight: 18,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
  },
  rowLabel: {
    flex: 1,
    fontSize: 13,
    color: '#1a1a1a',
    fontWeight: '500',
  },
  rowValueColumn: {
    flex: 1.3,
    alignItems: 'flex-end',
    gap: 2,
  },
  rowValue: {
    fontSize: 13,
    color: '#1a1a1a',
    textAlign: 'right',
  },
  rowHint: {
    fontSize: 11,
    color: '#8a8478',
    textAlign: 'right',
  },
  permissionRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingTop: 6,
  },
  permissionInfo: {
    flex: 1,
    gap: 4,
  },
  permissionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  permissionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  permissionHint: {
    fontSize: 11,
    color: '#8a8478',
    lineHeight: 16,
    maxWidth: 440,
  },
  permissionBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  permissionBadgeOk: {
    backgroundColor: '#eaf5ec',
    borderColor: '#bad7bf',
  },
  permissionBadgeWarning: {
    backgroundColor: '#fff3dd',
    borderColor: '#e8d18a',
  },
  permissionBadgeLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  permissionBadgeLabelOk: {
    color: '#2f6a3e',
  },
  permissionBadgeLabelWarning: {
    color: '#7a5300',
  },
  smallButton: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#1a1a1a',
  },
  smallButtonLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#ffffff',
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  primaryButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#1a1a1a',
    alignSelf: 'flex-start',
  },
  primaryButtonLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#ffffff',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  inlineHint: {
    fontSize: 12,
    color: '#8a8478',
    flex: 1,
  },
  failureBanner: {
    backgroundColor: '#fff0f0',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#f0c6c6',
    padding: 12,
    gap: 2,
  },
  failureTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6b1a1a',
  },
  failureBody: {
    fontSize: 12,
    color: '#6b1a1a',
    lineHeight: 17,
  },
  footerInfo: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  footerInfoText: {
    fontSize: 11,
    color: '#a59e8c',
  },
  emptyUsageText: {
    fontSize: 12,
    color: '#8a8478',
    fontStyle: 'italic',
  },
  costStatsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  costStatCard: {
    flex: 1,
    backgroundColor: '#faf8f3',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ece7dd',
    padding: 14,
    gap: 4,
  },
  costStatLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8a8478',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  costStatValue: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1a1a1a',
    letterSpacing: -0.3,
  },
  costStatFooter: {
    fontSize: 11,
    color: '#6b6b6b',
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6b6b6b',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  providerList: {
    gap: 8,
  },
  providerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#ece7dd',
  },
  providerLabelColumn: {
    flex: 1,
    gap: 2,
  },
  providerName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  providerMeta: {
    fontSize: 11,
    color: '#8a8478',
  },
  providerCost: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  lastPlanBlock: {
    backgroundColor: '#faf8f3',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ece7dd',
    padding: 12,
    gap: 2,
  },
  lastPlanRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 8,
  },
  lastPlanModel: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  lastPlanCost: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  lastPlanTokens: {
    fontSize: 11,
    color: '#6b6b6b',
  },
  costCaveat: {
    fontSize: 11,
    color: '#8a6a22',
    fontStyle: 'italic',
  },
});
