import React, {useEffect, useMemo, useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {Text} from './src/ui/Text';

import {useObservationLab} from './src/observation/useObservationLab';
import {EMPTY_TIMELINE} from './src/timeline/eventLog';
import {PLANNER_CONFIG} from './src/planner/config';
import {computeCostSummary} from './src/planner/costSummary';
import {
  getAllPlanCalendarBlocks,
  getWorklogForDates,
} from './src/planner/selectors';
import {CalendarScreen, type CalendarView} from './src/ui/CalendarScreen';
import {DayDetailPanel} from './src/ui/DayDetailPanel';
import {SidebarNav, type SidebarKey} from './src/ui/SidebarNav';
import {ChatScreen} from './src/ui/screens/ChatScreen';
import {InsightsScreen} from './src/ui/screens/InsightsScreen';
import {SettingsScreen} from './src/ui/screens/SettingsScreen';
import {TodayScreen} from './src/ui/screens/TodayScreen';

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function toDateIso(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getMondayStart(date: Date): Date {
  const result = new Date(date);
  const dayOfWeek = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() - dayOfWeek);
  return result;
}

function describeFailureTitle(reason: string): string {
  switch (reason) {
    case 'missing_api_key':
      return 'Gemini API key missing';
    case 'schema_validation_failed':
      return "The model returned something we couldn't parse";
    case 'transient_overload':
      return 'Gemini is temporarily overloaded';
    case 'rate_limited':
      return 'Hit the Gemini rate limit';
    case 'engine_error':
    default:
      return 'Last plan update failed';
  }
}

function isTransientFailure(reason: string | undefined): boolean {
  return reason === 'transient_overload' || reason === 'rate_limited';
}

function describeAge(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1 minute ago';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

function describeAbsoluteTime(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function describeFailureHint(reason: string): string {
  switch (reason) {
    case 'missing_api_key':
      return 'Set GEMINI_API_KEY in the .env file and relaunch the app.';
    case 'schema_validation_failed':
      return 'Flow will keep trying every 2 minutes. If it persists, the model may be rate-limited or returning malformed JSON.';
    case 'transient_overload':
      return 'Google saw a usage spike. Your previous plan is still in place. Flow will retry automatically in a couple of minutes.';
    case 'rate_limited':
      return "You've hit a per-minute quota. Your previous plan is still in place. Flow will retry automatically once the cooldown clears.";
    case 'engine_error':
    default:
      return 'Flow will retry on the next tick. If the message mentions a model name, check that the model is available on your API key.';
  }
}

function buildMonthDateIsos(year: number, month: number): string[] {
  const first = new Date(year, month, 1);
  const start = getMondayStart(first);
  const dates: string[] = [];
  const cursor = new Date(start);
  for (let i = 0; i < 42; i += 1) {
    dates.push(toDateIso(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function parseIsoParts(dateIso: string): {year: number; month: number; day: number} {
  const [y, m, d] = dateIso.split('-').map(Number);
  return {year: y ?? 1970, month: (m ?? 1) - 1, day: d ?? 1};
}

function addDaysIsoPure(dateIso: string, days: number): string {
  const {year, month, day} = parseIsoParts(dateIso);
  const dt = new Date(year, month, day + days, 0, 0, 0, 0);
  return toDateIso(dt);
}

function buildVisibleDateIsos(view: CalendarView, anchorIso: string): string[] {
  if (view === 'month') {
    const {year, month} = parseIsoParts(anchorIso);
    return buildMonthDateIsos(year, month);
  }
  if (view === 'week') {
    const anchorDate = new Date(`${anchorIso}T00:00:00`);
    const mondayStart = getMondayStart(anchorDate);
    const dates: string[] = [];
    // Include the full surrounding 3-week range so that week navigation can
    // peek at neighbouring data instantly without a refetch.
    const cursor = new Date(mondayStart);
    cursor.setDate(cursor.getDate() - 7);
    for (let i = 0; i < 21; i += 1) {
      dates.push(toDateIso(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return dates;
  }
  // day view: include ±3 days around the anchor.
  const dates: string[] = [];
  for (let delta = -3; delta <= 3; delta += 1) {
    dates.push(addDaysIsoPure(anchorIso, delta));
  }
  return dates;
}

function App() {
  const {
    hydrationStatus,
    permissions,
    surfaceErrorMessage,
    storagePath,
    timeline,
    continuousModeState,
    plannerRuntimeState,
    runPlannerRevisionNow,
    startSession,
    stopSession,
    promptForAccessibility,
    requestScreenCapturePermission,
    selectedWorklogDateIso,
    setSelectedWorklogDateIso,
    selectedWorklogBlockId,
    setSelectedWorklogBlockId,
    worklogTimezone,
    orphanedSession,
    closeOrphanedSession,
    resumeSession,
    getCapturePreview,
    capturePreviewCount,
    lastPersistDurationMs,
    lastPersistBytes,
    eventLog,
    updateBlockNotes,
  } = useObservationLab();

  const [activeNav, setActiveNav] = useState<SidebarKey>('calendar');

  const today = useMemo(() => toDateIso(new Date()), []);
  const [calendarView, setCalendarView] = useState<CalendarView>('month');
  const [calendarAnchorIso, setCalendarAnchorIso] = useState<string>(
    () => selectedWorklogDateIso,
  );

  const visibleDateIsos = useMemo(
    () => buildVisibleDateIsos(calendarView, calendarAnchorIso),
    [calendarView, calendarAnchorIso],
  );

  // The only thing any of these selectors actually reads off `timeline` is
  // `planSnapshots`. Key memos on that alone so a capture-heavy second
  // doesn't bust the month/today/cost caches every time.
  const planSnapshots = timeline.planSnapshots;

  const blocksByDate = useMemo(
    () =>
      getWorklogForDates(
        {...EMPTY_TIMELINE, planSnapshots},
        visibleDateIsos,
        worklogTimezone,
      ),
    [planSnapshots, visibleDateIsos, worklogTimezone],
  );

  const allBlocks = useMemo(
    () => getAllPlanCalendarBlocks({...EMPTY_TIMELINE, planSnapshots}),
    [planSnapshots],
  );

  const costSummary = useMemo(
    () => computeCostSummary({...EMPTY_TIMELINE, planSnapshots}),
    [planSnapshots],
  );

  const todaysBlocks = useMemo(
    () =>
      getWorklogForDates(
        {...EMPTY_TIMELINE, planSnapshots},
        [today],
        worklogTimezone,
      )[today] ?? [],
    [planSnapshots, today, worklogTimezone],
  );

  const selectedDayBlocks = blocksByDate[selectedWorklogDateIso] ?? [];
  const selectedBlock = useMemo(() => {
    if (selectedWorklogBlockId == null) return null;
    const fromDay = selectedDayBlocks.find(
      block => block.id === selectedWorklogBlockId,
    );
    if (fromDay != null) return fromDay;
    return (
      allBlocks.find(block => block.id === selectedWorklogBlockId) ?? null
    );
  }, [selectedDayBlocks, allBlocks, selectedWorklogBlockId]);

  useEffect(() => {
    if (selectedDayBlocks.length === 0) {
      if (
        selectedWorklogBlockId != null &&
        !allBlocks.some(block => block.id === selectedWorklogBlockId)
      ) {
        setSelectedWorklogBlockId(null);
      }
      return;
    }
    const stillExists = selectedDayBlocks.some(
      block => block.id === selectedWorklogBlockId,
    );
    if (!stillExists) {
      setSelectedWorklogBlockId(selectedDayBlocks[0].id);
    }
  }, [
    selectedDayBlocks,
    selectedWorklogBlockId,
    allBlocks,
    setSelectedWorklogBlockId,
  ]);

  const hasSession = timeline.currentSessionId != null;
  const permissionsReady =
    permissions.accessibilityTrusted && permissions.captureAccessGranted;
  const controlsDisabled = hydrationStatus !== 'ready';

  const replanInFlight = plannerRuntimeState?.inFlight === true;
  const replanDisabled =
    controlsDisabled || replanInFlight || !hasSession;
  const lastReplanAt = plannerRuntimeState?.lastRunAt ?? null;
  const nextReplanAt = useMemo(() => {
    if (!hasSession || lastReplanAt == null) return null;
    const next =
      Date.parse(lastReplanAt) +
      (plannerRuntimeState?.intervalMs ??
        PLANNER_CONFIG.plannerRevisionIntervalMs);
    return new Date(next).toISOString();
  }, [hasSession, lastReplanAt, plannerRuntimeState?.intervalMs]);

  const recordingStatusText = hasSession
    ? continuousModeState.currentMode === 'paused'
      ? 'Paused'
      : 'Capturing your work'
    : permissionsReady
      ? 'Click to start a session'
      : 'Grant permissions first';

  const recordingHint = (() => {
    if (replanInFlight) return 'Generating a fresh plan…';
    if (plannerRuntimeState?.lastFailure != null) {
      if (
        isTransientFailure(
          plannerRuntimeState.lastFailure.reason,
        )
      ) {
        return 'Update delayed — model is busy';
      }
      return 'Last plan failed — see banner';
    }
    if (lastReplanAt != null) {
      const time = new Date(lastReplanAt).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      });
      return `Last plan at ${time}`;
    }
    return 'Click to stop';
  })();

  function handleStartSession() {
    if (!permissionsReady) return;
    startSession().catch(() => {});
  }

  function handleStopSession() {
    stopSession().catch(() => {});
  }

  function handleReplanNow() {
    runPlannerRevisionNow?.({cause: 'manual', force: true}).catch(() => {});
  }

  function goToToday() {
    const nowIso = toDateIso(new Date());
    setCalendarAnchorIso(nowIso);
    setSelectedWorklogDateIso(nowIso);
    const firstBlockId = todaysBlocks[0]?.id ?? null;
    setSelectedWorklogBlockId(firstBlockId);
  }

  function handleCalendarSelectToday() {
    goToToday();
  }

  function handleChangeAnchor(anchorIso: string) {
    setCalendarAnchorIso(anchorIso);
    // In week/day view the anchor effectively is the selected day, so keep
    // the selected day in sync to avoid a stale detail panel.
    if (calendarView !== 'month') {
      setSelectedWorklogDateIso(anchorIso);
      const dayBlocks = blocksByDate[anchorIso] ?? [];
      setSelectedWorklogBlockId(dayBlocks[0]?.id ?? null);
    }
  }

  function handleChangeView(nextView: CalendarView) {
    setCalendarView(nextView);
    if (nextView !== 'month') {
      // Anchor follows the currently selected day so the hour grids open on
      // whatever day the user was focused on.
      setCalendarAnchorIso(selectedWorklogDateIso);
    }
  }

  function handleSelectDay(dateIso: string) {
    setSelectedWorklogDateIso(dateIso);
    setCalendarAnchorIso(dateIso);
    const dayBlocks = blocksByDate[dateIso] ?? [];
    setSelectedWorklogBlockId(dayBlocks[0]?.id ?? null);
  }

  function handleNavSelect(key: SidebarKey) {
    if (key === 'today') {
      goToToday();
      setActiveNav('today');
      return;
    }
    setActiveNav(key);
  }

  const calendarPrimaryAction = hasSession
    ? {
        label: replanInFlight ? 'Planning…' : 'Replan now',
        onPress: handleReplanNow,
        disabled: controlsDisabled || replanInFlight,
      }
    : {
        label: 'Start session',
        onPress: handleStartSession,
        disabled: controlsDisabled || !permissionsReady,
      };

  const calendarSecondaryAction = hasSession
    ? {
        label: 'Stop',
        onPress: handleStopSession,
        disabled: controlsDisabled,
      }
    : undefined;

  const showDetailPanel =
    activeNav === 'calendar' || activeNav === 'today';

  return (
    <View style={styles.shell} testID="app-running">
      <SidebarNav
        activeKey={activeNav}
        onSelect={handleNavSelect}
        recording={hasSession}
        recordingStatusText={recordingStatusText}
        recordingHint={recordingHint}
        onStartPress={handleStartSession}
        onStopPress={handleStopSession}
        startDisabled={controlsDisabled || !permissionsReady}
      />
      <View style={styles.main}>
        {orphanedSession != null ? (
          <View style={styles.recoveryBar}>
            <View style={styles.recoveryText}>
              <Text style={styles.recoveryTitle}>
                Unfinished session from {describeAge(orphanedSession.ageMs)}
              </Text>
              <Text style={styles.recoveryBody}>
                Started {describeAbsoluteTime(orphanedSession.startedAt)} · last
                activity {describeAbsoluteTime(orphanedSession.lastActivityAt)}.
                Flow isn't capturing right now — resume to continue or close to
                record this as its final time.
              </Text>
            </View>
            <View style={styles.recoveryActions}>
              <Pressable
                onPress={() => closeOrphanedSession?.()}
                style={({pressed}) => [
                  styles.recoverySecondary,
                  pressed ? styles.pressed : null,
                ]}>
                <Text style={styles.recoverySecondaryLabel}>Close session</Text>
              </Pressable>
              <Pressable
                onPress={() => resumeSession?.()}
                disabled={!permissionsReady}
                style={({pressed}) => [
                  styles.recoveryPrimary,
                  !permissionsReady ? styles.recoveryDisabled : null,
                  pressed && permissionsReady ? styles.pressed : null,
                ]}>
                <Text style={styles.recoveryPrimaryLabel}>Resume</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {!permissionsReady ? (
          <View style={styles.permissionBar}>
            <View style={styles.permissionText}>
              <Text style={styles.permissionTitle}>Grant permissions to start</Text>
              <Text style={styles.permissionBody}>
                Flow needs screen recording and accessibility to capture your work.
              </Text>
            </View>
            <View style={styles.permissionActions}>
              {!permissions.accessibilityTrusted ? (
                <Pressable
                  onPress={promptForAccessibility}
                  style={({pressed}) => [
                    styles.permissionButton,
                    pressed ? styles.pressed : null,
                  ]}>
                  <Text style={styles.permissionButtonLabel}>
                    Grant accessibility
                  </Text>
                </Pressable>
              ) : null}
              {!permissions.captureAccessGranted ? (
                <Pressable
                  onPress={requestScreenCapturePermission}
                  style={({pressed}) => [
                    styles.permissionButton,
                    pressed ? styles.pressed : null,
                  ]}>
                  <Text style={styles.permissionButtonLabel}>
                    Grant screen recording
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}

        {surfaceErrorMessage != null ? (
          <View style={styles.errorBar}>
            <Text style={styles.errorTitle}>Something went wrong</Text>
            <Text style={styles.errorBody}>{surfaceErrorMessage}</Text>
          </View>
        ) : null}

        {plannerRuntimeState?.lastFailure != null ? (
          <View
            style={[
              styles.replanFailureBar,
              isTransientFailure(plannerRuntimeState.lastFailure.reason)
                ? styles.replanFailureBarTransient
                : null,
            ]}>
            <View style={styles.replanFailureText}>
              <Text
                style={[
                  styles.replanFailureTitle,
                  isTransientFailure(
                    plannerRuntimeState.lastFailure.reason,
                  )
                    ? styles.replanFailureTitleTransient
                    : null,
                ]}>
                {describeFailureTitle(
                  plannerRuntimeState.lastFailure.reason,
                )}
              </Text>
              <Text
                style={[
                  styles.replanFailureBody,
                  isTransientFailure(
                    plannerRuntimeState.lastFailure.reason,
                  )
                    ? styles.replanFailureBodyTransient
                    : null,
                ]}
                selectable>
                {plannerRuntimeState.lastFailure.message}
              </Text>
              <Text
                style={[
                  styles.replanFailureHint,
                  isTransientFailure(
                    plannerRuntimeState.lastFailure.reason,
                  )
                    ? styles.replanFailureHintTransient
                    : null,
                ]}>
                {describeFailureHint(
                  plannerRuntimeState.lastFailure.reason,
                )}
              </Text>
            </View>
            <Pressable
              onPress={handleReplanNow}
              disabled={replanDisabled}
              style={({pressed}) => [
                styles.replanRetryButton,
                isTransientFailure(
                  plannerRuntimeState.lastFailure?.reason,
                )
                  ? styles.replanRetryButtonTransient
                  : null,
                replanDisabled ? styles.replanRetryDisabled : null,
                pressed && !replanDisabled ? styles.pressed : null,
              ]}>
              <Text style={styles.replanRetryLabel}>
                {replanInFlight ? 'Retrying…' : 'Retry now'}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {activeNav === 'calendar' ? (
          <CalendarScreen
            view={calendarView}
            onChangeView={handleChangeView}
            anchorIso={calendarAnchorIso}
            onChangeAnchor={handleChangeAnchor}
            today={today}
            selectedDateIso={selectedWorklogDateIso}
            selectedBlockId={selectedWorklogBlockId}
            blocksByDate={blocksByDate}
            onSelectDay={handleSelectDay}
            onSelectBlock={setSelectedWorklogBlockId}
            onGoToToday={handleCalendarSelectToday}
            primaryAction={calendarPrimaryAction}
            secondaryAction={calendarSecondaryAction}
          />
        ) : null}

        {activeNav === 'today' ? (
          <TodayScreen
            todayIso={today}
            blocks={todaysBlocks}
            selectedBlockId={selectedWorklogBlockId}
            onSelectBlock={setSelectedWorklogBlockId}
            hasSession={hasSession}
            lastReplanAt={lastReplanAt}
            nextReplanAt={nextReplanAt}
            onStartSession={handleStartSession}
            onStopSession={handleStopSession}
            onReplanNow={handleReplanNow}
            startDisabled={controlsDisabled || !permissionsReady}
            replanDisabled={replanDisabled}
            replanInFlight={replanInFlight}
          />
        ) : null}

        {activeNav === 'chat' ? (
          <ChatScreen timeline={timeline} timezone={worklogTimezone} />
        ) : null}

        {activeNav === 'insights' ? (
          <InsightsScreen allBlocks={allBlocks} />
        ) : null}

        {activeNav === 'settings' ? (
          <SettingsScreen
            permissions={permissions}
            onPromptAccessibility={promptForAccessibility}
            onPromptScreenRecording={requestScreenCapturePermission}
            replanIntervalMs={PLANNER_CONFIG.plannerRevisionIntervalMs}
            replanWindowMs={PLANNER_CONFIG.plannerRevisionWindowMs}
            replanMaxObservations={
              PLANNER_CONFIG.plannerRevisionMaxObservationsInPrompt
            }
            lastReplanAt={lastReplanAt}
            lastReplanBlockCount={plannerRuntimeState?.lastBlockCount ?? 0}
            lastPlanModel={plannerRuntimeState?.lastPlanModel ?? null}
            lastFailureMessage={
              plannerRuntimeState?.lastFailure?.message ?? null
            }
            onReplanNow={handleReplanNow}
            replanInFlight={replanInFlight}
            replanDisabled={replanDisabled}
            hasSession={hasSession}
            storagePath={storagePath}
            costSummary={costSummary}
            performance={{
              eventCount: eventLog.length,
              observationCount: timeline.observationOrder.length,
              planCount: timeline.planSnapshots.length,
              contextSnapshotCount: timeline.contextSnapshotOrder.length,
              capturePreviewCount: capturePreviewCount ?? 0,
              lastPersistDurationMs: lastPersistDurationMs ?? null,
              lastPersistBytes: lastPersistBytes ?? null,
            }}
          />
        ) : null}
      </View>
      {showDetailPanel ? (
        <DayDetailPanel
          selectedDateIso={selectedWorklogDateIso}
          dayBlocks={
            activeNav === 'today' ? todaysBlocks : selectedDayBlocks
          }
          selectedBlock={selectedBlock}
          onSelectBlock={setSelectedWorklogBlockId}
          observationsById={timeline.observationsById}
          getCapturePreview={getCapturePreview}
          userBlockNotes={timeline.userBlockNotes}
          onUpdateBlockNotes={updateBlockNotes}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#f7f3ec',
  },
  main: {
    flex: 1,
    flexDirection: 'column',
  },
  permissionBar: {
    marginHorizontal: 24,
    marginTop: 20,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#fff6dc',
    borderWidth: 1,
    borderColor: '#e8d18a',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  permissionText: {
    flex: 1,
    gap: 2,
  },
  permissionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#5e4200',
  },
  permissionBody: {
    fontSize: 12,
    color: '#75521c',
  },
  permissionActions: {
    flexDirection: 'row',
    gap: 8,
  },
  permissionButton: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e8d18a',
  },
  permissionButtonLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#5e4200',
  },
  pressed: {
    opacity: 0.8,
  },
  errorBar: {
    marginHorizontal: 24,
    marginTop: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#ffe3e3',
    borderWidth: 1,
    borderColor: '#e89c9c',
    gap: 4,
  },
  errorTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6b1a1a',
  },
  errorBody: {
    fontSize: 12,
    color: '#6b1a1a',
  },
  replanFailureBar: {
    marginHorizontal: 24,
    marginTop: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#fff0f0',
    borderWidth: 1,
    borderColor: '#f0c6c6',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  replanFailureText: {
    flex: 1,
    gap: 3,
  },
  replanFailureTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6b1a1a',
  },
  replanFailureBody: {
    fontSize: 12,
    color: '#6b1a1a',
    lineHeight: 18,
  },
  replanFailureHint: {
    fontSize: 11,
    color: '#8a4d4d',
    lineHeight: 16,
    marginTop: 2,
  },
  replanRetryButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#6b1a1a',
  },
  replanRetryDisabled: {
    opacity: 0.45,
  },
  replanRetryLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#ffffff',
  },
  replanFailureBarTransient: {
    backgroundColor: '#fff6dc',
    borderColor: '#e8d18a',
  },
  replanFailureTitleTransient: {
    color: '#6b4f00',
  },
  replanFailureBodyTransient: {
    color: '#6b4f00',
  },
  replanFailureHintTransient: {
    color: '#8a6a22',
  },
  replanRetryButtonTransient: {
    backgroundColor: '#6b4f00',
  },
  recoveryBar: {
    marginHorizontal: 24,
    marginTop: 20,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#fdf6ff',
    borderWidth: 1,
    borderColor: '#d9c9f5',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  recoveryText: {
    flex: 1,
    gap: 3,
  },
  recoveryTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#3d1f7a',
  },
  recoveryBody: {
    fontSize: 12,
    color: '#4a3370',
    lineHeight: 18,
  },
  recoveryActions: {
    flexDirection: 'row',
    gap: 8,
  },
  recoverySecondary: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d9c9f5',
  },
  recoverySecondaryLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#3d1f7a',
  },
  recoveryPrimary: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#6f3bf5',
  },
  recoveryDisabled: {
    opacity: 0.45,
  },
  recoveryPrimaryLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#ffffff',
  },
});

export default App;
