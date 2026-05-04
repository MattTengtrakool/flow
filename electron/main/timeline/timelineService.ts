import {BrowserWindow, ipcMain} from 'electron';

import type {
  CalendarItemUpdate,
  CalendarRecurrenceRule,
  CreateCalendarItemInput,
  UserCalendarItem,
} from '../../../src/calendar/types';
import {generateStructuredObservationForCapture} from '../../../src/observation/runObservationForCapture';
import {PLANNER_CONFIG} from '../../../src/planner/config';
import {runPlannerRevision} from '../../../src/planner/revisionEngine';
import {
  sanitizeCalendarItem,
  sanitizeCalendarItemUpdate,
  sanitizeCreateCalendarItemInput,
  sanitizeCaptureMetadata,
  sanitizeContextSnapshot,
  sanitizeInspection,
  sanitizeObservationRun,
  sanitizeObservationSummary,
  sanitizeStructuredObservation,
} from '../../../src/privacy/redaction';
import {
  applyEventInPlace,
  createDomainId,
  createEmptyTimeline,
  createOccurredAt,
  getCurrentContext,
  getVisibleObservations,
  replayEventLog,
  type DomainEvent,
  type TimelineView,
} from '../../../src/timeline/eventLog';
import {captureClient} from '../capture/captureService';
import {loadEventLog, saveEventLog} from '../storage/eventLogStorage';

const EVENT_LOG_SAVE_DEBOUNCE_MS = 500;
const CONTINUOUS_CAPTURE_INTERVAL_MS = 1000;
const DEFAULT_CALENDAR_ITEM_DURATION_MS = 60 * 60 * 1000;
const VALID_RECURRENCE_FREQUENCIES = new Set([
  'daily',
  'weekly',
  'monthly',
  'yearly',
]);

type TimelineStatePayload = {
  eventLogLength: number;
  timeline: TimelineView;
  hydrationStatus: 'loading' | 'ready' | 'error';
  storagePath: string | null;
  errorMessage: string | null;
  captureEnabled: boolean;
  captureStatusMessage: string;
  plannerInFlight: boolean;
};

function trimCalendarText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeDateTime(value: unknown, fallbackMs: number): string {
  if (typeof value !== 'string') return new Date(fallbackMs).toISOString();
  const ms = Date.parse(value);
  return Number.isFinite(ms)
    ? new Date(ms).toISOString()
    : new Date(fallbackMs).toISOString();
}

function normalizeUntilDate(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function normalizeRecurrence(
  recurrence: CreateCalendarItemInput['recurrence'] | undefined,
): CalendarRecurrenceRule | null {
  if (recurrence == null) return null;
  if (!VALID_RECURRENCE_FREQUENCIES.has(recurrence.frequency)) return null;
  const interval = Math.max(1, Math.floor(recurrence.interval || 1));
  const daysOfWeek = Array.isArray(recurrence.daysOfWeek)
    ? Array.from(
        new Set(
          recurrence.daysOfWeek
            .map(day => Math.floor(day))
            .filter(day => day >= 0 && day <= 6),
        ),
      ).sort((a, b) => a - b)
    : undefined;

  return {
    frequency: recurrence.frequency,
    interval,
    daysOfWeek:
      recurrence.frequency === 'weekly' && daysOfWeek != null && daysOfWeek.length > 0
        ? daysOfWeek
        : undefined,
    until: normalizeUntilDate(recurrence.until),
  };
}

function normalizeCreateCalendarItemInput(
  input: CreateCalendarItemInput,
): CreateCalendarItemInput {
  const startAt = normalizeDateTime(input.startAt, Date.now());
  const startMs = Date.parse(startAt);
  const parsedEndMs = Date.parse(input.endAt);
  const endAt =
    Number.isFinite(parsedEndMs) && parsedEndMs > startMs
      ? new Date(parsedEndMs).toISOString()
      : new Date(startMs + DEFAULT_CALENDAR_ITEM_DURATION_MS).toISOString();
  const kind = input.kind === 'task' ? 'task' : 'event';
  const fallbackTitle = kind === 'task' ? 'Untitled task' : 'Untitled event';
  const title = trimCalendarText(input.title) || fallbackTitle;

  return {
    kind,
    title,
    description: trimCalendarText(input.description),
    location: trimCalendarText(input.location),
    startAt,
    endAt,
    recurrence: normalizeRecurrence(input.recurrence),
  };
}

function createInputFromItem(item: UserCalendarItem): CreateCalendarItemInput {
  return {
    kind: item.kind,
    title: item.title,
    description: item.description,
    location: item.location,
    startAt: item.startAt,
    endAt: item.endAt,
    recurrence: item.recurrence,
  };
}

class ElectronTimelineService {
  private eventLog: DomainEvent[] = [];
  private timeline: TimelineView = createEmptyTimeline();
  private hydrationStatus: TimelineStatePayload['hydrationStatus'] = 'loading';
  private storagePath: string | null = null;
  private errorMessage: string | null = null;
  private captureEnabled = false;
  private captureStatusMessage = 'Continuous capture is off.';
  private plannerInFlight = false;
  private persistTimer: NodeJS.Timeout | null = null;
  private captureTimer: NodeJS.Timeout | null = null;
  private observationBusy = false;
  private lastObservedFrameHash: string | null = null;

  constructor() {
    captureClient.on('contextSnapshotDidChange', snapshot => {
      const sanitizedSnapshot = sanitizeContextSnapshot(snapshot) ?? snapshot;
      this.appendEvents([
        {
          id: createDomainId('event'),
          type: 'context_snapshot_recorded',
          snapshotId: createDomainId('context'),
          snapshot: sanitizedSnapshot,
          occurredAt: sanitizedSnapshot.recordedAt,
        },
      ]);
    });
  }

  async hydrate() {
    try {
      const payload = await loadEventLog();
      this.eventLog = payload.eventLog;
      this.timeline = replayEventLog(payload.eventLog);
      this.storagePath = payload.filePath;
      this.hydrationStatus = 'ready';
      this.errorMessage = null;
      await this.startContextMonitoring();
    } catch (error) {
      this.hydrationStatus = 'error';
      this.errorMessage =
        error instanceof Error ? error.message : 'Failed to load event log.';
    }
    this.broadcast();
  }

  private async startContextMonitoring() {
    const snapshot = await captureClient.startMonitoring({
      preciseModeEnabled: true,
      idleThresholdSeconds: 60,
    });
    const sanitizedSnapshot = sanitizeContextSnapshot(snapshot) ?? snapshot;
    this.appendEvents([
      {
        id: createDomainId('event'),
        type: 'context_snapshot_recorded',
        snapshotId: createDomainId('context'),
        snapshot: sanitizedSnapshot,
        occurredAt: sanitizedSnapshot.recordedAt,
      },
    ]);
  }

  snapshot(): TimelineStatePayload {
    // Strip four large dicts the renderer never reads. It uses the order arrays
    // for counts (Settings screen) and planSnapshots for calendar display.
    // Stripping them keeps the IPC payload small regardless of session length.
    const leanTimeline: TimelineView = {
      ...this.timeline,
      captureRecordsById: {},
      captureInspectionsById: {},
      contextSnapshotsById: {},
      observationsById: {},
    };
    return {
      eventLogLength: this.eventLog.length,
      timeline: leanTimeline,
      hydrationStatus: this.hydrationStatus,
      storagePath: this.storagePath,
      errorMessage: this.errorMessage,
      captureEnabled: this.captureEnabled,
      captureStatusMessage: this.captureStatusMessage,
      plannerInFlight: this.plannerInFlight,
    };
  }

  private broadcast() {
    const payload = this.snapshot();
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('flow:timeline:stateChanged', payload);
    }
  }

  private appendEvents(events: DomainEvent[]) {
    if (events.length === 0) return;
    for (const event of events) {
      applyEventInPlace(this.timeline, event);
    }
    this.eventLog.push(...events);
    this.trimTimeline();
    this.schedulePersist();
    this.broadcast();
  }

  // Cap the in-memory timeline to prevent unbounded RAM growth during long sessions.
  // The on-disk event log is the source of truth and is not affected — on restart
  // replayEventLog rebuilds the full view from disk. The renderer only needs recent
  // data for display; planSnapshots are preserved in full for the calendar selectors.
  private trimTimeline() {
    const MAX_CAPTURES = 5_000;
    const MAX_INSPECTIONS = 5_000;
    const MAX_CONTEXT_SNAPSHOTS = 5_000;
    const MAX_OBSERVATIONS = 2_000;

    const t = this.timeline;

    if (t.captureRecordOrder.length > MAX_CAPTURES) {
      const excess = t.captureRecordOrder.splice(0, t.captureRecordOrder.length - MAX_CAPTURES);
      for (const id of excess) delete t.captureRecordsById[id];
    }
    if (t.captureInspectionOrder.length > MAX_INSPECTIONS) {
      const excess = t.captureInspectionOrder.splice(0, t.captureInspectionOrder.length - MAX_INSPECTIONS);
      for (const id of excess) delete t.captureInspectionsById[id];
    }
    if (t.contextSnapshotOrder.length > MAX_CONTEXT_SNAPSHOTS) {
      const excess = t.contextSnapshotOrder.splice(0, t.contextSnapshotOrder.length - MAX_CONTEXT_SNAPSHOTS);
      for (const id of excess) delete t.contextSnapshotsById[id];
    }
    if (t.observationOrder.length > MAX_OBSERVATIONS) {
      const excess = t.observationOrder.splice(0, t.observationOrder.length - MAX_OBSERVATIONS);
      for (const id of excess) delete t.observationsById[id];
    }
  }

  private schedulePersist() {
    if (this.hydrationStatus !== 'ready') return;
    if (this.persistTimer != null) {
      clearTimeout(this.persistTimer);
    }
    this.persistTimer = setTimeout(() => {
      saveEventLog(this.eventLog)
        .then(payload => {
          this.storagePath = payload.filePath;
          this.errorMessage = null;
          this.broadcast();
        })
        .catch(error => {
          this.errorMessage =
            error instanceof Error ? error.message : 'Failed to save event log.';
          this.broadcast();
        });
    }, EVENT_LOG_SAVE_DEBOUNCE_MS);
  }

  startSession() {
    if (this.timeline.currentSessionId != null) return this.snapshot();
    this.appendEvents([
      {
        id: createDomainId('event'),
        type: 'session_started',
        sessionId: createDomainId('session'),
        title: `Session ${this.timeline.sessionOrder.length + 1}`,
        occurredAt: createOccurredAt(),
      },
    ]);
    this.captureEnabled = true;
    this.captureStatusMessage = 'Continuous capture is running.';
    this.ensureCaptureTimer();
    this.broadcast();
    return this.snapshot();
  }

  async stopSession() {
    const sessionId = this.timeline.currentSessionId;
    if (sessionId == null) return this.snapshot();
    await this.runPlannerRevision(true);
    this.appendEvents([
      {
        id: createDomainId('event'),
        type: 'session_stopped',
        sessionId,
        occurredAt: createOccurredAt(),
      },
    ]);
    this.captureEnabled = false;
    this.captureStatusMessage = 'Continuous capture is off.';
    this.clearCaptureTimer();
    this.broadcast();
    return this.snapshot();
  }

  private ensureCaptureTimer() {
    if (this.captureTimer != null) return;
    this.captureTimer = setInterval(() => {
      this.captureNow().catch(() => {});
    }, CONTINUOUS_CAPTURE_INTERVAL_MS);
  }

  private clearCaptureTimer() {
    if (this.captureTimer != null) {
      clearInterval(this.captureTimer);
      this.captureTimer = null;
    }
  }

  async captureNow() {
    const result = await captureClient.captureNow();
    const captureMetadata = sanitizeCaptureMetadata({
      ...result.metadata,
      staleFrame: false,
      blankFrame: false,
    });
    this.appendEvents([
      {
        id: createDomainId('event'),
        type: 'capture_target_resolved',
        inspectionId: createDomainId('inspection'),
        inspection: sanitizeInspection(result.inspection),
        occurredAt: result.inspection.inspectedAt,
      },
      {
        id: createDomainId('event'),
        type: 'capture_performed',
        captureId: createDomainId('capture'),
        capture: captureMetadata,
        occurredAt: captureMetadata.capturedAt,
      },
    ]);

    if (
      !this.captureEnabled ||
      result.metadata.status !== 'captured' ||
      this.observationBusy ||
      (captureMetadata.frameHash != null &&
        captureMetadata.frameHash === this.lastObservedFrameHash)
    ) {
      return result;
    }

    this.observationBusy = true;
    this.captureStatusMessage = 'Generating a structured observation.';
    this.broadcast();
    try {
      const run = await generateStructuredObservationForCapture({
        preview: {
          dataUri:
            result.previewBase64 != null && result.previewMimeType != null
              ? `data:${result.previewMimeType};base64,${result.previewBase64}`
              : null,
          mimeType: result.previewMimeType,
          metadata: captureMetadata,
          ocrText: result.ocrText,
        },
        inspection: result.inspection,
        currentContext: getCurrentContext(this.timeline),
        recentObservations: getVisibleObservations(this.timeline)
          .filter(observation => observation.structured != null)
          .slice(-5)
          .map(observation => observation.structured!),
        apiKey: process.env.GEMINI_API_KEY,
      });
      this.appendEvents([
        {
          id: createDomainId('event'),
          type: 'observation_added',
          observationId: createDomainId('observation'),
          sessionId: this.timeline.currentSessionId ?? undefined,
          text: sanitizeObservationSummary(run.observation.summary),
          structured: sanitizeStructuredObservation(run.observation),
          engineRun: sanitizeObservationRun(run),
          capturePreviewDataUri: null,
          occurredAt: captureMetadata.capturedAt,
        },
      ]);
      this.lastObservedFrameHash = captureMetadata.frameHash;
      this.captureStatusMessage = 'Captured the latest changed frame.';
    } catch (error) {
      this.captureStatusMessage =
        error instanceof Error ? error.message : 'Observation generation failed.';
    } finally {
      this.observationBusy = false;
      this.broadcast();
    }
    return result;
  }

  async runPlannerRevision(force = false) {
    if (this.plannerInFlight) return this.snapshot();
    this.plannerInFlight = true;
    this.broadcast();
    try {
      const result = await runPlannerRevision({
        timeline: this.timeline,
        cause: 'manual',
        force,
        windowMs: PLANNER_CONFIG.plannerRevisionWindowMs,
        maxObservationsInPrompt:
          PLANNER_CONFIG.plannerRevisionMaxObservationsInPrompt,
        apiKey: process.env.GEMINI_API_KEY,
      });
      if (result.kind !== 'skipped') {
        this.appendEvents(result.events);
      }
      this.errorMessage = result.kind === 'failure' ? result.failure.message : null;
    } catch (error) {
      this.errorMessage =
        error instanceof Error ? error.message : 'Planner revision failed.';
    } finally {
      this.plannerInFlight = false;
      this.broadcast();
    }
    return this.snapshot();
  }

  editBlockNotes(args: {notesKey: string; blockId: string | null; notes: string}) {
    this.appendEvents([
      {
        id: createDomainId('event'),
        type: 'user_block_notes_edited',
        notesKey: args.notesKey,
        blockId: args.blockId,
        notes: args.notes,
        occurredAt: createOccurredAt(),
      },
    ]);
    return this.snapshot();
  }

  createCalendarItem(input: CreateCalendarItemInput) {
    const occurredAt = createOccurredAt();
    const normalized = sanitizeCreateCalendarItemInput(
      normalizeCreateCalendarItemInput(input),
    );
    const item = sanitizeCalendarItem({
      id: createDomainId('calendar_item'),
      ...normalized,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    });
    this.appendEvents([
      {
        id: createDomainId('event'),
        type: 'calendar_item_created',
        item,
        occurredAt,
      },
    ]);
    return this.snapshot();
  }

  updateCalendarItem(args: {itemId: string; updates: CalendarItemUpdate}) {
    const current = this.timeline.calendarItemsById[args.itemId];
    if (current == null || current.deletedAt != null) return this.snapshot();

    const normalized = normalizeCreateCalendarItemInput({
      ...createInputFromItem(current),
      ...args.updates,
    });
    const updates = sanitizeCalendarItemUpdate(normalized);
    this.appendEvents([
      {
        id: createDomainId('event'),
        type: 'calendar_item_updated',
        itemId: args.itemId,
        updates,
        occurredAt: createOccurredAt(),
      },
    ]);
    return this.snapshot();
  }

  deleteCalendarItem(itemId: string) {
    if (this.timeline.calendarItemsById[itemId] == null) return this.snapshot();
    this.appendEvents([
      {
        id: createDomainId('event'),
        type: 'calendar_item_deleted',
        itemId,
        occurredAt: createOccurredAt(),
      },
    ]);
    return this.snapshot();
  }
}

export const timelineService = new ElectronTimelineService();

export function registerTimelineIpcHandlers() {
  ipcMain.handle('flow:timeline:getState', () => timelineService.snapshot());
  ipcMain.handle('flow:timeline:startSession', () => timelineService.startSession());
  ipcMain.handle('flow:timeline:stopSession', () => timelineService.stopSession());
  ipcMain.handle('flow:timeline:captureNow', () => timelineService.captureNow());
  ipcMain.handle('flow:timeline:runPlannerRevision', (_event, force: boolean) =>
    timelineService.runPlannerRevision(force),
  );
  ipcMain.handle('flow:timeline:editBlockNotes', (_event, args) =>
    timelineService.editBlockNotes(args),
  );
  ipcMain.handle('flow:timeline:createCalendarItem', (_event, input) =>
    timelineService.createCalendarItem(input),
  );
  ipcMain.handle('flow:timeline:updateCalendarItem', (_event, args) =>
    timelineService.updateCalendarItem(args),
  );
  ipcMain.handle('flow:timeline:deleteCalendarItem', (_event, itemId) =>
    timelineService.deleteCalendarItem(itemId),
  );
}
