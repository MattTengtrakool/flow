import {
  deleteWorkflowRecording,
  loadWorkflowRecordings,
  saveWorkflowRecording,
} from '../src/storage/observationLabStorage';
import type {WorkflowRecordingRecord} from '../src/observation/types';

function createRecording(id: string): WorkflowRecordingRecord {
  return {
    id,
    label: 'Recorded workflow',
    description: 'Saved for regression coverage.',
    tags: ['benchmark'],
    createdAt: '2026-04-15T10:00:00.000Z',
    startedAt: '2026-04-15T10:00:00.000Z',
    completedAt: '2026-04-15T10:05:00.000Z',
    captureMode: 'manual',
    status: 'completed',
    steps: [
      {
        id: 'step_1',
        label: 'Fix PAY-193',
        recordedAt: '2026-04-15T10:00:10.000Z',
        imageBase64: 'ZmFrZQ==',
        imageMimeType: 'image/png',
        inspection: {
          inspectedAt: '2026-04-15T10:00:10.000Z',
          context: {
            hostBundleIdentifier: 'com.flow.test',
            hostBundlePath: '/Applications/Flow.app',
            appName: 'Cursor',
            bundleIdentifier: 'com.todesktop.230313mzl4w4u92',
            processId: 100,
            windowTitle: 'retry.ts',
            windowFrame: null,
            source: 'window',
            preciseModeEnabled: true,
            accessibilityTrusted: true,
            captureAccessGranted: true,
            isIdle: false,
            idleSeconds: 0,
            changeReasons: [],
            recordedAt: '2026-04-15T10:00:10.000Z',
          },
          captureAccessGranted: true,
          chosenTargetType: 'window',
          confidence: 0.9,
          fallbackReason: null,
          chosenTarget: null,
          candidates: [],
        },
        capture: {
          capturedAt: '2026-04-15T10:00:10.000Z',
          status: 'captured',
          targetType: 'window',
          appName: 'Cursor',
          bundleIdentifier: 'com.todesktop.230313mzl4w4u92',
          processId: 100,
          windowId: 10,
          windowTitle: 'retry.ts',
          displayId: 1,
          confidence: 0.9,
          width: 1440,
          height: 900,
          frameHash: 'frame_1',
          perceptualHash: 'perceptual_1',
          errorMessage: null,
          previewByteLength: 4,
          privacyRedaction: {
            checked: true,
            applied: false,
            version: 'capture-privacy-v1',
            matchCount: 0,
            matchTypes: [],
          },
          staleFrame: false,
          blankFrame: false,
        },
        ocrText: 'retry logic',
        recordedObservationId: 'observation_1',
        recordedObservation: null,
        recordedTaskDebug: {
          decisionId: 'decision_1',
          decision: 'start_new',
          decisionMode: 'deterministic',
          targetSegmentId: 'segment_1',
          targetLineageId: 'lineage_1',
          reasonCodes: ['no_active_segment'],
          reasonText: 'Start a new segment.',
          confidence: 1,
          usedLlm: false,
          eventIds: ['event_1'],
        },
        expectation: {
          expectedKind: 'switch_task',
          expectedDecision: 'start_new',
          note: 'This should clearly become a new task.',
          importance: 'high',
          labeledAt: '2026-04-15T10:01:00.000Z',
        },
      },
    ],
    lastReplay: null,
  };
}

describe('workflow recording storage', () => {
  test('saves, loads, and deletes workflow recordings with annotations', async () => {
    const recording = createRecording('workflow_storage_test');

    await saveWorkflowRecording(recording);

    const loaded = await loadWorkflowRecordings();
    expect(
      loaded.recordings.some(
        item =>
          item.id === recording.id &&
          item.steps[0]?.expectation.expectedDecision === 'start_new' &&
          item.steps[0]?.expectation.note === 'This should clearly become a new task.',
      ),
    ).toBe(true);

    await deleteWorkflowRecording(recording.id);

    const afterDelete = await loadWorkflowRecordings();
    expect(afterDelete.recordings.some(item => item.id === recording.id)).toBe(false);
  });
});
