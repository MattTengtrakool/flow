import {
  coalesceQueuedContinuousObservation,
  evaluateContinuousCaptureDecision,
  shouldAutoPauseContinuousMode,
} from '../src/state/continuousSessionUtils';

describe('continuous session mode utilities', () => {
  test('marks identical observed frame as duplicate', () => {
    expect(
      evaluateContinuousCaptureDecision({
        captureStatus: 'captured',
        didChange: true,
        frameHash: 'abc123',
        lastObservedFrameHash: 'abc123',
        observationInFlight: false,
      }),
    ).toBe('skip_duplicate');
  });

  test('coalesces to the latest queued capture while observation is busy', () => {
    const initial = {frameHash: 'first'};
    const next = {frameHash: 'latest'};

    expect(coalesceQueuedContinuousObservation(initial, next)).toEqual(next);
  });

  test('returns observe for a changed capture when idle', () => {
    expect(
      evaluateContinuousCaptureDecision({
        captureStatus: 'captured',
        didChange: true,
        frameHash: 'new_hash',
        lastObservedFrameHash: 'old_hash',
        observationInFlight: false,
      }),
    ).toBe('observe');
  });

  test('auto-pauses after repeated failures', () => {
    expect(shouldAutoPauseContinuousMode(2)).toBe(false);
    expect(shouldAutoPauseContinuousMode(3)).toBe(true);
  });
});
