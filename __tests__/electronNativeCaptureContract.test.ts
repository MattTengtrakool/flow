import fs from 'node:fs';
import path from 'node:path';

import {validateCaptureForObservation} from '../src/observation/runObservationForCapture';
import type {CaptureResultPayload} from '../src/types/contextCapture';
import {
  migrationCaptureInspection,
  migrationCaptureResult,
} from './fixtures/electronMigrationFixtures';

const helperSourcePath = path.join(
  __dirname,
  '..',
  'electron',
  'native-capture',
  'FlowNativeCapture.mm',
);

describe('Electron native capture helper contract', () => {
  test('helper source exposes the expected command surface', () => {
    const source = fs.readFileSync(helperSourcePath, 'utf8');

    for (const command of [
      'getPermissionsStatus',
      'requestAccessibilityPrompt',
      'requestScreenCaptureAccess',
      'startMonitoring',
      'setPreciseModeEnabled',
      'currentContextSnapshot',
      'inspectCaptureTarget',
      'captureNow',
    ]) {
      expect(source).toContain(command);
    }
  });

  test('helper source links the native frameworks required for parity', () => {
    const source = fs.readFileSync(helperSourcePath, 'utf8');

    expect(source).toContain('ScreenCaptureKit/ScreenCaptureKit.h');
    expect(source).toContain('Vision/Vision.h');
    expect(source).toContain('ApplicationServices/ApplicationServices.h');
  });

  test('captured payload fixture remains observation-compatible', () => {
    const capture: CaptureResultPayload = migrationCaptureResult;

    expect(capture.metadata.status).toBe('captured');
    expect(capture.metadata.privacyRedaction).toMatchObject({
      checked: true,
      version: 'capture-privacy-v1',
    });
    expect(capture.metadata.frameHash).toMatch(/^[a-f0-9]{64}$/);
    expect(capture.metadata.perceptualHash).toMatch(/^[a-f0-9]{16}$/);
    expect(capture.metadata.previewByteLength).toBeLessThanOrEqual(512 * 1024);

    expect(
      validateCaptureForObservation({
        preview: {
          dataUri: `data:${capture.previewMimeType};base64,${capture.previewBase64}`,
          mimeType: capture.previewMimeType,
          metadata: {
            ...capture.metadata,
            staleFrame: false,
            blankFrame: false,
          },
          ocrText: capture.ocrText,
        },
        inspection: migrationCaptureInspection,
        currentContext: migrationCaptureInspection.context,
        recentObservations: [],
      }),
    ).toEqual({
      imageBase64: capture.previewBase64,
      imageMimeType: capture.previewMimeType,
    });
  });
});
