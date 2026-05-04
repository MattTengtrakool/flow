import type { StructuredObservation } from '../../src/observation/types';
import type { TaskPlanSnapshot } from '../../src/planner/types';
import type { DomainEvent } from '../../src/timeline/eventLog';
import type {
  CaptureInspectionPayload,
  CaptureMetadataPayload,
  CaptureResultPayload,
  ContextSnapshotPayload,
} from '../../src/types/contextCapture';

export const MIGRATION_BASE_TIME = '2026-04-24T16:00:00.000Z';

export const migrationContextSnapshot: ContextSnapshotPayload = {
  hostBundleIdentifier: 'com.flow.test',
  hostBundlePath: '/Applications/Flow.app',
  appName: 'Cursor',
  bundleIdentifier: 'com.todesktop.cursor',
  processId: 4242,
  windowTitle: 'PAY-193 retry.ts - Cursor',
  windowFrame: { x: 80, y: 90, width: 1440, height: 900 },
  source: 'window',
  preciseModeEnabled: true,
  accessibilityTrusted: true,
  captureAccessGranted: true,
  isIdle: false,
  idleSeconds: 4.5,
  changeReasons: ['frontmostApplication', 'windowTitle'],
  recordedAt: MIGRATION_BASE_TIME,
};

export const migrationCaptureInspection: CaptureInspectionPayload = {
  inspectedAt: '2026-04-24T16:00:01.000Z',
  context: migrationContextSnapshot,
  captureAccessGranted: true,
  chosenTargetType: 'window',
  confidence: 0.94,
  fallbackReason: null,
  chosenTarget: {
    targetType: 'window',
    appName: 'Cursor',
    bundleIdentifier: 'com.todesktop.cursor',
    processId: 4242,
    windowId: 99,
    windowTitle: 'PAY-193 retry.ts - Cursor',
    displayId: 1,
    frame: { x: 80, y: 90, width: 1440, height: 900 },
  },
  candidates: [
    {
      targetType: 'window',
      appName: 'Cursor',
      bundleIdentifier: 'com.todesktop.cursor',
      processId: 4242,
      windowId: 99,
      windowTitle: 'PAY-193 retry.ts - Cursor',
      displayId: 1,
      frame: { x: 80, y: 90, width: 1440, height: 900 },
      score: 113,
      reasons: ['pid-match', 'title-match', 'frontmost-app', 'onscreen'],
      isOnScreen: true,
      isActive: true,
    },
  ],
};

export const migrationCaptureMetadata: CaptureMetadataPayload = {
  capturedAt: '2026-04-24T16:00:02.000Z',
  status: 'captured',
  targetType: 'window',
  appName: 'Cursor',
  bundleIdentifier: 'com.todesktop.cursor',
  processId: 4242,
  windowId: 99,
  windowTitle: 'PAY-193 retry.ts - Cursor',
  displayId: 1,
  confidence: 0.94,
  width: 1440,
  height: 900,
  frameHash: '7ef4d3df8a6ff70ac65a1a4211dc1e0d807819ca3ac7d2929dc1b28ee97d9056',
  perceptualHash: '0f0f1f1f3f3f7f7f',
  errorMessage: null,
  previewByteLength: 123456,
  privacyRedaction: {
    checked: true,
    applied: true,
    version: 'capture-privacy-v1',
    matchCount: 2,
    matchTypes: ['email', 'api_key'],
  },
  staleFrame: false,
  blankFrame: false,
};

export const migrationCaptureResult: CaptureResultPayload = {
  inspection: migrationCaptureInspection,
  metadata: {
    capturedAt: migrationCaptureMetadata.capturedAt,
    status: migrationCaptureMetadata.status,
    targetType: migrationCaptureMetadata.targetType,
    appName: migrationCaptureMetadata.appName,
    bundleIdentifier: migrationCaptureMetadata.bundleIdentifier,
    processId: migrationCaptureMetadata.processId,
    windowId: migrationCaptureMetadata.windowId,
    windowTitle: migrationCaptureMetadata.windowTitle,
    displayId: migrationCaptureMetadata.displayId,
    confidence: migrationCaptureMetadata.confidence,
    width: migrationCaptureMetadata.width,
    height: migrationCaptureMetadata.height,
    frameHash: migrationCaptureMetadata.frameHash,
    perceptualHash: migrationCaptureMetadata.perceptualHash,
    errorMessage: migrationCaptureMetadata.errorMessage,
    previewByteLength: migrationCaptureMetadata.previewByteLength,
    privacyRedaction: migrationCaptureMetadata.privacyRedaction,
  },
  previewBase64: 'ZmFrZS1wcml2YWN5LXNjcmVlbmVkLWpwZWc=',
  previewMimeType: 'image/jpeg',
  ocrText: 'Editing retry.ts for PAY-193 with redacted credentials.',
};

export const migrationStructuredObservation: StructuredObservation = {
  summary: 'Edited retry.ts to repair the PAY-193 retry flow.',
  activityType: 'coding',
  taskHypothesis: 'Fix PAY-193 retry flow',
  confidence: 0.86,
  sensitivity: 'low',
  sensitivityReason: 'Visible content is source code and ticket metadata.',
  artifacts: ['retry.ts', 'PAY-193', 'payments-service'],
  entities: {
    apps: ['Cursor'],
    documents: ['retry.ts'],
    tickets: ['PAY-193'],
    repos: ['payments-service'],
    urls: [],
    people: [],
  },
  nextAction: 'Run tests for the retry path.',
};

export const migrationPlanSnapshot: TaskPlanSnapshot = {
  snapshotId: 'plan_snapshot_migration',
  revisedAt: '2026-04-24T16:15:00.000Z',
  windowStartAt: '2026-04-24T10:15:00.000Z',
  windowEndAt: '2026-04-24T16:15:00.000Z',
  sessionId: 'session_migration',
  blocks: [
    {
      id: 'block_migration',
      startAt: '2026-04-24T16:00:00.000Z',
      endAt: '2026-04-24T16:20:00.000Z',
      headline: 'PAY-193 retry flow',
      narrative: 'Repaired retry handling in retry.ts and validated the flow.',
      notes: '- Checked retry behavior\n- Prepared test follow-up',
      label: 'worked_on',
      category: 'coding',
      confidence: 0.87,
      keyActivities: ['Edited retry.ts', 'Reviewed PAY-193'],
      artifacts: {
        apps: ['Cursor'],
        repositories: ['payments-service'],
        urls: [],
        tickets: ['PAY-193'],
        documents: ['retry.ts'],
        people: [],
      },
      reasonCodes: ['coding', 'ticket-visible'],
      sourceObservationIds: ['observation_migration'],
    },
  ],
  model: 'gemini-2.5-flash',
  promptVersion: '2026-04-17.planner.v1',
  durationMs: 1200,
  inputObservationCount: 1,
  inputClusterCount: 1,
  previousSnapshotId: null,
  cause: 'manual',
  usage: {
    provider: 'gemini',
    inputTokens: 1000,
    outputTokens: 250,
  },
};

export const migrationEventLog: DomainEvent[] = [
  {
    id: 'event_session_started',
    type: 'session_started',
    sessionId: 'session_migration',
    title: 'Migration fixture session',
    occurredAt: '2026-04-24T15:59:00.000Z',
  },
  {
    id: 'event_context',
    type: 'context_snapshot_recorded',
    snapshotId: 'context_migration',
    snapshot: migrationContextSnapshot,
    occurredAt: migrationContextSnapshot.recordedAt,
  },
  {
    id: 'event_inspection',
    type: 'capture_target_resolved',
    inspectionId: 'inspection_migration',
    inspection: migrationCaptureInspection,
    occurredAt: migrationCaptureInspection.inspectedAt,
  },
  {
    id: 'event_capture',
    type: 'capture_performed',
    captureId: 'capture_migration',
    capture: migrationCaptureMetadata,
    occurredAt: migrationCaptureMetadata.capturedAt,
  },
  {
    id: 'event_observation',
    type: 'observation_added',
    observationId: 'observation_migration',
    sessionId: 'session_migration',
    text: migrationStructuredObservation.summary,
    structured: migrationStructuredObservation,
    engineRun: {
      model: 'gemini-2.5-flash-lite',
      promptVersion: '2026-04-17.observation.v1',
      generatedAt: '2026-04-24T16:00:05.000Z',
      durationMs: 900,
      observation: migrationStructuredObservation,
    },
    capturePreviewDataUri: null,
    occurredAt: '2026-04-24T16:00:02.000Z',
  },
  {
    id: 'event_plan',
    type: 'task_plan_revised',
    snapshot: migrationPlanSnapshot,
    occurredAt: migrationPlanSnapshot.revisedAt,
  },
  {
    id: 'event_notes',
    type: 'user_block_notes_edited',
    notesKey: 'observation_migration',
    blockId: 'block_migration',
    notes: '- User edited note',
    occurredAt: '2026-04-24T16:16:00.000Z',
  },
];

describe('electron migration fixture data', () => {
  test('exports a reusable event log fixture', () => {
    expect(migrationEventLog.length).toBeGreaterThan(0);
  });
});
