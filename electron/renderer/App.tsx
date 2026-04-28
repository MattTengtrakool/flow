import {useCallback, useEffect, useMemo, useState} from 'react';

import '../shared/flowApi';
import type {ChatMessage} from '../../src/chat/runChat';
import {computeCostSummary} from '../../src/planner/costSummary';
import {getAllPlanCalendarBlocks, getWorklogForDates} from '../../src/planner/selectors';
import {computeBlockNotesKey} from '../../src/planner/types';
import {AppShell} from './components/AppShell';
import {StatusBanners} from './components/StatusBanner';
import {
  addDaysIso,
  addMonthsIso,
  dateRangeForView,
  focusedMinutes,
  toDateIso,
} from './dateUtils';
import {useElectronTimeline} from './hooks/useElectronTimeline';
import {
  CalendarScreen,
  ChatScreen,
  InsightsScreen,
  SettingsScreen,
  TodayScreen,
} from './screens';
import type {CalendarView, NavKey} from './types';

export function ElectronApp() {
  const timelineStore = useElectronTimeline(window.flow);
  const [activeNav, setActiveNav] = useState<NavKey>('calendar');
  const [version, setVersion] = useState<string>('loading');
  const [permissionStatus, setPermissionStatus] = useState<string>('loading');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatDraft, setChatDraft] = useState('');
  const [selectedDateIso, setSelectedDateIso] = useState(() => toDateIso(new Date()));
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [calendarView, setCalendarView] = useState<CalendarView>('month');
  const [calendarAnchorIso, setCalendarAnchorIso] = useState(() => toDateIso(new Date()));

  const checkPermissions = useCallback(() => {
    window.flow?.capture
      .getPermissionsStatus()
      .then(payload =>
        setPermissionStatus(
          `accessibility=${payload.accessibilityTrusted ? 'granted' : 'missing'}, screen=${payload.captureAccessGranted ? 'granted' : 'missing'}`,
        ),
      )
      .catch(() => setPermissionStatus('unavailable'));
  }, []);

  useEffect(() => {
    window.flow?.app.getVersion().then(setVersion).catch(() => setVersion('unavailable'));
    checkPermissions();
    // Re-check when the window regains focus — accessibility requires the user to
    // leave to System Settings and come back before the grant is visible.
    window.addEventListener('focus', checkPermissions);
    return () => window.removeEventListener('focus', checkPermissions);
  }, [checkPermissions]);

  const todayIso = toDateIso(new Date());
  const visibleDateIsos = useMemo(
    () => dateRangeForView(calendarView, calendarAnchorIso),
    [calendarView, calendarAnchorIso],
  );
  const timezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
    [],
  );

  // Scope expensive selector re-runs to plan data changes only — not every capture event
  const planSnapshotsLength = timelineStore.timeline.planSnapshots.length;

  const blocksByDate = useMemo(
    () => getWorklogForDates(timelineStore.timeline, visibleDateIsos, timezone),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [planSnapshotsLength, visibleDateIsos, timezone],
  );
  const allBlocks = useMemo(
    () => getAllPlanCalendarBlocks(timelineStore.timeline),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [planSnapshotsLength],
  );
  const costSummary = useMemo(
    () => computeCostSummary(timelineStore.timeline),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [planSnapshotsLength],
  );

  const selectedDayBlocks = blocksByDate[selectedDateIso] ?? [];
  const selectedFocusedMinutes = focusedMinutes(selectedDayBlocks);
  const selectedBlock =
    allBlocks.find(block => block.id === selectedBlockId) ??
    selectedDayBlocks[0] ??
    null;
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
      ? timelineStore.timeline.userBlockNotes[editableNotesKey]?.notes
      : undefined;

  const goToToday = useCallback(() => {
    setCalendarAnchorIso(todayIso);
    setSelectedDateIso(todayIso);
  }, [todayIso]);

  const shiftCalendar = useCallback((delta: number) => {
    setCalendarAnchorIso(prev => {
      const next =
        calendarView === 'month'
          ? addMonthsIso(prev, delta)
          : addDaysIso(prev, delta * (calendarView === 'week' ? 7 : 1));
      setSelectedDateIso(next);
      return next;
    });
  }, [calendarView]);

  const selectBlockForDate = useCallback((blockId: string, dateIso?: string) => {
    if (dateIso != null) setSelectedDateIso(dateIso);
    setSelectedBlockId(blockId);
  }, []);

  const handleCaptureNow = useCallback(() => {
    timelineStore.runCaptureNow().catch(() => {});
  }, [timelineStore]);

  const handleReplanNow = useCallback(() => {
    timelineStore.runPlannerRevisionNow(true).catch(() => {});
  }, [timelineStore]);

  const handleEditNotes = useCallback((notes: string) => {
    if (editableNotesKey.length === 0 || selectedBlock == null) return;
    window.flow?.timeline.editBlockNotes({
      notesKey: editableNotesKey,
      blockId: selectedBlock.id,
      notes,
    });
  }, [editableNotesKey, selectedBlock]);

  const handleSelectTodayBlock = useCallback((block: {id: string}) => {
    selectBlockForDate(block.id, todayIso);
  }, [selectBlockForDate, todayIso]);

  const handleSelectCalendarBlock = useCallback((block: {id: string}, dateIso?: string) => {
    selectBlockForDate(block.id, dateIso);
  }, [selectBlockForDate]);

  const handleSelectInsightsBlock = useCallback((block: {id: string}) => {
    selectBlockForDate(block.id);
  }, [selectBlockForDate]);

  const handleChangeCalendarView = useCallback((view: CalendarView) => {
    setCalendarView(view);
    setCalendarAnchorIso(selectedDateIso);
  }, [selectedDateIso]);

  const handleSelectDate = useCallback((dateIso: string) => {
    setSelectedDateIso(dateIso);
    setCalendarAnchorIso(dateIso);
  }, []);

  const sendChat = useCallback(async () => {
    const content = chatDraft.trim();
    if (content.length === 0) return;
    const conversation = chatMessages;
    const userMessage: ChatMessage = {
      id: `chat_${Date.now()}_user`,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };
    setChatMessages(previous => [...previous, userMessage]);
    setChatDraft('');
    setChatLoading(true);
    try {
      if (window.flow == null) {
        throw new Error('Electron bridge missing.');
      }
      const result = await window.flow.chat.runTurn({
        conversation,
        userMessage: content,
        timeline: timelineStore.timeline,
        timezone,
      });
      setChatMessages(previous => [...previous, result.assistantMessage]);
    } catch (error) {
      setChatMessages(previous => [
        ...previous,
        {
          id: `chat_${Date.now()}_error`,
          role: 'assistant',
          content:
            error instanceof Error ? error.message : 'Chat request failed.',
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  }, [chatDraft, chatMessages, timelineStore.timeline, timezone]);

  const detailProps = useMemo(() => ({
    selectedBlock,
    selectedUserNotes,
    editableNotesKey,
    selectedObservationIds,
    visible: activeNav === 'today' || activeNav === 'calendar',
    onEditNotes: handleEditNotes,
  }), [
    selectedBlock,
    selectedUserNotes,
    editableNotesKey,
    selectedObservationIds,
    activeNav,
    handleEditNotes,
  ]);

  function activeScreen() {
    switch (activeNav) {
      case 'today':
        return (
          <TodayScreen
            todayIso={todayIso}
            blocks={blocksByDate[todayIso] ?? []}
            selectedBlockId={selectedBlock?.id ?? null}
            captureStatus={timelineStore.continuousModeState.statusMessage}
            onSelectBlock={handleSelectTodayBlock}
            onStartSession={timelineStore.startSession}
            onCaptureNow={handleCaptureNow}
            onReplanNow={handleReplanNow}
          />
        );
      case 'calendar':
        return (
          <CalendarScreen
            view={calendarView}
            anchorIso={calendarAnchorIso}
            visibleDateIsos={visibleDateIsos}
            blocksByDate={blocksByDate}
            selectedDateIso={selectedDateIso}
            selectedBlockId={selectedBlock?.id ?? null}
            selectedDayBlocks={selectedDayBlocks}
            selectedFocusedMinutes={selectedFocusedMinutes}
            onChangeView={handleChangeCalendarView}
            onShift={shiftCalendar}
            onToday={goToToday}
            onSelectDate={handleSelectDate}
            onSelectBlock={handleSelectCalendarBlock}
          />
        );
      case 'chat':
        return (
          <ChatScreen
            messages={chatMessages}
            loading={chatLoading}
            draft={chatDraft}
            onDraftChange={setChatDraft}
            onSend={sendChat}
          />
        );
      case 'insights':
        return (
          <InsightsScreen
            allBlocks={allBlocks}
            costSummary={costSummary}
            selectedBlockId={selectedBlock?.id ?? null}
            onSelectBlock={handleSelectInsightsBlock}
          />
        );
      case 'settings':
        return (
          <SettingsScreen
            version={version}
            permissionStatus={permissionStatus}
            timelineStore={timelineStore}
            costSummary={costSummary}
            onCaptureNow={handleCaptureNow}
            onReplanNow={handleReplanNow}
          />
        );
    }
  }

  return (
    <AppShell
      activeNav={activeNav}
      onNavigate={setActiveNav}
      timelineStore={timelineStore}
      detail={detailProps}>
      <StatusBanners
        permissionStatus={permissionStatus}
        timelineStore={timelineStore}
        onRefreshPermissions={checkPermissions}
      />
      {activeScreen()}
    </AppShell>
  );
}
