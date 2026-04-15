import type {
  CaptureInspectionPayload,
  CaptureMetadataPayload,
  CaptureTargetSummary,
  ContextSnapshotPayload,
} from '../types/contextCapture';
import type {ObservationRun, StructuredObservation} from '../observation/types';

const REDACTED = '[redacted]';

const INLINE_SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+\b/gi, '$1[redacted-token]'],
  [
    /\b((?:password|passcode|secret|api[_ -]?key|access[_ -]?token|refresh[_ -]?token)\s*[:=]\s*)(\S+)/gi,
    '$1[redacted]',
  ],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]'],
  [/\b(?:\d[ -]*?){13,19}\b/g, '[redacted-card]'],
  [/\b\d{3}-\d{2}-\d{4}\b/g, '[redacted-ssn]'],
  [/(?<!\w)\+?\d[\d\s().-]{7,}\d/g, '[redacted-phone]'],
  [
    /\b(?:sk-[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z\-_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
    '[redacted-token]',
  ],
  [
    /((?:[?&]|^)(?:token|key|password|secret|code)=)[^&\s]+/gi,
    '$1[redacted]',
  ],
];

export function redactSensitiveText(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }

  let nextValue = value;

  for (const [pattern, replacement] of INLINE_SECRET_PATTERNS) {
    nextValue = nextValue.replace(pattern, replacement);
  }

  return nextValue;
}

export function hasCapturePrivacyScreening(
  metadata:
    | Pick<CaptureMetadataPayload, 'status' | 'privacyRedaction'>
    | null
    | undefined,
): boolean {
  if (metadata == null) {
    return false;
  }

  return (
    metadata.status !== 'captured' || metadata.privacyRedaction?.checked === true
  );
}

function sanitizeCaptureTargetSummary(
  target: CaptureTargetSummary | null,
): CaptureTargetSummary | null {
  if (target == null) {
    return null;
  }

  return {
    ...target,
    bundleIdentifier: null,
    processId: null,
    windowId: null,
    windowTitle: redactSensitiveText(target.windowTitle),
  };
}

export function sanitizeContextSnapshot(
  snapshot: ContextSnapshotPayload | null,
): ContextSnapshotPayload | null {
  if (snapshot == null) {
    return null;
  }

  return {
    ...snapshot,
    hostBundleIdentifier: null,
    hostBundlePath: null,
    bundleIdentifier: null,
    processId: null,
    windowTitle: redactSensitiveText(snapshot.windowTitle),
  };
}

export function sanitizeCaptureMetadata(
  metadata: CaptureMetadataPayload,
): CaptureMetadataPayload {
  return {
    ...metadata,
    bundleIdentifier: null,
    processId: null,
    windowId: null,
    windowTitle: redactSensitiveText(metadata.windowTitle),
  };
}

export function sanitizeInspection(
  inspection: CaptureInspectionPayload,
): CaptureInspectionPayload {
  return {
    ...inspection,
    context: sanitizeContextSnapshot(inspection.context)!,
    fallbackReason: redactSensitiveText(inspection.fallbackReason),
    chosenTarget: sanitizeCaptureTargetSummary(inspection.chosenTarget),
    candidates: [],
  };
}

function sanitizeStringList(values: string[]): string[] {
  return values.map(value => redactSensitiveText(value) ?? REDACTED);
}

export function sanitizeStructuredObservation(
  observation: StructuredObservation,
): StructuredObservation {
  return {
    ...observation,
    summary: redactSensitiveText(observation.summary) ?? REDACTED,
    taskHypothesis: redactSensitiveText(observation.taskHypothesis),
    sensitivityReason: redactSensitiveText(observation.sensitivityReason) ?? REDACTED,
    artifacts: sanitizeStringList(observation.artifacts),
    entities: {
      apps: sanitizeStringList(observation.entities.apps),
      documents: sanitizeStringList(observation.entities.documents),
      tickets: sanitizeStringList(observation.entities.tickets),
      repos: sanitizeStringList(observation.entities.repos),
      urls: sanitizeStringList(observation.entities.urls),
      people: sanitizeStringList(observation.entities.people),
    },
    nextAction: redactSensitiveText(observation.nextAction),
  };
}

export function sanitizeObservationRun(run: ObservationRun): ObservationRun {
  return {
    ...run,
    observation: sanitizeStructuredObservation(run.observation),
  };
}

export function sanitizeObservationSummary(summary: string): string {
  return redactSensitiveText(summary) ?? REDACTED;
}
