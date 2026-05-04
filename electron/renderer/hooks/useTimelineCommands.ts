import { useCallback } from 'react';

import type { TimelineUiState } from '../types';

export function useTimelineCommands(timelineStore: TimelineUiState) {
  const captureNow = useCallback(() => {
    timelineStore.runCaptureNow().catch(() => {});
  }, [timelineStore]);

  const replanNow = useCallback(() => {
    timelineStore.runPlannerRevisionNow(true).catch(() => {});
  }, [timelineStore]);

  return {
    captureNow,
    replanNow,
  };
}
