import type { ContextSnapshotPayload } from '../../../src/types/contextCapture';

function rectChanged(
  previous: ContextSnapshotPayload['windowFrame'],
  next: ContextSnapshotPayload['windowFrame'],
): boolean {
  if (previous == null || next == null) {
    return previous !== next;
  }
  return (
    previous.x !== next.x ||
    previous.y !== next.y ||
    previous.width !== next.width ||
    previous.height !== next.height
  );
}

export function createFallbackSnapshot(
  preciseModeEnabled = false,
): ContextSnapshotPayload {
  return {
    hostBundleIdentifier: null,
    hostBundlePath: null,
    appName: null,
    bundleIdentifier: null,
    processId: null,
    windowTitle: null,
    windowFrame: null,
    source: 'app',
    preciseModeEnabled,
    accessibilityTrusted: false,
    captureAccessGranted: false,
    isIdle: false,
    idleSeconds: 0,
    changeReasons: ['fallback'],
    recordedAt: new Date().toISOString(),
  };
}

export function computeContextChangeReasons(
  previous: ContextSnapshotPayload | null,
  next: ContextSnapshotPayload,
): string[] {
  if (previous == null) return ['initial'];
  const reasons: string[] = [];
  if (previous.appName !== next.appName) reasons.push('frontmostApplication');
  if (previous.bundleIdentifier !== next.bundleIdentifier) {
    reasons.push('bundleIdentifier');
  }
  if (previous.processId !== next.processId) reasons.push('processId');
  if (previous.windowTitle !== next.windowTitle) reasons.push('windowTitle');
  if (rectChanged(previous.windowFrame, next.windowFrame)) {
    reasons.push('windowFrame');
  }
  if (previous.source !== next.source) reasons.push('source');
  if (previous.isIdle !== next.isIdle) reasons.push('idleState');
  if (previous.accessibilityTrusted !== next.accessibilityTrusted) {
    reasons.push('accessibilityPermission');
  }
  if (previous.captureAccessGranted !== next.captureAccessGranted) {
    reasons.push('screenCapturePermission');
  }
  return reasons;
}
