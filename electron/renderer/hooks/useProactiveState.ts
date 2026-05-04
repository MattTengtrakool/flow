import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  DEFAULT_PROACTIVE_SETTINGS,
  type ProactiveState,
} from '../../../src/proactive/types';
import type { FlowElectronApi } from '../../shared/flowApi';

const EMPTY_PROACTIVE_STATE: ProactiveState = {
  enabled: false,
  companionEnabled: false,
  quieted: false,
  settings: DEFAULT_PROACTIVE_SETTINGS,
  insights: [],
  activeInsight: null,
};

export function useProactiveState(flow: FlowElectronApi | undefined) {
  const [state, setState] = useState<ProactiveState>(EMPTY_PROACTIVE_STATE);

  const refresh = useCallback(async () => {
    if (flow == null) return EMPTY_PROACTIVE_STATE;
    const next = await flow.proactive.getState();
    setState(next);
    return next;
  }, [flow]);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  useEffect(() => {
    if (flow == null) return;
    const subscription = flow.proactive.addStateListener(setState);
    return () => subscription.remove();
  }, [flow]);

  const dismiss = useCallback(
    async (insightId: string) => {
      if (flow == null) return EMPTY_PROACTIVE_STATE;
      const next = await flow.proactive.dismiss(insightId);
      setState(next);
      return next;
    },
    [flow],
  );

  const snooze = useCallback(
    async (insightId: string, minutes = 10) => {
      if (flow == null) return EMPTY_PROACTIVE_STATE;
      const next = await flow.proactive.snooze(insightId, minutes);
      setState(next);
      return next;
    },
    [flow],
  );

  const action = useCallback(
    async (insightId: string, actionId: string) => {
      if (flow == null) return EMPTY_PROACTIVE_STATE;
      const next = await flow.proactive.action(insightId, actionId);
      setState(next);
      return next;
    },
    [flow],
  );

  return useMemo(
    () => ({
      ...state,
      action,
      dismiss,
      refresh,
      snooze,
    }),
    [action, dismiss, refresh, snooze, state],
  );
}
