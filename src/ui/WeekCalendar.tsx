import React, {useMemo} from 'react';
import {StyleSheet, View} from 'react-native';

import type {WorklogCalendarBlock} from '../worklog/types';
import type {BlockHoverHandlers} from './CalendarScreen';
import {TimeGrid, type TimeGridColumn} from './TimeGrid';

type WeekCalendarProps = {
  weekStartIso: string; // Monday
  today: string;
  selectedDateIso: string;
  selectedBlockId: string | null;
  blocksByDate: Record<string, WorklogCalendarBlock[]>;
  onSelectDay: (dateIso: string) => void;
  onSelectBlock: (blockId: string) => void;
  hoverHandlers?: BlockHoverHandlers;
};

const WEEKDAYS_SHORT = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

function pad(n: number) {
  return String(n).padStart(2, '0');
}
function addDaysIso(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split('-').map(Number);
  const dt = new Date(y, (m ?? 1) - 1, (d ?? 1) + days, 0, 0, 0, 0);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

export function WeekCalendar(props: WeekCalendarProps) {
  const {
    weekStartIso,
    today,
    selectedDateIso,
    selectedBlockId,
    blocksByDate,
    onSelectDay,
    onSelectBlock,
    hoverHandlers,
  } = props;

  const columns = useMemo<TimeGridColumn[]>(() => {
    return WEEKDAYS_SHORT.map((weekdayLabel, offset) => {
      const dateIso = addDaysIso(weekStartIso, offset);
      const dayNumber = Number(dateIso.split('-')[2]);
      return {
        dateIso,
        isToday: dateIso === today,
        isSelected: dateIso === selectedDateIso,
        weekdayLabel,
        dayNumberLabel: String(dayNumber),
        blocks: blocksByDate[dateIso] ?? [],
      };
    });
  }, [weekStartIso, today, selectedDateIso, blocksByDate]);

  return (
    <View style={styles.root}>
      <TimeGrid
        columns={columns}
        selectedBlockId={selectedBlockId}
        onSelectBlock={onSelectBlock}
        onSelectDay={onSelectDay}
        hoverHandlers={hoverHandlers}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
