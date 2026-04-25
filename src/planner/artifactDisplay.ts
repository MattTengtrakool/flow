const FILE_EXTENSION_RE = /\.[\w]{1,6}$/;
const BREADCRUMB_SEPARATOR_RE = / [-|·›»] /;

export function displayArtifact(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return trimmed;

  if (looksLikeFilePath(trimmed)) {
    const parts = trimmed.split('/').filter(segment => segment.length > 0);
    if (parts.length >= 2) {
      return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
    }
    return parts[parts.length - 1] ?? trimmed;
  }

  if (trimmed.length > 24 && BREADCRUMB_SEPARATOR_RE.test(trimmed)) {
    const firstSegment = trimmed.split(BREADCRUMB_SEPARATOR_RE)[0]?.trim();
    if (firstSegment != null && firstSegment.length >= 4) {
      return firstSegment;
    }
  }

  return trimmed;
}

export function looksLikeFilePath(value: string): boolean {
  if (!value.includes('/')) return false;
  return FILE_EXTENSION_RE.test(value);
}

export function looksLikeWindowChrome(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return true;
  if (looksLikeFilePath(trimmed)) return false;
  if (/^https?:\/\//i.test(trimmed)) return false;
  if (/^[A-Z]+-\d+$/.test(trimmed)) return false; // ticket IDs like POS-2221

  const segments = trimmed.split(BREADCRUMB_SEPARATOR_RE).map(s => s.trim());
  if (segments.length < 2) return false;

  // Heuristic: multi-segment breadcrumbs with generic calendar/tab labels.
  const chromeKeywords = new Set([
    'calendar',
    'inbox',
    'dashboard',
    'home',
    'week',
    'month',
    'day',
    'today',
    'launch',
    'updates',
    'notifications',
    'settings',
  ]);
  const lowered = segments.map(segment => segment.toLowerCase());
  const hasChromeKeyword = lowered.some(segment =>
    Array.from(chromeKeywords).some(keyword => segment.includes(keyword)),
  );
  const looksLikeDomain = /\b[a-z0-9-]+\.(com|io|dev|ai|app|co)\b/i.test(trimmed);
  return hasChromeKeyword && (looksLikeDomain || segments.length >= 3);
}

export function dedupeArtifactsCaseInsensitive(values: string[]): string[] {
  const chosen = new Map<string, string>();
  for (const raw of values) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    const key = trimmed.toLowerCase();
    const existing = chosen.get(key);
    if (existing == null) {
      chosen.set(key, trimmed);
      continue;
    }
    if (prefersCandidate(trimmed, existing)) {
      chosen.set(key, trimmed);
    }
  }
  return Array.from(chosen.values());
}

function prefersCandidate(candidate: string, current: string): boolean {
  const candidateMixed = hasMixedCase(candidate);
  const currentMixed = hasMixedCase(current);
  if (candidateMixed && !currentMixed) return true;
  if (!candidateMixed && currentMixed) return false;
  return candidate.length < current.length;
}

function hasMixedCase(value: string): boolean {
  let hasUpper = false;
  let hasLower = false;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (char >= 'A' && char <= 'Z') hasUpper = true;
    else if (char >= 'a' && char <= 'z') hasLower = true;
    if (hasUpper && hasLower) return true;
  }
  return false;
}
