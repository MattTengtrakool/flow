import { ipcMain } from 'electron';

import type { ContextSnapshotPayload } from '../../../src/types/contextCapture';
import {
  NativeCaptureClient,
  type MonitoringOptions,
} from './nativeCaptureClient';
import { sendToAllWindows } from '../windowRegistry';

export const captureClient = new NativeCaptureClient();

captureClient.on('contextSnapshotDidChange', snapshot => {
  sendToAllWindows('flow:capture:contextSnapshotDidChange', snapshot);
});

export function registerCaptureIpcHandlers() {
  ipcMain.handle(
    'flow:capture:startMonitoring',
    (_event, options: MonitoringOptions) =>
      captureClient.startMonitoring(options),
  );
  ipcMain.handle('flow:capture:stopMonitoring', () =>
    captureClient.stopMonitoring(),
  );
  ipcMain.handle(
    'flow:capture:setPreciseModeEnabled',
    (_event, enabled: boolean) => captureClient.setPreciseModeEnabled(enabled),
  );
  ipcMain.handle('flow:capture:requestAccessibilityPrompt', () =>
    captureClient.requestAccessibilityPrompt(),
  );
  ipcMain.handle('flow:capture:getPermissionsStatus', () =>
    captureClient.getPermissionsStatus(),
  );
  ipcMain.handle('flow:capture:requestScreenCaptureAccess', () =>
    captureClient.requestScreenCaptureAccess(),
  );
  ipcMain.handle('flow:capture:inspectCaptureTarget', () =>
    captureClient.inspectCaptureTarget(),
  );
  ipcMain.handle('flow:capture:captureNow', () => captureClient.captureNow());
}

export type ContextSnapshotListener = (
  snapshot: ContextSnapshotPayload,
) => void;
