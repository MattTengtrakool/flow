import React, {useCallback, useMemo, useRef, useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {Text} from './Text';

import type {WorklogCalendarBlock} from '../worklog/types';
import {BLOCK_HOVER_CARD_WIDTH, BlockHoverCard} from './BlockHoverCard';
import {DayCalendar} from './DayCalendar';
import {MonthCalendar} from './MonthCalendar';
import {WeekCalendar} from './WeekCalendar';
import {labelForCategory, paletteForBlock} from './blockColors';
import {ChevronLeftIcon, ChevronRightIcon} from './icons';

export type CalendarView = 'month' | 'week' | 'day';

export type BlockHoverHandlers = {
  onBlockHoverIn: (
    block: WorklogCalendarBlock,
    anchorRef: React.RefObject<View | null>,
  ) => void;
  onBlockHoverOut: (blockId: string) => void;
};

type CalendarScreenProps = {
  view: CalendarView;
  onChangeView: (view: CalendarView) => void;
  anchorIso: string;
  onChangeAnchor: (anchorIso: string) => void;
  today: string;
  selectedDateIso: string;
  selectedBlockId: string | null;
  blocksByDate: Record<string, WorklogCalendarBlock[]>;
  onSelectDay: (dateIso: string) => void;
  onSelectBlock: (blockId: string) => void;
  onGoToToday: () => void;
  primaryAction?: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
  };
  secondaryAction?: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
  };
};

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const MONTH_NAMES_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const WEEKDAY_FULL = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const HOVER_CARD_ESTIMATED_HEIGHT = 170;
const HOVER_CARD_GAP = 6;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
function toDateIso(year: number, month: number, day: number): string {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}
function parseIso(dateIso: string): {year: number; month: number; day: number} {
  const [y, m, d] = dateIso.split('-').map(Number);
  return {year: y ?? 1970, month: (m ?? 1) - 1, day: d ?? 1};
}
function dateFromIso(dateIso: string): Date {
  const {year, month, day} = parseIso(dateIso);
  return new Date(year, month, day, 0, 0, 0, 0);
}
function addDaysIso(dateIso: string, days: number): string {
  const dt = dateFromIso(dateIso);
  dt.setDate(dt.getDate() + days);
  return toDateIso(dt.getFullYear(), dt.getMonth(), dt.getDate());
}
function addMonthsIso(dateIso: string, months: number): string {
  const {year, month, day} = parseIso(dateIso);
  const dt = new Date(year, month + months, 1);
  const lastDay = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
  const clampedDay = Math.min(day, lastDay);
  return toDateIso(dt.getFullYear(), dt.getMonth(), clampedDay);
}
function mondayOfIso(dateIso: string): string {
  const dt = dateFromIso(dateIso);
  const dayOfWeek = (dt.getDay() + 6) % 7;
  dt.setDate(dt.getDate() - dayOfWeek);
  return toDateIso(dt.getFullYear(), dt.getMonth(), dt.getDate());
}
function firstOfMonthIso(dateIso: string): string {
  const {year, month} = parseIso(dateIso);
  return toDateIso(year, month, 1);
}

type HoverState = {
  block: WorklogCalendarBlock;
  anchor: {left: number; top: number; width: number; height: number};
  bounds: {width: number; height: number};
};

export function CalendarScreen(props: CalendarScreenProps) {
  const {
    view,
    onChangeView,
    anchorIso,
    onChangeAnchor,
    today,
    selectedDateIso,
    selectedBlockId,
    blocksByDate,
    onSelectDay,
    onSelectBlock,
    onGoToToday,
    primaryAction,
    secondaryAction,
  } = props;

  const anchor = parseIso(anchorIso);
  const weekStartIso = useMemo(() => mondayOfIso(anchorIso), [anchorIso]);

  const rootRef = useRef<View | null>(null);
  const [hoverState, setHoverState] = useState<HoverState | null>(null);

  const handleBlockHoverIn = useCallback<BlockHoverHandlers['onBlockHoverIn']>(
    (block, anchorRef) => {
      const anchorNode = anchorRef.current;
      const rootNode = rootRef.current;
      if (anchorNode == null || rootNode == null) return;
      anchorNode.measureInWindow((ax, ay, aw, ah) => {
        rootNode.measureInWindow((rx, ry, rw, rh) => {
          if (
            !Number.isFinite(ax) ||
            !Number.isFinite(ay) ||
            !Number.isFinite(rx) ||
            !Number.isFinite(ry)
          ) {
            return;
          }
          setHoverState({
            block,
            anchor: {
              left: ax - rx,
              top: ay - ry,
              width: aw,
              height: ah,
            },
            bounds: {width: rw, height: rh},
          });
        });
      });
    },
    [],
  );

  const handleBlockHoverOut = useCallback<BlockHoverHandlers['onBlockHoverOut']>(
    blockId => {
      setHoverState(prev => {
        if (prev == null) return null;
        if (prev.block.id !== blockId) return prev;
        return null;
      });
    },
    [],
  );

  const hoverHandlers = useMemo<BlockHoverHandlers>(
    () => ({
      onBlockHoverIn: handleBlockHoverIn,
      onBlockHoverOut: handleBlockHoverOut,
    }),
    [handleBlockHoverIn, handleBlockHoverOut],
  );

  const hoverCardPosition = useMemo(() => {
    if (hoverState == null) return null;
    const margin = 8;
    const {anchor: a, bounds} = hoverState;
    let left = a.left;
    if (left + BLOCK_HOVER_CARD_WIDTH > bounds.width - margin) {
      left = bounds.width - BLOCK_HOVER_CARD_WIDTH - margin;
    }
    if (left < margin) left = margin;
    const spaceBelow = bounds.height - (a.top + a.height);
    const spaceAbove = a.top;
    let top: number;
    if (spaceBelow >= HOVER_CARD_ESTIMATED_HEIGHT + HOVER_CARD_GAP) {
      top = a.top + a.height + HOVER_CARD_GAP;
    } else if (spaceAbove >= HOVER_CARD_ESTIMATED_HEIGHT + HOVER_CARD_GAP) {
      top = a.top - HOVER_CARD_ESTIMATED_HEIGHT - HOVER_CARD_GAP;
    } else {
      top = Math.max(
        margin,
        Math.min(
          a.top + a.height + HOVER_CARD_GAP,
          bounds.height - HOVER_CARD_ESTIMATED_HEIGHT - margin,
        ),
      );
    }
    if (top < margin) top = margin;
    return {left, top};
  }, [hoverState]);

  const title = useMemo(() => {
    if (view === 'month') {
      return `${MONTH_NAMES[anchor.month]} ${anchor.year}`;
    }
    if (view === 'week') {
      const weekEndIso = addDaysIso(weekStartIso, 6);
      const s = parseIso(weekStartIso);
      const e = parseIso(weekEndIso);
      if (s.month === e.month) {
        return `${MONTH_NAMES_SHORT[s.month]} ${s.day} – ${e.day}, ${e.year}`;
      }
      if (s.year === e.year) {
        return `${MONTH_NAMES_SHORT[s.month]} ${s.day} – ${MONTH_NAMES_SHORT[e.month]} ${e.day}, ${e.year}`;
      }
      return `${MONTH_NAMES_SHORT[s.month]} ${s.day}, ${s.year} – ${MONTH_NAMES_SHORT[e.month]} ${e.day}, ${e.year}`;
    }
    const dt = dateFromIso(anchorIso);
    return `${WEEKDAY_FULL[dt.getDay()]}, ${MONTH_NAMES_SHORT[anchor.month]} ${anchor.day}, ${anchor.year}`;
  }, [view, anchorIso, weekStartIso, anchor]);

  function handlePrev() {
    if (view === 'month') {
      onChangeAnchor(addMonthsIso(firstOfMonthIso(anchorIso), -1));
      return;
    }
    if (view === 'week') {
      onChangeAnchor(addDaysIso(anchorIso, -7));
      return;
    }
    onChangeAnchor(addDaysIso(anchorIso, -1));
  }
  function handleNext() {
    if (view === 'month') {
      onChangeAnchor(addMonthsIso(firstOfMonthIso(anchorIso), 1));
      return;
    }
    if (view === 'week') {
      onChangeAnchor(addDaysIso(anchorIso, 7));
      return;
    }
    onChangeAnchor(addDaysIso(anchorIso, 1));
  }

  const legendEntries = useMemo(() => {
    const set = new Map<
      string,
      {palette: ReturnType<typeof paletteForBlock>; label: string}
    >();
    const isosToConsider =
      view === 'month'
        ? Object.keys(blocksByDate)
        : view === 'week'
          ? Array.from({length: 7}, (_, i) => addDaysIso(weekStartIso, i))
          : [anchorIso];
    for (const iso of isosToConsider) {
      const dayBlocks = blocksByDate[iso] ?? [];
      for (const block of dayBlocks) {
        const key = block.category ?? 'other';
        if (!set.has(key)) {
          set.set(key, {
            palette: paletteForBlock(block),
            label: labelForCategory(key),
          });
        }
      }
    }
    return Array.from(set.entries()).map(([key, value]) => ({key, ...value}));
  }, [view, anchorIso, weekStartIso, blocksByDate]);

  return (
    <View ref={rootRef} style={styles.root} collapsable={false}>
      <View style={styles.toolbar}>
        <View style={styles.navGroup}>
          <Pressable
            onPress={onGoToToday}
            style={({pressed}) => [
              styles.todayButton,
              pressed ? styles.pressed : null,
            ]}>
            <Text style={styles.todayButtonLabel}>Today</Text>
          </Pressable>
          <View style={styles.chevronGroup}>
            <Pressable
              onPress={handlePrev}
              style={({pressed}) => [
                styles.iconButton,
                pressed ? styles.iconButtonPressed : null,
              ]}>
              <ChevronLeftIcon size={14} color="#3a3a3a" />
            </Pressable>
            <Pressable
              onPress={handleNext}
              style={({pressed}) => [
                styles.iconButton,
                pressed ? styles.iconButtonPressed : null,
              ]}>
              <ChevronRightIcon size={14} color="#3a3a3a" />
            </Pressable>
          </View>
          <Text style={styles.title}>{title}</Text>
        </View>
        <View style={styles.actionGroup}>
          <ViewSwitcher view={view} onChangeView={onChangeView} />
          {secondaryAction ? (
            <Pressable
              onPress={secondaryAction.onPress}
              disabled={secondaryAction.disabled}
              style={({pressed}) => [
                styles.secondaryButton,
                secondaryAction.disabled ? styles.disabled : null,
                pressed && !secondaryAction.disabled ? styles.pressed : null,
              ]}>
              <Text style={styles.secondaryButtonLabel}>
                {secondaryAction.label}
              </Text>
            </Pressable>
          ) : null}
          {primaryAction ? (
            <Pressable
              onPress={primaryAction.onPress}
              disabled={primaryAction.disabled}
              style={({pressed}) => [
                styles.primaryButton,
                primaryAction.disabled ? styles.disabled : null,
                pressed && !primaryAction.disabled ? styles.pressed : null,
              ]}>
              <Text style={styles.primaryButtonLabel}>
                {primaryAction.label}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.content}>
        {view === 'month' ? (
          <MonthCalendar
            year={anchor.year}
            month={anchor.month}
            today={today}
            selectedDateIso={selectedDateIso}
            selectedBlockId={selectedBlockId}
            blocksByDate={blocksByDate}
            onSelectDay={onSelectDay}
            onSelectBlock={onSelectBlock}
            hoverHandlers={hoverHandlers}
          />
        ) : null}
        {view === 'week' ? (
          <WeekCalendar
            weekStartIso={weekStartIso}
            today={today}
            selectedDateIso={selectedDateIso}
            selectedBlockId={selectedBlockId}
            blocksByDate={blocksByDate}
            onSelectDay={onSelectDay}
            onSelectBlock={onSelectBlock}
            hoverHandlers={hoverHandlers}
          />
        ) : null}
        {view === 'day' ? (
          <DayCalendar
            dateIso={anchorIso}
            today={today}
            selectedBlockId={selectedBlockId}
            blocksByDate={blocksByDate}
            onSelectBlock={onSelectBlock}
            hoverHandlers={hoverHandlers}
          />
        ) : null}
      </View>

      <View style={styles.footer}>
        {legendEntries.length > 0 ? (
          <View style={styles.legend}>
            {legendEntries.map(entry => (
              <View key={entry.key} style={styles.legendItem}>
                <View
                  style={[
                    styles.legendDot,
                    {backgroundColor: entry.palette.dot},
                  ]}
                />
                <Text style={styles.legendLabel}>{entry.label}</Text>
              </View>
            ))}
          </View>
        ) : (
          <View />
        )}
        <Text style={styles.footerCaption}>All times in your local time zone</Text>
      </View>

      {hoverState != null && hoverCardPosition != null ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <View
            style={[
              styles.hoverCardLayer,
              {left: hoverCardPosition.left, top: hoverCardPosition.top},
            ]}>
            <BlockHoverCard block={hoverState.block} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

type ViewSwitcherProps = {
  view: CalendarView;
  onChangeView: (view: CalendarView) => void;
};

function ViewSwitcher({view, onChangeView}: ViewSwitcherProps) {
  const options: Array<{key: CalendarView; label: string}> = [
    {key: 'month', label: 'Month'},
    {key: 'week', label: 'Week'},
    {key: 'day', label: 'Day'},
  ];
  return (
    <View style={styles.switcher}>
      {options.map(option => {
        const active = option.key === view;
        return (
          <Pressable
            key={option.key}
            onPress={() => onChangeView(option.key)}
            style={({pressed}) => [
              styles.switcherButton,
              active ? styles.switcherButtonActive : null,
              pressed ? styles.pressed : null,
            ]}>
            <Text
              style={[
                styles.switcherLabel,
                active ? styles.switcherLabelActive : null,
              ]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 20,
    paddingBottom: 16,
    gap: 14,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    flexWrap: 'wrap',
  },
  navGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  chevronGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  iconButton: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonPressed: {
    backgroundColor: '#ece7dd',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1a1a1a',
    letterSpacing: -0.2,
  },
  todayButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#e0dccf',
    backgroundColor: '#ffffff',
  },
  todayButtonLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  actionGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  switcher: {
    flexDirection: 'row',
    borderRadius: 8,
    padding: 3,
    backgroundColor: '#ece7dd',
    gap: 2,
  },
  switcherButton: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
  },
  switcherButtonActive: {
    backgroundColor: '#ffffff',
    shadowColor: '#1a1a1a',
    shadowOpacity: 0.08,
    shadowRadius: 2,
    shadowOffset: {width: 0, height: 1},
  },
  switcherLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b6b6b',
  },
  switcherLabelActive: {
    color: '#1a1a1a',
  },
  secondaryButton: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0dccf',
    backgroundColor: '#ffffff',
  },
  secondaryButtonLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
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
  pressed: {
    opacity: 0.85,
  },
  disabled: {
    opacity: 0.45,
  },
  content: {
    flex: 1,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    flex: 1,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  legendLabel: {
    fontSize: 11,
    color: '#6b6b6b',
    fontWeight: '500',
  },
  footerCaption: {
    fontSize: 11,
    color: '#a59e8c',
  },
  hoverCardLayer: {
    position: 'absolute',
  },
});
