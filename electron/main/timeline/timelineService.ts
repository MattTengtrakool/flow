import { BrowserWindow, ipcMain } from 'electron';

import { PLANNER_CONFIG } from '../../../src/planner/config';
import type { MeetingRuntimeState } from '../../../src/meetings/types';
import { runPlannerRevision } from '../../../src/planner/revisionEngine';
import {
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
import type { TimelineStatePayload } from '../../shared/flowApi';
import {
  generateManagedObservationForCapture,
  generateManagedReplanBlocks,
} from '../ai/managedAiClient';
import { calendarService } from '../calendar/googleCalendarService';
import { captureClient } from '../capture/captureService';
import { settingsService } from '../settings/settingsService';
import { loadEventLog, saveEventLog } from '../storage/eventLogStorage';

const EVENT_LOG_SAVE_DEBOUNCE_MS = 500;
const CONTINUOUS_CAPTURE_INTERVAL_MS = 1000;

class ElectronTimelineService {
  private eventLog: DomainEvent[] = [];
  private timeline: TimelineView = createEmptyTimeline();
  private hydrationStatus: TimelineStatePayload['hydrationStatus'] = 'loading';
  private storagePath: string | null = null;
  private errorMessage: string | null = null;
  private captureEnabled = false;
  private captureStatusMessage = 'Continuous capture is off.';
  private privacyModeEnabled = false;
  private plannerInFlight = false;
  private plannerLastRunAt: string | null = null;
  private plannerLastSnapshotId: string | null = null;
  private plannerLastFailureMessage: string | null = null;
  private lastCapturedAt: string | null = null;
  private lastObservedAt: string | null = null;
  private meetingRuntimeSnapshot: Pick<
    MeetingRuntimeState,
    'currentDetection' | 'activeRecording' | 'transcriptionStatus'
  > = {
    currentDetection: null,
    activeRecording: null,
    transcriptionStatus: 'idle',
  };
  private persistTimer: NodeJS.Timeout | null = null;
  private captureTimer: NodeJS.Timeout | null = null;
  private observationBusy = false;
  private lastObservedFrameHash: string | null = null;

  constructor() {
    settingsService.on('changed', settings => {
      const wasPrivacyModeEnabled = this.privacyModeEnabled;
      this.privacyModeEnabled = settings.privacyModeEnabled;
      if (settings.privacyModeEnabled && !wasPrivacyModeEnabled) {
        this.captureEnabled = false;
        this.captureStatusMessage = 'Privacy mode is on. Capture is paused.';
        this.clearCaptureTimer();
        captureClient.stopMonitoring().catch(() => {});
      } else if (!settings.privacyModeEnabled && wasPrivacyModeEnabled) {
        this.captureStatusMessage = 'Continuous capture is off.';
        this.startContextMonitoring().catch(() => {});
      }
      this.broadcast();
    });
    captureClient.on('contextSnapshotDidChange', snapshot => {
      if (this.isPrivacyModeEnabled()) return;
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
      this.recoverRuntimeMarkers(payload.eventLog);
      this.storagePath = payload.filePath;
      this.hydrationStatus = 'ready';
      this.errorMessage = null;
      this.privacyModeEnabled =
        settingsService.publicSettings().privacyModeEnabled;
      if (!this.privacyModeEnabled) {
        await this.startContextMonitoring();
      } else {
        this.captureStatusMessage = 'Privacy mode is on. Capture is paused.';
      }
    } catch (error) {
      this.hydrationStatus = 'error';
      this.errorMessage =
        error instanceof Error ? error.message : 'Failed to load event log.';
    }
    this.broadcast();
  }

  private async startContextMonitoring() {
    if (this.isPrivacyModeEnabled()) return;
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

  private isPrivacyModeEnabled() {
    this.privacyModeEnabled =
      settingsService.publicSettings().privacyModeEnabled;
    return this.privacyModeEnabled;
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
    const settings = settingsService.publicSettings();
    return {
      eventLogLength: this.eventLog.length,
      timeline: leanTimeline,
      hydrationStatus: this.hydrationStatus,
      storagePath: this.storagePath,
      errorMessage: this.errorMessage,
      captureEnabled: this.captureEnabled,
      captureStatusMessage: this.captureStatusMessage,
      plannerInFlight: this.plannerInFlight,
      lastCapturedAt: this.lastCapturedAt,
      lastObservedAt: this.lastObservedAt,
      plannerLastRunAt: this.plannerLastRunAt,
      plannerLastSnapshotId: this.plannerLastSnapshotId,
      plannerLastFailureMessage: this.plannerLastFailureMessage,
      plannerStatus: this.plannerInFlight
        ? 'planning'
        : this.plannerLastFailureMessage != null
        ? 'failed'
        : 'idle',
      privacyModeEnabled: settings.privacyModeEnabled,
      aiConnectionMode: settings.aiConnectionMode,
      selectedProvider: settings.selectedProvider,
      managedAi: settings.managedAi,
      apiKeyStatus: settings.apiKeys,
      recentActivity: this.recentActivity(),
      meetingDetection: this.meetingRuntimeSnapshot.currentDetection,
      activeMeetingRecording: this.meetingRuntimeSnapshot.activeRecording,
      meetingTranscriptionStatus:
        this.meetingRuntimeSnapshot.transcriptionStatus,
    };
  }

  private recentActivity(): TimelineStatePayload['recentActivity'] {
    const rows: TimelineStatePayload['recentActivity'] = [];
    for (let i = this.eventLog.length - 1; i >= 0 && rows.length < 8; i -= 1) {
      const event = this.eventLog[i];
      if (event.type === 'capture_performed') {
        rows.push({
          kind: 'capture',
          occurredAt: event.occurredAt,
          title: 'Capture',
          detail: event.capture.status,
        });
      }
      if (event.type === 'observation_added') {
        rows.push({
          kind: 'observation',
          occurredAt: event.occurredAt,
          title: 'Observation',
          detail: event.text,
        });
      }
      if (event.type === 'task_plan_revised') {
        rows.push({
          kind: 'planner',
          occurredAt: event.occurredAt,
          title: 'Plan revised',
          detail: `${event.snapshot.blocks.length} blocks`,
        });
      }
      if (event.type === 'task_plan_revision_failed') {
        rows.push({
          kind: 'planner',
          occurredAt: event.occurredAt,
          title: 'Plan failed',
          detail: event.failure.message,
        });
      }
    }
    return rows;
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

  appendProactiveEvents(events: DomainEvent[]) {
    this.appendEvents(events);
  }

  appendMeetingEvents(events: DomainEvent[]) {
    this.appendEvents(events);
  }

  setMeetingRuntimeSnapshot(
    state: Pick<
      MeetingRuntimeState,
      'currentDetection' | 'activeRecording' | 'transcriptionStatus'
    >,
  ) {
    this.meetingRuntimeSnapshot = state;
  }

  getTimelineForServices(): TimelineView {
    return this.timeline;
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
      const excess = t.captureRecordOrder.splice(
        0,
        t.captureRecordOrder.length - MAX_CAPTURES,
      );
      for (const id of excess) delete t.captureRecordsById[id];
    }
    if (t.captureInspectionOrder.length > MAX_INSPECTIONS) {
      const excess = t.captureInspectionOrder.splice(
        0,
        t.captureInspectionOrder.length - MAX_INSPECTIONS,
      );
      for (const id of excess) delete t.captureInspectionsById[id];
    }
    if (t.contextSnapshotOrder.length > MAX_CONTEXT_SNAPSHOTS) {
      const excess = t.contextSnapshotOrder.splice(
        0,
        t.contextSnapshotOrder.length - MAX_CONTEXT_SNAPSHOTS,
      );
      for (const id of excess) delete t.contextSnapshotsById[id];
    }
    if (t.observationOrder.length > MAX_OBSERVATIONS) {
      const excess = t.observationOrder.splice(
        0,
        t.observationOrder.length - MAX_OBSERVATIONS,
      );
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
            error instanceof Error
              ? error.message
              : 'Failed to save event log.';
          this.broadcast();
        });
    }, EVENT_LOG_SAVE_DEBOUNCE_MS);
  }

  startSession() {
    if (this.isPrivacyModeEnabled()) {
      this.captureStatusMessage = 'Privacy mode is on. Capture is paused.';
      this.broadcast();
      return this.snapshot();
    }
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
    if (this.isPrivacyModeEnabled()) {
      this.captureStatusMessage = 'Privacy mode is on. Capture is paused.';
      this.broadcast();
      throw new Error('Privacy mode is on. Turn it off before capturing.');
    }
    const result = await captureClient.captureNow();
    const captureMetadata = sanitizeCaptureMetadata({
      ...result.metadata,
      staleFrame: false,
      blankFrame: false,
    });
    this.lastCapturedAt = captureMetadata.capturedAt;
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
      const observationArgs = {
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
      };
      const run = await generateManagedObservationForCapture(observationArgs);
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
      this.lastObservedAt = captureMetadata.capturedAt;
      this.captureStatusMessage = 'Captured the latest changed frame.';
    } catch (error) {
      this.captureStatusMessage =
        error instanceof Error
          ? error.message
          : 'Observation generation failed.';
    } finally {
      this.observationBusy = false;
      this.broadcast();
    }
    return result;
  }

  async runPlannerRevision(force = false) {
    if (this.plannerInFlight) return this.snapshot();
    this.plannerInFlight = true;
    this.plannerLastRunAt = createOccurredAt();
    this.broadcast();
    try {
      const windowEndAt = createOccurredAt();
      const windowStartAt = new Date(
        Date.parse(windowEndAt) - PLANNER_CONFIG.plannerRevisionWindowMs,
      ).toISOString();
      const result = await runPlannerRevision({
        timeline: this.timeline,
        now: windowEndAt,
        cause: 'manual',
        force,
        windowMs: PLANNER_CONFIG.plannerRevisionWindowMs,
        calendarContext: calendarService.getContextForRange(
          windowStartAt,
          windowEndAt,
        ),
        maxObservationsInPrompt:
          PLANNER_CONFIG.plannerRevisionMaxObservationsInPrompt,
        runReplan: generateManagedReplanBlocks,
      });
      if (result.kind !== 'skipped') {
        this.appendEvents(result.events);
      }
      if (result.kind === 'success') {
        this.plannerLastSnapshotId = result.snapshot.snapshotId;
        this.plannerLastFailureMessage = null;
      }
      this.errorMessage =
        result.kind === 'failure' ? result.failure.message : null;
      this.plannerLastFailureMessage =
        result.kind === 'failure' ? result.failure.message : null;
    } catch (error) {
      this.errorMessage =
        error instanceof Error ? error.message : 'Planner revision failed.';
      this.plannerLastFailureMessage = this.errorMessage;
    } finally {
      this.plannerInFlight = false;
      this.broadcast();
    }
    return this.snapshot();
  }

  editBlockNotes(args: {
    notesKey: string;
    blockId: string | null;
    notes: string;
  }) {
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

  correctBlock(args: {
    blockId: string;
    notesKey?: string;
    title?: string;
    category?: string;
    markedWrong?: boolean;
    feedback?: string;
    mergeWithBlockId?: string;
    splitAt?: string;
  }) {
    this.appendEvents([
      {
        id: createDomainId('event'),
        type: 'user_block_corrected',
        blockId: args.blockId,
        notesKey: args.notesKey,
        title: args.title,
        category: args.category,
        markedWrong: args.markedWrong,
        feedback: args.feedback,
        mergeWithBlockId: args.mergeWithBlockId,
        splitAt: args.splitAt,
        occurredAt: createOccurredAt(),
      },
    ]);
    return this.snapshot();
  }

  private recoverRuntimeMarkers(eventLog: DomainEvent[]) {
    for (const event of eventLog) {
      if (event.type === 'capture_performed') {
        this.lastCapturedAt = event.capture.capturedAt;
      }
      if (event.type === 'observation_added') {
        this.lastObservedAt = event.occurredAt;
      }
      if (event.type === 'task_plan_revised') {
        this.plannerLastRunAt = event.snapshot.revisedAt;
        this.plannerLastSnapshotId = event.snapshot.snapshotId;
        this.plannerLastFailureMessage = null;
      }
      if (event.type === 'task_plan_revision_failed') {
        this.plannerLastRunAt = event.failure.failedAt;
        this.plannerLastFailureMessage = event.failure.message;
      }
    }
  }
}

export const timelineService = new ElectronTimelineService();

export function registerTimelineIpcHandlers() {
  ipcMain.handle('flow:timeline:getState', () => timelineService.snapshot());
  ipcMain.handle('flow:timeline:startSession', () =>
    timelineService.startSession(),
  );
  ipcMain.handle('flow:timeline:stopSession', () =>
    timelineService.stopSession(),
  );
  ipcMain.handle('flow:timeline:captureNow', () =>
    timelineService.captureNow(),
  );
  ipcMain.handle('flow:timeline:runPlannerRevision', (_event, force: boolean) =>
    timelineService.runPlannerRevision(force),
  );
  ipcMain.handle('flow:timeline:editBlockNotes', (_event, args) =>
    timelineService.editBlockNotes(args),
  );
  ipcMain.handle('flow:timeline:correctBlock', (_event, args) =>
    timelineService.correctBlock(args),
  );
}
