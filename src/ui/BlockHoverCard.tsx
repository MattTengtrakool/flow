import React from 'react';
import {StyleSheet, View} from 'react-native';
import {Text} from './Text';

import type {WorklogCalendarBlock} from '../worklog/types';
import {displayArtifact} from '../planner/artifactDisplay';
import {labelForCategory, paletteForBlock} from './blockColors';

type BlockHoverCardProps = {
  block: WorklogCalendarBlock;
};

export const BLOCK_HOVER_CARD_WIDTH = 280;

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDuration(block: WorklogCalendarBlock): string {
  const minutes = Math.max(
    0,
    Math.round((Date.parse(block.endTime) - Date.parse(block.startTime)) / 60000),
  );
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

export function BlockHoverCard({block}: BlockHoverCardProps) {
  const palette = paletteForBlock(block);
  const artifacts = block.summary.provenance.keyArtifacts.slice(0, 3);
  const activities = block.keyActivities?.slice(0, 2) ?? [];

  return (
    <View pointerEvents="none" style={styles.card}>
      <View style={[styles.accent, {backgroundColor: palette.accent}]} />
      <View style={styles.body}>
        <View style={styles.headerRow}>
          <View style={[styles.dot, {backgroundColor: palette.dot}]} />
          <Text style={styles.categoryLabel} numberOfLines={1}>
            {labelForCategory(block.category)}
          </Text>
        </View>
        <Text style={styles.timeRange} numberOfLines={1}>
          {formatTime(block.startTime)} – {formatTime(block.endTime)} ·{' '}
          {formatDuration(block)}
        </Text>
        <Text style={styles.title} numberOfLines={2}>
          {block.title}
        </Text>
        {block.summary.narrative ? (
          <Text style={styles.narrative} numberOfLines={3}>
            {truncate(block.summary.narrative, 180)}
          </Text>
        ) : null}
        {activities.length > 0 ? (
          <View style={styles.activityList}>
            {activities.map((activity, index) => (
              <View key={`${activity}-${index}`} style={styles.activityRow}>
                <Text style={styles.activityBullet}>•</Text>
                <Text style={styles.activityText} numberOfLines={1}>
                  {truncate(activity, 70)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        {artifacts.length > 0 ? (
          <View style={styles.chipRow}>
            {artifacts.map(artifact => (
              <View
                key={artifact}
                style={[
                  styles.chip,
                  {backgroundColor: palette.softBg, borderColor: palette.border},
                ]}>
                <Text
                  style={[styles.chipLabel, {color: palette.text}]}
                  numberOfLines={1}>
                  {truncate(displayArtifact(artifact), 28)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: BLOCK_HOVER_CARD_WIDTH,
    flexDirection: 'row',
    borderRadius: 10,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#ece7dd',
    shadowColor: '#1a1a1a',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: {width: 0, height: 6},
    overflow: 'hidden',
  },
  accent: {
    width: 3,
  },
  body: {
    flex: 1,
    padding: 10,
    gap: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  categoryLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#1a1a1a',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  timeRange: {
    fontSize: 11,
    color: '#8a8478',
    fontWeight: '500',
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1a1a1a',
    lineHeight: 17,
  },
  narrative: {
    fontSize: 12,
    color: '#4a4a4a',
    lineHeight: 16,
  },
  activityList: {
    gap: 2,
    marginTop: 2,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  activityBullet: {
    fontSize: 11,
    color: '#8a8478',
    lineHeight: 15,
  },
  activityText: {
    flex: 1,
    fontSize: 11,
    color: '#1a1a1a',
    lineHeight: 15,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 2,
  },
  chip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipLabel: {
    fontSize: 10,
    fontWeight: '600',
  },
});
