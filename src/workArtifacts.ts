export type WorkArtifactSource = {
  projects?: readonly string[];
  tasks?: readonly string[];
  repositories?: readonly string[];
  repos?: readonly string[];
  tickets?: readonly string[];
  taskIds?: readonly string[];
};

const LOW_SIGNAL_ARTIFACTS = new Set([
  'github',
  'git',
  'push',
  'commit',
  'commits',
  'branch',
  'branches',
  'auth',
  'login',
  'localhost',
]);

function clean(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function uniqueWorkArtifacts(
  values: Array<readonly string[] | undefined>,
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const list of values) {
    for (const value of list ?? []) {
      const artifact = clean(value);
      if (artifact == null) continue;
      const key = artifact.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(artifact);
    }
  }

  return result;
}

export function normalizeProjects(source: WorkArtifactSource): string[] {
  return uniqueWorkArtifacts([
    source.projects,
    source.repositories,
    source.repos,
  ]);
}

export function normalizeTasks(source: WorkArtifactSource): string[] {
  return uniqueWorkArtifacts([source.tasks, source.taskIds, source.tickets]);
}

export function isLowSignalWorkArtifact(value: string): boolean {
  const trimmed = value.trim();
  const normalized = trimmed.toLowerCase();
  if (trimmed.length === 0) return true;
  if (LOW_SIGNAL_ARTIFACTS.has(normalized)) return true;
  if (/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/i.test(trimmed)) {
    return true;
  }
  if (/^#\d{2,7}$/.test(trimmed)) return true;
  return false;
}

export function presentableWorkArtifacts(
  source: WorkArtifactSource & {
    documents?: readonly string[];
    urls?: readonly string[];
  },
): string[] {
  const primary = uniqueWorkArtifacts([
    source.projects,
    source.tasks,
    source.documents,
  ]).filter(value => !isLowSignalWorkArtifact(value));

  if (primary.length > 0) return primary;

  return uniqueWorkArtifacts([
    source.repositories,
    source.repos,
    source.tickets,
    source.taskIds,
    source.urls,
  ]).filter(value => !isLowSignalWorkArtifact(value));
}
