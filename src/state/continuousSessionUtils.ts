export type ContinuousCaptureDecision =
  | 'observe'
  | 'skip_duplicate'
  | 'skip_busy';

export function evaluateContinuousCaptureDecision(args: {
  captureStatus: string;
  didChange: boolean;
  frameHash: string | null;
  lastObservedFrameHash: string | null;
  observationInFlight: boolean;
}): ContinuousCaptureDecision | null {
  if (args.captureStatus !== 'captured' || !args.didChange) {
    return null;
  }

  if (
    args.frameHash != null &&
    args.lastObservedFrameHash != null &&
    args.frameHash === args.lastObservedFrameHash
  ) {
    return 'skip_duplicate';
  }

  if (args.observationInFlight) {
    return 'skip_busy';
  }

  return 'observe';
}

export function coalesceQueuedContinuousObservation<T>(
  _current: T | null,
  next: T,
): T {
  return next;
}

export function shouldAutoPauseContinuousMode(
  consecutiveFailures: number,
  threshold = 3,
): boolean {
  return consecutiveFailures >= threshold;
}
