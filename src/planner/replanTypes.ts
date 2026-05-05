import { PREFERRED_OBSERVATION_ACTIVITY_TYPES } from '../observation/types';
import type { CalendarContext } from '../calendar/types';
import type {
  CondensedObservationEntry,
  PlanUsage,
  TaskPlanSnapshot,
} from './types';
import type { WorkCategoryOption } from '../workCategories';

export const MAX_SOURCE_OBSERVATIONS_PER_BLOCK = 40;

export const WORKLOG_LABELS = [
  'worked_on',
  'reviewed',
  'drafted',
  'likely_completed',
  'confirmed_completed',
] as const;

export const CATEGORY_VALUES = [
  ...PREFERRED_OBSERVATION_ACTIVITY_TYPES,
  'coding',
  'review',
  'planning',
  'other',
] as const;

export const PREFERRED_CATEGORY_VALUES = PREFERRED_OBSERVATION_ACTIVITY_TYPES;

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
  customCategories?: WorkCategoryOption[];
  apiKey?: string;
  model?: string;
};

export type ReplanRawBlock = {
  taskKey?: string;
  lineageKey?: string;
  startAt: string;
  endAt: string;
  headline: string;
  narrative: string;
  notes?: string;
  label: (typeof WORKLOG_LABELS)[number];
  category: (typeof CATEGORY_VALUES)[number] | (string & {});
  confidence: number;
  keyActivities: string[];
  nextActions?: string[];
  calendarEventIds?: string[];
  artifacts: {
    apps: string[];
    projects?: string[];
    tasks?: string[];
    repositories: string[];
    urls: string[];
    tickets: string[];
    documents: string[];
    people: string[];
  };
  reasonCodes: string[];
  backgroundObservationIds?: string[];
  assignmentReason?: string;
  timeConfidence?: number;
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
