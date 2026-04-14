import {startTransition, useEffect, useMemo, useState} from 'react';

import {
  createDomainId,
  createOccurredAt,
  getCurrentContext,
} from '../state/eventLog';
import {useEventSourcedTimeline} from '../state/useEventSourcedTimeline';
import {
  DEFAULT_OBSERVATION_MODEL,
  generateObservationWithOpenAI,
} from './openaiObservationEngine';
import {createFixtureRatingSummary} from './fixtureSummary';
import type {
  ObservationFixtureRating,
  ObservationFixtureRecord,
  ObservationRun,
  ObservationSettings,
} from './types';
import {
  deleteObservationFixture,
  loadObservationFixtures,
  loadObservationSettings,
  saveObservationFixture,
  saveObservationSettings,
} from '../storage/observationLabStorage';

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

function getEffectiveModel(model: string): string {
  const trimmedModel = model.trim();
  return trimmedModel.length > 0 ? trimmedModel : DEFAULT_OBSERVATION_MODEL;
}

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

function toBase64Payload(dataUri: string | null): string | null {
  if (dataUri == null) {
    return null;
  }

  const separatorIndex = dataUri.indexOf(',');

  return separatorIndex >= 0 ? dataUri.slice(separatorIndex + 1) : dataUri;
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

export function useObservationLab() {
  const timeline = useEventSourcedTimeline();
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
        const [settingsPayload, fixturesPayload] = await Promise.all([
          loadObservationSettings(),
          loadObservationFixtures(),
        ]);

        if (isCancelled) {
          return;
        }

        startTransition(() => {
          setSettings(settingsPayload.settings);
          setSettingsPath(settingsPayload.filePath);
          setFixtures(sortFixtures(fixturesPayload.fixtures));
          setFixturesDirectoryPath(fixturesPayload.directoryPath);
          setSelectedFixtureId(previousId =>
            previousId ??
            (fixturesPayload.fixtures.length > 0 ? fixturesPayload.fixtures[0].id : null),
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
  const fixtureSummary = useMemo(
    () => createFixtureRatingSummary(fixtures),
    [fixtures],
  );

  useEffect(() => {
    if (selectedFixture?.rating != null) {
      setRatingDraft(selectedFixture.rating);
      return;
    }

    setRatingDraft(EMPTY_RATING);
  }, [selectedFixture]);

  async function persistFixture(nextFixture: ObservationFixtureRecord) {
    const payload = await saveObservationFixture(nextFixture);

    startTransition(() => {
      setFixtures(previousFixtures =>
        sortFixtures(
          previousFixtures.some(fixture => fixture.id === nextFixture.id)
            ? previousFixtures.map(fixture =>
                fixture.id === nextFixture.id ? nextFixture : fixture,
              )
            : [...previousFixtures, nextFixture],
        ),
      );
      setFixturesDirectoryPath(payload.filePath.replace(/\/[^/]+$/, ''));
    });
  }

  async function saveSettings() {
    setSettingsBusy(true);

    try {
      const nextSettings: ObservationSettings = {
        apiKey: settings.apiKey.trim(),
        model: getEffectiveModel(settings.model),
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

  async function observeLatestCapture() {
    const preview = timeline.latestCapturePreview;
    const latestInspection = timeline.latestInspection;
    const imageBase64 = toBase64Payload(preview?.dataUri ?? null);
    const imageMimeType = preview?.mimeType ?? null;

    if (
      preview == null ||
      latestInspection == null ||
      preview.metadata.status !== 'captured' ||
      imageBase64 == null ||
      imageMimeType == null
    ) {
      startTransition(() => {
        setLabFeedback(
          createLabFeedback(
            'Capture a successful screenshot before running a real observation.',
            'warning',
          ),
        );
      });
      return;
    }

    setObservationBusy(true);

    try {
      const run = await generateObservationWithOpenAI(
        settings.apiKey,
        {
          imageBase64,
          imageMimeType,
          inspection: latestInspection,
          capture: preview.metadata,
          currentContext,
          recentObservations: recentStructuredObservations,
        },
        getEffectiveModel(settings.model),
      );

      startTransition(() => {
        setLatestObservationRun(run);
        setLabFeedback(
          createLabFeedback(
            `Observation generated in ${run.durationMs} ms with ${run.model}.`,
            'success',
          ),
        );
      });

      timeline.recordStructuredObservation(run, preview.metadata.capturedAt);
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
    } finally {
      setObservationBusy(false);
    }
  }

  async function saveLatestCaptureAsFixture() {
    const preview = timeline.latestCapturePreview;
    const latestInspection = timeline.latestInspection;
    const imageBase64 = toBase64Payload(preview?.dataUri ?? null);
    const imageMimeType = preview?.mimeType ?? null;

    if (
      preview == null ||
      latestInspection == null ||
      preview.metadata.status !== 'captured' ||
      imageBase64 == null ||
      imageMimeType == null
    ) {
      startTransition(() => {
        setLabFeedback(
          createLabFeedback(
            'Capture a successful screenshot before saving a fixture.',
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
      const run = await generateObservationWithOpenAI(
        settings.apiKey,
        {
          imageBase64: fixture.imageBase64,
          imageMimeType: fixture.imageMimeType,
          inspection: fixture.inspection,
          capture: fixture.capture,
          currentContext: fixture.inspection.context,
          recentObservations: [],
        },
        getEffectiveModel(settings.model),
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
        const run = await generateObservationWithOpenAI(
          settings.apiKey,
          {
            imageBase64: fixture.imageBase64,
            imageMimeType: fixture.imageMimeType,
            inspection: fixture.inspection,
            capture: fixture.capture,
            currentContext: fixture.inspection.context,
            recentObservations: [],
          },
          getEffectiveModel(settings.model),
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
    labFeedback,
  };
}
