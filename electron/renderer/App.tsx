import { useState } from 'react';

import '../shared/flowApi';
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
  InsightsScreen,
  SettingsScreen,
  TodayScreen,
} from './screens';
import type { NavKey } from './types';
import type { FlowElectronApi } from '../shared/flowApi';

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
  const { version, permissions, permissionStatus, checkPermissions } =
    useAppStatus(flow);
  const settingsController = useFlowSettings(flow);
  const calendarState = useCalendarState(flow);
  const timeline = timelineStore.timeline;
  const worklog = useWorklogState({
    activeNav,
    calendarAnnotations: calendarState.annotations,
    calendarEvents: calendarState.events,
    calendarSources: calendarState.sources,
    timeline,
    updateEventAnnotation: calendarState.updateEventAnnotation,
    updateEventBlockLink: calendarState.updateEventBlockLink,
  });
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
    switch (activeNav) {
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
            onSelectExternalEvent={worklog.selectExternalEvent}
          />
        );
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
      onNavigate={setActiveNav}
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
