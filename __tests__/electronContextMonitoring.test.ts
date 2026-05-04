import {
  computeContextChangeReasons,
  createFallbackSnapshot,
} from '../electron/main/capture/contextMonitor';

describe('Electron context monitoring', () => {
  test('marks the first snapshot as initial', () => {
    const snapshot = createFallbackSnapshot(true);

    expect(computeContextChangeReasons(null, snapshot)).toEqual(['initial']);
  });

  test('computes meaningful change reasons between snapshots', () => {
    const previous = {
      ...createFallbackSnapshot(true),
      appName: 'Cursor',
      bundleIdentifier: 'com.cursor',
      processId: 1,
      windowTitle: 'A',
      windowFrame: { x: 0, y: 0, width: 100, height: 100 },
      accessibilityTrusted: false,
      captureAccessGranted: false,
      isIdle: false,
      source: 'app' as const,
    };
    const next = {
      ...previous,
      appName: 'Chrome',
      bundleIdentifier: 'com.google.Chrome',
      processId: 2,
      windowTitle: 'B',
      windowFrame: { x: 10, y: 0, width: 100, height: 100 },
      accessibilityTrusted: true,
      captureAccessGranted: true,
      isIdle: true,
      source: 'window' as const,
    };

    expect(computeContextChangeReasons(previous, next)).toEqual([
      'frontmostApplication',
      'bundleIdentifier',
      'processId',
      'windowTitle',
      'windowFrame',
      'source',
      'idleState',
      'accessibilityPermission',
      'screenCapturePermission',
    ]);
  });

  test('returns no changes for equivalent snapshots', () => {
    const snapshot = createFallbackSnapshot(true);

    expect(computeContextChangeReasons(snapshot, { ...snapshot })).toEqual([]);
  });
});
