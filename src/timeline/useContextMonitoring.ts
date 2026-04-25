import {useEffect} from 'react';

import {
  addContextSnapshotListener,
  startContextMonitoring,
} from '../native/contextCaptureBridge';
import {sanitizeContextSnapshot} from '../privacy/redaction';
import {
  createDomainId,
  type DomainEvent,
} from './eventLog';
import type {HydrationStatus} from './useTimelinePersistence';

export function useContextMonitoring(args: {
  hydrationStatus: HydrationStatus;
  appendEvent: (event: DomainEvent) => void;
  setErrorMessage: (message: string | null) => void;
}) {
  const {appendEvent, hydrationStatus, setErrorMessage} = args;

  useEffect(() => {
    if (hydrationStatus !== 'ready') return;
    let cancelled = false;
    const recordSnapshot = (
      snapshot: Parameters<Parameters<typeof addContextSnapshotListener>[0]>[0],
    ) => {
      if (cancelled) return;
      const sanitizedSnapshot = sanitizeContextSnapshot(snapshot) ?? snapshot;
      appendEvent({
        id: createDomainId('event'),
        type: 'context_snapshot_recorded',
        snapshotId: createDomainId('context'),
        snapshot: sanitizedSnapshot,
        occurredAt: sanitizedSnapshot.recordedAt,
      });
    };

    const subscription = addContextSnapshotListener(recordSnapshot);

    startContextMonitoring({
      preciseModeEnabled: true,
      idleThresholdSeconds: 60,
    })
      .then(recordSnapshot)
      .catch(error => {
        if (!cancelled) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : 'Failed to start passive context monitoring.',
          );
        }
      });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [appendEvent, hydrationStatus, setErrorMessage]);
}
