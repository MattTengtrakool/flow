import { OBSERVATION_ACTIVITY_TYPES } from '../observation/types';
import type { CalendarContext } from '../calendar/types';
import type {
  CondensedObservationEntry,
  PlanUsage,
  TaskPlanSnapshot,
} from './types';

export const MAX_SOURCE_OBSERVATIONS_PER_BLOCK = 40;

export const WORKLOG_LABELS = [
  'worked_on',
  'reviewed',
  'drafted',
  'likely_completed',
  'confirmed_completed',
] as const;

export const CATEGORY_VALUES = [
  ...OBSERVATION_ACTIVITY_TYPES,
  'other',
] as const;

export type ReplanInput = {
  windowStartAt: string;
  windowEndAt: string;
  clusters: CondensedObservationEntry[];
  previousSnapshot: TaskPlanSnapshot | null;
  calendarContext?: CalendarContext;
  correctionHints?: Array<{
    blockId: string;
    sourceObservationIds: string[];
    title?: string;
    category?: string;
    markedWrong?: boolean;
    feedback?: string;
    mergeWithBlockId?: string;
    splitAt?: string;
  }>;
  apiKey?: string;
  model?: string;
};

export type ReplanRawBlock = {
  startAt: string;
  endAt: string;
  headline: string;
  narrative: string;
  notes?: string;
  label: (typeof WORKLOG_LABELS)[number];
  category: (typeof CATEGORY_VALUES)[number];
  confidence: number;
  keyActivities: string[];
  nextActions?: string[];
  calendarEventIds?: string[];
  artifacts: {
    apps: string[];
    repositories: string[];
    urls: string[];
    tickets: string[];
    documents: string[];
    people: string[];
  };
  reasonCodes: string[];
  sourceObservationIds: string[];
};

export type ParsedReplanBlock = Omit<ReplanRawBlock, 'sourceObservationIds'> & {
  sourceClusterIds: string[];
};

export type ReplanResult = {
  blocks: ReplanRawBlock[];
  model: string;
  promptVersion: string;
  durationMs: number;
  usage?: PlanUsage;
};
