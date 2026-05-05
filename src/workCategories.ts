import { PREFERRED_OBSERVATION_ACTIVITY_TYPES } from './observation/types';

export type WorkCategoryOption = {
  value: (typeof PREFERRED_OBSERVATION_ACTIVITY_TYPES)[number] | (string & {});
  label: string;
  description: string;
};

export const WORK_CATEGORY_OPTIONS: WorkCategoryOption[] = [
  {
    value: 'software_development',
    label: 'Software development',
    description: 'Building or changing software behavior.',
  },
  {
    value: 'debugging',
    label: 'Debugging',
    description: 'Investigating or fixing a defect, failure, or incident.',
  },
  {
    value: 'qa_testing',
    label: 'QA / testing',
    description: 'Testing, validating, reproducing, or verifying work.',
  },
  {
    value: 'code_review',
    label: 'Code review',
    description: 'Reviewing code, diffs, PRs, or implementation feedback.',
  },
  {
    value: 'research',
    label: 'Research',
    description: 'Gathering information to answer an open question.',
  },
  {
    value: 'analysis',
    label: 'Analysis',
    description: 'Interpreting data, logs, metrics, reports, or evidence.',
  },
  {
    value: 'learning',
    label: 'Learning',
    description: 'Watching, reading, or practicing to learn a topic.',
  },
  {
    value: 'writing',
    label: 'Writing',
    description: 'Drafting original prose, notes, docs, or content.',
  },
  {
    value: 'document_review',
    label: 'Document review',
    description: 'Reviewing docs, decks, contracts, specs, or written work.',
  },
  {
    value: 'design',
    label: 'Design',
    description: 'Creating or refining visual, product, system, or content design.',
  },
  {
    value: 'communication',
    label: 'Communication',
    description: 'Email, chat, async updates, or coordination messages.',
  },
  {
    value: 'meeting',
    label: 'Meeting',
    description: 'Synchronous calls, meetings, interviews, or live discussions.',
  },
  {
    value: 'planning_strategy',
    label: 'Planning / strategy',
    description: 'Scoping, prioritizing, roadmap, strategy, or decision planning.',
  },
  {
    value: 'project_management',
    label: 'Project management',
    description: 'Tracking tasks, updating status, triage, scheduling, or coordination.',
  },
  {
    value: 'sales_customer',
    label: 'Sales / customer',
    description: 'Customer, prospect, account, support, renewal, or success work.',
  },
  {
    value: 'recruiting',
    label: 'Recruiting',
    description: 'Sourcing, interviewing, candidate review, or hiring coordination.',
  },
  {
    value: 'operations_admin',
    label: 'Operations / admin',
    description: 'Operational, compliance, account, setup, or administrative work.',
  },
  {
    value: 'finance',
    label: 'Finance',
    description: 'Invoices, billing, accounting, planning, or reconciliation.',
  },
  {
    value: 'browsing',
    label: 'Browsing',
    description: 'General browsing without a clearer work category.',
  },
  {
    value: 'file_management',
    label: 'File management',
    description: 'Organizing, moving, naming, exporting, or cleaning files.',
  },
  {
    value: 'other',
    label: 'Other',
    description: 'Use only when no specific category fits.',
  },
];

export function normalizeCustomCategoryValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}

export function normalizeWorkCategoryOption(
  option: Partial<WorkCategoryOption>,
): WorkCategoryOption | null {
  const label = option.label?.trim() ?? '';
  const value = normalizeCustomCategoryValue(option.value ?? label);
  if (label.length === 0 || value.length === 0) return null;
  return {
    value,
    label,
    description: option.description?.trim() ?? '',
  };
}

export function mergeWorkCategoryOptions(
  customCategories: readonly WorkCategoryOption[] | undefined,
): WorkCategoryOption[] {
  const byValue = new Map<string, WorkCategoryOption>();
  for (const option of WORK_CATEGORY_OPTIONS) {
    byValue.set(option.value, option);
  }
  for (const option of customCategories ?? []) {
    const normalized = normalizeWorkCategoryOption(option);
    if (normalized != null) byValue.set(normalized.value, normalized);
  }
  return Array.from(byValue.values());
}

export function categoryLabel(value: string | null | undefined): string {
  if (value === 'coding') return 'Software development';
  if (value === 'review') return 'Review';
  return (
    WORK_CATEGORY_OPTIONS.find(option => option.value === value)?.label ??
    (value ?? 'other').replace(/_/g, ' ')
  );
}
