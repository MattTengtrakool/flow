import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { app } from 'electron';

import type {
  CaptureInspectionPayload,
  CaptureResultPayload,
  ContextSnapshotPayload,
  PermissionsStatus,
} from '../../../src/types/contextCapture';
import {
  computeContextChangeReasons,
  createFallbackSnapshot,
} from './contextMonitor';

export type MonitoringOptions = {
  preciseModeEnabled: boolean;
  idleThresholdSeconds: number;
};

export type NativeCaptureEvents = {
  contextSnapshotDidChange: [ContextSnapshotPayload];
};

const execFileAsync = promisify(execFile);
const CONTEXT_MONITOR_INTERVAL_MS = 1000;

function nativeCaptureHelperPath(): string {
  if (app.isPackaged) {
    return path.join(
      process.resourcesPath,
      'native-capture',
      'FlowNativeCapture',
    );
  }
  return path.join(
    app.getAppPath(),
    'electron',
    'native-capture',
    'build',
    'FlowNativeCapture',
  );
}

async function callNativeHelper<T>(
  command: string,
  options?: MonitoringOptions,
): Promise<T | null> {
  const helperPath = nativeCaptureHelperPath();
  if (!existsSync(helperPath)) {
    return null;
  }

  const args = options == null ? [command] : [command, JSON.stringify(options)];
  const { stdout } = await execFileAsync(helperPath, args, {
    maxBuffer: 8 * 1024 * 1024,
  });
  const firstLine = stdout.trim().split('\n')[0];
  if (firstLine == null || firstLine.length === 0) {
    throw new Error(
      `Native capture helper returned no payload for ${command}.`,
    );
  }
  const parsed = JSON.parse(firstLine) as unknown;
  if (
    parsed != null &&
    typeof parsed === 'object' &&
    'error' in parsed &&
    typeof parsed.error === 'string'
  ) {
    throw new Error(parsed.error);
  }
  return parsed as T;
}

function fallbackPermissions(): PermissionsStatus {
  return {
    accessibilityTrusted: false,
    captureAccessGranted: false,
    hostBundleIdentifier: null,
    hostBundlePath: null,
  };
}

/**
 * Boundary for the production macOS helper. The helper is intentionally isolated
 * from the renderer so the Electron app can preserve ScreenCaptureKit, Vision,
 * and Accessibility behavior without exposing native process control over IPC.
 */
export class NativeCaptureClient extends EventEmitter<NativeCaptureEvents> {
  private preciseModeEnabled = false;
  private idleThresholdSeconds = 60;
  private monitorTimer: NodeJS.Timeout | null = null;
  private lastSnapshot: ContextSnapshotPayload | null = null;
  private polling = false;

  private currentOptions(): MonitoringOptions {
    return {
      preciseModeEnabled: this.preciseModeEnabled,
      idleThresholdSeconds: this.idleThresholdSeconds,
    };
  }

  async startMonitoring(
    options: MonitoringOptions,
  ): Promise<ContextSnapshotPayload> {
    this.preciseModeEnabled = options.preciseModeEnabled;
    this.idleThresholdSeconds = options.idleThresholdSeconds;
    const snapshot =
      (await callNativeHelper<ContextSnapshotPayload>(
        'startMonitoring',
        this.currentOptions(),
      )) ?? createFallbackSnapshot(this.preciseModeEnabled);
    const reasons = computeContextChangeReasons(this.lastSnapshot, snapshot);
    const initialSnapshot = { ...snapshot, changeReasons: reasons };
    this.lastSnapshot = initialSnapshot;
    this.ensureMonitoringTimer();
    return initialSnapshot;
  }

  async stopMonitoring(): Promise<void> {
    if (this.monitorTimer != null) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
    this.polling = false;
  }

  async setPreciseModeEnabled(
    enabled: boolean,
  ): Promise<ContextSnapshotPayload> {
    this.preciseModeEnabled = enabled;
    const snapshot =
      (await callNativeHelper<ContextSnapshotPayload>(
        'setPreciseModeEnabled',
        this.currentOptions(),
      )) ?? createFallbackSnapshot(enabled);
    const changed = {
      ...snapshot,
      changeReasons: computeContextChangeReasons(this.lastSnapshot, snapshot),
    };
    this.lastSnapshot = changed;
    this.emit('contextSnapshotDidChange', changed);
    return changed;
  }

  private ensureMonitoringTimer() {
    if (this.monitorTimer != null) return;
    this.monitorTimer = setInterval(() => {
      this.pollContextSnapshot().catch(() => {});
    }, CONTEXT_MONITOR_INTERVAL_MS);
  }

  private async pollContextSnapshot() {
    if (this.polling) return;
    this.polling = true;
    try {
      const snapshot =
        (await callNativeHelper<ContextSnapshotPayload>(
          'currentContextSnapshot',
          this.currentOptions(),
        )) ?? createFallbackSnapshot(this.preciseModeEnabled);
      const changeReasons = computeContextChangeReasons(
        this.lastSnapshot,
        snapshot,
      );
      if (changeReasons.length === 0) return;
      const changedSnapshot = { ...snapshot, changeReasons };
      this.lastSnapshot = changedSnapshot;
      this.emit('contextSnapshotDidChange', changedSnapshot);
    } finally {
      this.polling = false;
    }
  }

  async requestAccessibilityPrompt(): Promise<PermissionsStatus> {
    return (
      (await callNativeHelper<PermissionsStatus>(
        'requestAccessibilityPrompt',
      )) ?? fallbackPermissions()
    );
  }

  async getPermissionsStatus(): Promise<PermissionsStatus> {
    return (
      (await callNativeHelper<PermissionsStatus>('getPermissionsStatus')) ??
      fallbackPermissions()
    );
  }

  async requestScreenCaptureAccess(): Promise<PermissionsStatus> {
    return (
      (await callNativeHelper<PermissionsStatus>(
        'requestScreenCaptureAccess',
      )) ?? fallbackPermissions()
    );
  }

  async inspectCaptureTarget(): Promise<CaptureInspectionPayload> {
    const helperResult = await callNativeHelper<CaptureInspectionPayload>(
      'inspectCaptureTarget',
      this.currentOptions(),
    );
    if (helperResult != null) {
      return helperResult;
    }
    return {
      inspectedAt: new Date().toISOString(),
      context: createFallbackSnapshot(this.preciseModeEnabled),
      captureAccessGranted: false,
      chosenTargetType: 'none',
      confidence: 0,
      fallbackReason:
        'Native capture helper is not bundled yet for this Electron build.',
      chosenTarget: null,
      candidates: [],
    };
  }

  async captureNow(): Promise<CaptureResultPayload> {
    const helperResult = await callNativeHelper<CaptureResultPayload>(
      'captureNow',
      this.currentOptions(),
    );
    if (helperResult != null) {
      return helperResult;
    }
    const inspection = await this.inspectCaptureTarget();
    return {
      inspection,
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
        perceptualHash: null,
        errorMessage:
          'Native capture helper is not bundled yet for this Electron build.',
        previewByteLength: 0,
        privacyRedaction: {
          checked: false,
          applied: false,
          version: 'capture-privacy-v1',
          matchCount: 0,
          matchTypes: [],
        },
      },
      previewBase64: null,
      previewMimeType: null,
      ocrText: null,
    };
  }
}
