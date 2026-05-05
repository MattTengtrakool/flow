import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const helperPath = path.join(
  __dirname,
  '..',
  'electron',
  'native-capture',
  'build',
  'FlowNativeCapture.app',
  'Contents',
  'MacOS',
  'FlowNativeCapture',
);

function helperAvailable() {
  return fs.existsSync(helperPath);
}

function runHelper<T>(command: string): T {
  const stdout = execFileSync(helperPath, [command], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(stdout.trim().split('\n')[0]) as T;
}

const describeIfHelperAvailable = helperAvailable() ? describe : describe.skip;

describeIfHelperAvailable('FlowNativeCapture executable', () => {
  test('returns permission status JSON', () => {
    const payload = runHelper<{
      accessibilityTrusted: boolean;
      captureAccessGranted: boolean;
      hostBundleIdentifier: string | null;
      hostBundlePath: string | null;
    }>('getPermissionsStatus');

    expect(typeof payload.accessibilityTrusted).toBe('boolean');
    expect(typeof payload.captureAccessGranted).toBe('boolean');
    expect('hostBundleIdentifier' in payload).toBe(true);
    expect('hostBundlePath' in payload).toBe(true);
  });

  test('returns current context snapshot JSON', () => {
    const payload = runHelper<{
      source: string;
      recordedAt: string;
      changeReasons: string[];
      accessibilityTrusted: boolean;
      captureAccessGranted: boolean;
    }>('currentContextSnapshot');

    expect(['app', 'window']).toContain(payload.source);
    expect(new Date(payload.recordedAt).toString()).not.toBe('Invalid Date');
    expect(Array.isArray(payload.changeReasons)).toBe(true);
    expect(typeof payload.accessibilityTrusted).toBe('boolean');
    expect(typeof payload.captureAccessGranted).toBe('boolean');
  });

  test('returns capture target inspection JSON', () => {
    const payload = runHelper<{
      captureAccessGranted: boolean;
      chosenTargetType: string;
      confidence: number;
      candidates: unknown[];
    }>('inspectCaptureTarget');

    expect(typeof payload.captureAccessGranted).toBe('boolean');
    expect(['window', 'application', 'none']).toContain(
      payload.chosenTargetType,
    );
    expect(typeof payload.confidence).toBe('number');
    expect(Array.isArray(payload.candidates)).toBe(true);
  });

  test('captures screenshot payload when Screen Recording is available', () => {
    const payload = runHelper<{
      metadata: {
        status: 'captured' | 'permission_required' | 'error';
        frameHash: string | null;
        perceptualHash: string | null;
        previewByteLength: number;
        privacyRedaction: { version: string; checked: boolean };
      };
      previewBase64: string | null;
      previewMimeType: string | null;
    }>('captureNow');

    if (payload.metadata.status !== 'captured') {
      expect(['permission_required', 'error']).toContain(
        payload.metadata.status,
      );
      return;
    }

    expect(payload.metadata.frameHash).toMatch(/^[a-f0-9]{64}$/);
    expect(payload.metadata.perceptualHash).toMatch(/^[a-f0-9]{16}$/);
    expect(payload.metadata.previewByteLength).toBeGreaterThan(0);
    expect(payload.metadata.previewByteLength).toBeLessThanOrEqual(512 * 1024);
    expect(payload.metadata.privacyRedaction.version).toBe(
      'capture-privacy-v1',
    );
    expect(payload.metadata.privacyRedaction.checked).toBe(true);
    expect(payload.previewBase64).toEqual(expect.any(String));
    expect(payload.previewMimeType).toBe('image/jpeg');
  });
});
