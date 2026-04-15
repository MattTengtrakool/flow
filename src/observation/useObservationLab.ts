import {startTransition, useEffect, useMemo, useRef, useState} from 'react';

import {
  createDomainId,
  createOccurredAt,
  getCurrentContext,
} from '../state/eventLog';
import {
  useEventSourcedTimeline,
  type StructuredObservationRecordedPayload,
} from '../state/useEventSourcedTimeline';
import {
  DEFAULT_OBSERVATION_MODEL,
  generateObservation,
} from './geminiObservationEngine';
import {createFixtureRatingSummary} from './fixtureSummary';
import type {
  ObservationFixtureRating,
  ObservationFixtureRecord,
  ObservationRun,
  ObservationSettings,
  WorkflowRecordingCaptureMode,
  WorkflowRecordingRecord,
  WorkflowRecordingStep,
  WorkflowStepExpectation,
  WorkflowStepTaskDebug,
} from './types';
import {
  deleteObservationFixture,
  deleteWorkflowRecording,
  loadObservationFixtures,
  loadObservationSettings,
  loadWorkflowRecordings,
  saveObservationFixture,
  saveObservationSettings,
  saveWorkflowRecording,
} from '../storage/observationLabStorage';
import {generateStructuredObservationForCapture} from './runObservationForCapture';
import {replayWorkflowRecording} from './workflowReplay';
import {
  hasCapturePrivacyScreening,
  redactSensitiveText,
  sanitizeCaptureMetadata,
  sanitizeInspection,
  sanitizeObservationRun,
} from '../privacy/redaction';

type LabFeedback = {
  message: string;
  tone: 'neutral' | 'success' | 'warning' | 'error';
  at: string;
};

const DEFAULT_SETTINGS: ObservationSettings = {
  apiKey: '',
  model: DEFAULT_OBSERVATION_MODEL,
  savedAt: null,
};

const EMPTY_RATING: ObservationFixtureRating = {
  usefulness: null,
  confidenceCalibration: null,
  sensitivityHandling: null,
  notes: '',
  ratedAt: null,
};


function createLabFeedback(
  message: string,
  tone: LabFeedback['tone'] = 'neutral',
): LabFeedback {
  return {
    message,
    tone,
    at: createOccurredAt(),
  };
}

function createDefaultFixtureLabel(
  appName: string | null | undefined,
  windowTitle: string | null | undefined,
): string {
  const pieces = [appName, windowTitle].filter(
    (value): value is string => value != null && value.trim().length > 0,
  );

  if (pieces.length > 0) {
    return pieces.join(' · ');
  }

  return `Fixture ${new Date().toLocaleString()}`;
}

function sortFixtures(
  fixtures: ObservationFixtureRecord[],
): ObservationFixtureRecord[] {
  return [...fixtures].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
}

function createEmptyWorkflowExpectation(): WorkflowStepExpectation {
  return {
    expectedKind: null,
    expectedDecision: null,
    note: '',
    importance: 'medium',
    labeledAt: null,
  };
}

function sortWorkflowRecordings(
  recordings: WorkflowRecordingRecord[],
): WorkflowRecordingRecord[] {
  return [...recordings].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
}

function createDefaultWorkflowLabel(captureMode: WorkflowRecordingCaptureMode): string {
  return `${captureMode === 'automatic' ? 'Auto' : 'Manual'} Workflow ${new Date().toLocaleString()}`;
}

function toWorkflowStepTaskDebug(
  taskEngineResult: StructuredObservationRecordedPayload['taskEngineResult'],
): WorkflowStepTaskDebug | null {
  if (taskEngineResult == null) {
    return null;
  }

  return {
    decisionId:
      taskEngineResult.taskEvents.find(event => event.type === 'task_decision_recorded')
        ?.decisionId ?? null,
    decision: taskEngineResult.selectedCandidate.decision,
    decisionMode: taskEngineResult.decisionMode,
    targetSegmentId: taskEngineResult.selectedCandidate.targetSegmentId,
    targetLineageId: taskEngineResult.selectedCandidate.targetLineageId,
    reasonCodes: taskEngineResult.selectedCandidate.reasonCodes,
    reasonText: taskEngineResult.selectedCandidate.summary,
    confidence: taskEngineResult.selectedCandidate.score,
    usedLlm: taskEngineResult.usedLlm,
    eventIds: taskEngineResult.events.map(event => event.id),
  };
}

function buildWorkflowStep(
  payload: StructuredObservationRecordedPayload,
): WorkflowRecordingStep | null {
  const dataUri = payload.preview.dataUri;

  if (
    dataUri == null ||
    payload.preview.mimeType == null ||
    !hasCapturePrivacyScreening(payload.preview.metadata)
  ) {
    return null;
  }

  const imageBase64 = dataUri.split(',')[1] ?? null;

  if (imageBase64 == null) {
    return null;
  }

  return {
    id: createDomainId('workflow_step'),
    label:
      redactSensitiveText(payload.preview.metadata.windowTitle) ??
      payload.preview.metadata.appName ??
      `Step ${new Date(payload.preview.metadata.capturedAt).toLocaleTimeString()}`,
    recordedAt: payload.preview.metadata.capturedAt,
    imageBase64,
    imageMimeType: payload.preview.mimeType,
    inspection: sanitizeInspection(payload.inspection),
    capture: sanitizeCaptureMetadata(payload.preview.metadata),
    ocrText: payload.preview.ocrText ?? null,
    recordedObservationId: payload.observationId,
    recordedObservation: sanitizeObservationRun(payload.observationRun),
    recordedTaskDebug: toWorkflowStepTaskDebug(payload.taskEngineResult),
    expectation: createEmptyWorkflowExpectation(),
  };
}

function sanitizeFixtureForPersistence(
  fixture: ObservationFixtureRecord,
): ObservationFixtureRecord {
  return {
    ...fixture,
    label: redactSensitiveText(fixture.label) ?? fixture.label,
    inspection: sanitizeInspection(fixture.inspection),
    capture: sanitizeCaptureMetadata(fixture.capture),
    lastRun: fixture.lastRun != null ? sanitizeObservationRun(fixture.lastRun) : null,
  };
}

function sanitizeWorkflowRecordingForPersistence(
  recording: WorkflowRecordingRecord,
): WorkflowRecordingRecord {
  return {
    ...recording,
    label: redactSensitiveText(recording.label) ?? recording.label,
    description: redactSensitiveText(recording.description) ?? recording.description,
    tags: recording.tags.map(tag => redactSensitiveText(tag) ?? tag),
    steps: recording.steps.map(step => ({
      ...step,
      label: redactSensitiveText(step.label) ?? step.label,
      inspection: sanitizeInspection(step.inspection),
      capture: sanitizeCaptureMetadata(step.capture),
      ocrText: redactSensitiveText(step.ocrText),
      recordedObservation:
        step.recordedObservation != null
          ? sanitizeObservationRun(step.recordedObservation)
          : null,
      expectation: {
        ...step.expectation,
        note: redactSensitiveText(step.expectation.note) ?? step.expectation.note,
      },
    })),
  };
}

export function useObservationLab() {
  const activeWorkflowRecordingRef = useRef<WorkflowRecordingRecord | null>(null);
  const pendingManualObservationIdsRef = useRef<Set<string>>(new Set());
  const pendingManualCaptureCountRef = useRef(0);
  const [workflowRecordings, setWorkflowRecordings] = useState<WorkflowRecordingRecord[]>(
    [],
  );
  const [workflowRecordingsDirectoryPath, setWorkflowRecordingsDirectoryPath] =
    useState<string | null>(null);
  const [selectedWorkflowRecordingId, setSelectedWorkflowRecordingId] =
    useState<string | null>(null);
  const [activeWorkflowRecordingId, setActiveWorkflowRecordingId] =
    useState<string | null>(null);
  const [workflowLabelDraft, setWorkflowLabelDraft] = useState('');
  const [workflowDescriptionDraft, setWorkflowDescriptionDraft] = useState('');
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [workflowReplayBusy, setWorkflowReplayBusy] = useState(false);
  const timeline = useEventSourcedTimeline({
    onStructuredObservationRecorded: payload => {
      if (payload == null || typeof payload.observationId !== 'string') {
        return;
      }

      const activeRecording = activeWorkflowRecordingRef.current;

      if (activeRecording == null) {
        return;
      }

      const hasPendingManualCapture = pendingManualCaptureCountRef.current > 0;
      const isPendingManualObservation = pendingManualObservationIdsRef.current.has(
        payload.observationId,
      );
      const shouldCapture =
        activeRecording.captureMode === 'automatic' ||
        isPendingManualObservation ||
        hasPendingManualCapture;

      if (!shouldCapture) {
        return;
      }

      if (hasPendingManualCapture) {
        pendingManualCaptureCountRef.current = Math.max(
          0,
          pendingManualCaptureCountRef.current - 1,
        );
      }
      pendingManualObservationIdsRef.current.delete(payload.observationId);
      const step = buildWorkflowStep(payload);

      if (step == null) {
        return;
      }

      if (
        activeRecording.steps.some(
          existingStep =>
            existingStep.recordedObservationId === payload.observationId,
        )
      ) {
        return;
      }

      const nextRecording: WorkflowRecordingRecord = {
        ...activeRecording,
        steps: [...activeRecording.steps, step],
        lastReplay: null,
      };

      activeWorkflowRecordingRef.current = nextRecording;
      persistWorkflowRecording(nextRecording)
        .then(() => {
          startTransition(() => {
            setActiveWorkflowRecordingId(nextRecording.id);
            setSelectedWorkflowRecordingId(nextRecording.id);
            setLabFeedback(
              createLabFeedback(
                `Recorded workflow step ${nextRecording.steps.length} for "${nextRecording.label}".`,
                'success',
              ),
            );
          });
        })
        .catch(error => {
          startTransition(() => {
            setLabFeedback(
              createLabFeedback(
                error instanceof Error
                  ? error.message
                  : 'Failed to save the workflow recording step.',
                'error',
              ),
            );
          });
        });
    },
  });
  const currentContext = getCurrentContext(timeline.timeline);
  const recentStructuredObservations = useMemo(
    () =>
      timeline.timeline.observationOrder
        .map(observationId => timeline.timeline.observationsById[observationId])
        .filter(
          observation =>
            observation != null &&
            observation.deletedAt == null &&
            observation.structured != null,
        )
        .slice(-5)
        .map(observation => observation.structured!),
    [timeline.timeline.observationOrder, timeline.timeline.observationsById],
  );

  const [settings, setSettings] = useState<ObservationSettings>(DEFAULT_SETTINGS);
  const [settingsPath, setSettingsPath] = useState<string | null>(null);
  const [fixtures, setFixtures] = useState<ObservationFixtureRecord[]>([]);
  const [fixturesDirectoryPath, setFixturesDirectoryPath] = useState<string | null>(
    null,
  );
  const [selectedFixtureId, setSelectedFixtureId] = useState<string | null>(null);
  const [fixtureLabelDraft, setFixtureLabelDraft] = useState('');
  const [latestObservationRun, setLatestObservationRun] =
    useState<ObservationRun | null>(null);
  const [labFeedback, setLabFeedback] = useState<LabFeedback | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [observationBusy, setObservationBusy] = useState(false);
  const [fixtureBusy, setFixtureBusy] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [ratingDraft, setRatingDraft] =
    useState<ObservationFixtureRating>(EMPTY_RATING);

  useEffect(() => {
    let isCancelled = false;

    async function hydrateObservationLab() {
      try {
        const [settingsPayload, fixturesPayload, workflowPayload] = await Promise.all([
          loadObservationSettings(),
          loadObservationFixtures(),
          loadWorkflowRecordings(),
        ]);

        if (isCancelled) {
          return;
        }

        startTransition(() => {
          setSettings(settingsPayload.settings);
          setSettingsPath(settingsPayload.filePath);
          setFixtures(
            sortFixtures(
              fixturesPayload.fixtures.map(fixture =>
                sanitizeFixtureForPersistence(fixture),
              ),
            ),
          );
          setFixturesDirectoryPath(fixturesPayload.directoryPath);
          setWorkflowRecordings(
            sortWorkflowRecordings(
              workflowPayload.recordings.map(recording =>
                sanitizeWorkflowRecordingForPersistence(recording),
              ),
            ),
          );
          setWorkflowRecordingsDirectoryPath(workflowPayload.directoryPath);
          setActiveWorkflowRecordingId(
            workflowPayload.recordings.find(recording => recording.status === 'recording')
              ?.id ?? null,
          );
          setSelectedFixtureId(previousId =>
            previousId ??
            (fixturesPayload.fixtures.length > 0 ? fixturesPayload.fixtures[0].id : null),
          );
          setSelectedWorkflowRecordingId(previousId =>
            previousId ??
            (workflowPayload.recordings.length > 0
              ? workflowPayload.recordings[0].id
              : null),
          );
        });
      } catch (error) {
        if (isCancelled) {
          return;
        }

        startTransition(() => {
          setLabFeedback(
            createLabFeedback(
              error instanceof Error
                ? error.message
                : 'Failed to load observation settings or fixtures.',
              'error',
            ),
          );
        });
      }
    }

    hydrateObservationLab().catch(() => {});

    return () => {
      isCancelled = true;
    };
  }, []);

  const selectedFixture =
    selectedFixtureId != null
      ? fixtures.find(fixture => fixture.id === selectedFixtureId) ?? null
      : null;
  const selectedWorkflowRecording =
    selectedWorkflowRecordingId != null
      ? workflowRecordings.find(recording => recording.id === selectedWorkflowRecordingId) ??
        null
      : null;
  const activeWorkflowRecording =
    activeWorkflowRecordingId != null
      ? workflowRecordings.find(recording => recording.id === activeWorkflowRecordingId) ?? null
      : null;
  const fixtureSummary = useMemo(
    () => createFixtureRatingSummary(fixtures),
    [fixtures],
  );

  useEffect(() => {
    activeWorkflowRecordingRef.current = activeWorkflowRecording;
  }, [activeWorkflowRecording]);

  useEffect(() => {
    if (selectedFixture?.rating != null) {
      setRatingDraft(selectedFixture.rating);
      return;
    }

    setRatingDraft(EMPTY_RATING);
  }, [selectedFixture]);

  async function persistFixture(nextFixture: ObservationFixtureRecord) {
    const persistedFixture = sanitizeFixtureForPersistence(nextFixture);
    const payload = await saveObservationFixture(persistedFixture);

    startTransition(() => {
      setFixtures(previousFixtures =>
        sortFixtures(
          previousFixtures.some(fixture => fixture.id === persistedFixture.id)
            ? previousFixtures.map(fixture =>
                fixture.id === persistedFixture.id ? persistedFixture : fixture,
              )
            : [...previousFixtures, persistedFixture],
        ),
      );
      setFixturesDirectoryPath(payload.filePath.replace(/\/[^/]+$/, ''));
    });
  }

  async function persistWorkflowRecording(nextRecording: WorkflowRecordingRecord) {
    const persistedRecording = sanitizeWorkflowRecordingForPersistence(nextRecording);
    const payload = await saveWorkflowRecording(persistedRecording);

    startTransition(() => {
      setWorkflowRecordings(previousRecordings =>
        sortWorkflowRecordings(
          previousRecordings.some(recording => recording.id === persistedRecording.id)
            ? previousRecordings.map(recording =>
                recording.id === persistedRecording.id ? persistedRecording : recording,
              )
            : [...previousRecordings, persistedRecording],
        ),
      );
      setWorkflowRecordingsDirectoryPath(payload.filePath.replace(/\/[^/]+$/, ''));
    });
  }

  async function saveSettings() {
    setSettingsBusy(true);

    try {
      const nextSettings: ObservationSettings = {
        apiKey: settings.apiKey.trim(),
        model: settings.model.trim().length > 0 ? settings.model.trim() : DEFAULT_OBSERVATION_MODEL,
        savedAt: createOccurredAt(),
      };
      const payload = await saveObservationSettings(nextSettings);

      startTransition(() => {
        setSettings(nextSettings);
        setSettingsPath(payload.filePath);
        setLabFeedback(
          createLabFeedback('Observation settings saved locally.', 'success'),
        );
      });
    } catch (error) {
      startTransition(() => {
        setLabFeedback(
          createLabFeedback(
            error instanceof Error
              ? error.message
              : 'Failed to save observation settings.',
            'error',
          ),
        );
      });
    } finally {
      setSettingsBusy(false);
    }
  }

  async function observeCaptureInput(args?: {
    preview: NonNullable<typeof timeline.latestCapturePreview>;
    inspection: NonNullable<typeof timeline.latestInspection>;
  }): Promise<{run: ObservationRun; observationId: string} | null> {
    const preview = args?.preview ?? timeline.latestCapturePreview;
    const latestInspection = args?.inspection ?? timeline.latestInspection;
    setObservationBusy(true);

    try {
      const run = await generateStructuredObservationForCapture({
        preview,
        inspection: latestInspection,
        currentContext,
        recentObservations: recentStructuredObservations,
      });

      startTransition(() => {
        setLatestObservationRun(run);
        setLabFeedback(
          createLabFeedback(
            `Observation generated in ${run.durationMs} ms with ${run.model}.`,
            'success',
          ),
        );
      });

      const safePreview = preview!;
      const safeInspection = latestInspection!;
      const observationId = timeline.recordStructuredObservation(
        run,
        safePreview.metadata.capturedAt,
        safePreview.dataUri ?? null,
        {
          preview: safePreview,
          inspection: safeInspection,
        },
      );

      return {
        run,
        observationId,
      };
    } catch (error) {
      startTransition(() => {
        setLabFeedback(
          createLabFeedback(
            error instanceof Error
              ? error.message
              : 'Observation generation failed.',
            'error',
          ),
        );
      });
      return null;
    } finally {
      setObservationBusy(false);
    }
  }

  async function observeLatestCapture() {
    await observeCaptureInput();
  }

  async function saveLatestCaptureAsFixture() {
    const preview = timeline.latestCapturePreview;
    const latestInspection = timeline.latestInspection;
    const imageBase64 = preview?.dataUri != null ? preview.dataUri.split(',')[1] ?? null : null;
    const imageMimeType = preview?.mimeType ?? null;

    if (
      preview == null ||
      latestInspection == null ||
      preview.metadata.status !== 'captured' ||
      !hasCapturePrivacyScreening(preview.metadata) ||
      imageBase64 == null ||
      imageMimeType == null
    ) {
      startTransition(() => {
        setLabFeedback(
          createLabFeedback(
            'Capture a privacy-screened screenshot before saving a fixture.',
            'warning',
          ),
        );
      });
      return;
    }

    const fixture: ObservationFixtureRecord = {
      id: createDomainId('fixture'),
      label:
        fixtureLabelDraft.trim().length > 0
          ? fixtureLabelDraft.trim()
          : createDefaultFixtureLabel(
              preview.metadata.appName,
              preview.metadata.windowTitle,
            ),
      createdAt: preview.metadata.capturedAt,
      imageBase64,
      imageMimeType,
      inspection: latestInspection,
      capture: preview.metadata,
      lastRun: latestObservationRun,
      rating: null,
    };

    setFixtureBusy(true);

    try {
      await persistFixture(fixture);

      startTransition(() => {
        setSelectedFixtureId(fixture.id);
        setFixtureLabelDraft('');
        setLabFeedback(
          createLabFeedback(`Saved fixture "${fixture.label}".`, 'success'),
        );
      });
    } catch (error) {
      startTransition(() => {
        setLabFeedback(
          createLabFeedback(
            error instanceof Error ? error.message : 'Failed to save fixture.',
            'error',
          ),
        );
      });
    } finally {
      setFixtureBusy(false);
    }
  }

  async function runFixtureObservation(fixtureId: string) {
    const fixture = fixtures.find(item => item.id === fixtureId);

    if (fixture == null) {
      return;
    }

    setFixtureBusy(true);

    try {
      const run = await generateObservation(
        {
          imageBase64: fixture.imageBase64,
          imageMimeType: fixture.imageMimeType,
          ocrText: null,
          inspection: fixture.inspection,
          capture: fixture.capture,
          currentContext: fixture.inspection.context,
          recentObservations: [],
        },
      );
      const nextFixture: ObservationFixtureRecord = {
        ...fixture,
        lastRun: run,
      };

      await persistFixture(nextFixture);

      startTransition(() => {
        setSelectedFixtureId(fixtureId);
        setLabFeedback(
          createLabFeedback(
            `Fixture "${fixture.label}" evaluated in ${run.durationMs} ms.`,
            'success',
          ),
        );
      });
    } catch (error) {
      startTransition(() => {
        setLabFeedback(
          createLabFeedback(
            error instanceof Error
              ? error.message
              : 'Fixture evaluation failed.',
            'error',
          ),
        );
      });
    } finally {
      setFixtureBusy(false);
    }
  }

  async function runAllFixtures() {
    if (fixtures.length === 0) {
      startTransition(() => {
        setLabFeedback(
          createLabFeedback('Save at least one fixture before batch evaluation.', 'warning'),
        );
      });
      return;
    }

    setBatchBusy(true);

    let completedCount = 0;
    let failureCount = 0;

    for (const fixture of fixtures) {
      try {
        const run = await generateObservation(
          {
            imageBase64: fixture.imageBase64,
            imageMimeType: fixture.imageMimeType,
            ocrText: null,
            inspection: fixture.inspection,
            capture: fixture.capture,
            currentContext: fixture.inspection.context,
            recentObservations: [],
          },
        );

        await persistFixture({
          ...fixture,
          lastRun: run,
        });
        completedCount += 1;
      } catch (_error) {
        failureCount += 1;
      }
    }

    startTransition(() => {
      setLabFeedback(
        createLabFeedback(
          `Batch evaluation finished. ${completedCount} fixtures ran successfully${failureCount > 0 ? `, ${failureCount} failed` : ''}.`,
          failureCount > 0 ? 'warning' : 'success',
        ),
      );
    });
    setBatchBusy(false);
  }

  async function startWorkflowRecording(captureMode: WorkflowRecordingCaptureMode) {
    if (activeWorkflowRecording != null) {
      startTransition(() => {
        setLabFeedback(
          createLabFeedback(
            `Finish "${activeWorkflowRecording.label}" before starting another workflow recording.`,
            'warning',
          ),
        );
      });
      return;
    }

    setWorkflowBusy(true);

    const now = createOccurredAt();
    const recording: WorkflowRecordingRecord = {
      id: createDomainId('workflow'),
      label:
        workflowLabelDraft.trim().length > 0
          ? workflowLabelDraft.trim()
          : createDefaultWorkflowLabel(captureMode),
      description: workflowDescriptionDraft.trim(),
      tags: [],
      createdAt: now,
      startedAt: now,
      completedAt: null,
      captureMode,
      status: 'recording',
      steps: [],
      lastReplay: null,
    };

    try {
      activeWorkflowRecordingRef.current = recording;
      await persistWorkflowRecording(recording);

      startTransition(() => {
        setActiveWorkflowRecordingId(recording.id);
        setSelectedWorkflowRecordingId(recording.id);
        setWorkflowLabelDraft('');
        setWorkflowDescriptionDraft('');
        setLabFeedback(
          createLabFeedback(
            `Started ${captureMode} workflow recording "${recording.label}".`,
            'success',
          ),
        );
      });
    } catch (error) {
      activeWorkflowRecordingRef.current = null;
      startTransition(() => {
        setLabFeedback(
          createLabFeedback(
            error instanceof Error
              ? error.message
              : 'Failed to start the workflow recording.',
            'error',
          ),
        );
      });
    } finally {
      setWorkflowBusy(false);
    }
  }

  async function stopWorkflowRecording() {
    if (activeWorkflowRecording == null) {
      return;
    }

    setWorkflowBusy(true);

    try {
      if (activeWorkflowRecording.steps.length === 0) {
        await deleteWorkflowRecording(activeWorkflowRecording.id);
        activeWorkflowRecordingRef.current = null;
        startTransition(() => {
          setWorkflowRecordings(previousRecordings =>
            previousRecordings.filter(
              recording => recording.id !== activeWorkflowRecording.id,
            ),
          );
          setActiveWorkflowRecordingId(null);
          setSelectedWorkflowRecordingId(previousId =>
            previousId === activeWorkflowRecording.id ? null : previousId,
          );
          setLabFeedback(
            createLabFeedback(
              'Discarded the empty workflow recording.',
              'warning',
            ),
          );
        });
        return;
      }

      const completedRecording: WorkflowRecordingRecord = {
        ...activeWorkflowRecording,
        status: 'completed',
        completedAt: createOccurredAt(),
      };

      activeWorkflowRecordingRef.current = completedRecording;
      await persistWorkflowRecording(completedRecording);

      startTransition(() => {
        setActiveWorkflowRecordingId(null);
        setSelectedWorkflowRecordingId(completedRecording.id);
        setLabFeedback(
          createLabFeedback(
            `Saved workflow recording "${completedRecording.label}" with ${completedRecording.steps.length} steps.`,
            'success',
          ),
        );
      });
      activeWorkflowRecordingRef.current = null;
    } catch (error) {
      startTransition(() => {
        setLabFeedback(
          createLabFeedback(
            error instanceof Error
              ? error.message
              : 'Failed to stop the workflow recording.',
            'error',
          ),
        );
      });
    } finally {
      setWorkflowBusy(false);
    }
  }

  async function recordWorkflowStepNow() {
    if (activeWorkflowRecording == null) {
      startTransition(() => {
        setLabFeedback(
          createLabFeedback('Start a manual workflow recording first.', 'warning'),
        );
      });
      return;
    }

    if (activeWorkflowRecording.captureMode !== 'manual') {
      startTransition(() => {
        setLabFeedback(
          createLabFeedback(
            'Manual step capture is only available for manual workflow recordings.',
            'warning',
          ),
        );
      });
      return;
    }

    setWorkflowBusy(true);

    try {
      const captureResult = await timeline.runCaptureNow();

      if (captureResult == null) {
        return;
      }

      pendingManualCaptureCountRef.current += 1;
      const observationResult = await observeCaptureInput({
        preview: captureResult.preview,
        inspection: captureResult.inspection,
      });

      if (observationResult != null) {
        pendingManualObservationIdsRef.current.add(observationResult.observationId);
        startTransition(() => {
          setLabFeedback(
            createLabFeedback(
              `Captured manual workflow step ${activeWorkflowRecording.steps.length + 1}.`,
              'success',
            ),
          );
        });
      } else {
        pendingManualCaptureCountRef.current = Math.max(
          0,
          pendingManualCaptureCountRef.current - 1,
        );
      }
    } finally {
      setWorkflowBusy(false);
    }
  }

  async function saveWorkflowStepExpectation(args: {
    recordingId: string;
    stepId: string;
    expectation: WorkflowRecordingStep['expectation'];
  }) {
    const recording = workflowRecordings.find(item => item.id === args.recordingId);

    if (recording == null) {
      return;
    }

    const nextRecording: WorkflowRecordingRecord = {
      ...recording,
      steps: recording.steps.map(step =>
        step.id === args.stepId
          ? {
              ...step,
              expectation: {
                ...args.expectation,
                note: args.expectation.note.trim(),
                expectedDecision:
                  args.expectation.expectedDecision?.trim().length
                    ? args.expectation.expectedDecision.trim()
                    : null,
                labeledAt: createOccurredAt(),
              },
            }
          : step,
      ),
    };

    setWorkflowBusy(true);

    try {
      await persistWorkflowRecording(nextRecording);
      startTransition(() => {
        if (activeWorkflowRecordingId === nextRecording.id) {
          activeWorkflowRecordingRef.current = nextRecording;
        }
        setSelectedWorkflowRecordingId(nextRecording.id);
        setLabFeedback(
          createLabFeedback(
            `Saved labels for workflow "${nextRecording.label}".`,
            'success',
          ),
        );
      });
    } catch (error) {
      startTransition(() => {
        setLabFeedback(
          createLabFeedback(
            error instanceof Error
              ? error.message
              : 'Failed to save workflow labels.',
            'error',
          ),
        );
      });
    } finally {
      setWorkflowBusy(false);
    }
  }

  async function replaySelectedWorkflowRecording() {
    if (selectedWorkflowRecording == null) {
      return;
    }

    setWorkflowReplayBusy(true);

    try {
      const replayResult = await replayWorkflowRecording({
        recording: selectedWorkflowRecording,
      });
      const nextRecording: WorkflowRecordingRecord = {
        ...selectedWorkflowRecording,
        lastReplay: replayResult.replay,
      };

      await persistWorkflowRecording(nextRecording);

      startTransition(() => {
        if (activeWorkflowRecordingId === nextRecording.id) {
          activeWorkflowRecordingRef.current = nextRecording;
        }
        setSelectedWorkflowRecordingId(nextRecording.id);
        setLabFeedback(
          createLabFeedback(
            `Workflow replay finished with ${replayResult.replay.matchedCount} matched and ${replayResult.replay.mismatchedCount} mismatched labeled steps.`,
            replayResult.replay.mismatchedCount > 0 ? 'warning' : 'success',
          ),
        );
      });
    } catch (error) {
      startTransition(() => {
        setLabFeedback(
          createLabFeedback(
            error instanceof Error
              ? error.message
              : 'Failed to replay the selected workflow.',
            'error',
          ),
        );
      });
    } finally {
      setWorkflowReplayBusy(false);
    }
  }

  async function deleteSelectedWorkflowRecording() {
    if (selectedWorkflowRecording == null) {
      return;
    }

    setWorkflowBusy(true);

    try {
      await deleteWorkflowRecording(selectedWorkflowRecording.id);

      startTransition(() => {
        setWorkflowRecordings(previousRecordings =>
          previousRecordings.filter(
            recording => recording.id !== selectedWorkflowRecording.id,
          ),
        );
        setActiveWorkflowRecordingId(previousId =>
          previousId === selectedWorkflowRecording.id ? null : previousId,
        );
        setSelectedWorkflowRecordingId(previousId => {
          if (previousId !== selectedWorkflowRecording.id) {
            return previousId;
          }

          const remainingRecordings = workflowRecordings.filter(
            recording => recording.id !== selectedWorkflowRecording.id,
          );
          return remainingRecordings.length > 0 ? remainingRecordings[0].id : null;
        });
        setLabFeedback(
          createLabFeedback(
            `Deleted workflow "${selectedWorkflowRecording.label}".`,
            'success',
          ),
        );
      });
      if (activeWorkflowRecordingRef.current?.id === selectedWorkflowRecording.id) {
        activeWorkflowRecordingRef.current = null;
      }
    } catch (error) {
      startTransition(() => {
        setLabFeedback(
          createLabFeedback(
            error instanceof Error
              ? error.message
              : 'Failed to delete the selected workflow.',
            'error',
          ),
        );
      });
    } finally {
      setWorkflowBusy(false);
    }
  }

  async function deleteSelectedFixture() {
    if (selectedFixture == null) {
      return;
    }

    setFixtureBusy(true);

    try {
      await deleteObservationFixture(selectedFixture.id);

      startTransition(() => {
        setFixtures(previousFixtures =>
          previousFixtures.filter(fixture => fixture.id !== selectedFixture.id),
        );
        setSelectedFixtureId(previousId => {
          if (previousId !== selectedFixture.id) {
            return previousId;
          }

          const remainingFixtures = fixtures.filter(
            fixture => fixture.id !== selectedFixture.id,
          );
          return remainingFixtures.length > 0 ? remainingFixtures[0].id : null;
        });
        setLabFeedback(
          createLabFeedback(
            `Deleted fixture "${selectedFixture.label}".`,
            'success',
          ),
        );
      });
    } catch (error) {
      startTransition(() => {
        setLabFeedback(
          createLabFeedback(
            error instanceof Error ? error.message : 'Failed to delete fixture.',
            'error',
          ),
        );
      });
    } finally {
      setFixtureBusy(false);
    }
  }

  async function saveSelectedFixtureRating() {
    if (selectedFixture == null) {
      return;
    }

    const nextFixture: ObservationFixtureRecord = {
      ...selectedFixture,
      rating: {
        usefulness: ratingDraft.usefulness,
        confidenceCalibration: ratingDraft.confidenceCalibration,
        sensitivityHandling: ratingDraft.sensitivityHandling,
        notes: ratingDraft.notes.trim(),
        ratedAt: createOccurredAt(),
      },
    };

    setFixtureBusy(true);

    try {
      await persistFixture(nextFixture);

      startTransition(() => {
        setLabFeedback(
          createLabFeedback(
            `Saved review scores for "${selectedFixture.label}".`,
            'success',
          ),
        );
      });
    } catch (error) {
      startTransition(() => {
        setLabFeedback(
          createLabFeedback(
            error instanceof Error
              ? error.message
              : 'Failed to save fixture scores.',
            'error',
          ),
        );
      });
    } finally {
      setFixtureBusy(false);
    }
  }

  return {
    ...timeline,
    currentContext,
    settings,
    setSettings,
    saveSettings,
    settingsBusy,
    settingsPath,
    latestObservationRun,
    observeLatestCapture,
    observationBusy,
    fixtures,
    fixturesDirectoryPath,
    selectedFixtureId,
    setSelectedFixtureId,
    selectedFixture,
    fixtureLabelDraft,
    setFixtureLabelDraft,
    saveLatestCaptureAsFixture,
    runFixtureObservation,
    runAllFixtures,
    deleteSelectedFixture,
    fixtureBusy,
    batchBusy,
    ratingDraft,
    setRatingDraft,
    saveSelectedFixtureRating,
    fixtureSummary,
    workflowRecordings,
    workflowRecordingsDirectoryPath,
    selectedWorkflowRecordingId,
    setSelectedWorkflowRecordingId,
    selectedWorkflowRecording,
    activeWorkflowRecording,
    activeWorkflowRecordingId,
    workflowLabelDraft,
    setWorkflowLabelDraft,
    workflowDescriptionDraft,
    setWorkflowDescriptionDraft,
    workflowBusy,
    workflowReplayBusy,
    startWorkflowRecording,
    stopWorkflowRecording,
    recordWorkflowStepNow,
    saveWorkflowStepExpectation,
    replaySelectedWorkflowRecording,
    deleteSelectedWorkflowRecording,
    labFeedback,
  };
}
