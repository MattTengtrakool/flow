import {useRef, type MutableRefObject} from 'react';

import type {CapturePreviewState} from '../capture/useCaptureController';
import {
  createDomainId,
  createOccurredAt,
  getCurrentContext,
  getVisibleObservations,
  type DomainEvent,
  type ObservationAddedEvent,
  type TimelineView,
} from '../timeline/eventLog';
import {useStableEvent} from '../timeline/useStableEvent';
import type {CaptureInspectionPayload} from '../types/contextCapture';
import {
  sanitizeObservationRun,
  sanitizeObservationSummary,
  sanitizeStructuredObservation,
} from '../privacy/redaction';
import type {ObservationRun} from './types';
import {generateStructuredObservationForCapture} from './runObservationForCapture';

function getRecentStructuredObservations(timeline: TimelineView) {
  return getVisibleObservations(timeline)
    .filter(observation => observation.structured != null)
    .slice(-5)
    .map(observation => observation.structured!);
}

export function useObservationRecorder(args: {
  timelineRef: MutableRefObject<TimelineView>;
  appendEvent: (event: DomainEvent) => void;
  onObservationRecorded: () => void;
}) {
  const capturePreviewsRef = useRef(new Map<string, string>());
  const observationBusyRef = useRef(false);

  const recordObservationEvent = useStableEvent((event: ObservationAddedEvent) => {
    args.appendEvent(event);
    args.onObservationRecorded();
  });

  const recordStructuredObservation = useStableEvent(
    (
      observationRun: ObservationRun,
      occurredAt = createOccurredAt(),
      capturePreviewDataUri: string | null = null,
    ): string => {
      const observationId = createDomainId('observation');
      if (capturePreviewDataUri != null) {
        capturePreviewsRef.current.set(observationId, capturePreviewDataUri);
      }
      recordObservationEvent({
        id: createDomainId('event'),
        type: 'observation_added',
        observationId,
        sessionId: args.timelineRef.current.currentSessionId ?? undefined,
        text: sanitizeObservationSummary(observationRun.observation.summary),
        structured: sanitizeStructuredObservation(observationRun.observation),
        engineRun: sanitizeObservationRun(observationRun),
        capturePreviewDataUri: null,
        occurredAt,
      });
      return observationId;
    },
  );

  const observeCapture = useStableEvent(
    async (
      preview: CapturePreviewState,
      inspection: CaptureInspectionPayload,
    ): Promise<{observedAt: string; frameHash: string | null} | null> => {
      if (observationBusyRef.current) return null;
      observationBusyRef.current = true;
      try {
        const run = await generateStructuredObservationForCapture({
          preview,
          inspection,
          currentContext: getCurrentContext(args.timelineRef.current),
          recentObservations: getRecentStructuredObservations(args.timelineRef.current),
        });
        recordStructuredObservation(
          run,
          preview.metadata.capturedAt,
          preview.dataUri ?? null,
        );
        return {
          observedAt: preview.metadata.capturedAt,
          frameHash: preview.metadata.frameHash ?? null,
        };
      } finally {
        observationBusyRef.current = false;
      }
    },
  );

  return {
    observeCapture,
    getCapturePreview: (observationId: string) =>
      capturePreviewsRef.current.get(observationId) ?? null,
    capturePreviewCount: capturePreviewsRef.current.size,
  };
}
