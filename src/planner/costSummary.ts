import type {TimelineView} from '../timeline/eventLog';
import {estimateCostUsd, getModelPricing} from './pricing';
import type {PlanUsageProvider, TaskPlanSnapshot} from './types';

export type CostBucket = {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  planCount: number;
};

export type ProviderCost = CostBucket & {
  provider: PlanUsageProvider;
  friendlyName: string;
};

export type CostSummary = {
  allTime: CostBucket;
  last7Days: CostBucket;
  last30Days: CostBucket;
  byProvider: ProviderCost[];
  lastPlan:
    | {
        model: string;
        revisedAt: string;
        inputTokens: number;
        outputTokens: number;
        costUsd: number;
      }
    | null;
  firstPlanAt: string | null;
  pricedPlanCount: number;
  unpricedPlanCount: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const PROVIDER_DISPLAY: Record<PlanUsageProvider, string> = {
  gemini: 'Google Gemini',
  anthropic: 'Anthropic Claude',
};

export function computeCostSummary(timeline: TimelineView): CostSummary {
  const now = Date.now();
  const cutoff7 = now - 7 * DAY_MS;
  const cutoff30 = now - 30 * DAY_MS;

  const allTime = emptyBucket();
  const last7 = emptyBucket();
  const last30 = emptyBucket();
  const perProvider = new Map<PlanUsageProvider, CostBucket>();
  let firstPlanAt: string | null = null;
  let lastPlan: CostSummary['lastPlan'] = null;
  let pricedPlanCount = 0;
  let unpricedPlanCount = 0;

  for (const snapshot of timeline.planSnapshots) {
    const cost = snapshotCost(snapshot);
    if (firstPlanAt == null || snapshot.revisedAt < firstPlanAt) {
      firstPlanAt = snapshot.revisedAt;
    }
    addToBucket(allTime, cost);

    const ts = Date.parse(snapshot.revisedAt);
    if (Number.isFinite(ts) && ts >= cutoff7) addToBucket(last7, cost);
    if (Number.isFinite(ts) && ts >= cutoff30) addToBucket(last30, cost);

    if (cost.provider != null) {
      const existing = perProvider.get(cost.provider) ?? emptyBucket();
      addToBucket(existing, cost);
      perProvider.set(cost.provider, existing);
    }

    // Only count "unpriced" when usage data exists but pricing isn't known.
    // Plans without usage metadata aren't charged — don't flag them.
    if (cost.priced) pricedPlanCount += 1;
    else if (snapshot.usage != null) unpricedPlanCount += 1;

    if (snapshot.usage != null) {
      lastPlan = {
        model: snapshot.model,
        revisedAt: snapshot.revisedAt,
        inputTokens: snapshot.usage.inputTokens,
        outputTokens: snapshot.usage.outputTokens,
        costUsd: cost.costUsd,
      };
    }
  }

  const byProvider: ProviderCost[] = Array.from(perProvider.entries())
    .map(([provider, bucket]) => ({
      provider,
      friendlyName: PROVIDER_DISPLAY[provider],
      ...bucket,
    }))
    .sort((a, b) => b.costUsd - a.costUsd);

  return {
    allTime,
    last7Days: last7,
    last30Days: last30,
    byProvider,
    lastPlan,
    firstPlanAt,
    pricedPlanCount,
    unpricedPlanCount,
  };
}

type SnapshotCost = {
  provider: PlanUsageProvider | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  priced: boolean;
};

function snapshotCost(snapshot: TaskPlanSnapshot): SnapshotCost {
  if (snapshot.usage == null) {
    return {
      provider: null,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      priced: false,
    };
  }
  const inputTokens = snapshot.usage.inputTokens;
  const outputTokens = snapshot.usage.outputTokens;
  const pricing = getModelPricing(snapshot.model);
  return {
    provider: snapshot.usage.provider,
    inputTokens,
    outputTokens,
    costUsd: estimateCostUsd(snapshot.model, inputTokens, outputTokens),
    priced: pricing != null,
  };
}

function emptyBucket(): CostBucket {
  return {inputTokens: 0, outputTokens: 0, costUsd: 0, planCount: 0};
}

function addToBucket(bucket: CostBucket, cost: SnapshotCost): void {
  bucket.inputTokens += cost.inputTokens;
  bucket.outputTokens += cost.outputTokens;
  bucket.costUsd += cost.costUsd;
  bucket.planCount += 1;
}
