import React from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';
import {Text} from '../Text';

import type {WorklogCalendarBlock} from '../../worklog/types';
import {displayArtifact} from '../../planner/artifactDisplay';

export type TodayScreenProps = {
  todayIso: string;
  blocks: WorklogCalendarBlock[];
  selectedBlockId: string | null;
  onSelectBlock: (blockId: string) => void;
  hasSession: boolean;
  lastReplanAt: string | null;
  nextReplanAt: string | null;
  onStartSession: () => void;
  onStopSession: () => void;
  onReplanNow: () => void;
  startDisabled: boolean;
  replanDisabled: boolean;
  replanInFlight: boolean;
};

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDuration(block: WorklogCalendarBlock): string {
  const minutes = Math.max(
    0,
    Math.round((Date.parse(block.endTime) - Date.parse(block.startTime)) / 60000),
  );
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`;
}

function formatTodayHeading(dateIso: string): string {
  const date = new Date(`${dateIso}T12:00:00.000Z`);
  return date.toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function describeNextReplan(
  hasSession: boolean,
  replanInFlight: boolean,
  lastReplanAt: string | null,
  nextReplanAt: string | null,
): string {
  if (!hasSession) return 'Start a session to begin capturing work.';
  if (replanInFlight) return 'Writing up your latest work…';
  if (nextReplanAt != null) {
    const t = new Date(nextReplanAt).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
    return `Next plan ≈ ${t}`;
  }
  if (lastReplanAt != null) {
    const t = new Date(lastReplanAt).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
    return `Last plan at ${t}`;
  }
  return 'First plan runs shortly.';
}

export function TodayScreen(props: TodayScreenProps) {
  const focusedMinutes = props.blocks.reduce((sum, block) => {
    const ms = Math.max(
      0,
      Date.parse(block.endTime) - Date.parse(block.startTime),
    );
    return sum + Math.round(ms / 60000);
  }, 0);
  const totalHours = Math.floor(focusedMinutes / 60);
  const totalRem = focusedMinutes % 60;
  const totalLabel =
    focusedMinutes === 0
      ? 'No focused time tracked yet'
      : totalHours === 0
        ? `${totalRem} min focused`
        : totalRem === 0
          ? `${totalHours}h focused`
          : `${totalHours}h ${totalRem}m focused`;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.overline}>TODAY</Text>
          <Text style={styles.heading}>{formatTodayHeading(props.todayIso)}</Text>
          <Text style={styles.subheading}>
            {props.blocks.length}{' '}
            {props.blocks.length === 1 ? 'block' : 'blocks'} · {totalLabel}
          </Text>
        </View>
        <View style={styles.headerActions}>
          {props.hasSession ? (
            <>
              <Pressable
                onPress={props.onReplanNow}
                disabled={props.replanDisabled}
                style={({pressed}) => [
                  styles.secondaryButton,
                  props.replanDisabled ? styles.buttonDisabled : null,
                  pressed && !props.replanDisabled ? styles.buttonPressed : null,
                ]}>
                <Text style={styles.secondaryButtonLabel}>
                  {props.replanInFlight ? 'Planning…' : 'Replan now'}
                </Text>
              </Pressable>
              <Pressable
                onPress={props.onStopSession}
                style={({pressed}) => [
                  styles.primaryButton,
                  pressed ? styles.buttonPressed : null,
                ]}>
                <Text style={styles.primaryButtonLabel}>Stop</Text>
              </Pressable>
            </>
          ) : (
            <Pressable
              onPress={props.onStartSession}
              disabled={props.startDisabled}
              style={({pressed}) => [
                styles.primaryButton,
                props.startDisabled ? styles.buttonDisabled : null,
                pressed && !props.startDisabled ? styles.buttonPressed : null,
              ]}>
              <Text style={styles.primaryButtonLabel}>Start session</Text>
            </Pressable>
          )}
        </View>
      </View>

      <Text style={styles.statusLine}>
        {describeNextReplan(
          props.hasSession,
          props.replanInFlight,
          props.lastReplanAt,
          props.nextReplanAt,
        )}
      </Text>

      {props.blocks.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Nothing tracked yet today</Text>
          <Text style={styles.emptyBody}>
            {props.hasSession
              ? 'Keep working — Flow will write up what you did every 10 minutes.'
              : 'Start a session from above to begin. Everything happens on your device until the plan is written.'}
          </Text>
        </View>
      ) : (
        <View style={styles.timeline}>
          {props.blocks.map(block => {
            const isSelected = block.id === props.selectedBlockId;
            return (
              <Pressable
                key={block.id}
                onPress={() => props.onSelectBlock(block.id)}
                style={({pressed}) => [
                  styles.blockCard,
                  isSelected ? styles.blockCardSelected : null,
                  pressed ? styles.buttonPressed : null,
                ]}>
                <View style={styles.blockMetaColumn}>
                  <Text style={styles.blockTime}>{formatTime(block.startTime)}</Text>
                  <Text style={styles.blockDuration}>{formatDuration(block)}</Text>
                </View>
                <View style={styles.blockBody}>
                  <Text style={styles.blockTitle} numberOfLines={1}>
                    {block.title}
                  </Text>
                  <Text style={styles.blockNarrative} numberOfLines={4}>
                    {block.summary.narrative}
                  </Text>
                  {block.summary.provenance.keyArtifacts.length > 0 ? (
                    <View style={styles.chipRow}>
                      {block.summary.provenance.keyArtifacts
                        .slice(0, 4)
                        .map(artifact => (
                          <View key={artifact} style={styles.chip}>
                            <Text style={styles.chipLabel} numberOfLines={1}>
                              {displayArtifact(artifact)}
                            </Text>
                          </View>
                        ))}
                    </View>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </ScrollView>
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
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  headerText: {
    flex: 1,
    gap: 4,
  },
  overline: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8a8478',
    letterSpacing: 1.4,
  },
  heading: {
    fontSize: 26,
    fontWeight: '700',
    color: '#1a1a1a',
    letterSpacing: -0.3,
  },
  subheading: {
    fontSize: 13,
    color: '#6b6b6b',
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  primaryButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#1a1a1a',
  },
  primaryButtonLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#ffffff',
  },
  secondaryButton: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e0dccf',
  },
  secondaryButtonLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  statusLine: {
    fontSize: 12,
    color: '#8a8478',
    fontWeight: '500',
  },
  emptyState: {
    marginTop: 40,
    alignItems: 'center',
    gap: 6,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  emptyBody: {
    fontSize: 13,
    color: '#6b6b6b',
    textAlign: 'center',
    maxWidth: 360,
    lineHeight: 19,
  },
  timeline: {
    gap: 10,
  },
  blockCard: {
    flexDirection: 'row',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ece7dd',
    backgroundColor: '#ffffff',
    padding: 16,
    gap: 14,
  },
  blockCardSelected: {
    borderColor: '#1a1a1a',
  },
  blockMetaColumn: {
    width: 72,
    gap: 2,
  },
  blockTime: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  blockDuration: {
    fontSize: 12,
    color: '#8a8478',
  },
  blockBody: {
    flex: 1,
    gap: 6,
  },
  blockTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  blockNarrative: {
    fontSize: 13,
    lineHeight: 19,
    color: '#3a3a3a',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  chip: {
    backgroundColor: '#f1ece1',
    borderRadius: 6,
    paddingHorizontal: 9,
    paddingVertical: 3,
    maxWidth: 220,
  },
  chipLabel: {
    fontSize: 11,
    color: '#5a5a5a',
    fontWeight: '500',
  },
});
