import {getAllPlanCalendarBlocks, getDayWorklog} from '../src/planner/selectors';
import {
  sanitizeCaptureMetadata,
  sanitizeInspection,
} from '../src/privacy/redaction';
import {validateCaptureForObservation} from '../src/observation/runObservationForCapture';
import {replayEventLog} from '../src/timeline/eventLog';
import {
  migrationCaptureInspection,
  migrationCaptureMetadata,
  migrationCaptureResult,
  migrationEventLog,
} from './fixtures/electronMigrationFixtures';

describe('Electron migration regression fixtures', () => {
  test('replays a full capture-to-plan event log contract', () => {
    const timeline = replayEventLog(migrationEventLog);

    expect(timeline.currentSessionId).toBe('session_migration');
    expect(timeline.currentContextSnapshotId).toBe('context_migration');
    expect(timeline.latestCaptureInspectionId).toBe('inspection_migration');
    expect(timeline.latestCaptureRecordId).toBe('capture_migration');
    expect(timeline.observationOrder).toEqual(['observation_migration']);
    expect(timeline.planSnapshots).toHaveLength(1);
    expect(timeline.userBlockNotes.observation_migration.notes).toBe(
      '- User edited note',
    );
  });

  test('derives stable worklog blocks from the migration event log', () => {
    const timeline = replayEventLog(migrationEventLog);

    const day = getDayWorklog(timeline, '2026-04-24', 'UTC');
    const allBlocks = getAllPlanCalendarBlocks(timeline);

    expect(day.totals.focusedMinutes).toBe(20);
    expect(day.blocks).toHaveLength(1);
    expect(day.blocks[0]).toMatchObject({
      id: 'block_migration',
      title: 'PAY-193 retry flow',
      notes: '- Checked retry behavior\n- Prepared test follow-up',
      repos: ['payments-service'],
      tickets: ['PAY-193'],
    });
    expect(allBlocks.map(block => block.id)).toEqual(['block_migration']);
  });

  test('keeps capture result payload compatible with observation validation', () => {
    const preview = {
      dataUri: `data:${migrationCaptureResult.previewMimeType};base64,${migrationCaptureResult.previewBase64}`,
      mimeType: migrationCaptureResult.previewMimeType,
      metadata: {
        ...migrationCaptureResult.metadata,
        staleFrame: false,
        blankFrame: false,
      },
      ocrText: migrationCaptureResult.ocrText,
    };

    expect(
      validateCaptureForObservation({
        preview,
        inspection: migrationCaptureResult.inspection,
        currentContext: migrationCaptureResult.inspection.context,
        recentObservations: [],
      }),
    ).toEqual({
      imageBase64: migrationCaptureResult.previewBase64,
      imageMimeType: 'image/jpeg',
    });
  });

  test('preserves native capture metadata invariants needed by Electron parity', () => {
    expect(migrationCaptureMetadata.privacyRedaction).toMatchObject({
      checked: true,
      applied: true,
      version: 'capture-privacy-v1',
    });
    expect(migrationCaptureMetadata.frameHash).toMatch(/^[a-f0-9]{64}$/);
    expect(migrationCaptureMetadata.perceptualHash).toMatch(/^[a-f0-9]+$/);
    expect(migrationCaptureMetadata.previewByteLength).toBeLessThanOrEqual(
      512 * 1024,
    );
  });

  test('sanitizes capture and inspection before persistence', () => {
    const sanitizedInspection = sanitizeInspection(migrationCaptureInspection);
    const sanitizedCapture = sanitizeCaptureMetadata(migrationCaptureMetadata);

    expect(sanitizedInspection.context.hostBundleIdentifier).toBeNull();
    expect(sanitizedInspection.context.hostBundlePath).toBeNull();
    expect(sanitizedInspection.context.bundleIdentifier).toBeNull();
    expect(sanitizedInspection.context.processId).toBeNull();
    expect(sanitizedInspection.chosenTarget?.bundleIdentifier).toBeNull();
    expect(sanitizedInspection.chosenTarget?.processId).toBeNull();
    expect(sanitizedInspection.chosenTarget?.windowId).toBeNull();
    expect(sanitizedInspection.candidates).toEqual([]);
    expect(sanitizedCapture.bundleIdentifier).toBeNull();
    expect(sanitizedCapture.processId).toBeNull();
    expect(sanitizedCapture.windowId).toBeNull();
  });
});
