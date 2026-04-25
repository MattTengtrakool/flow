import type {PlanUsageProvider} from './types';

export type ModelPricing = {
  inputPerMillion: number;
  outputPerMillion: number;
  provider: PlanUsageProvider;
  friendlyName: string;
};

const PRICING_TABLE: Array<{match: RegExp; pricing: ModelPricing}> = [
  {
    match: /^gemini-2\.5-flash-lite/i,
    pricing: {
      inputPerMillion: 0.075,
      outputPerMillion: 0.3,
      provider: 'gemini',
      friendlyName: 'Gemini 2.5 Flash-Lite',
    },
  },
  {
    match: /^gemini-2\.5-flash/i,
    pricing: {
      inputPerMillion: 0.3,
      outputPerMillion: 2.5,
      provider: 'gemini',
      friendlyName: 'Gemini 2.5 Flash',
    },
  },
  {
    match: /^gemini-2\.5-pro/i,
    pricing: {
      inputPerMillion: 1.25,
      outputPerMillion: 10,
      provider: 'gemini',
      friendlyName: 'Gemini 2.5 Pro',
    },
  },
  {
    match: /^gemini-1\.5-flash/i,
    pricing: {
      inputPerMillion: 0.075,
      outputPerMillion: 0.3,
      provider: 'gemini',
      friendlyName: 'Gemini 1.5 Flash',
    },
  },
  // Claude Opus 4.5+ — reduced pricing vs Opus 4/4.1
  {
    match: /^claude-opus-4-(?:[5-9]|1\d)(?:\b|[-_])/i,
    pricing: {
      inputPerMillion: 5,
      outputPerMillion: 25,
      provider: 'anthropic',
      friendlyName: 'Claude Opus 4.5+',
    },
  },
  // Claude Opus 4 / 4.1 — legacy premium pricing
  {
    match: /^claude-opus-4(?:-[0-4])?(?:\b|[-_])/i,
    pricing: {
      inputPerMillion: 15,
      outputPerMillion: 75,
      provider: 'anthropic',
      friendlyName: 'Claude Opus 4.1',
    },
  },
  // Claude Opus 3 (legacy / deprecated)
  {
    match: /^(?:claude-opus-3|claude-3-opus)/i,
    pricing: {
      inputPerMillion: 15,
      outputPerMillion: 75,
      provider: 'anthropic',
      friendlyName: 'Claude Opus 3',
    },
  },
  // Claude Sonnet 4.x (4, 4.5, 4.6)
  {
    match: /^claude-sonnet-4/i,
    pricing: {
      inputPerMillion: 3,
      outputPerMillion: 15,
      provider: 'anthropic',
      friendlyName: 'Claude Sonnet 4.5',
    },
  },
  // Claude Sonnet 3.5 / 3.7 (older naming: claude-3-5-sonnet, claude-3-7-sonnet)
  {
    match: /^claude-3-(?:5|7)-sonnet/i,
    pricing: {
      inputPerMillion: 3,
      outputPerMillion: 15,
      provider: 'anthropic',
      friendlyName: 'Claude Sonnet 3.7',
    },
  },
  // Claude Sonnet 3 (legacy)
  {
    match: /^(?:claude-sonnet-3|claude-3-sonnet)/i,
    pricing: {
      inputPerMillion: 3,
      outputPerMillion: 15,
      provider: 'anthropic',
      friendlyName: 'Claude Sonnet 3',
    },
  },
  // Claude Haiku 4.5
  {
    match: /^claude-haiku-4/i,
    pricing: {
      inputPerMillion: 1,
      outputPerMillion: 5,
      provider: 'anthropic',
      friendlyName: 'Claude Haiku 4.5',
    },
  },
  // Claude Haiku 3.5 (both naming schemes)
  {
    match: /^(?:claude-haiku-3-5|claude-3-5-haiku)/i,
    pricing: {
      inputPerMillion: 0.8,
      outputPerMillion: 4,
      provider: 'anthropic',
      friendlyName: 'Claude Haiku 3.5',
    },
  },
  // Claude Haiku 3
  {
    match: /^(?:claude-haiku-3|claude-3-haiku)/i,
    pricing: {
      inputPerMillion: 0.25,
      outputPerMillion: 1.25,
      provider: 'anthropic',
      friendlyName: 'Claude Haiku 3',
    },
  },
];

export function getModelPricing(model: string): ModelPricing | null {
  for (const {match, pricing} of PRICING_TABLE) {
    if (match.test(model)) return pricing;
  }
  return null;
}

export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = getModelPricing(model);
  if (pricing == null) return 0;
  return (
    (inputTokens / 1_000_000) * pricing.inputPerMillion +
    (outputTokens / 1_000_000) * pricing.outputPerMillion
  );
}

export function formatUsd(amount: number): string {
  if (amount === 0) return '$0.00';
  if (amount < 0.01) return `< $0.01`;
  if (amount < 10) return `$${amount.toFixed(3)}`;
  if (amount < 100) return `$${amount.toFixed(2)}`;
  return `$${Math.round(amount).toLocaleString()}`;
}

export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}K`;
  return `${(count / 1_000_000).toFixed(2)}M`;
}
