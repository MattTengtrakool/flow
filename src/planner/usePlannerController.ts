import {startTransition, useEffect, useRef, useState, type MutableRefObject} from 'react';

import {
  createOccurredAt,
  type DomainEvent,
  type TimelineView,
} from '../timeline/eventLog';
import {useStableEvent} from '../timeline/useStableEvent';
import type {HydrationStatus} from '../timeline/useTimelinePersistence';
import {PLANNER_CONFIG} from './config';
import {runPlannerRevision, type RunPlannerRevisionResult} from './revisionEngine';
import type {
  PlannerRevisionCause,
  TaskPlanRevisionFailure,
} from './types';

export type PlannerRuntimeState = {
  enabled: boolean;
  inFlight: boolean;
  intervalMs: number;
  windowMs: number;
  maxObservationsInPrompt: number;
  lastRunAt: string | null;
  lastRunCause: PlannerRevisionCause | null;
  lastSnapshotId: string | null;
  lastBlockCount: number;
  lastPlanModel: string | null;
  lastFailure: TaskPlanRevisionFailure | null;
  lastSkippedReason: string | null;
  consecutiveFailureCount: number;
};

function createInitialPlannerState(): PlannerRuntimeState {
  return {
    enabled: true,
    inFlight: false,
    intervalMs: PLANNER_CONFIG.plannerRevisionIntervalMs,
    windowMs: PLANNER_CONFIG.plannerRevisionWindowMs,
    maxObservationsInPrompt: PLANNER_CONFIG.plannerRevisionMaxObservationsInPrompt,
    lastRunAt: null,
    lastRunCause: null,
    lastSnapshotId: null,
    lastBlockCount: 0,
    lastPlanModel: null,
    lastFailure: null,
    lastSkippedReason: null,
    consecutiveFailureCount: 0,
  };
}

export function usePlannerController(args: {
  timelineRef: MutableRefObject<TimelineView>;
  hydrationStatus: HydrationStatus;
  currentSessionId: string | null;
  appendEvents: (events: DomainEvent[]) => void;
}) {
  const [plannerRuntimeState, setPlannerRuntimeState] =
    useState<PlannerRuntimeState>(createInitialPlannerState);
  const plannerRevisionQueueRef = useRef(Promise.resolve());
  const plannerRevisionInFlightRef = useRef(false);
  const sessionStartTriggeredRef = useRef<string | null>(null);
  const sessionStartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const applyPlannerRevisionResult = useStableEvent(
    (result: RunPlannerRevisionResult, cause: PlannerRevisionCause) => {
      if (result.kind === 'skipped') {
        startTransition(() => {
          setPlannerRuntimeState(previous => ({
            ...previous,
            lastRunAt: createOccurredAt(),
            lastRunCause: cause,
            lastSkippedReason: result.reason,
          }));
        });
        return;
      }

      args.appendEvents(result.events);
      if (result.kind === 'success') {
        startTransition(() => {
          setPlannerRuntimeState(previous => ({
            ...previous,
            lastRunAt: result.snapshot.revisedAt,
            lastRunCause: cause,
            lastSnapshotId: result.snapshot.snapshotId,
            lastBlockCount: result.snapshot.blocks.length,
            lastPlanModel: result.snapshot.model,
            lastFailure: null,
            lastSkippedReason: null,
            consecutiveFailureCount: 0,
          }));
        });
      } else {
        startTransition(() => {
          setPlannerRuntimeState(previous => ({
            ...previous,
            lastRunAt: result.failure.failedAt,
            lastRunCause: cause,
            lastFailure: result.failure,
            lastSkippedReason: null,
            consecutiveFailureCount: previous.consecutiveFailureCount + 1,
          }));
        });
      }
    },
  );

  const runPlannerRevisionNow = useStableEvent(
    (request: {cause: PlannerRevisionCause; force?: boolean} = {cause: 'manual'}) => {
      const task = plannerRevisionQueueRef.current
        .catch(() => {})
        .then(async () => {
          if (plannerRevisionInFlightRef.current) return;
          plannerRevisionInFlightRef.current = true;
          startTransition(() => {
            setPlannerRuntimeState(previous => ({
              ...previous,
              inFlight: true,
            }));
          });
          try {
            const result = await runPlannerRevision({
              timeline: args.timelineRef.current,
              cause: request.cause,
              force: request.force === true,
              windowMs: PLANNER_CONFIG.plannerRevisionWindowMs,
              maxObservationsInPrompt:
                PLANNER_CONFIG.plannerRevisionMaxObservationsInPrompt,
            });
            applyPlannerRevisionResult(result, request.cause);
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : 'Planner crashed unexpectedly.';
            startTransition(() => {
              setPlannerRuntimeState(previous => ({
                ...previous,
                lastRunCause: request.cause,
                consecutiveFailureCount: previous.consecutiveFailureCount + 1,
                lastFailure: {
                  failedAt: createOccurredAt(),
                  cause: request.cause,
                  reason: 'engine_error',
                  message,
                  windowStartAt: new Date(
                    Date.now() - PLANNER_CONFIG.plannerRevisionWindowMs,
                  ).toISOString(),
                  windowEndAt: createOccurredAt(),
                  inputObservationCount: 0,
                  inputClusterCount: 0,
                },
              }));
            });
          } finally {
            plannerRevisionInFlightRef.current = false;
            startTransition(() => {
              setPlannerRuntimeState(previous => ({
                ...previous,
                inFlight: false,
              }));
            });
          }
        });
      plannerRevisionQueueRef.current = task;
      return task;
    },
  );

  const maybeKickoffSessionStartPlan = useStableEvent(() => {
    const sessionId = args.timelineRef.current.currentSessionId;
    if (sessionId == null || sessionStartTriggeredRef.current === sessionId) {
      return;
    }
    sessionStartTriggeredRef.current = sessionId;
    if (sessionStartTimeoutRef.current != null) {
      clearTimeout(sessionStartTimeoutRef.current);
    }
    sessionStartTimeoutRef.current = setTimeout(() => {
      sessionStartTimeoutRef.current = null;
      runPlannerRevisionNow({cause: 'session_start'}).catch(() => {});
    }, PLANNER_CONFIG.plannerRevisionSessionStartDelayMs);
  });

  function resetSessionStartPlan() {
    sessionStartTriggeredRef.current = null;
    if (sessionStartTimeoutRef.current != null) {
      clearTimeout(sessionStartTimeoutRef.current);
      sessionStartTimeoutRef.current = null;
    }
  }

  useEffect(() => {
    if (args.hydrationStatus !== 'ready' || args.currentSessionId == null) {
      return;
    }
    const intervalMs =
      plannerRuntimeState.consecutiveFailureCount > 0 &&
      plannerRuntimeState.lastFailure != null
        ? PLANNER_CONFIG.plannerRevisionFailureRetryMs
        : PLANNER_CONFIG.plannerRevisionIntervalMs;
    const intervalId = setInterval(() => {
      runPlannerRevisionNow({cause: 'cadence'}).catch(() => {});
    }, intervalMs);
    return () => clearInterval(intervalId);
  }, [
    args.currentSessionId,
    args.hydrationStatus,
    plannerRuntimeState.consecutiveFailureCount,
    plannerRuntimeState.lastFailure,
    runPlannerRevisionNow,
  ]);

  return {
    plannerRuntimeState,
    runPlannerRevisionNow,
    maybeKickoffSessionStartPlan,
    resetSessionStartPlan,
  };
}
