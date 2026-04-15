import {replayWorkflowRecording, compareWorkflowExpectation} from '../src/observation/workflowReplay';
import type {
  ObservationEngineInput,
  ObservationRun,
  WorkflowRecordingRecord,
} from '../src/observation/types';

function createRecording(): WorkflowRecordingRecord {
  const context = {
    hostBundleIdentifier: 'com.flow.test',
    hostBundlePath: '/Applications/Flow.app',
    appName: 'Cursor',
    bundleIdentifier: 'com.todesktop.230313mzl4w4u92',
    processId: 100,
    windowTitle: 'payments-service',
    windowFrame: null,
    source: 'window' as const,
    preciseModeEnabled: true,
    accessibilityTrusted: true,
    captureAccessGranted: true,
    isIdle: false,
    idleSeconds: 0,
    changeReasons: ['app_changed'],
    recordedAt: '2026-04-15T10:00:00.000Z',
  };

  const inspection = {
    inspectedAt: '2026-04-15T10:00:00.000Z',
    context,
    captureAccessGranted: true,
    chosenTargetType: 'window' as const,
    confidence: 0.91,
    fallbackReason: null,
    chosenTarget: {
      targetType: 'window' as const,
      appName: 'Cursor',
      bundleIdentifier: 'com.todesktop.230313mzl4w4u92',
      processId: 100,
      windowId: 10,
      windowTitle: 'payments-service',
      displayId: 1,
      frame: null,
    },
    candidates: [],
  };

  function createStep(
    id: string,
    title: string,
    expectedKind: 'same_task' | 'switch_task' | null,
    expectedDecision: string | null,
  ) {
    return {
      id,
      label: title,
      recordedAt: '2026-04-15T10:00:00.000Z',
      imageBase64: 'ZmFrZQ==',
      imageMimeType: 'image/png',
      inspection: {
        ...inspection,
        context: {
          ...context,
          windowTitle: title,
        },
        chosenTarget: {
          ...inspection.chosenTarget,
          windowTitle: title,
        },
      },
      capture: {
        capturedAt: '2026-04-15T10:00:00.000Z',
        status: 'captured' as const,
        targetType: 'window' as const,
        appName: 'Cursor',
        bundleIdentifier: 'com.todesktop.230313mzl4w4u92',
        processId: 100,
        windowId: 10,
        windowTitle: title,
        displayId: 1,
        confidence: 0.93,
        width: 1440,
        height: 900,
        frameHash: `${id}_frame`,
        perceptualHash: `${id}_perceptual`,
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
      ocrText: null,
      recordedObservationId: null,
      recordedObservation: null,
      recordedTaskDebug: null,
      expectation: {
        expectedKind,
        expectedDecision,
        note: '',
        importance: 'medium' as const,
        labeledAt: null,
      },
    };
  }

  return {
    id: 'workflow_1',
    label: 'Payments Workflow',
    description: 'Synthetic workflow for replay tests.',
    tags: [],
    createdAt: '2026-04-15T10:00:00.000Z',
    startedAt: '2026-04-15T10:00:00.000Z',
    completedAt: '2026-04-15T10:10:00.000Z',
    captureMode: 'manual',
    status: 'completed',
    steps: [
      createStep('step_1', 'PAY-193 retry.ts', null, 'start_new'),
      createStep('step_2', 'PAY-193 retry.ts follow-up', 'same_task', null),
      createStep('step_3', 'AUTH-1 login.ts', null, null),
    ],
    lastReplay: null,
  };
}

function createObservationRun(args: {
  summary: string;
  taskHypothesis: string;
  repo: string;
  ticket: string;
}): ObservationRun {
  return {
    model: 'test-model',
    promptVersion: 'test-prompt',
    generatedAt: '2026-04-15T10:00:00.000Z',
    durationMs: 10,
    observation: {
      summary: args.summary,
      activityType: 'coding',
      taskHypothesis: args.taskHypothesis,
      confidence: 0.9,
      sensitivity: 'low',
      sensitivityReason: 'Code only.',
      artifacts: [],
      entities: {
        apps: ['Cursor'],
        documents: [],
        tickets: [args.ticket],
        repos: [args.repo],
        urls: [],
        people: [],
      },
      nextAction: null,
    },
  };
}

describe('workflow replay', () => {
  test('compares actual decisions against workflow expectations', async () => {
    const recording = createRecording();
    const generator = jest.fn(async (input: ObservationEngineInput) => {
      const title = input.capture.windowTitle ?? '';

      if (title.includes('AUTH-1')) {
        return createObservationRun({
          summary: 'Fixing login edge cases in auth-service.',
          taskHypothesis: 'Fix AUTH-1 login edge case',
          repo: 'auth-service',
          ticket: 'AUTH-1',
        });
      }

      return createObservationRun({
        summary: 'Fixing retry behavior in payments-service.',
        taskHypothesis: 'Fix PAY-193 retry flow',
        repo: 'payments-service',
        ticket: 'PAY-193',
      });
    });

    const result = await replayWorkflowRecording({
      recording,
      generateWorkflowObservation: generator,
    });

    expect(generator).toHaveBeenCalledTimes(3);
    expect(result.replay.stepResults).toHaveLength(3);
    expect(result.replay.stepResults[0].decision).toBe('start_new');
    expect(result.replay.stepResults[0].matchedExpectation).toBe(true);
    expect(result.replay.stepResults[1].decision).toBe('join_current');
    expect(result.replay.stepResults[1].matchedExpectation).toBe(true);
    expect(result.replay.stepResults[2].matchedExpectation).toBeNull();
    expect(result.replay.matchedCount).toBe(2);
    expect(result.replay.mismatchedCount).toBe(0);
    expect(result.replay.unlabeledCount).toBe(1);
  });

  test('reports unlabeled and mismatched expectations clearly', () => {
    expect(
      compareWorkflowExpectation(
        {
          expectedKind: null,
          expectedDecision: null,
          note: '',
          importance: 'medium',
          labeledAt: null,
        },
        'join_current',
      ),
    ).toEqual({matched: null, reason: null});

    expect(
      compareWorkflowExpectation(
        {
          expectedKind: 'resume_task',
          expectedDecision: null,
          note: '',
          importance: 'medium',
          labeledAt: null,
        },
        'join_current',
      ),
    ).toEqual({
      matched: false,
      reason: 'Expected resume_task but saw join_current.',
    });
  });
});
