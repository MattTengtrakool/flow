import {
  redactSensitiveText,
  sanitizeInspection,
} from '../src/privacy/redaction';
import {validateCaptureForObservation} from '../src/observation/runObservationForCapture';

describe('privacy redaction utilities', () => {
  test('redacts obvious secrets from text surfaces', () => {
    expect(
      redactSensitiveText(
        'Email jane@example.com uses Bearer abc123TOKEN and password: hunter2',
      ),
    ).toBe(
      'Email [redacted-email] uses Bearer [redacted-token] and password: [redacted]',
    );
  });

  test('sanitizes persisted inspection metadata', () => {
    const inspection = sanitizeInspection({
      inspectedAt: '2026-04-15T10:00:00.000Z',
      context: {
        hostBundleIdentifier: 'com.flow.test',
        hostBundlePath: '/Applications/Flow.app',
        appName: 'Cursor',
        bundleIdentifier: 'com.todesktop.cursor',
        processId: 42,
        windowTitle: 'Reset token for jane@example.com',
        windowFrame: null,
        source: 'window',
        preciseModeEnabled: true,
        accessibilityTrusted: true,
        captureAccessGranted: true,
        isIdle: false,
        idleSeconds: 0,
        changeReasons: [],
        recordedAt: '2026-04-15T10:00:00.000Z',
      },
      captureAccessGranted: true,
      chosenTargetType: 'window',
      confidence: 0.9,
      fallbackReason: 'token=secretvalue',
      chosenTarget: {
        targetType: 'window',
        appName: 'Cursor',
        bundleIdentifier: 'com.todesktop.cursor',
        processId: 42,
        windowId: 7,
        windowTitle: 'Reset token for jane@example.com',
        displayId: 1,
        frame: null,
      },
      candidates: [
        {
          targetType: 'window',
          appName: 'Cursor',
          bundleIdentifier: 'com.todesktop.cursor',
          processId: 42,
          windowId: 7,
          windowTitle: 'Reset token for jane@example.com',
          displayId: 1,
          frame: null,
          score: 0.9,
          reasons: ['focused'],
          isOnScreen: true,
          isActive: true,
        },
      ],
    });

    expect(inspection.context.hostBundlePath).toBeNull();
    expect(inspection.context.bundleIdentifier).toBeNull();
    expect(inspection.context.processId).toBeNull();
    expect(inspection.context.windowTitle).toBe(
      'Reset token for [redacted-email]',
    );
    expect(inspection.chosenTarget?.bundleIdentifier).toBeNull();
    expect(inspection.chosenTarget?.processId).toBeNull();
    expect(inspection.chosenTarget?.windowId).toBeNull();
    expect(inspection.candidates).toEqual([]);
    expect(inspection.fallbackReason).toBe('token=[redacted]');
  });
});

describe('capture validation', () => {
  test('requires privacy-screened captures before observation', () => {
    expect(() =>
      validateCaptureForObservation({
        preview: {
          dataUri: 'data:image/jpeg;base64,ZmFrZQ==',
          mimeType: 'image/jpeg',
          metadata: {
            capturedAt: '2026-04-15T10:00:00.000Z',
            status: 'captured',
            targetType: 'window',
            appName: 'Cursor',
            bundleIdentifier: 'com.todesktop.cursor',
            processId: 42,
            windowId: 7,
            windowTitle: 'Secrets',
            displayId: 1,
            confidence: 0.9,
            width: 1440,
            height: 900,
            frameHash: 'frame',
            perceptualHash: 'perceptual',
            errorMessage: null,
            previewByteLength: 4,
            privacyRedaction: {
              checked: false,
              applied: false,
              version: 'capture-privacy-v1',
              matchCount: 0,
              matchTypes: [],
            },
            staleFrame: false,
            blankFrame: false,
          },
          ocrText: null,
        },
        inspection: {
          inspectedAt: '2026-04-15T10:00:00.000Z',
          context: {
            hostBundleIdentifier: null,
            hostBundlePath: null,
            appName: 'Cursor',
            bundleIdentifier: null,
            processId: null,
            windowTitle: null,
            windowFrame: null,
            source: 'window',
            preciseModeEnabled: true,
            accessibilityTrusted: true,
            captureAccessGranted: true,
            isIdle: false,
            idleSeconds: 0,
            changeReasons: [],
            recordedAt: '2026-04-15T10:00:00.000Z',
          },
          captureAccessGranted: true,
          chosenTargetType: 'window',
          confidence: 0.9,
          fallbackReason: null,
          chosenTarget: null,
          candidates: [],
        },
        currentContext: null,
        recentObservations: [],
      }),
    ).toThrow('privacy-screened screenshot');
  });
});
