import {startTransition, useEffect, useReducer, useRef} from 'react';

import {loadPersistedEventLog, savePersistedEventLog} from '../storage/eventLogStorage';
import {
  createEmptyTimeline,
  replayEventLog,
  stepEvent,
  type DomainEvent,
  type TimelineView,
} from './eventLog';
import {useStableEvent} from './useStableEvent';

const EVENT_LOG_SAVE_DEBOUNCE_MS = 500;

export type HydrationStatus = 'loading' | 'ready' | 'error';

export type TimelineStoreState = {
  eventLog: DomainEvent[];
  timeline: TimelineView;
  hydrationStatus: HydrationStatus;
  storagePath: string | null;
  lastSavedAt: string | null;
  errorMessage: string | null;
  lastPersistDurationMs: number | null;
  lastPersistBytes: number | null;
};

type TimelineStoreAction =
  | {type: 'hydrate_succeeded'; eventLog: DomainEvent[]; storagePath: string}
  | {type: 'hydrate_failed'; errorMessage: string}
  | {type: 'append_event'; event: DomainEvent}
  | {type: 'append_events'; events: DomainEvent[]}
  | {
      type: 'persist_succeeded';
      storagePath: string;
      savedAt: string;
      durationMs: number;
      bytes: number;
    }
  | {type: 'persist_failed'; errorMessage: string};

function reducer(
  state: TimelineStoreState,
  action: TimelineStoreAction,
): TimelineStoreState {
  switch (action.type) {
    case 'hydrate_succeeded':
      return {
        ...state,
        eventLog: action.eventLog,
        timeline: replayEventLog(action.eventLog),
        hydrationStatus: 'ready',
        storagePath: action.storagePath,
        errorMessage: null,
      };
    case 'hydrate_failed':
      return {
        ...state,
        hydrationStatus: 'error',
        errorMessage: action.errorMessage,
      };
    case 'append_event':
      return {
        ...state,
        eventLog: [...state.eventLog, action.event],
        timeline: stepEvent(state.timeline, action.event),
      };
    case 'append_events': {
      let timeline = state.timeline;
      for (const event of action.events) {
        timeline = stepEvent(timeline, event);
      }
      return {
        ...state,
        eventLog: [...state.eventLog, ...action.events],
        timeline,
      };
    }
    case 'persist_succeeded':
      return {
        ...state,
        storagePath: action.storagePath,
        lastSavedAt: action.savedAt,
        lastPersistDurationMs: action.durationMs,
        lastPersistBytes: action.bytes,
        errorMessage: null,
      };
    case 'persist_failed':
      return {...state, errorMessage: action.errorMessage};
  }
}

function createInitialState(): TimelineStoreState {
  return {
    eventLog: [],
    timeline: createEmptyTimeline(),
    hydrationStatus: 'loading',
    storagePath: null,
    lastSavedAt: null,
    errorMessage: null,
    lastPersistDurationMs: null,
    lastPersistBytes: null,
  };
}

export function useTimelinePersistence() {
  const [store, dispatch] = useReducer(reducer, undefined, createInitialState);
  const timelineRef = useRef(store.timeline);
  const eventLogRef = useRef(store.eventLog);

  useEffect(() => {
    timelineRef.current = store.timeline;
    eventLogRef.current = store.eventLog;
  }, [store.eventLog, store.timeline]);

  const appendEvent = useStableEvent((event: DomainEvent) => {
    startTransition(() => {
      dispatch({type: 'append_event', event});
    });
  });

  const appendEvents = useStableEvent((events: DomainEvent[]) => {
    if (events.length === 0) return;
    startTransition(() => {
      dispatch({type: 'append_events', events});
    });
  });

  useEffect(() => {
    let cancelled = false;
    loadPersistedEventLog()
      .then(payload => {
        if (cancelled) return;
        startTransition(() => {
          dispatch({
            type: 'hydrate_succeeded',
            eventLog: payload.eventLog,
            storagePath: payload.filePath,
          });
        });
      })
      .catch(error => {
        if (cancelled) return;
        startTransition(() => {
          dispatch({
            type: 'hydrate_failed',
            errorMessage:
              error instanceof Error ? error.message : 'Failed to load event log.',
          });
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (store.hydrationStatus !== 'ready') return;
    let cancelled = false;
    const timeoutId = setTimeout(() => {
      const startedAt = Date.now();
      const eventLog = eventLogRef.current;
      savePersistedEventLog(eventLog)
        .then(payload => {
          if (cancelled) return;
          startTransition(() => {
            dispatch({
              type: 'persist_succeeded',
              storagePath: payload.filePath,
              savedAt: payload.savedAt,
              durationMs: Date.now() - startedAt,
              bytes: JSON.stringify(eventLog).length,
            });
          });
        })
        .catch(error => {
          if (cancelled) return;
          startTransition(() => {
            dispatch({
              type: 'persist_failed',
              errorMessage:
                error instanceof Error
                  ? error.message
                  : 'Failed to save event log.',
            });
          });
        });
    }, EVENT_LOG_SAVE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [store.eventLog, store.hydrationStatus]);

  return {
    store,
    timelineRef,
    eventLogRef,
    appendEvent,
    appendEvents,
  };
}
