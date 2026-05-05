import { startTransition, useCallback, useEffect, useMemo, useState } from 'react';

import type {
  CalendarEventAnnotationPatch,
  CalendarEventBlockLinkAction,
  CalendarSourceMode,
  CalendarStatePayload,
  TaskFitSuggestion,
} from '../../../src/calendar/types';
import type { FlowElectronApi } from '../../shared/flowApi';

export const EMPTY_CALENDAR_STATE: CalendarStatePayload = {
  accounts: [],
  sources: [],
  events: [],
  annotations: [],
  scheduledItems: [],
  taskFitSuggestions: [],
  status: 'idle',
  errorMessage: null,
  lastSyncedAt: null,
  oauthClientConfigured: false,
};

export function useCalendarState(flow: FlowElectronApi | undefined) {
  const [state, setState] =
    useState<CalendarStatePayload>(EMPTY_CALENDAR_STATE);

  const refresh = useCallback(async () => {
    if (flow == null) return EMPTY_CALENDAR_STATE;
    const next = await flow.calendar.getState();
    setState(next);
    return next;
  }, [flow]);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  useEffect(() => {
    if (flow == null) return;
    const subscription = flow.calendar.addStateListener(next => {
      startTransition(() => {
        setState(next);
      });
    });
    return () => subscription.remove();
  }, [flow]);

  const connectGoogleAccount = useCallback(async () => {
    if (flow == null) return EMPTY_CALENDAR_STATE;
    const next = await flow.calendar.connectGoogleAccount();
    setState(next);
    return next;
  }, [flow]);

  const disconnectGoogleAccount = useCallback(
    async (accountId: string) => {
      if (flow == null) return EMPTY_CALENDAR_STATE;
      const next = await flow.calendar.disconnectGoogleAccount(accountId);
      setState(next);
      return next;
    },
    [flow],
  );

  const syncNow = useCallback(async () => {
    if (flow == null) return EMPTY_CALENDAR_STATE;
    const next = await flow.calendar.syncNow();
    setState(next);
    return next;
  }, [flow]);

  const updateCalendarSelection = useCallback(
    async (accountId: string, calendarId: string, enabled: boolean) => {
      if (flow == null) return EMPTY_CALENDAR_STATE;
      const next = await flow.calendar.updateCalendarSelection(
        accountId,
        calendarId,
        enabled,
      );
      setState(next);
      return next;
    },
    [flow],
  );

  const updateCalendarSourceMode = useCallback(
    async (accountId: string, calendarId: string, mode: CalendarSourceMode) => {
      if (flow == null) return EMPTY_CALENDAR_STATE;
      const next = await flow.calendar.updateCalendarSourceMode(
        accountId,
        calendarId,
        mode,
      );
      setState(next);
      return next;
    },
    [flow],
  );

  const updateEventAnnotation = useCallback(
    async (eventId: string, patch: CalendarEventAnnotationPatch) => {
      if (flow == null) return EMPTY_CALENDAR_STATE;
      const next = await flow.calendar.updateEventAnnotation(eventId, patch);
      setState(next);
      return next;
    },
    [flow],
  );

  const updateEventBlockLink = useCallback(
    async (
      eventId: string,
      blockId: string,
      action: CalendarEventBlockLinkAction,
    ) => {
      if (flow == null) return EMPTY_CALENDAR_STATE;
      const next = await flow.calendar.updateEventBlockLink(
        eventId,
        blockId,
        action,
      );
      setState(next);
      return next;
    },
    [flow],
  );

  const setTaskFitSuggestions = useCallback(
    (taskFitSuggestions: TaskFitSuggestion[]) => {
      setState(previous => ({ ...previous, taskFitSuggestions }));
    },
    [],
  );

  return useMemo(
    () => ({
      ...state,
      connectGoogleAccount,
      disconnectGoogleAccount,
      refresh,
      setTaskFitSuggestions,
      syncNow,
      updateCalendarSelection,
      updateCalendarSourceMode,
      updateEventAnnotation,
      updateEventBlockLink,
    }),
    [
      connectGoogleAccount,
      disconnectGoogleAccount,
      refresh,
      setTaskFitSuggestions,
      state,
      syncNow,
      updateCalendarSelection,
      updateCalendarSourceMode,
      updateEventAnnotation,
      updateEventBlockLink,
    ],
  );
}
