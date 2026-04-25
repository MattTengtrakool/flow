import React, {useMemo} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {Text} from './Text';

import type {WorklogCalendarBlock} from '../worklog/types';
import {paletteForBlock} from './blockColors';
import type {BlockHoverHandlers} from './CalendarScreen';

export type MonthCalendarProps = {
  year: number;
  month: number; // 0-indexed
  today: string;
  selectedDateIso: string;
  selectedBlockId: string | null;
  blocksByDate: Record<string, WorklogCalendarBlock[]>;
  onSelectDay: (dateIso: string) => void;
  onSelectBlock: (blockId: string) => void;
  hoverHandlers?: BlockHoverHandlers;
};

const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function toDateIso(year: number, month: number, day: number): string {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

function getMondayStart(date: Date): Date {
  const result = new Date(date);
  const dayOfWeek = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() - dayOfWeek);
  return result;
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

function focusedMinutesForDay(blocks: WorklogCalendarBlock[]): number {
  let total = 0;
  for (const block of blocks) {
    total += Math.max(
      0,
      Math.round((Date.parse(block.endTime) - Date.parse(block.startTime)) / 60000),
    );
  }
  return total;
}

export function MonthCalendar(props: MonthCalendarProps) {
  const {
    year,
    month,
    today,
    selectedDateIso,
    selectedBlockId,
    blocksByDate,
    onSelectDay,
    onSelectBlock,
    hoverHandlers,
  } = props;

  const weeks = useMemo(() => buildWeeks(year, month), [year, month]);

  return (
    <View style={styles.root}>
      <View style={styles.weekdayRow}>
        {WEEKDAYS.map(day => (
          <Text key={day} style={styles.weekdayLabel}>
            {day}
          </Text>
        ))}
      </View>

      <View style={styles.grid}>
        {weeks.map((week, weekIndex) => (
          <View key={weekIndex} style={styles.weekRow}>
            {week.map(cell => {
              const isCurrentMonth = cell.month === month;
              const dateIso = toDateIso(cell.year, cell.month, cell.day);
              const isSelected = dateIso === selectedDateIso;
              const isToday = dateIso === today;
              const dayBlocks = blocksByDate[dateIso] ?? [];
              const focusedMinutes = focusedMinutesForDay(dayBlocks);
              return (
                <Pressable
                  key={dateIso}
                  onPress={() => onSelectDay(dateIso)}
                  style={({pressed}) => [
                    styles.dayCell,
                    !isCurrentMonth ? styles.dayCellMuted : null,
                    isSelected ? styles.dayCellSelected : null,
                    pressed ? styles.dayCellPressed : null,
                  ]}>
                  <View style={styles.dayHeader}>
                    <View
                      style={[
                        styles.dayNumberWrap,
                        isToday ? styles.dayNumberToday : null,
                      ]}>
                      <Text
                        style={[
                          styles.dayNumber,
                          !isCurrentMonth ? styles.dayNumberMuted : null,
                          isToday ? styles.dayNumberTodayText : null,
                        ]}>
                        {cell.day}
                      </Text>
                    </View>
                    {focusedMinutes > 0 ? (
                      <Text
                        style={[
                          styles.focusedMinutes,
                          !isCurrentMonth ? styles.focusedMinutesMuted : null,
                        ]}>
                        {Math.round(focusedMinutes / 60) >= 1
                          ? `${Math.round(focusedMinutes / 60)}h`
                          : `${focusedMinutes}m`}
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.blockList}>
                    {dayBlocks.slice(0, 3).map(block => (
                      <MonthBlockPill
                        key={block.id}
                        block={block}
                        isSelected={block.id === selectedBlockId}
                        onPress={() => {
                          onSelectDay(dateIso);
                          onSelectBlock(block.id);
                        }}
                        hoverHandlers={hoverHandlers}
                      />
                    ))}
                    {dayBlocks.length > 3 ? (
                      <Text style={styles.blockPillMore}>
                        +{dayBlocks.length - 3} more
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

type MonthBlockPillProps = {
  block: WorklogCalendarBlock;
  isSelected: boolean;
  onPress: () => void;
  hoverHandlers?: BlockHoverHandlers;
};

function MonthBlockPill({
  block,
  isSelected,
  onPress,
  hoverHandlers,
}: MonthBlockPillProps) {
  const palette = paletteForBlock(block);
  const ref = React.useRef<View | null>(null);
  return (
    <Pressable
      ref={ref}
      onPress={onPress}
      onHoverIn={() => hoverHandlers?.onBlockHoverIn(block, ref)}
      onHoverOut={() => hoverHandlers?.onBlockHoverOut(block.id)}
      style={({pressed}) => [
        styles.blockPill,
        {
          backgroundColor: palette.bg,
          borderColor: isSelected ? palette.dot : palette.border,
        },
        isSelected ? styles.blockPillSelected : null,
        pressed ? styles.blockPillPressed : null,
      ]}>
      <View style={[styles.blockPillDot, {backgroundColor: palette.dot}]} />
      <View style={styles.blockPillBody}>
        <Text
          style={[styles.blockPillLabel, {color: palette.text}]}
          numberOfLines={1}>
          {block.title}
        </Text>
        <Text
          style={[styles.blockPillMeta, {color: palette.text}]}
          numberOfLines={1}>
          {formatDuration(block)}
        </Text>
      </View>
    </Pressable>
  );
}

type GridCell = {year: number; month: number; day: number};

function buildWeeks(year: number, month: number): GridCell[][] {
  const firstOfMonth = new Date(year, month, 1);
  const gridStart = getMondayStart(firstOfMonth);
  const weeks: GridCell[][] = [];
  let cursor = new Date(gridStart);
  for (let w = 0; w < 6; w += 1) {
    const week: GridCell[] = [];
    for (let d = 0; d < 7; d += 1) {
      week.push({
        year: cursor.getFullYear(),
        month: cursor.getMonth(),
        day: cursor.getDate(),
      });
      cursor = new Date(cursor);
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
    if (week[6].month !== month && w >= 4) {
      break;
    }
  }
  return weeks;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    gap: 6,
  },
  weekdayRow: {
    flexDirection: 'row',
    paddingHorizontal: 0,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#ece7dd',
  },
  weekdayLabel: {
    flex: 1,
    fontSize: 11,
    fontWeight: '600',
    color: '#8a8478',
    letterSpacing: 1.2,
    textAlign: 'left',
    paddingHorizontal: 6,
  },
  grid: {
    flex: 1,
    gap: 0,
  },
  weekRow: {
    flexDirection: 'row',
    flex: 1,
    minHeight: 104,
  },
  dayCell: {
    flex: 1,
    padding: 6,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#f0ece2',
    gap: 4,
  },
  dayCellMuted: {
    backgroundColor: 'transparent',
  },
  dayCellSelected: {
    backgroundColor: '#faf7ef',
  },
  dayCellPressed: {
    opacity: 0.92,
  },
  dayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dayNumberWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayNumberToday: {
    backgroundColor: '#1a1a1a',
  },
  dayNumber: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  dayNumberMuted: {
    color: '#c0b9a5',
  },
  dayNumberTodayText: {
    color: '#ffffff',
  },
  focusedMinutes: {
    fontSize: 10,
    fontWeight: '600',
    color: '#8a8478',
  },
  focusedMinutesMuted: {
    color: '#c0b9a5',
  },
  blockList: {
    gap: 3,
  },
  blockPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 5,
    borderWidth: 1,
  },
  blockPillSelected: {
    shadowColor: '#1a1a1a',
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: {width: 0, height: 1},
  },
  blockPillPressed: {
    opacity: 0.8,
  },
  blockPillDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  blockPillBody: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 4,
  },
  blockPillLabel: {
    flex: 1,
    fontSize: 11,
    fontWeight: '500',
  },
  blockPillMeta: {
    fontSize: 10,
    opacity: 0.7,
  },
  blockPillMore: {
    paddingHorizontal: 6,
    fontSize: 10,
    color: '#8a8478',
  },
});
