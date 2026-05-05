import { startTransition, useCallback, useDeferredValue, useState } from 'react';

import '../shared/flowApi';
import type {
  CalendarItemUpdate,
  CreateCalendarItemInput,
} from '../../src/calendar/types';
import { AppShell } from './components/AppShell';
import { CompanionApp } from './components/Companion';
import { LoadingScreen } from './components/LoadingScreen';
import { Onboarding } from './components/Onboarding';
import { PreviewMode } from './components/PreviewMode';
import { StatusBanners } from './components/StatusBanner';
import { StatusCenter } from './components/StatusCenter';
import { useAppStatus } from './hooks/useAppStatus';
import { useChatSession } from './hooks/useChatSession';
import { useCalendarState } from './hooks/useCalendarState';
import { useElectronTimeline } from './hooks/useElectronTimeline';
import { useFlowSettings } from './hooks/useFlowSettings';
import { useTimelineCommands } from './hooks/useTimelineCommands';
import { useWorklogState } from './hooks/useWorklogState';
import {
  CalendarScreen,
  ChatScreen,
  AuditScreen,
  InsightsScreen,
  SettingsScreen,
  TodayScreen,
} from './screens';
import type { NavKey } from './types';
import type { FlowElectronApi } from '../shared/flowApi';
import { Screen } from './components/common';

export function ElectronApp() {
  if (window.location.hash === '#/companion') {
    return <CompanionApp flow={window.flow} />;
  }
  if (window.flow == null) {
    return <PreviewMode />;
  }
  return <ElectronAppWithBridge flow={window.flow} />;
}

function ElectronAppWithBridge(props: { flow: FlowElectronApi }) {
  const { flow } = props;
  const timelineStore = useElectronTimeline(flow);
  const [activeNav, setActiveNav] = useState<NavKey>('calendar');
  const [contentNav, setContentNav] = useState<NavKey>('calendar');
  const { version, permissions, permissionStatus, checkPermissions } =
    useAppStatus(flow);
  const settingsController = useFlowSettings(flow);
  const calendarState = useCalendarState(flow);
  const timeline = useDeferredValue(timelineStore.timeline);
  const worklog = useWorklogState({
    activeNav: contentNav,
    flow,
    calendarAnnotations: calendarState.annotations,
    calendarEvents: calendarState.events,
    calendarSources: calendarState.sources,
    customCategories: settingsController.settings.customCategories,
    timeline,
    updateEventAnnotation: calendarState.updateEventAnnotation,
    updateEventBlockLink: calendarState.updateEventBlockLink,
  });
  const handleCreateCalendarItem = useCallback(
    async (input: CreateCalendarItemInput) => {
      await flow.timeline.createCalendarItem(input);
    },
    [flow],
  );
  const handleUpdateCalendarItem = useCallback(
    async (itemId: string, updates: CalendarItemUpdate) => {
      await flow.timeline.updateCalendarItem({itemId, updates});
    },
    [flow],
  );
  const handleDeleteCalendarItem = useCallback(
    async (itemId: string) => {
      await flow.timeline.deleteCalendarItem(itemId);
    },
    [flow],
  );

  const chat = useChatSession({
    flow,
    timeline,
    timezone: worklog.timezone,
    selectedDateIso: worklog.selectedDateIso,
    selectedBlock: worklog.selectedBlock,
    selectedCalendarEvent: worklog.selectedExternalEvent,
    selectedCalendarEventAnnotation: worklog.selectedExternalEventAnnotation,
    selectedCalendarEventSource: worklog.selectedExternalEventSource,
  });
  const timelineCommands = useTimelineCommands(timelineStore);
  const handleNavigate = useCallback((nextNav: NavKey) => {
    setActiveNav(nextNav);
    startTransition(() => {
      setContentNav(nextNav);
    });
  }, []);

  if (settingsController.status === 'loading') {
    return <LoadingScreen />;
  }

  const setupIncomplete =
    !settingsController.settings.onboardingCompleted ||
    !settingsController.settings.managedAi.configured;

  if (setupIncomplete) {
    return (
      <Onboarding
        permissions={permissions}
        permissionStatus={permissionStatus}
        settingsController={settingsController}
        onRefreshPermissions={checkPermissions}
        onRequestAccessibility={() => flow.capture.requestAccessibilityPrompt()}
        onRequestScreen={() => flow.capture.requestScreenCaptureAccess()}
        onStartSession={timelineStore.startSession}
      />
    );
  }

  function activeScreen() {
    if (contentNav !== activeNav) {
      return (
        <Screen title={navTitle(activeNav)}>
          <div className="empty-state roomy">
            <strong>Loading {navTitle(activeNav).toLowerCase()}…</strong>
          </div>
        </Screen>
      );
    }

    switch (contentNav) {
      case 'today':
        return (
          <TodayScreen
            todayIso={worklog.todayIso}
            blocks={worklog.blocksByDate[worklog.todayIso] ?? []}
            selectedBlockId={worklog.selectedBlock?.id ?? null}
            captureStatus={timelineStore.continuousModeState.statusMessage}
            onSelectBlock={worklog.selectTodayBlock}
            onStartSession={timelineStore.startSession}
            onCaptureNow={timelineCommands.captureNow}
            onReplanNow={timelineCommands.replanNow}
          />
        );
      case 'calendar':
        return (
          <CalendarScreen
            view={worklog.calendarView}
            anchorIso={worklog.calendarAnchorIso}
            visibleDateIsos={worklog.visibleDateIsos}
            blocksByDate={worklog.blocksByDate}
            selectedDateIso={worklog.selectedDateIso}
            selectedBlockId={worklog.selectedBlock?.id ?? null}
            selectedBlock={worklog.selectedBlock}
            selectedExternalEventId={worklog.selectedExternalEvent?.id ?? null}
            selectedDayBlocks={worklog.selectedDayBlocks}
            selectedFocusedMinutes={worklog.selectedFocusedMinutes}
            externalEventsByDate={worklog.externalEventsByDate}
            calendarSources={calendarState.sources}
            reconciliation={worklog.calendarReconciliation}
            taskFitSuggestions={worklog.taskFitSuggestions}
            onChangeView={worklog.setCalendarView}
            onShift={worklog.shiftCalendar}
            onToday={worklog.goToToday}
            onSelectDate={worklog.selectDate}
            onSelectBlock={worklog.selectCalendarBlock}
            onCreateCalendarItem={handleCreateCalendarItem}
            onUpdateCalendarItem={handleUpdateCalendarItem}
            onDeleteCalendarItem={handleDeleteCalendarItem}
            onSelectExternalEvent={worklog.selectExternalEvent}
          />
        );
      case 'audit':
        return <AuditScreen timeline={timelineStore.timeline} />;
      case 'chat':
        return (
          <ChatScreen
            messages={chat.messages}
            loading={chat.loading}
            draft={chat.draft}
            allBlocks={worklog.allBlocks}
            selectedBlock={worklog.selectedBlock}
            selectedDateIso={worklog.selectedDateIso}
            onDraftChange={chat.setDraft}
            onSend={chat.send}
            onSelectCitation={block => {
              worklog.selectInsightsBlock(block);
              setActiveNav('calendar');
            }}
          />
        );
      case 'insights':
        return (
          <InsightsScreen
            allBlocks={worklog.allBlocks}
            costSummary={worklog.costSummary}
            selectedBlockId={worklog.selectedBlock?.id ?? null}
            onSelectBlock={worklog.selectInsightsBlock}
          />
        );
      case 'settings':
        return (
          <SettingsScreen
            version={version}
            permissionStatus={permissionStatus}
            timelineStore={timelineStore}
            costSummary={worklog.costSummary}
            settingsController={settingsController}
            calendarState={calendarState}
            onCaptureNow={timelineCommands.captureNow}
            onReplanNow={timelineCommands.replanNow}
          />
        );
    }
  }

  return (
    <AppShell
      activeNav={activeNav}
      onNavigate={handleNavigate}
      timelineStore={timelineStore}
      detail={worklog.detailProps}
    >
      <StatusBanners
        permissionStatus={permissionStatus}
        timelineStore={timelineStore}
        onRefreshPermissions={checkPermissions}
      />
      <StatusCenter
        settings={settingsController.settings}
        calendarState={calendarState}
        permissionStatus={permissionStatus}
        timelineStore={timelineStore}
      />
      {activeScreen()}
    </AppShell>
  );
}

function navTitle(nav: NavKey): string {
  switch (nav) {
    case 'today':
      return 'Today';
    case 'calendar':
      return 'Calendar';
    case 'chat':
      return 'Chat';
    case 'audit':
      return 'Audit';
    case 'insights':
      return 'Insights';
    case 'settings':
      return 'Settings';
  }
}
