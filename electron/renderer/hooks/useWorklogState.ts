import { startTransition, useCallback, useEffect, useMemo, useState } from 'react';

import {
  computeCostSummary,
  type CostSummary,
} from '../../../src/planner/costSummary';
import { getCalendarEventMode } from '../../../src/calendar/calendarLogic';
import { getAllCalendarItemBlocks } from '../../../src/calendar/selectors';
import type {
  CalendarEventAnnotationPatch,
  CalendarEventAnnotationView,
  CalendarEventBlockLinkAction,
  CalendarReconciliationView,
  CalendarSourceView,
  ExternalCalendarEventView,
} from '../../../src/calendar/types';
import { getAllPlanCalendarBlocks } from '../../../src/planner/selectors';
import { computeBlockNotesKey } from '../../../src/planner/types';
import type { TimelineView } from '../../../src/timeline/eventLog';
import type { WorklogCalendarBlock } from '../../../src/worklog/types';
import {
  addDaysIso,
  addMonthsIso,
  dateRangeForView,
  focusedMinutes,
  toDateIso,
} from '../dateUtils';
import type { CalendarDisplayItemView, CalendarView, NavKey } from '../types';
import type { FlowElectronApi, WorklogViewPayload } from '../../shared/flowApi';
import type { WorkCategoryOption } from '../../../src/workCategories';

function mergeBlockLists(
  first: WorklogCalendarBlock[],
  second: WorklogCalendarBlock[],
): WorklogCalendarBlock[] {
  return [...first, ...second].sort((a, b) =>
    a.startTime.localeCompare(b.startTime),
  );
}

const EMPTY_COST_SUMMARY: CostSummary = {
  allTime: { inputTokens: 0, outputTokens: 0, costUsd: 0, planCount: 0 },
  last7Days: { inputTokens: 0, outputTokens: 0, costUsd: 0, planCount: 0 },
  last30Days: { inputTokens: 0, outputTokens: 0, costUsd: 0, planCount: 0 },
  byProvider: [],
  lastPlan: null,
  firstPlanAt: null,
  pricedPlanCount: 0,
  unpricedPlanCount: 0,
};

export function useWorklogState(args: {
  activeNav: NavKey;
  flow: FlowElectronApi;
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
  customCategories: WorkCategoryOption[];
}) {
  const {
    activeNav,
    flow,
    calendarAnnotations,
    calendarSources,
    timeline,
    updateEventAnnotation,
    updateEventBlockLink,
    customCategories,
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
  const needsVisibleWorklog = activeNav === 'today' || activeNav === 'calendar';
  const [worklogView, setWorklogView] = useState<WorklogViewPayload | null>(null);
  const [worklogViewLoading, setWorklogViewLoading] = useState(false);
  const worklogRequestKey = `${visibleDateIsos.join(',')}|${timezone}|${
    timeline.planSnapshots.at(-1)?.snapshotId ?? 'none'
  }|${timeline.calendarItemOrder.length}|${
    Object.keys(timeline.userBlockCorrections).length
  }|${timeline.taskSegmentOrder.length}`;

  useEffect(() => {
    if (!needsVisibleWorklog) return;
    let cancelled = false;
    setWorklogViewLoading(true);
    flow.timeline
      .getWorklogView({ dateIsos: visibleDateIsos, timezone })
      .then(view => {
        if (cancelled) return;
        startTransition(() => {
          setWorklogView(view);
          setWorklogViewLoading(false);
        });
      })
      .catch(() => {
        if (!cancelled) setWorklogViewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [flow, needsVisibleWorklog, timezone, visibleDateIsos, worklogRequestKey]);

  const blocksByDate = useMemo(() => {
    if (!needsVisibleWorklog) return {};
    if (needsVisibleWorklog && worklogView != null) {
      return worklogView.blocksByDate;
    }
    return {};
  }, [needsVisibleWorklog, worklogView]);
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
  const needsCalendarIntelligence = needsVisibleWorklog;
  const needsGlobalBlocks = activeNav === 'chat' || activeNav === 'insights';
  const allBlocks = useMemo(
    () => {
      if (!needsGlobalBlocks) return visibleBlocks;
      return mergeBlockLists(
        getAllPlanCalendarBlocks(timeline),
        getAllCalendarItemBlocks(timeline, timezone),
      );
    },
    [needsGlobalBlocks, timeline, timezone, visibleBlocks],
  );
  const costSummary = useMemo(
    () =>
      activeNav === 'settings' || activeNav === 'insights'
        ? computeCostSummary(timeline)
        : EMPTY_COST_SUMMARY,
    [activeNav, timeline],
  );
  const visibleCalendarEvents = useMemo(() => {
    if (needsCalendarIntelligence && worklogView != null) {
      return Object.values(worklogView.externalEventsByDate).flat();
    }
    return [];
  }, [needsCalendarIntelligence, worklogView]);
  const externalEventsByDate = useMemo(
    () =>
      needsCalendarIntelligence && worklogView != null
        ? worklogView.externalEventsByDate
        : groupCalendarEventsByDate(visibleCalendarEvents, visibleDateIsos, timezone),
    [
      needsCalendarIntelligence,
      visibleCalendarEvents,
      visibleDateIsos,
      timezone,
      worklogView,
    ],
  );
  const calendarDisplayItemsByDate = useMemo(
    () => {
      if (!needsCalendarIntelligence) return {};
      return buildCalendarDisplayItemsByDate({
        blocksByDate,
        eventsByDate: externalEventsByDate,
        sources: calendarSources,
        annotations: calendarAnnotations,
      });
    },
    [
      blocksByDate,
      calendarAnnotations,
      calendarSources,
      externalEventsByDate,
      needsCalendarIntelligence,
    ],
  );
  const reconciliation: CalendarReconciliationView = useMemo(
    () => {
      if (needsCalendarIntelligence && worklogView != null) {
        return worklogView.reconciliation;
      }
      return {
        links: [],
        scheduledItems: [],
        totals: {
          observedFocusMinutes: 0,
          scheduledBusyMinutes: 0,
          observedWithinScheduledMinutes: 0,
        },
      };
    },
    [needsCalendarIntelligence, worklogView],
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
      ? visibleBlocks.find(block => block.id === selectedBlockId) ??
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
    () => {
      if (needsCalendarIntelligence && worklogView != null) {
        return worklogView.taskFitSuggestions;
      }
      return [];
    },
    [needsCalendarIntelligence, worklogView],
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
      customCategories,
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
      customCategories,
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
    worklogViewLoading,
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
