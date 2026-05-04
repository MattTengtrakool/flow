import { useCallback, useMemo, useState } from 'react';

import { computeCostSummary } from '../../../src/planner/costSummary';
import {
  buildCalendarReconciliation,
  buildTaskFitSuggestions,
  getCalendarEventMode,
  getCalendarEventsInRange,
} from '../../../src/calendar/calendarLogic';
import type {
  CalendarEventAnnotationPatch,
  CalendarEventAnnotationView,
  CalendarEventBlockLinkAction,
  CalendarReconciliationView,
  CalendarSourceView,
  ExternalCalendarEventView,
} from '../../../src/calendar/types';
import {
  getAllPlanCalendarBlocks,
  getWorklogForDates,
} from '../../../src/planner/selectors';
import { computeBlockNotesKey } from '../../../src/planner/types';
import type { TimelineView } from '../../../src/timeline/eventLog';
import type { WorklogCalendarBlock } from '../../../src/worklog/types';
import {
  addDaysIso,
  addMonthsIso,
  dateFromIso,
  dateRangeForView,
  focusedMinutes,
  toDateIso,
} from '../dateUtils';
import type { CalendarDisplayItemView, CalendarView, NavKey } from '../types';

export function useWorklogState(args: {
  activeNav: NavKey;
  timeline: TimelineView;
  calendarEvents: ExternalCalendarEventView[];
  calendarSources: CalendarSourceView[];
  calendarAnnotations: CalendarEventAnnotationView[];
  updateEventAnnotation: (
    eventId: string,
    patch: CalendarEventAnnotationPatch,
  ) => Promise<unknown>;
  updateEventBlockLink: (
    eventId: string,
    blockId: string,
    action: CalendarEventBlockLinkAction,
  ) => Promise<unknown>;
}) {
  const {
    activeNav,
    calendarAnnotations,
    calendarEvents,
    calendarSources,
    timeline,
    updateEventAnnotation,
    updateEventBlockLink,
  } = args;
  const [selectedDateIso, setSelectedDateIso] = useState(() =>
    toDateIso(new Date()),
  );
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [selectedExternalEventId, setSelectedExternalEventId] = useState<
    string | null
  >(null);
  const [calendarView, setCalendarView] = useState<CalendarView>('month');
  const [calendarAnchorIso, setCalendarAnchorIso] = useState(() =>
    toDateIso(new Date()),
  );

  const todayIso = toDateIso(new Date());
  const visibleDateIsos = useMemo(
    () => dateRangeForView(calendarView, calendarAnchorIso),
    [calendarView, calendarAnchorIso],
  );
  const timezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
    [],
  );

  const blocksByDate = useMemo(
    () => getWorklogForDates(timeline, visibleDateIsos, timezone),
    [timeline, visibleDateIsos, timezone],
  );
  const allBlocks = useMemo(
    () => getAllPlanCalendarBlocks(timeline),
    [timeline],
  );
  const costSummary = useMemo(() => computeCostSummary(timeline), [timeline]);
  const visibleRange = useMemo(
    () => rangeForDateIsos(visibleDateIsos),
    [visibleDateIsos],
  );
  const visibleCalendarEvents = useMemo(() => {
    const sourceById = new Map(
      calendarSources.map(source => [source.id, source]),
    );
    const annotationByEventId = new Map(
      calendarAnnotations.map(annotation => [annotation.eventId, annotation]),
    );
    return getCalendarEventsInRange(
      calendarEvents,
      visibleRange.startIso,
      visibleRange.endIso,
    ).filter(
      event =>
        getCalendarEventMode(
          event,
          sourceById.get(event.sourceId),
          annotationByEventId.get(event.id),
        ) !== 'ignored',
    );
  }, [calendarAnnotations, calendarEvents, calendarSources, visibleRange]);
  const externalEventsByDate = useMemo(
    () =>
      groupCalendarEventsByDate(
        visibleCalendarEvents,
        visibleDateIsos,
        timezone,
      ),
    [visibleCalendarEvents, visibleDateIsos, timezone],
  );
  const calendarDisplayItemsByDate = useMemo(
    () =>
      buildCalendarDisplayItemsByDate({
        blocksByDate,
        eventsByDate: externalEventsByDate,
        sources: calendarSources,
        annotations: calendarAnnotations,
      }),
    [blocksByDate, calendarAnnotations, calendarSources, externalEventsByDate],
  );
  const visibleBlocks = useMemo(
    () =>
      Array.from(
        new Map(
          Object.values(blocksByDate)
            .flat()
            .map(block => [block.id, block]),
        ).values(),
      ),
    [blocksByDate],
  );
  const reconciliation: CalendarReconciliationView = useMemo(
    () =>
      buildCalendarReconciliation({
        blocks: visibleBlocks,
        events: visibleCalendarEvents,
        sources: calendarSources,
        annotations: calendarAnnotations,
        rangeStartIso: visibleRange.startIso,
        rangeEndIso: visibleRange.endIso,
      }),
    [
      calendarAnnotations,
      calendarSources,
      visibleBlocks,
      visibleCalendarEvents,
      visibleRange,
    ],
  );

  const selectedDayBlocks = blocksByDate[selectedDateIso] ?? [];
  const selectedFocusedMinutes = focusedMinutes(selectedDayBlocks);
  const selectedExternalEvent =
    selectedExternalEventId != null
      ? visibleCalendarEvents.find(
          event => event.id === selectedExternalEventId,
        ) ?? null
      : null;
  const selectedExternalEventSource =
    selectedExternalEvent != null
      ? calendarSources.find(
          source => source.id === selectedExternalEvent.sourceId,
        ) ?? null
      : null;
  const selectedExternalEventAnnotation =
    selectedExternalEvent != null
      ? calendarAnnotations.find(
          annotation => annotation.eventId === selectedExternalEvent.id,
        ) ?? null
      : null;
  const selectedBlock =
    selectedExternalEvent == null
      ? allBlocks.find(block => block.id === selectedBlockId) ??
        selectedDayBlocks[0] ??
        null
      : null;
  const selectedObservationIds = useMemo(
    () => selectedBlock?.summary.provenance.supportedByObservationIds ?? [],
    [selectedBlock],
  );
  const selectedNotesKey = computeBlockNotesKey(selectedObservationIds);
  const editableNotesKey =
    selectedNotesKey.length > 0
      ? selectedNotesKey
      : selectedBlock != null
      ? `block:${selectedBlock.id}`
      : '';
  const selectedUserNotes =
    editableNotesKey.length > 0
      ? timeline.userBlockNotes[editableNotesKey]?.notes
      : undefined;
  const selectedBlockCalendarEvents = useMemo(() => {
    if (selectedBlock == null) return [];
    const linkedIds = new Set(selectedBlock.calendarEventIds ?? []);
    for (const link of reconciliation.links) {
      if (link.blockId === selectedBlock.id) linkedIds.add(link.eventId);
    }
    return visibleCalendarEvents.filter(event => {
      if (linkedIds.has(event.id)) return true;
      return (
        Date.parse(event.startTime) < Date.parse(selectedBlock.endTime) &&
        Date.parse(event.endTime) > Date.parse(selectedBlock.startTime)
      );
    });
  }, [reconciliation.links, selectedBlock, visibleCalendarEvents]);
  const selectedExternalEventBlocks = useMemo(() => {
    if (selectedExternalEvent == null) return [];
    const linkedBlockIds = new Set(
      reconciliation.links
        .filter(link => link.eventId === selectedExternalEvent.id)
        .map(link => link.blockId),
    );
    const annotation = calendarAnnotations.find(
      item => item.eventId === selectedExternalEvent.id,
    );
    const dismissed = new Set(annotation?.dismissedBlockIds ?? []);
    return visibleBlocks.filter(block => {
      if (dismissed.has(block.id)) return false;
      if (linkedBlockIds.has(block.id)) return true;
      return (
        Date.parse(block.startTime) <
          Date.parse(selectedExternalEvent.endTime) &&
        Date.parse(block.endTime) > Date.parse(selectedExternalEvent.startTime)
      );
    });
  }, [
    calendarAnnotations,
    reconciliation.links,
    selectedExternalEvent,
    visibleBlocks,
  ]);
  const taskFitSuggestions = useMemo(
    () =>
      buildTaskFitSuggestions({
        blocks: allBlocks,
        events: visibleCalendarEvents,
        sources: calendarSources,
        annotations: calendarAnnotations,
        rangeStartIso: visibleRange.startIso,
        rangeEndIso: visibleRange.endIso,
      }),
    [
      allBlocks,
      calendarAnnotations,
      calendarSources,
      visibleCalendarEvents,
      visibleRange,
    ],
  );

  const goToToday = useCallback(() => {
    setCalendarAnchorIso(todayIso);
    setSelectedDateIso(todayIso);
    setSelectedBlockId(null);
    setSelectedExternalEventId(null);
  }, [todayIso]);

  const shiftCalendar = useCallback(
    (delta: number) => {
      setCalendarAnchorIso(prev => {
        const next =
          calendarView === 'month'
            ? addMonthsIso(prev, delta)
            : addDaysIso(prev, delta * (calendarView === 'week' ? 7 : 1));
        setSelectedDateIso(next);
        setSelectedBlockId(null);
        setSelectedExternalEventId(null);
        return next;
      });
    },
    [calendarView],
  );

  const selectBlockForDate = useCallback(
    (blockId: string, dateIso?: string) => {
      if (dateIso != null) setSelectedDateIso(dateIso);
      setSelectedExternalEventId(null);
      setSelectedBlockId(blockId);
    },
    [],
  );

  const selectExternalEvent = useCallback(
    (event: { id: string }, dateIso?: string) => {
      if (dateIso != null) setSelectedDateIso(dateIso);
      setSelectedBlockId(null);
      setSelectedExternalEventId(event.id);
    },
    [],
  );

  const selectTodayBlock = useCallback(
    (block: { id: string }) => {
      selectBlockForDate(block.id, todayIso);
    },
    [selectBlockForDate, todayIso],
  );

  const selectCalendarBlock = useCallback(
    (block: { id: string }, dateIso?: string) => {
      selectBlockForDate(block.id, dateIso);
    },
    [selectBlockForDate],
  );

  const selectInsightsBlock = useCallback(
    (block: { id: string }) => {
      selectBlockForDate(block.id);
    },
    [selectBlockForDate],
  );

  const changeCalendarView = useCallback(
    (view: CalendarView) => {
      setCalendarView(view);
      setCalendarAnchorIso(selectedDateIso);
    },
    [selectedDateIso],
  );

  const selectDate = useCallback((dateIso: string) => {
    setSelectedDateIso(dateIso);
    setCalendarAnchorIso(dateIso);
    setSelectedBlockId(null);
    setSelectedExternalEventId(null);
  }, []);

  const editNotes = useCallback(
    (notes: string) => {
      if (editableNotesKey.length === 0 || selectedBlock == null) return;
      window.flow?.timeline.editBlockNotes({
        notesKey: editableNotesKey,
        blockId: selectedBlock.id,
        notes,
      });
    },
    [editableNotesKey, selectedBlock],
  );

  const correctBlock = useCallback(
    (correction: {
      title?: string;
      category?: string;
      markedWrong?: boolean;
      feedback?: string;
      mergeWithBlockId?: string;
      splitAt?: string;
    }) => {
      if (selectedBlock == null) return;
      window.flow?.timeline.correctBlock({
        blockId: selectedBlock.id,
        notesKey: selectedBlock.notesKey ?? editableNotesKey,
        ...correction,
      });
    },
    [editableNotesKey, selectedBlock],
  );

  const detailProps = useMemo(
    () => ({
      selectedBlock,
      selectedExternalEvent,
      selectedExternalEventAnnotation,
      selectedExternalEventBlocks,
      selectedExternalEventSource,
      selectedUserNotes,
      editableNotesKey,
      selectedObservationIds,
      selectedCalendarEvents: selectedBlockCalendarEvents,
      calendarReconciliation: reconciliation,
      visible: activeNav === 'today' || activeNav === 'calendar',
      onEditNotes: editNotes,
      onCorrectBlock: correctBlock,
      onEditCalendarEventAnnotation: updateEventAnnotation,
      onUpdateCalendarEventBlockLink: updateEventBlockLink,
    }),
    [
      activeNav,
      editableNotesKey,
      editNotes,
      correctBlock,
      selectedBlock,
      selectedExternalEvent,
      selectedExternalEventAnnotation,
      selectedExternalEventBlocks,
      selectedExternalEventSource,
      selectedObservationIds,
      selectedBlockCalendarEvents,
      selectedUserNotes,
      reconciliation,
      updateEventAnnotation,
      updateEventBlockLink,
    ],
  );

  return {
    allBlocks,
    blocksByDate,
    calendarAnchorIso,
    calendarView,
    costSummary,
    detailProps,
    externalEventsByDate,
    goToToday,
    calendarReconciliation: reconciliation,
    calendarDisplayItemsByDate,
    selectedBlock,
    selectedExternalEvent,
    selectedExternalEventAnnotation,
    selectedExternalEventSource,
    selectedDateIso,
    selectedDayBlocks,
    selectedFocusedMinutes,
    taskFitSuggestions,
    shiftCalendar,
    selectCalendarBlock,
    selectDate,
    selectExternalEvent,
    selectInsightsBlock,
    selectTodayBlock,
    setCalendarView: changeCalendarView,
    timezone,
    todayIso,
    visibleDateIsos,
  };
}

function buildCalendarDisplayItemsByDate(args: {
  blocksByDate: Record<string, WorklogCalendarBlock[]>;
  eventsByDate: Record<string, ExternalCalendarEventView[]>;
  sources: CalendarSourceView[];
  annotations: CalendarEventAnnotationView[];
}): Record<string, CalendarDisplayItemView[]> {
  const sourceById = new Map(args.sources.map(source => [source.id, source]));
  const annotationByEventId = new Map(
    args.annotations.map(annotation => [annotation.eventId, annotation]),
  );
  const result: Record<string, CalendarDisplayItemView[]> = {};
  const dateIsos = new Set([
    ...Object.keys(args.blocksByDate),
    ...Object.keys(args.eventsByDate),
  ]);
  for (const dateIso of dateIsos) {
    const observedItems = (args.blocksByDate[dateIso] ?? []).map(block => ({
      kind: 'observed_block' as const,
      id: block.id,
      dateIso,
      block,
    }));
    const eventItems: CalendarDisplayItemView[] = [];
    for (const event of args.eventsByDate[dateIso] ?? []) {
      const mode = getCalendarEventMode(
        event,
        sourceById.get(event.sourceId),
        annotationByEventId.get(event.id),
      );
      if (mode === 'ignored') continue;
      eventItems.push({
        kind: mode === 'scheduled' ? 'scheduled_event' : 'context_event',
        id: event.id,
        dateIso,
        event,
      });
    }
    result[dateIso] = [...observedItems, ...eventItems];
  }
  return result;
}

function rangeForDateIsos(dateIsos: string[]): {
  startIso: string;
  endIso: string;
} {
  const first = dateIsos[0] ?? toDateIso(new Date());
  const last = dateIsos[dateIsos.length - 1] ?? first;
  const start = dateFromIso(first);
  const end = dateFromIso(last);
  end.setDate(end.getDate() + 1);
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

function groupCalendarEventsByDate(
  events: ExternalCalendarEventView[],
  dateIsos: string[],
  timezone: string,
): Record<string, ExternalCalendarEventView[]> {
  const result: Record<string, ExternalCalendarEventView[]> = {};
  for (const dateIso of dateIsos) result[dateIso] = [];
  for (const event of events) {
    const key = toLocalDayKey(event.startTime, timezone);
    if (result[key] == null) result[key] = [];
    result[key].push(event);
  }
  for (const key of Object.keys(result)) {
    result[key].sort((a, b) => a.startTime.localeCompare(b.startTime));
  }
  return result;
}

function toLocalDayKey(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}
