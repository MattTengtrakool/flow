import {NativeEventEmitter, NativeModules} from 'react-native';

import type {
  CaptureInspectionPayload,
  CaptureResultPayload,
  ContextSnapshotPayload,
  PermissionsStatus,
} from '../types/contextCapture';

type MonitoringOptions = {
  preciseModeEnabled: boolean;
  idleThresholdSeconds: number;
};

type ContextCaptureModule = {
  startMonitoring: (options: MonitoringOptions) => Promise<ContextSnapshotPayload>;
  stopMonitoring: () => Promise<void>;
  setPreciseModeEnabled: (enabled: boolean) => Promise<ContextSnapshotPayload>;
  requestAccessibilityPrompt: () => Promise<PermissionsStatus>;
  getPermissionsStatus: () => Promise<PermissionsStatus>;
  requestScreenCaptureAccess: () => Promise<PermissionsStatus>;
  inspectCaptureTarget: () => Promise<CaptureInspectionPayload>;
  captureNow: () => Promise<CaptureResultPayload>;
};

const nativeModule = NativeModules.ContextCaptureModule as
  | ContextCaptureModule
  | undefined;

const emitter =
  nativeModule != null ? new NativeEventEmitter(nativeModule as never) : null;

function createFallbackSnapshot(
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

export function addContextSnapshotListener(
  listener: (snapshot: ContextSnapshotPayload) => void,
): {remove: () => void} {
  if (emitter == null) {
    return {
      remove() {},
    };
  }

  return emitter.addListener('contextSnapshotDidChange', listener);
}

export async function startContextMonitoring(
  options: MonitoringOptions,
): Promise<ContextSnapshotPayload> {
  if (nativeModule?.startMonitoring != null) {
    return nativeModule.startMonitoring(options);
  }

  return createFallbackSnapshot(options.preciseModeEnabled);
}

export async function stopContextMonitoring(): Promise<void> {
  if (nativeModule?.stopMonitoring != null) {
    await nativeModule.stopMonitoring();
  }
}

export async function setNativePreciseModeEnabled(
  enabled: boolean,
): Promise<ContextSnapshotPayload> {
  if (nativeModule?.setPreciseModeEnabled != null) {
    return nativeModule.setPreciseModeEnabled(enabled);
  }

  return createFallbackSnapshot(enabled);
}

export async function requestAccessibilityPrompt(): Promise<PermissionsStatus> {
  if (nativeModule?.requestAccessibilityPrompt != null) {
    return nativeModule.requestAccessibilityPrompt();
  }

  return {
    accessibilityTrusted: false,
    captureAccessGranted: false,
    hostBundleIdentifier: null,
    hostBundlePath: null,
  };
}

export async function getPermissionsStatus(): Promise<PermissionsStatus> {
  if (nativeModule?.getPermissionsStatus != null) {
    return nativeModule.getPermissionsStatus();
  }

  return {
    accessibilityTrusted: false,
    captureAccessGranted: false,
    hostBundleIdentifier: null,
    hostBundlePath: null,
  };
}

export async function requestScreenCaptureAccess(): Promise<PermissionsStatus> {
  if (nativeModule?.requestScreenCaptureAccess != null) {
    return nativeModule.requestScreenCaptureAccess();
  }

  return {
    accessibilityTrusted: false,
    captureAccessGranted: false,
    hostBundleIdentifier: null,
    hostBundlePath: null,
  };
}

export async function inspectCaptureTarget(): Promise<CaptureInspectionPayload> {
  if (nativeModule?.inspectCaptureTarget != null) {
    return nativeModule.inspectCaptureTarget();
  }

  return {
    inspectedAt: new Date().toISOString(),
    context: createFallbackSnapshot(),
    captureAccessGranted: false,
    chosenTargetType: 'none',
    confidence: 0,
    fallbackReason: 'Native capture bridge unavailable in this environment.',
    chosenTarget: null,
    candidates: [],
  };
}

export async function captureNow(): Promise<CaptureResultPayload> {
  if (nativeModule?.captureNow != null) {
    return nativeModule.captureNow();
  }

  return {
    inspection: await inspectCaptureTarget(),
    metadata: {
      capturedAt: new Date().toISOString(),
      status: 'error',
      targetType: 'none',
      appName: null,
      bundleIdentifier: null,
      processId: null,
      windowId: null,
      windowTitle: null,
      displayId: null,
      confidence: 0,
      width: null,
      height: null,
      frameHash: null,
      errorMessage: 'Native capture bridge unavailable in this environment.',
      previewByteLength: 0,
    },
    previewBase64: null,
    previewMimeType: null,
  };
}
