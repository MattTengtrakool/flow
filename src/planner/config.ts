export type PlannerConfig = {
  worklogCalendarEnabled: boolean;
  plannerRevisionIntervalMs: number;
  plannerRevisionWindowMs: number;
  plannerRetrospectiveWindowMs: number;
  plannerRevisionMaxObservationsInPrompt: number;
  plannerRevisionFailureRetryMs: number;
  plannerRevisionSessionStartDelayMs: number;
};

export const PLANNER_CONFIG: PlannerConfig = {
  worklogCalendarEnabled: true,
  plannerRevisionIntervalMs: 10 * 60 * 1000,
  plannerRevisionWindowMs: 6 * 60 * 60 * 1000,
  plannerRetrospectiveWindowMs: 60 * 60 * 1000,
  plannerRevisionMaxObservationsInPrompt: 50,
  plannerRevisionFailureRetryMs: 2 * 60 * 1000,
  plannerRevisionSessionStartDelayMs: 90 * 1000,
};
