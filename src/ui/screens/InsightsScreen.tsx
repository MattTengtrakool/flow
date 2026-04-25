import React, {useMemo, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';
import {Text} from '../Text';

import type {WorklogCalendarBlock} from '../../worklog/types';

export type InsightsScreenProps = {
  allBlocks: WorklogCalendarBlock[];
};

type RangeKey = 'week' | 'month' | 'all';

const RANGE_LABELS: Record<RangeKey, string> = {
  week: 'This week',
  month: 'This month',
  all: 'All time',
};

function getRangeStart(range: RangeKey): Date {
  const now = new Date();
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  switch (range) {
    case 'week': {
      const dayOfWeek = (d.getDay() + 6) % 7;
      d.setDate(d.getDate() - dayOfWeek);
      return d;
    }
    case 'month': {
      d.setDate(1);
      return d;
    }
    case 'all':
      return new Date(0);
  }
}

function formatHoursMinutes(minutes: number): string {
  if (minutes === 0) return '0m';
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours === 0) return `${rem}m`;
  if (rem === 0) return `${hours}h`;
  return `${hours}h ${rem}m`;
}

function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatWeekdayShort(dateIso: string): string {
  const date = new Date(`${dateIso}T12:00:00`);
  return date
    .toLocaleDateString([], {weekday: 'short'})
    .slice(0, 2)
    .toUpperCase();
}

function formatDayNumber(dateIso: string): string {
  const date = new Date(`${dateIso}T12:00:00`);
  return String(date.getDate());
}

function capitalize(value: string): string {
  if (value.length === 0) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function InsightsScreen(props: InsightsScreenProps) {
  const [range, setRange] = useState<RangeKey>('week');

  const data = useMemo(() => computeInsights(props.allBlocks, range), [
    props.allBlocks,
    range,
  ]);

  const maxMinutes = Math.max(
    ...data.perDay.map(entry => entry.minutes),
    1,
  );

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Text style={styles.overline}>INSIGHTS</Text>
        <Text style={styles.heading}>Your focus, by the numbers</Text>
        <View style={styles.rangeTabs}>
          {(['week', 'month', 'all'] as RangeKey[]).map(key => (
            <Pressable
              key={key}
              onPress={() => setRange(key)}
              style={({pressed}) => [
                styles.rangeTab,
                range === key ? styles.rangeTabActive : null,
                pressed ? styles.buttonPressed : null,
              ]}>
              <Text
                style={[
                  styles.rangeTabLabel,
                  range === key ? styles.rangeTabLabelActive : null,
                ]}>
                {RANGE_LABELS[key]}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.bigStatsRow}>
        <StatCard
          label="Focused time"
          value={formatHoursMinutes(data.totalMinutes)}
        />
        <StatCard label="Tracked blocks" value={String(data.blockCount)} />
        <StatCard
          label="Active days"
          value={String(data.activeDays)}
          suffix={
            data.activeDays > 0 && data.totalMinutes > 0
              ? `avg ${formatHoursMinutes(
                  Math.round(data.totalMinutes / data.activeDays),
                )}/day`
              : undefined
          }
        />
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Focused time by day</Text>
          <Text style={styles.sectionHint}>{RANGE_LABELS[range]}</Text>
        </View>
        {data.perDay.length === 0 ? (
          <Text style={styles.emptyText}>No tracked time in this range yet.</Text>
        ) : (
          <View style={styles.chart}>
            {data.perDay.map(entry => (
              <View key={entry.dateIso} style={styles.chartColumn}>
                <View style={styles.chartBarTrack}>
                  <View
                    style={[
                      styles.chartBarFill,
                      {
                        height: `${Math.max(
                          2,
                          Math.round((entry.minutes / maxMinutes) * 100),
                        )}%`,
                        opacity: entry.minutes === 0 ? 0.08 : 1,
                      },
                    ]}
                  />
                </View>
                <Text style={styles.chartDayLabel}>
                  {formatWeekdayShort(entry.dateIso)}
                </Text>
                <Text style={styles.chartDayNumber}>
                  {formatDayNumber(entry.dateIso)}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>

      <View style={styles.twoColumn}>
        <View style={styles.halfSection}>
          <Text style={styles.sectionTitle}>Top topics</Text>
          {data.topArtifacts.length === 0 ? (
            <Text style={styles.emptyText}>Nothing to show yet.</Text>
          ) : (
            data.topArtifacts.map(entry => (
              <View key={entry.label} style={styles.leaderRow}>
                <Text style={styles.leaderLabel} numberOfLines={1}>
                  {entry.label}
                </Text>
                <Text style={styles.leaderValue}>
                  {formatHoursMinutes(entry.minutes)}
                </Text>
              </View>
            ))
          )}
        </View>
        <View style={styles.halfSection}>
          <Text style={styles.sectionTitle}>By category</Text>
          {data.categoryBreakdown.length === 0 ? (
            <Text style={styles.emptyText}>Nothing to show yet.</Text>
          ) : (
            data.categoryBreakdown.map(entry => (
              <View key={entry.category} style={styles.categoryRow}>
                <View style={styles.categoryLabelRow}>
                  <Text style={styles.categoryLabel}>
                    {capitalize(entry.category)}
                  </Text>
                  <Text style={styles.categoryValue}>
                    {formatHoursMinutes(entry.minutes)}
                  </Text>
                </View>
                <View style={styles.categoryTrack}>
                  <View
                    style={[
                      styles.categoryFill,
                      {
                        width: `${Math.max(
                          2,
                          Math.round((entry.minutes / data.totalMinutes) * 100),
                        )}%`,
                      },
                    ]}
                  />
                </View>
              </View>
            ))
          )}
        </View>
      </View>
    </ScrollView>
  );
}

type StatCardProps = {
  label: string;
  value: string;
  suffix?: string;
};

function StatCard({label, value, suffix}: StatCardProps) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
      {suffix != null ? <Text style={styles.statSuffix}>{suffix}</Text> : null}
    </View>
  );
}

type InsightsData = {
  totalMinutes: number;
  blockCount: number;
  activeDays: number;
  perDay: {dateIso: string; minutes: number}[];
  topArtifacts: {label: string; minutes: number}[];
  categoryBreakdown: {category: string; minutes: number}[];
};

function computeInsights(
  blocks: WorklogCalendarBlock[],
  range: RangeKey,
): InsightsData {
  const now = new Date();
  const start = getRangeStart(range);
  const inRange = blocks.filter(block => {
    const t = Date.parse(block.startTime);
    return t >= start.getTime() && t <= now.getTime() + 24 * 60 * 60 * 1000;
  });

  let totalMinutes = 0;
  const minutesByDay = new Map<string, number>();
  const minutesByArtifact = new Map<string, number>();
  const minutesByCategory = new Map<string, number>();

  for (const block of inRange) {
    const minutes = Math.max(
      0,
      Math.round(
        (Date.parse(block.endTime) - Date.parse(block.startTime)) / 60000,
      ),
    );
    totalMinutes += minutes;
    const blockDayKey = dayKey(new Date(block.startTime));
    minutesByDay.set(
      blockDayKey,
      (minutesByDay.get(blockDayKey) ?? 0) + minutes,
    );
    const category = (block.category ?? 'other').toLowerCase();
    minutesByCategory.set(
      category,
      (minutesByCategory.get(category) ?? 0) + minutes,
    );
    for (const artifact of block.summary.provenance.keyArtifacts) {
      minutesByArtifact.set(
        artifact,
        (minutesByArtifact.get(artifact) ?? 0) + minutes,
      );
    }
  }

  const perDay: {dateIso: string; minutes: number}[] = [];
  const cursor = new Date(start);
  while (cursor.getTime() <= now.getTime()) {
    const key = dayKey(cursor);
    perDay.push({dateIso: key, minutes: minutesByDay.get(key) ?? 0});
    cursor.setDate(cursor.getDate() + 1);
    if (perDay.length > 60) break;
  }

  const topArtifacts = Array.from(minutesByArtifact.entries())
    .map(([label, minutes]) => ({label, minutes}))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 6);

  const categoryBreakdown = Array.from(minutesByCategory.entries())
    .map(([category, minutes]) => ({category, minutes}))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 6);

  const activeDays = Array.from(minutesByDay.values()).filter(v => v > 0).length;

  return {
    totalMinutes,
    blockCount: inRange.length,
    activeDays,
    perDay,
    topArtifacts,
    categoryBreakdown,
  };
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 32,
    paddingVertical: 24,
    gap: 22,
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
  rangeTabs: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
  },
  rangeTab: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0dccf',
    backgroundColor: '#ffffff',
  },
  rangeTabActive: {
    backgroundColor: '#1a1a1a',
    borderColor: '#1a1a1a',
  },
  rangeTabLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  rangeTabLabelActive: {
    color: '#ffffff',
  },
  buttonPressed: {
    opacity: 0.85,
  },
  bigStatsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ece7dd',
    padding: 16,
    gap: 4,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8a8478',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  statValue: {
    fontSize: 26,
    fontWeight: '700',
    color: '#1a1a1a',
    letterSpacing: -0.5,
  },
  statSuffix: {
    fontSize: 12,
    color: '#6b6b6b',
  },
  section: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ece7dd',
    padding: 18,
    gap: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  sectionHint: {
    fontSize: 12,
    color: '#8a8478',
  },
  emptyText: {
    fontSize: 12,
    color: '#8a8478',
    fontStyle: 'italic',
  },
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 160,
    gap: 6,
    paddingTop: 8,
  },
  chartColumn: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  chartBarTrack: {
    width: '60%',
    height: 120,
    justifyContent: 'flex-end',
    backgroundColor: '#f6f2e8',
    borderRadius: 6,
    overflow: 'hidden',
  },
  chartBarFill: {
    width: '100%',
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  chartDayLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#8a8478',
    letterSpacing: 0.6,
  },
  chartDayNumber: {
    fontSize: 11,
    color: '#1a1a1a',
    fontWeight: '500',
  },
  twoColumn: {
    flexDirection: 'row',
    gap: 12,
  },
  halfSection: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ece7dd',
    padding: 18,
    gap: 10,
  },
  leaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  leaderLabel: {
    flex: 1,
    fontSize: 13,
    color: '#1a1a1a',
  },
  leaderValue: {
    fontSize: 12,
    color: '#6b6b6b',
    fontWeight: '600',
  },
  categoryRow: {
    gap: 5,
  },
  categoryLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  categoryLabel: {
    fontSize: 13,
    color: '#1a1a1a',
    fontWeight: '500',
  },
  categoryValue: {
    fontSize: 12,
    color: '#6b6b6b',
    fontWeight: '600',
  },
  categoryTrack: {
    height: 6,
    backgroundColor: '#f6f2e8',
    borderRadius: 3,
    overflow: 'hidden',
  },
  categoryFill: {
    height: '100%',
    backgroundColor: '#6f3bf5',
    borderRadius: 3,
  },
});
