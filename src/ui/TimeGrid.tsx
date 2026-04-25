import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';
import {Text} from './Text';

import type {WorklogCalendarBlock} from '../worklog/types';
import {paletteForBlock} from './blockColors';
import type {BlockHoverHandlers} from './CalendarScreen';

export type TimeGridColumn = {
  dateIso: string;
  isToday: boolean;
  isSelected: boolean;
  weekdayLabel: string;
  dayNumberLabel: string;
  blocks: WorklogCalendarBlock[];
};

type TimeGridProps = {
  columns: TimeGridColumn[];
  selectedBlockId: string | null;
  onSelectBlock: (blockId: string) => void;
  onSelectDay?: (dateIso: string) => void;
  hourHeight?: number;
  startHour?: number; // inclusive, 0-23
  endHour?: number; // exclusive, 1-24
  density?: 'comfortable' | 'compact';
  hoverHandlers?: BlockHoverHandlers;
};

const DEFAULT_HOUR_HEIGHT = 48;
const DEFAULT_START_HOUR = 0;
const DEFAULT_END_HOUR = 24;
const GUTTER_WIDTH = 56;

function localMidnight(dateIso: string): Date {
  const [y, m, d] = dateIso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
}

function minutesSinceMidnight(date: Date, dayStart: Date): number {
  return (date.getTime() - dayStart.getTime()) / 60000;
}

function formatHourLabel(hour: number): string {
  if (hour === 0) return '12 AM';
  if (hour === 12) return 'Noon';
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

type LaneAssignment = {
  lane: number;
  laneCount: number;
};

function assignLanes(blocks: WorklogCalendarBlock[]): LaneAssignment[] {
  if (blocks.length === 0) return [];
  const sorted = blocks
    .map((block, index) => ({
      index,
      start: Date.parse(block.startTime),
      end: Date.parse(block.endTime),
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const laneEnds: number[] = [];
  const laneForSortedIndex: number[] = new Array(sorted.length).fill(0);
  const clusters: number[][] = [];
  let activeCluster: number[] = [];
  let activeClusterEnd = -Infinity;

  for (let i = 0; i < sorted.length; i += 1) {
    const item = sorted[i];
    if (item.start >= activeClusterEnd && activeCluster.length > 0) {
      clusters.push(activeCluster);
      activeCluster = [];
      activeClusterEnd = -Infinity;
      for (let l = 0; l < laneEnds.length; l += 1) {
        laneEnds[l] = -Infinity;
      }
    }
    let placedLane = -1;
    for (let l = 0; l < laneEnds.length; l += 1) {
      if (laneEnds[l] <= item.start) {
        placedLane = l;
        break;
      }
    }
    if (placedLane === -1) {
      placedLane = laneEnds.length;
      laneEnds.push(item.end);
    } else {
      laneEnds[placedLane] = item.end;
    }
    laneForSortedIndex[i] = placedLane;
    activeCluster.push(i);
    activeClusterEnd = Math.max(activeClusterEnd, item.end);
  }
  if (activeCluster.length > 0) clusters.push(activeCluster);

  const laneCountForSortedIndex: number[] = new Array(sorted.length).fill(1);
  for (const cluster of clusters) {
    let maxLane = 0;
    for (const sortedIndex of cluster) {
      maxLane = Math.max(maxLane, laneForSortedIndex[sortedIndex]);
    }
    const laneCount = maxLane + 1;
    for (const sortedIndex of cluster) {
      laneCountForSortedIndex[sortedIndex] = laneCount;
    }
  }

  const result: LaneAssignment[] = new Array(blocks.length);
  for (let i = 0; i < sorted.length; i += 1) {
    result[sorted[i].index] = {
      lane: laneForSortedIndex[i],
      laneCount: laneCountForSortedIndex[i],
    };
  }
  return result;
}

function useNowMinute(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const msUntilNext = 60_000 - (Date.now() % 60_000);
    const timeout = setTimeout(() => {
      tick();
    }, msUntilNext + 50);
    const interval = setInterval(tick, 60_000);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, []);
  return now;
}

export function TimeGrid(props: TimeGridProps) {
  const {
    columns,
    selectedBlockId,
    onSelectBlock,
    onSelectDay,
    hourHeight = DEFAULT_HOUR_HEIGHT,
    startHour = DEFAULT_START_HOUR,
    endHour = DEFAULT_END_HOUR,
    density = 'comfortable',
    hoverHandlers,
  } = props;

  const now = useNowMinute();

  const totalHours = Math.max(1, endHour - startHour);
  const contentHeight = totalHours * hourHeight;
  const startOffsetMinutes = startHour * 60;

  const todayIso = useMemo(() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }, [now]);

  const nowMinutesLocal =
    now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;

  const hours = useMemo(() => {
    const arr: number[] = [];
    for (let h = startHour; h < endHour; h += 1) arr.push(h);
    return arr;
  }, [startHour, endHour]);

  return (
    <View style={styles.root}>
      {columns.length > 1 ? (
        <View style={styles.headerRow}>
          <View style={[styles.gutter, styles.headerGutter]} />
          {columns.map(column => (
            <Pressable
              key={`header-${column.dateIso}`}
              onPress={() => onSelectDay?.(column.dateIso)}
              style={({pressed}) => [
                styles.columnHeader,
                column.isSelected ? styles.columnHeaderSelected : null,
                pressed ? styles.columnHeaderPressed : null,
              ]}>
              <Text
                style={[
                  styles.weekdayText,
                  column.isToday ? styles.weekdayTextToday : null,
                ]}>
                {column.weekdayLabel}
              </Text>
              <View
                style={[
                  styles.dayNumberWrap,
                  column.isToday ? styles.dayNumberWrapToday : null,
                ]}>
                <Text
                  style={[
                    styles.dayNumberText,
                    column.isToday ? styles.dayNumberTextToday : null,
                  ]}>
                  {column.dayNumberLabel}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator>
        <View style={styles.body}>
          <View style={styles.gutter}>
            {hours.map(hour => (
              <View key={hour} style={{height: hourHeight}}>
                <Text style={styles.hourLabel}>{formatHourLabel(hour)}</Text>
              </View>
            ))}
          </View>
          {columns.map(column => {
            const dayStart = localMidnight(column.dateIso);
            const lanes = assignLanes(column.blocks);
            const showNow = column.dateIso === todayIso;
            const nowTop =
              (nowMinutesLocal - startOffsetMinutes) * (hourHeight / 60);
            const nowVisible =
              showNow && nowTop >= 0 && nowTop <= contentHeight;
            return (
              <View
                key={`col-${column.dateIso}`}
                style={[
                  styles.column,
                  column.isSelected ? styles.columnSelected : null,
                  {height: contentHeight},
                ]}>
                {hours.map((_, hourIndex) => (
                  <View
                    key={hourIndex}
                    style={[
                      styles.hourLine,
                      {top: hourIndex * hourHeight, height: hourHeight},
                    ]}>
                    <View style={styles.halfHourLine} />
                  </View>
                ))}

                {column.blocks.map((block, blockIndex) => {
                  const lane = lanes[blockIndex];
                  const startMin = Math.max(
                    startOffsetMinutes,
                    Math.min(
                      endHour * 60,
                      minutesSinceMidnight(new Date(block.startTime), dayStart),
                    ),
                  );
                  const endMin = Math.max(
                    startMin + 8,
                    Math.min(
                      endHour * 60,
                      minutesSinceMidnight(new Date(block.endTime), dayStart),
                    ),
                  );
                  if (endMin <= startOffsetMinutes || startMin >= endHour * 60) {
                    return null;
                  }
                  const top =
                    (startMin - startOffsetMinutes) * (hourHeight / 60);
                  const height = Math.max(
                    18,
                    (endMin - startMin) * (hourHeight / 60),
                  );
                  const laneWidthPct = 100 / Math.max(1, lane.laneCount);
                  const leftPct = lane.lane * laneWidthPct;
                  const compact = density === 'compact' || height < 32;
                  return (
                    <TimeGridBlock
                      key={block.id}
                      block={block}
                      isSelected={selectedBlockId === block.id}
                      compact={compact}
                      onPress={() => onSelectBlock(block.id)}
                      hoverHandlers={hoverHandlers}
                      style={{
                        top,
                        height,
                        left: `${leftPct}%`,
                        width: `${laneWidthPct}%`,
                      }}
                    />
                  );
                })}

                {nowVisible ? (
                  <View style={[styles.nowLine, {top: nowTop}]}>
                    <View style={styles.nowDot} />
                    <View style={styles.nowBar} />
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

type TimeGridBlockProps = {
  block: WorklogCalendarBlock;
  isSelected: boolean;
  compact: boolean;
  onPress: () => void;
  hoverHandlers?: BlockHoverHandlers;
  style: {
    top: number;
    height: number;
    left: `${number}%` | number;
    width: `${number}%` | number;
  };
};

function TimeGridBlock({
  block,
  isSelected,
  compact,
  onPress,
  hoverHandlers,
  style,
}: TimeGridBlockProps) {
  const palette = paletteForBlock(block);
  const ref = useRef<View | null>(null);
  return (
    <View style={[styles.blockWrap, style]}>
      <Pressable
        ref={ref}
        onPress={onPress}
        onHoverIn={() => hoverHandlers?.onBlockHoverIn(block, ref)}
        onHoverOut={() => hoverHandlers?.onBlockHoverOut(block.id)}
        style={({pressed}) => [
          styles.block,
          {
            backgroundColor: palette.bg,
            borderColor: isSelected ? palette.dot : palette.border,
          },
          isSelected ? styles.blockSelected : null,
          pressed ? styles.blockPressed : null,
        ]}>
        <View style={[styles.blockAccent, {backgroundColor: palette.accent}]} />
        <View style={styles.blockBody}>
          <Text
            numberOfLines={compact ? 1 : 2}
            style={[
              styles.blockTitle,
              {color: palette.text},
              compact ? styles.blockTitleCompact : null,
            ]}>
            {block.title}
          </Text>
          {!compact ? (
            <Text
              numberOfLines={1}
              style={[styles.blockMeta, {color: palette.text}]}>
              {new Date(block.startTime).toLocaleTimeString([], {
                hour: 'numeric',
                minute: '2-digit',
              })}
              {' – '}
              {new Date(block.endTime).toLocaleTimeString([], {
                hour: 'numeric',
                minute: '2-digit',
              })}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'column',
  },
  scroll: {
    flex: 1,
    alignSelf: 'stretch',
  },
  scrollContent: {
    paddingBottom: 24,
  },
  headerRow: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    backgroundColor: '#faf8f3',
    borderBottomWidth: 1,
    borderBottomColor: '#ece7dd',
    zIndex: 5,
  },
  headerGutter: {
    borderRightWidth: 1,
    borderRightColor: '#ece7dd',
  },
  columnHeader: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    gap: 4,
    borderRightWidth: 1,
    borderRightColor: '#ece7dd',
  },
  columnHeaderSelected: {
    backgroundColor: '#f4efe4',
  },
  columnHeaderPressed: {
    opacity: 0.85,
  },
  weekdayText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.1,
    color: '#8a8478',
    textTransform: 'uppercase',
  },
  weekdayTextToday: {
    color: '#1a1a1a',
  },
  dayNumberWrap: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayNumberWrapToday: {
    backgroundColor: '#1a1a1a',
  },
  dayNumberText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  dayNumberTextToday: {
    color: '#ffffff',
  },
  body: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    alignSelf: 'stretch',
  },
  gutter: {
    width: GUTTER_WIDTH,
    borderRightWidth: 1,
    borderRightColor: '#ece7dd',
    paddingTop: 0,
  },
  hourLabel: {
    fontSize: 10,
    color: '#a59e8c',
    fontWeight: '600',
    textAlign: 'right',
    paddingRight: 8,
    marginTop: -6,
  },
  column: {
    flex: 1,
    borderRightWidth: 1,
    borderRightColor: '#ece7dd',
    position: 'relative',
    overflow: 'visible',
  },
  columnSelected: {
    backgroundColor: '#faf7ee',
  },
  hourLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopWidth: 1,
    borderTopColor: '#eee7d9',
  },
  halfHourLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    borderTopWidth: 1,
    borderTopColor: '#f5efe1',
    borderStyle: 'dashed',
  },
  blockWrap: {
    position: 'absolute',
    padding: 1,
  },
  block: {
    flex: 1,
    flexDirection: 'row',
    borderRadius: 6,
    borderWidth: 1,
    overflow: 'hidden',
  },
  blockSelected: {
    shadowColor: '#1a1a1a',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: {width: 0, height: 2},
  },
  blockPressed: {
    opacity: 0.9,
  },
  blockAccent: {
    width: 3,
  },
  blockBody: {
    flex: 1,
    paddingHorizontal: 6,
    paddingVertical: 4,
    gap: 2,
  },
  blockTitle: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 15,
  },
  blockTitleCompact: {
    fontSize: 11,
    lineHeight: 14,
  },
  blockMeta: {
    fontSize: 10,
    opacity: 0.75,
  },
  nowLine: {
    position: 'absolute',
    left: -3,
    right: 0,
    height: 2,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 10,
  },
  nowDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ff4444',
    marginLeft: -4,
  },
  nowBar: {
    flex: 1,
    height: 2,
    backgroundColor: '#ff4444',
  },
});
