import type {ObservationView, TimelineView} from '../timeline/eventLog';
import type {MeetingDetectionResult} from './types';

const PROMPT_COOLDOWN_MS = 45 * 60 * 1000;
const ACTIVE_WINDOW_MS = 15 * 60 * 1000;
const DETECTION_SOURCE_FRESH_MS = 45 * 1000;
const MEETING_OBSERVATION_FRESH_MS = 2 * 60 * 1000;
const PROMPT_THRESHOLD = 0.72;

type DetectionSource = {
  appName: string | null;
  bundleIdentifier: string | null;
  windowTitle: string | null;
  observedAt: string;
  sourceEventId: string | null;
};

const MEETING_APP_PATTERNS = [
  /zoom/i,
  /microsoft teams/i,
  /\bteams\b/i,
  /google chrome/i,
  /safari/i,
  /slack/i,
  /facetime/i,
  /webex/i,
  /discord/i,
];

const MEETING_BUNDLE_PATTERNS = [
  /zoom/i,
  /teams/i,
  /slack/i,
  /facetime/i,
  /webex/i,
  /discord/i,
  /chrome/i,
  /safari/i,
];

const MEETING_TITLE_PATTERNS = [
  /google meet/i,
  /^meet\b/i,
  /meet\.google\.com/i,
  /\bzoom meeting\b/i,
  /\bzoom\b/i,
  /microsoft teams/i,
  /\bteams meeting\b/i,
  /\bcall\b/i,
  /\bhuddle\b/i,
  /camera and microphone recording/i,
  /facetime/i,
  /webex/i,
  /discord.*(voice|call)/i,
];

export function detectMeetingCandidate(args: {
  timeline: TimelineView;
  createMeetingId: () => string;
  now?: string;
}): MeetingDetectionResult | null {
  const sources = getRecentDetectionSources(args.timeline);
  if (sources.length === 0) return null;

  const now =
    args.now ??
    sources.reduce((latest, source) =>
      Date.parse(source.observedAt) > Date.parse(latest) ? source.observedAt : latest,
    sources[0].observedAt);
  const nowMs = Date.parse(now);
  const freshSources = sources.filter(source => {
    const observedMs = Date.parse(source.observedAt);
    return (
      Number.isFinite(observedMs) &&
      Number.isFinite(nowMs) &&
      nowMs - observedMs <= DETECTION_SOURCE_FRESH_MS
    );
  });

  const match =
    freshSources
      .map(source => ({
        source,
        scored: scoreSource(source, args.timeline),
      }))
      .filter(entry => entry.scored.confidence >= PROMPT_THRESHOLD)
      .sort((a, b) => {
        const confidenceDelta = b.scored.confidence - a.scored.confidence;
        if (Math.abs(confidenceDelta) > 0.001) return confidenceDelta;
        return Date.parse(b.source.observedAt) - Date.parse(a.source.observedAt);
      })[0] ?? null;
  if (match == null) return null;

  const {source, scored} = match;
  const signature = meetingSignature(source);
  const reusable = findReusableCandidate(args.timeline, signature, now);
  if (reusable != null) {
    return {
      candidate: {
        ...reusable,
        status:
          reusable.status === 'dismissed' || reusable.status === 'ended'
            ? reusable.status
            : 'prompted',
        updatedAt: now,
        appName: source.appName,
        bundleIdentifier: source.bundleIdentifier,
        windowTitle: source.windowTitle,
        confidence: Math.max(reusable.confidence, scored.confidence),
        reasonCodes: Array.from(
          new Set([...reusable.reasonCodes, ...scored.reasonCodes]),
        ),
        sourceEventIds:
          source.sourceEventId == null
            ? reusable.sourceEventIds
            : Array.from(
                new Set([...reusable.sourceEventIds, source.sourceEventId]),
              ),
      },
      shouldPrompt: reusable.status === 'candidate',
    };
  }

  if (wasDismissedRecently(args.timeline, signature, now)) return null;

  return {
    candidate: {
      meetingId: args.createMeetingId(),
      sessionId: args.timeline.currentSessionId,
      status: 'candidate',
      detectedAt: now,
      updatedAt: now,
      promptShownAt: null,
      dismissedAt: null,
      endedAt: null,
      recordingId: null,
      appName: source.appName,
      bundleIdentifier: source.bundleIdentifier,
      windowTitle: source.windowTitle,
      confidence: scored.confidence,
      reasonCodes: scored.reasonCodes,
      sourceEventIds: source.sourceEventId == null ? [] : [source.sourceEventId],
    },
    shouldPrompt: true,
  };
}

function getRecentDetectionSources(timeline: TimelineView): DetectionSource[] {
  const candidates: DetectionSource[] = [];
  for (let i = timeline.contextSnapshotOrder.length - 1; i >= 0; i -= 1) {
    const context = timeline.contextSnapshotsById[timeline.contextSnapshotOrder[i]];
    if (context == null) continue;
    candidates.push({
      appName: context.appName,
      bundleIdentifier: context.bundleIdentifier,
      windowTitle: context.windowTitle,
      observedAt: context.recordedAt,
      sourceEventId: context.id,
    });
  }

  for (let i = timeline.captureRecordOrder.length - 1; i >= 0; i -= 1) {
    const capture = timeline.captureRecordsById[timeline.captureRecordOrder[i]];
    if (capture == null || capture.capture.status !== 'captured') continue;
    candidates.push({
      appName: capture.capture.appName,
      bundleIdentifier: capture.capture.bundleIdentifier,
      windowTitle: capture.capture.windowTitle,
      observedAt: capture.capturedAt,
      sourceEventId: capture.id,
    });
  }

  for (let i = timeline.observationOrder.length - 1; i >= 0; i -= 1) {
    const observation = timeline.observationsById[timeline.observationOrder[i]];
    if (observation?.structured == null) continue;
    candidates.push({
      appName: observation.structured.entities.apps[0] ?? null,
      bundleIdentifier: null,
      windowTitle: observation.structured.taskHypothesis,
      observedAt: observation.observedAt,
      sourceEventId: observation.id,
    });
  }

  return candidates
    .filter(candidate => Number.isFinite(Date.parse(candidate.observedAt)))
    .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
}

function scoreSource(source: DetectionSource, timeline: TimelineView) {
  const reasonCodes: string[] = [];
  let score = 0;

  if (matchesAny(source.appName, MEETING_APP_PATTERNS)) {
    score += 0.28;
    reasonCodes.push('meeting_app');
  }
  if (matchesAny(source.bundleIdentifier, MEETING_BUNDLE_PATTERNS)) {
    score += 0.22;
    reasonCodes.push('meeting_bundle');
  }
  if (matchesAny(source.windowTitle, MEETING_TITLE_PATTERNS)) {
    score += 0.45;
    reasonCodes.push('meeting_window_title');
  }

  const latestObservation =
    timeline.observationOrder.length === 0
      ? null
      : timeline.observationsById[
          timeline.observationOrder[timeline.observationOrder.length - 1]
        ];
  if (
    latestObservation != null &&
    shouldUseMeetingObservationSignal(latestObservation, source)
  ) {
    score += 0.35;
    reasonCodes.push('meeting_observation');
  }

  if (source.windowTitle != null && /recording|live captions|participants/i.test(source.windowTitle)) {
    score += 0.12;
    reasonCodes.push('meeting_ui');
  }

  return {
    confidence: Math.min(1, score),
    reasonCodes: Array.from(new Set(reasonCodes)),
  };
}

function shouldUseMeetingObservationSignal(
  observation: ObservationView,
  source: DetectionSource,
): boolean {
  if (observation.structured?.activityType !== 'meeting') return false;
  if (source.sourceEventId === observation.id) return true;

  const observedMs = Date.parse(observation.observedAt);
  const sourceMs = Date.parse(source.observedAt);
  if (
    !Number.isFinite(observedMs) ||
    !Number.isFinite(sourceMs) ||
    Math.abs(sourceMs - observedMs) > MEETING_OBSERVATION_FRESH_MS
  ) {
    return false;
  }

  return (
    matchesAny(source.windowTitle, MEETING_TITLE_PATTERNS) ||
    (isDedicatedMeetingApp(source) &&
      observation.structured.entities.apps.some(app =>
        sameLooseName(app, source.appName),
      ))
  );
}

function isDedicatedMeetingApp(source: DetectionSource): boolean {
  return matchesAny(source.appName, [
    /zoom/i,
    /microsoft teams/i,
    /\bteams\b/i,
    /facetime/i,
    /webex/i,
    /discord/i,
  ]);
}

function sameLooseName(left: string | null, right: string | null): boolean {
  const normalizedLeft = normalizeSignaturePart(left);
  const normalizedRight = normalizeSignaturePart(right);
  return (
    normalizedLeft.length > 0 &&
    normalizedRight.length > 0 &&
    (normalizedLeft === normalizedRight ||
      normalizedLeft.includes(normalizedRight) ||
      normalizedRight.includes(normalizedLeft))
  );
}

function matchesAny(value: string | null, patterns: RegExp[]): boolean {
  if (value == null) return false;
  return patterns.some(pattern => pattern.test(value));
}

function findReusableCandidate(
  timeline: TimelineView,
  signature: string,
  now: string,
) {
  const nowMs = Date.parse(now);
  for (let i = timeline.meetingCandidateOrder.length - 1; i >= 0; i -= 1) {
    const candidate =
      timeline.meetingCandidatesById[timeline.meetingCandidateOrder[i]];
    if (candidate == null) continue;
    if (meetingSignature(candidate) !== signature) continue;
    if (nowMs - Date.parse(candidate.updatedAt) > ACTIVE_WINDOW_MS) continue;
    if (candidate.status === 'recording' || candidate.status === 'prompted') {
      return candidate;
    }
    if (candidate.status === 'candidate') return candidate;
  }
  return null;
}

function wasDismissedRecently(
  timeline: TimelineView,
  signature: string,
  now: string,
): boolean {
  const nowMs = Date.parse(now);
  for (let i = timeline.meetingCandidateOrder.length - 1; i >= 0; i -= 1) {
    const candidate =
      timeline.meetingCandidatesById[timeline.meetingCandidateOrder[i]];
    if (candidate == null || candidate.dismissedAt == null) continue;
    if (meetingSignature(candidate) !== signature) continue;
    if (nowMs - Date.parse(candidate.dismissedAt) <= PROMPT_COOLDOWN_MS) {
      return true;
    }
  }
  return false;
}

function meetingSignature(source: {
  appName: string | null;
  bundleIdentifier: string | null;
  windowTitle: string | null;
}): string {
  return [
    normalizeSignaturePart(source.bundleIdentifier ?? source.appName),
    normalizeSignaturePart(source.windowTitle),
  ].join('|');
}

function normalizeSignaturePart(value: string | null): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\b\d{1,2}:\d{2}\b/g, '')
    .trim();
}
