export type TaskTitleArtifacts = {
  tickets?: readonly string[];
  repositories?: readonly string[];
  urls?: readonly string[];
  documents?: readonly string[];
};

type RepairTaskTitleArgs = {
  title: string | null | undefined;
  artifacts?: TaskTitleArtifacts;
  keyActivities?: readonly string[];
  fallback?: string;
  preferAnchors?: boolean;
};

const ACTIVITY_GERUNDS = [
  'reviewing',
  'debugging',
  'troubleshooting',
  'configuring',
  'developing',
  'refactoring',
  'implementing',
  'writing',
  'testing',
  'managing',
  'setting',
  'handling',
  'working',
  'investigating',
  'resolving',
  'browsing',
  'coding',
  'planning',
  'preparing',
  'updating',
  'fixing',
  'building',
  'checking',
  'reading',
  'monitoring',
  'researching',
  'drafting',
  'deploying',
  'syncing',
  'triaging',
  'analyzing',
  'running',
  'joining',
  'discussing',
  'confirming',
  'completing',
  'communicating',
];

const ACTIVITY_PATTERN = ACTIVITY_GERUNDS.join('|');
const GERUND_PREFIX_RE = new RegExp(`^(?:${ACTIVITY_PATTERN})\\b`, 'i');
const ACTIVITY_CHAIN_PREFIX_RE = new RegExp(
  `^(?:${ACTIVITY_PATTERN})(?:\\s+(?:and|&)\\s+(?:${ACTIVITY_PATTERN}))*\\s+`,
  'i',
);
const TWO_ACTIVITIES_RE = new RegExp(
  `^(?:${ACTIVITY_PATTERN})\\s+(?:&|and)\\s+(?:${ACTIVITY_PATTERN})\\b`,
  'i',
);
const GENERIC_ALONE_RE =
  /^(?:workflow|workflows|environment|config|configuration|setup|updates|code|changes|work|working|task|miscellaneous)(?:\s|$)/i;

export function isWellFormedTaskHeadline(headline: string): boolean {
  const trimmed = headline.trim();
  if (trimmed.length === 0) return false;
  if (GERUND_PREFIX_RE.test(trimmed)) return false;
  if (TWO_ACTIVITIES_RE.test(trimmed)) return false;
  if (GENERIC_ALONE_RE.test(trimmed)) return false;
  return true;
}

export function repairTaskTitle(args: RepairTaskTitleArgs): string {
  const rawTitle = normalizeTitleCandidate(args.title);
  if (rawTitle != null && isWellFormedTaskHeadline(rawTitle)) {
    return rawTitle;
  }

  const anchored = synthesizeTaskTitleFromArtifacts(args);
  if (args.preferAnchors === true && anchored != null) {
    return anchored;
  }

  const stripped = rawTitle != null ? stripActivityPrefix(rawTitle) : null;
  if (stripped != null && isWellFormedTaskHeadline(stripped)) {
    return stripped;
  }

  if (anchored != null) {
    return anchored;
  }

  return args.fallback ?? stripped ?? rawTitle ?? 'Active task';
}

export function synthesizeTaskTitleFromArtifacts(
  args: RepairTaskTitleArgs,
): string | null {
  const artifacts = args.artifacts;
  if (artifacts == null) return null;

  const topic = guessShortTopic(args.title, args.keyActivities);
  const ticket = firstValue(artifacts.tickets);
  if (ticket != null) {
    return topic != null ? `${ticket}: ${topic}` : ticket;
  }

  const pr = firstPrNumber(artifacts.urls ?? []);
  if (pr != null) {
    return topic != null ? `${topic} (PR ${pr})` : `PR ${pr}`;
  }

  const document = artifacts.documents?.find(isDistinctiveDocument);
  if (document != null) {
    return titleFromDocument(document);
  }

  const repo = firstValue(artifacts.repositories);
  if (repo != null) {
    return topic != null ? `${repo}: ${topic}` : repo;
  }

  const host = firstUrlHost(artifacts.urls ?? []);
  if (host != null) {
    return topic != null ? `${host}: ${topic}` : host;
  }

  return null;
}

function normalizeTitleCandidate(
  value: string | null | undefined,
): string | null {
  if (value == null) return null;
  const trimmed = value
    .replace(/\s+/g, ' ')
    .replace(/[.:;,\s]+$/g, '')
    .trim();
  return trimmed.length > 0 ? trimmed : null;
}

function stripActivityPrefix(value: string): string | null {
  let candidate = value
    .replace(/^work(?:ing)?\s+(?:on|in)\s+/i, '')
    .replace(/^setting\s+up\s+/i, '')
    .replace(ACTIVITY_CHAIN_PREFIX_RE, '')
    .replace(/^(?:a|an|the)\s+/i, '')
    .trim();

  candidate = candidate
    .replace(
      /\s+(?:as indicated by|as shown by|as seen in|by|via|through|using|while|after|before|during|to)\b.*$/i,
      '',
    )
    .replace(/\s+(?:that|which|where)\b.*$/i, '')
    .replace(/\s+(?:encountered|displayed|shown)\b.*$/i, '')
    .replace(/^(?:a|an|the)\s+/i, '')
    .replace(/[.:;,\s]+$/g, '')
    .trim();

  candidate = shortenNounPhrase(candidate);
  return candidate.length > 0 ? candidate : null;
}

function shortenNounPhrase(value: string): string {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length <= 9) return value;

  const cutIndex = words.findIndex(
    (word, index) =>
      index >= 4 &&
      /^(?:by|via|through|using|while|during|with|for|from|after|before|to)$/i.test(
        word,
      ),
  );
  if (cutIndex >= 4) {
    return words.slice(0, cutIndex).join(' ');
  }
  return words.slice(0, 9).join(' ');
}

function guessShortTopic(
  rawTitle: string | null | undefined,
  keyActivities: readonly string[] | undefined,
): string | null {
  const strippedTitle = rawTitle != null ? stripActivityPrefix(rawTitle) : null;
  if (
    strippedTitle != null &&
    strippedTitle.length <= 48 &&
    isWellFormedTaskHeadline(strippedTitle)
  ) {
    return strippedTitle;
  }

  const activity = keyActivities?.find(value => value.trim().length > 0);
  if (activity == null) return null;

  const strippedActivity = stripActivityPrefix(activity) ?? activity.trim();
  const candidate = normalizeTitleCandidate(strippedActivity);
  if (candidate == null || candidate.length > 48) return null;
  return candidate;
}

function firstValue(values: readonly string[] | undefined): string | null {
  const value = values?.find(candidate => candidate.trim().length > 0);
  return value?.trim() ?? null;
}

function firstPrNumber(urls: readonly string[]): string | null {
  for (const url of urls) {
    const match = /\bpull\/(\d{2,7})\b/i.exec(url);
    if (match != null) return `#${match[1]}`;
  }
  return null;
}

function firstUrlHost(urls: readonly string[]): string | null {
  for (const value of urls) {
    try {
      const host = new URL(value).hostname.replace(/^www\./i, '');
      if (host.length > 0) return host;
    } catch {
      continue;
    }
  }
  return null;
}

function isDistinctiveDocument(path: string): boolean {
  const basename = path.split('/').pop() ?? path;
  if (/^package(-lock)?\.json$/i.test(basename)) return false;
  if (/^(readme|changelog|license)/i.test(basename)) return false;
  if (!/\.[a-z0-9]{1,6}$/i.test(basename) && !path.includes('/')) {
    return false;
  }
  return true;
}

function titleFromDocument(path: string): string {
  const basename = path.split('/').pop() ?? path;
  if (/\.(md|markdown|txt|docx?|pdf|pptx?|xlsx?)$/i.test(basename)) {
    return basename;
  }

  const stem = basename.replace(/\.[a-z0-9]{1,6}$/i, '');
  const humanStem = humanizeIdentifier(stem);
  return humanStem.length > 0 ? humanStem : basename;
}

function humanizeIdentifier(value: string): string {
  const spaced = value
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  if (spaced.length === 0) return value;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
