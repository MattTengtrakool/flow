import React, {useMemo, useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {Text} from './Text';

import type {WorklogCalendarBlock} from '../worklog/types';
import type {BlockHoverHandlers} from './CalendarScreen';
import {TimeGrid, type TimeGridColumn} from './TimeGrid';

type DayCalendarProps = {
  dateIso: string;
  today: string;
  selectedBlockId: string | null;
  blocksByDate: Record<string, WorklogCalendarBlock[]>;
  onSelectBlock: (blockId: string) => void;
  hoverHandlers?: BlockHoverHandlers;
};

const WEEKDAY_FULL = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const ZOOM_LEVELS = [36, 48, 64, 96, 128] as const;
const DEFAULT_ZOOM_INDEX = 1;

export function DayCalendar(props: DayCalendarProps) {
  const {
    dateIso,
    today,
    selectedBlockId,
    blocksByDate,
    onSelectBlock,
    hoverHandlers,
  } = props;
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);

  const [y, m, d] = dateIso.split('-').map(Number);
  const dateObj = new Date(y, (m ?? 1) - 1, d ?? 1);
  const weekdayLabel = WEEKDAY_FULL[dateObj.getDay()];

  const columns = useMemo<TimeGridColumn[]>(() => {
    return [
      {
        dateIso,
        isToday: dateIso === today,
        isSelected: true,
        weekdayLabel,
        dayNumberLabel: String(dateObj.getDate()),
        blocks: blocksByDate[dateIso] ?? [],
      },
    ];
  }, [dateIso, today, weekdayLabel, dateObj, blocksByDate]);

  const canZoomOut = zoomIndex > 0;
  const canZoomIn = zoomIndex < ZOOM_LEVELS.length - 1;

  return (
    <View style={styles.root}>
      <View style={styles.controlsRow}>
        <Text style={styles.zoomLabel}>Hour height</Text>
        <Pressable
          onPress={() => canZoomOut && setZoomIndex(i => i - 1)}
          disabled={!canZoomOut}
          style={({pressed}) => [
            styles.zoomButton,
            !canZoomOut ? styles.zoomButtonDisabled : null,
            pressed && canZoomOut ? styles.zoomButtonPressed : null,
          ]}>
          <Text style={styles.zoomButtonLabel}>−</Text>
        </Pressable>
        <Text style={styles.zoomValue}>{ZOOM_LEVELS[zoomIndex]}px</Text>
        <Pressable
          onPress={() => canZoomIn && setZoomIndex(i => i + 1)}
          disabled={!canZoomIn}
          style={({pressed}) => [
            styles.zoomButton,
            !canZoomIn ? styles.zoomButtonDisabled : null,
            pressed && canZoomIn ? styles.zoomButtonPressed : null,
          ]}>
          <Text style={styles.zoomButtonLabel}>+</Text>
        </Pressable>
      </View>
      <TimeGrid
        columns={columns}
        selectedBlockId={selectedBlockId}
        onSelectBlock={onSelectBlock}
        hourHeight={ZOOM_LEVELS[zoomIndex]}
        hoverHandlers={hoverHandlers}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 0,
    paddingBottom: 10,
  },
  zoomLabel: {
    flex: 1,
    fontSize: 11,
    fontWeight: '600',
    color: '#8a8478',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  zoomButton: {
    width: 26,
    height: 26,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e0dccf',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomButtonDisabled: {
    opacity: 0.4,
  },
  zoomButtonPressed: {
    backgroundColor: '#f4efe4',
  },
  zoomButtonLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  zoomValue: {
    width: 52,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
    color: '#1a1a1a',
  },
});
