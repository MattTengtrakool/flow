import type {ObservationView} from '../timeline/eventLog';
import type {
  ObservationActivityType,
  StructuredObservation,
} from '../observation/types';
import type {CondensedObservationEntry} from './types';

const DEFAULT_GAP_MS = 3 * 60 * 1000;

type ClusterDraft = {
  earliestAt: string;
  latestAt: string;
  earliestMs: number;
  latestMs: number;
  occurrenceCount: number;
  taskHypothesis: string | null;
  activityType: ObservationActivityType;
  sourceObservationIds: string[];
  summaries: string[];
  nextActions: Set<string>;
  apps: Set<string>;
  repositories: Set<string>;
  urls: Set<string>;
  tickets: Set<string>;
  documents: Set<string>;
  people: Set<string>;
};

export type CondenseObservationsOptions = {
  maxEntries?: number;
  adjacencyGapMs?: number;
  maxRepresentativeSummaries?: number;
};

export function condenseObservations(
  observations: ObservationView[],
  options: CondenseObservationsOptions = {},
): CondensedObservationEntry[] {
  const maxEntries = options.maxEntries ?? 50;
  const adjacencyGapMs = options.adjacencyGapMs ?? DEFAULT_GAP_MS;
  const maxRepresentativeSummaries = options.maxRepresentativeSummaries ?? 3;

  const structured = observations
    .filter(observation => observation.deletedAt == null)
    .filter((observation): observation is ObservationView & {structured: StructuredObservation} =>
      observation.structured != null,
    )
    .slice()
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt));

  const drafts: ClusterDraft[] = [];

  for (const observation of structured) {
    const current = drafts[drafts.length - 1];
    const observedMs = Date.parse(observation.observedAt);

    if (current != null && canMerge(current, observation, observedMs, adjacencyGapMs)) {
      extendDraft(current, observation, observedMs);
    } else {
      drafts.push(createDraft(observation, observedMs));
    }
  }

  const compacted = compactDrafts(drafts, maxEntries);

  return compacted.map<CondensedObservationEntry>((draft, index) => ({
    clusterId: `c${index}`,
    earliestAt: draft.earliestAt,
    latestAt: draft.latestAt,
    occurrenceCount: draft.occurrenceCount,
    taskHypothesis: draft.taskHypothesis,
    activityType: draft.activityType,
    representativeSummaries: pickRepresentativeSummaries(
      draft.summaries,
      maxRepresentativeSummaries,
    ),
    nextActions: Array.from(draft.nextActions).slice(0, 3),
    artifacts: {
      apps: Array.from(draft.apps).slice(0, 8),
      repositories: Array.from(draft.repositories).slice(0, 8),
      urls: Array.from(draft.urls).slice(0, 8),
      tickets: Array.from(draft.tickets).slice(0, 8),
      documents: Array.from(draft.documents).slice(0, 8),
      people: Array.from(draft.people).slice(0, 8),
    },
    sourceObservationIds: sampleObservationIds(
      draft.sourceObservationIds,
      MAX_SOURCE_IDS_PER_CLUSTER,
    ),
  }));
}

const MAX_SOURCE_IDS_PER_CLUSTER = 80;

function sampleObservationIds(ids: string[], max: number): string[] {
  if (ids.length <= max) return ids;
  const result: string[] = [];
  const step = (ids.length - 1) / (max - 1);
  for (let i = 0; i < max; i += 1) {
    result.push(ids[Math.round(i * step)]);
  }
  return result;
}

export {sampleObservationIds};

function canMerge(
  current: ClusterDraft,
  observation: ObservationView & {structured: StructuredObservation},
  observedMs: number,
  adjacencyGapMs: number,
): boolean {
  if (observedMs - current.latestMs > adjacencyGapMs) {
    return false;
  }

  if (current.activityType !== observation.structured.activityType) {
    return false;
  }

  const currentHypothesis = normalize(current.taskHypothesis);
  const nextHypothesis = normalize(observation.structured.taskHypothesis);
  if (currentHypothesis !== nextHypothesis) {
    return false;
  }

  const firstRepoSignal = observation.structured.entities.repos[0] ?? null;
  const firstAppSignal = observation.structured.entities.apps[0] ?? null;
  if (firstRepoSignal != null && !current.repositories.has(firstRepoSignal)) {
    if (current.repositories.size > 0) {
      return false;
    }
  }
  if (
    firstRepoSignal == null &&
    firstAppSignal != null &&
    current.apps.size > 0 &&
    !current.apps.has(firstAppSignal)
  ) {
    return false;
  }

  return true;
}

function createDraft(
  observation: ObservationView & {structured: StructuredObservation},
  observedMs: number,
): ClusterDraft {
  const summary = observation.structured.summary.trim();
  const nextActions = new Set<string>();
  if (
    observation.structured.nextAction != null &&
    observation.structured.nextAction.trim().length > 0
  ) {
    nextActions.add(observation.structured.nextAction.trim());
  }

  return {
    earliestAt: observation.observedAt,
    latestAt: observation.observedAt,
    earliestMs: observedMs,
    latestMs: observedMs,
    occurrenceCount: 1,
    taskHypothesis:
      observation.structured.taskHypothesis?.trim().length != null &&
      (observation.structured.taskHypothesis?.trim().length ?? 0) > 0
        ? observation.structured.taskHypothesis!.trim()
        : null,
    activityType: observation.structured.activityType,
    sourceObservationIds: [observation.id],
    summaries: summary.length > 0 ? [summary] : [],
    nextActions,
    apps: new Set(observation.structured.entities.apps),
    repositories: new Set(observation.structured.entities.repos),
    urls: new Set(observation.structured.entities.urls),
    tickets: new Set(observation.structured.entities.tickets),
    documents: new Set(observation.structured.entities.documents),
    people: new Set(observation.structured.entities.people),
  };
}

function extendDraft(
  draft: ClusterDraft,
  observation: ObservationView & {structured: StructuredObservation},
  observedMs: number,
): void {
  draft.latestAt = observation.observedAt;
  draft.latestMs = observedMs;
  draft.occurrenceCount += 1;
  draft.sourceObservationIds.push(observation.id);

  const summary = observation.structured.summary.trim();
  if (summary.length > 0 && !draft.summaries.includes(summary)) {
    draft.summaries.push(summary);
  }

  if (
    observation.structured.nextAction != null &&
    observation.structured.nextAction.trim().length > 0
  ) {
    draft.nextActions.add(observation.structured.nextAction.trim());
  }

  for (const value of observation.structured.entities.apps) {
    draft.apps.add(value);
  }
  for (const value of observation.structured.entities.repos) {
    draft.repositories.add(value);
  }
  for (const value of observation.structured.entities.urls) {
    draft.urls.add(value);
  }
  for (const value of observation.structured.entities.tickets) {
    draft.tickets.add(value);
  }
  for (const value of observation.structured.entities.documents) {
    draft.documents.add(value);
  }
  for (const value of observation.structured.entities.people) {
    draft.people.add(value);
  }
}

function compactDrafts(drafts: ClusterDraft[], maxEntries: number): ClusterDraft[] {
  if (drafts.length <= maxEntries) {
    return drafts;
  }

  const working = drafts.slice();
  while (working.length > maxEntries) {
    let smallestIndex = 0;
    let smallestCombinedSize = Infinity;
    for (let i = 0; i < working.length - 1; i += 1) {
      const combined = working[i].occurrenceCount + working[i + 1].occurrenceCount;
      if (combined < smallestCombinedSize) {
        smallestCombinedSize = combined;
        smallestIndex = i;
      }
    }

    const left = working[smallestIndex];
    const right = working[smallestIndex + 1];
    const merged = mergeDrafts(left, right);
    working.splice(smallestIndex, 2, merged);
  }

  return working;
}

function mergeDrafts(left: ClusterDraft, right: ClusterDraft): ClusterDraft {
  const summaries = left.summaries.slice();
  for (const summary of right.summaries) {
    if (!summaries.includes(summary)) {
      summaries.push(summary);
    }
  }

  return {
    earliestAt: left.earliestAt,
    latestAt: right.latestAt,
    earliestMs: left.earliestMs,
    latestMs: right.latestMs,
    occurrenceCount: left.occurrenceCount + right.occurrenceCount,
    taskHypothesis: left.taskHypothesis ?? right.taskHypothesis,
    activityType: left.activityType,
    sourceObservationIds: [...left.sourceObservationIds, ...right.sourceObservationIds],
    summaries,
    nextActions: new Set([...left.nextActions, ...right.nextActions]),
    apps: new Set([...left.apps, ...right.apps]),
    repositories: new Set([...left.repositories, ...right.repositories]),
    urls: new Set([...left.urls, ...right.urls]),
    tickets: new Set([...left.tickets, ...right.tickets]),
    documents: new Set([...left.documents, ...right.documents]),
    people: new Set([...left.people, ...right.people]),
  };
}

function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function pickRepresentativeSummaries(
  summaries: string[],
  max: number,
): string[] {
  if (summaries.length <= max) {
    return summaries;
  }

  const picked: string[] = [];
  const seenPrefixes = new Set<string>();
  for (const summary of summaries) {
    const prefix = summary.slice(0, 32).toLowerCase();
    if (seenPrefixes.has(prefix)) {
      continue;
    }
    seenPrefixes.add(prefix);
    picked.push(summary);
    if (picked.length >= max) {
      break;
    }
  }

  if (picked.length < max) {
    for (const summary of summaries) {
      if (!picked.includes(summary)) {
        picked.push(summary);
      }
      if (picked.length >= max) {
        break;
      }
    }
  }

  return picked;
}
