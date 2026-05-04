import { BrowserWindow, app, ipcMain } from 'electron';
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';

import type {
  CalendarItemUpdate,
  CalendarRecurrenceRule,
  CreateCalendarItemInput,
  UserCalendarItem,
} from '../../../src/calendar/types';
import type {
  AudioPermissionStatus,
  AudioRecordingSource,
  AudioRecordingView,
  AudioTranscriptView,
} from '../../../src/audio/types';
import { buildOrphanedAudioRecordingRepairEvent } from '../../../src/audio/orphanRepair';
import { detectMeetingCandidate } from '../../../src/meeting/detector';
import {
  generateStructuredObservationForCapture,
  type ObserveCaptureArgs,
} from '../../../src/observation/runObservationForCapture';
import type { MeetingRuntimeState } from '../../../src/meetings/types';
import { PLANNER_CONFIG } from '../../../src/planner/config';
import { runPlannerRevision } from '../../../src/planner/revisionEngine';
import type {
  PlannerRevisionCause,
  TaskPlanRevisionFailure,
} from '../../../src/planner/types';
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
import { buildTimelineDiagnostics } from '../../../src/timeline/diagnostics';
import { buildReconciliationEvents } from '../../../src/tasks/reconcile';
import { runTaskEngineForObservation } from '../../../src/tasks/runTaskEngineForObservation';
import type { TimelineStatePayload } from '../../shared/flowApi';
import {
  generateManagedObservationForCapture,
  generateManagedReplanBlocks,
} from '../ai/managedAiClient';
import { nativeAudioClient } from '../audio/nativeAudioClient';
import { calendarService } from '../calendar/googleCalendarService';
import { captureClient } from '../capture/captureService';
import { settingsService } from '../settings/settingsService';
import { loadEventLog, saveEventLog } from '../storage/eventLogStorage';

const EVENT_LOG_SAVE_DEBOUNCE_MS = 500;
const CONTINUOUS_CAPTURE_INTERVAL_MS = 1000;
const DEFAULT_CALENDAR_ITEM_DURATION_MS = 60 * 60 * 1000;
const VALID_RECURRENCE_FREQUENCIES = new Set([
  'daily',
  'weekly',
  'monthly',
  'yearly',
]);

function trimCalendarText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function shouldUseManagedAi(
  settings: ReturnType<typeof settingsService.publicSettings>,
): boolean {
  return (
    settings.aiConnectionMode === 'managed' && settings.managedAi.configured
  );
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
      recurrence.frequency === 'weekly' &&
      daysOfWeek != null &&
      daysOfWeek.length > 0
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
  private privacyModeEnabled = false;
  private plannerInFlight = false;
  private persistTimer: NodeJS.Timeout | null = null;
  private captureTimer: NodeJS.Timeout | null = null;
  private plannerCadenceTimer: NodeJS.Timeout | null = null;
  private sessionStartPlanTimer: NodeJS.Timeout | null = null;
  private observationBusy = false;
  private lastObservedFrameHash: string | null = null;
  private plannerQueue: Promise<void> = Promise.resolve();
  private stoppingSessionIds = new Set<string>();
  private sessionStartTriggeredId: string | null = null;
  private plannerLastRunAt: string | null = null;
  private plannerLastRunCause: PlannerRevisionCause | null = null;
  private plannerLastSnapshotId: string | null = null;
  private plannerLastFailure: TaskPlanRevisionFailure | null = null;
  private plannerLastSkippedReason: string | null = null;
  private plannerConsecutiveFailureCount = 0;
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
  private audioInFlight = false;
  private audioLastError: string | null = null;
  private currentNativeAudioRecordingId: string | null = null;

  constructor() {
    settingsService.on('changed', settings => {
      const wasPrivacyModeEnabled = this.privacyModeEnabled;
      this.privacyModeEnabled = settings.privacyModeEnabled;
      if (settings.privacyModeEnabled && !wasPrivacyModeEnabled) {
        this.captureEnabled = false;
        this.captureStatusMessage = 'Privacy mode is on. Capture is paused.';
        this.clearCaptureTimer();
        this.clearPlannerCadence();
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
      this.maybePromptForMeeting();
    });
    nativeAudioClient.on('stopped', payload => {
      const recordingId = this.currentNativeAudioRecordingId;
      if (recordingId == null) return;
      this.currentNativeAudioRecordingId = null;
      this.audioInFlight = false;
      this.appendEvents([
        {
          id: createDomainId('event'),
          type: 'audio_recording_stopped',
          recordingId,
          stoppedAt: payload.stoppedAt,
          durationMs: payload.durationMs,
          filePath: payload.outputPath,
          byteLength: payload.byteLength,
          occurredAt: payload.stoppedAt,
        },
      ]);
      this.transcribeRecording(recordingId, payload.outputPath).catch(error => {
        this.audioLastError =
          error instanceof Error
            ? error.message
            : 'Audio transcription failed.';
        this.broadcast();
      });
      this.broadcast();
    });
    nativeAudioClient.on('failed', error => {
      const recordingId = this.currentNativeAudioRecordingId;
      const failedAt = createOccurredAt();
      this.currentNativeAudioRecordingId = null;
      this.audioInFlight = false;
      this.audioLastError = error.message;
      this.appendEvents([
        {
          id: createDomainId('event'),
          type: 'audio_recording_failed',
          recordingId,
          failedAt,
          errorMessage: error.message,
          occurredAt: failedAt,
        },
      ]);
      this.broadcast();
    });
  }

  async hydrate() {
    try {
      const payload = await loadEventLog();
      this.eventLog = payload.eventLog;
      this.timeline = replayEventLog(payload.eventLog);
      this.recoverRuntimeMarkers(payload.eventLog);
      const orphanRepairEvent = buildOrphanedAudioRecordingRepairEvent({
        timeline: this.timeline,
        occurredAt: createOccurredAt(),
      });
      if (orphanRepairEvent != null) {
        applyEventInPlace(this.timeline, orphanRepairEvent);
        this.eventLog.push(orphanRepairEvent);
        this.audioLastError = orphanRepairEvent.errorMessage;
      }
      this.trimTimeline();
      this.storagePath = payload.filePath;
      this.hydrationStatus = 'ready';
      this.errorMessage = null;
      if (orphanRepairEvent != null) {
        this.schedulePersist();
      }
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
    this.maybePromptForMeeting();
  }

  private isPrivacyModeEnabled() {
    this.privacyModeEnabled =
      settingsService.publicSettings().privacyModeEnabled;
    return this.privacyModeEnabled;
  }

  snapshot(): TimelineStatePayload {
    // Keep observations/captures/context in the renderer payload because task
    // selectors use them to extend stable-screen work. The timeline is trimmed
    // in memory, and inspections stay stripped because they are large and not
    // needed for calendar rendering.
    const leanTimeline: TimelineView = {
      ...this.timeline,
      captureInspectionsById: {},
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
      plannerRuntimeState: {
        lastRunAt: this.plannerLastRunAt,
        lastRunCause: this.plannerLastRunCause,
        lastSnapshotId: this.plannerLastSnapshotId,
        lastFailure: this.plannerLastFailure,
        lastSkippedReason: this.plannerLastSkippedReason,
        consecutiveFailureCount: this.plannerConsecutiveFailureCount,
      },
      audioRuntimeState: {
        permissionStatus: this.timeline.latestAudioPermissionStatus,
        activeRecordingId: this.timeline.activeAudioRecordingId,
        inFlight: this.audioInFlight,
        lastError: this.audioLastError,
      },
      activeMeetingCandidate:
        this.timeline.activeMeetingCandidateId == null
          ? null
          : this.timeline.meetingCandidatesById[
              this.timeline.activeMeetingCandidateId
            ] ?? null,
      diagnostics: buildTimelineDiagnostics({
        timeline: this.timeline,
        eventLog: this.eventLog,
        captureEnabled: this.captureEnabled,
      }),
      lastCapturedAt: this.lastCapturedAt,
      lastObservedAt: this.lastObservedAt,
      plannerLastRunAt: this.plannerLastRunAt,
      plannerLastSnapshotId: this.plannerLastSnapshotId,
      plannerLastFailureMessage: this.plannerLastFailure?.message ?? null,
      plannerStatus: this.plannerInFlight
        ? 'planning'
        : this.plannerLastFailure != null
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

  private maybePromptForMeeting() {
    const active =
      this.timeline.activeMeetingCandidateId == null
        ? null
        : this.timeline.meetingCandidatesById[
            this.timeline.activeMeetingCandidateId
          ];
    if (
      active != null &&
      (active.status === 'prompted' || active.status === 'recording')
    ) {
      return;
    }
    if (this.timeline.activeAudioRecordingId != null) return;

    const result = detectMeetingCandidate({
      timeline: this.timeline,
      createMeetingId: () => createDomainId('meeting'),
    });
    if (result == null) return;

    const existing =
      this.timeline.meetingCandidatesById[result.candidate.meetingId];
    const events: DomainEvent[] = [];
    if (existing == null) {
      events.push({
        id: createDomainId('event'),
        type: 'meeting_candidate_detected',
        candidate: result.candidate,
        occurredAt: result.candidate.detectedAt,
      });
    }
    if (result.shouldPrompt) {
      const shownAt = createOccurredAt();
      events.push({
        id: createDomainId('event'),
        type: 'meeting_prompt_shown',
        meetingId: result.candidate.meetingId,
        shownAt,
        occurredAt: shownAt,
      });
    }
    this.appendEvents(events);
  }

  // Cap the in-memory timeline to prevent unbounded RAM growth during long sessions.
  // The on-disk event log is the source of truth and is not affected — on restart
  // replayEventLog rebuilds the full view from disk. The renderer only needs recent
  // data for display; planSnapshots are preserved in full for the calendar selectors.
  private trimTimeline() {
    const MAX_CAPTURES = 5_000;
    const MAX_INSPECTIONS = 5_000;
    const MAX_CONTEXT_SNAPSHOTS = 5_000;
    const MAX_OBSERVATIONS = 20_000;
    const MAX_MEETING_CANDIDATES = 500;
    const MAX_AUDIO_TRANSCRIPTS = 500;

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
    if (t.meetingCandidateOrder.length > MAX_MEETING_CANDIDATES) {
      const excess = t.meetingCandidateOrder.splice(
        0,
        t.meetingCandidateOrder.length - MAX_MEETING_CANDIDATES,
      );
      for (const id of excess) delete t.meetingCandidatesById[id];
    }
    if (t.audioTranscriptOrder.length > MAX_AUDIO_TRANSCRIPTS) {
      const excess = t.audioTranscriptOrder.splice(
        0,
        t.audioTranscriptOrder.length - MAX_AUDIO_TRANSCRIPTS,
      );
      for (const id of excess) delete t.audioTranscriptsById[id];
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
    if (this.timeline.currentSessionId != null) {
      this.captureEnabled = true;
      this.captureStatusMessage = 'Continuous capture resumed.';
      this.lastObservedFrameHash = null;
      this.ensureCaptureTimer();
      this.ensurePlannerCadence();
      this.broadcast();
      return this.snapshot();
    }
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
    this.lastObservedFrameHash = null;
    this.sessionStartTriggeredId = null;
    this.ensureCaptureTimer();
    this.ensurePlannerCadence();
    this.broadcast();
    return this.snapshot();
  }

  async stopSession() {
    const sessionId = this.timeline.currentSessionId;
    if (sessionId == null) return this.snapshot();
    if (this.stoppingSessionIds.has(sessionId)) return this.snapshot();
    this.stoppingSessionIds.add(sessionId);
    this.captureEnabled = false;
    this.captureStatusMessage = 'Continuous capture is off.';
    this.clearCaptureTimer();
    this.clearPlannerCadence();
    this.clearSessionStartPlan();
    this.appendEvents([
      {
        id: createDomainId('event'),
        type: 'session_stopped',
        sessionId,
        occurredAt: createOccurredAt(),
      },
    ]);
    this.appendEvents(buildReconciliationEvents(this.timeline));
    this.broadcast();
    try {
      await this.runPlannerRevision({
        force: true,
        cause: 'session_stop',
        sessionIdOverride: sessionId,
      });
    } finally {
      this.stoppingSessionIds.delete(sessionId);
    }
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

  private ensurePlannerCadence(
    delayMs = PLANNER_CONFIG.plannerRevisionIntervalMs,
  ) {
    if (
      this.plannerCadenceTimer != null ||
      this.timeline.currentSessionId == null
    ) {
      return;
    }
    this.plannerCadenceTimer = setTimeout(() => {
      this.plannerCadenceTimer = null;
      const sessionId = this.timeline.currentSessionId;
      if (sessionId == null || !this.captureEnabled) return;
      this.runPlannerRevision({
        cause: 'cadence',
        sessionIdOverride: sessionId,
      })
        .catch(() => {})
        .finally(() => {
          const nextDelay =
            this.plannerLastFailure != null
              ? PLANNER_CONFIG.plannerRevisionFailureRetryMs
              : PLANNER_CONFIG.plannerRevisionIntervalMs;
          this.ensurePlannerCadence(nextDelay);
        });
    }, delayMs);
  }

  private clearPlannerCadence() {
    if (this.plannerCadenceTimer != null) {
      clearTimeout(this.plannerCadenceTimer);
      this.plannerCadenceTimer = null;
    }
  }

  private maybeKickoffSessionStartPlan(sessionId: string | null) {
    if (
      sessionId == null ||
      this.sessionStartTriggeredId === sessionId ||
      this.sessionStartPlanTimer != null
    ) {
      return;
    }
    this.sessionStartTriggeredId = sessionId;
    this.sessionStartPlanTimer = setTimeout(() => {
      this.sessionStartPlanTimer = null;
      this.runPlannerRevision({
        cause: 'session_start',
        sessionIdOverride: sessionId,
      }).catch(() => {});
    }, PLANNER_CONFIG.plannerRevisionSessionStartDelayMs);
  }

  private clearSessionStartPlan() {
    if (this.sessionStartPlanTimer != null) {
      clearTimeout(this.sessionStartPlanTimer);
      this.sessionStartPlanTimer = null;
    }
    this.sessionStartTriggeredId = null;
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
    this.maybePromptForMeeting();

    if (
      !this.captureEnabled ||
      result.metadata.status !== 'captured' ||
      this.observationBusy ||
      (captureMetadata.frameHash != null &&
        captureMetadata.frameHash === this.lastObservedFrameHash)
    ) {
      return result;
    }

    const observationSessionId = this.timeline.currentSessionId;
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
      const run = await this.generateObservationRun(observationArgs);
      const observationId = createDomainId('observation');
      this.appendEvents([
        {
          id: createDomainId('event'),
          type: 'observation_added',
          observationId,
          sessionId: observationSessionId ?? undefined,
          text: sanitizeObservationSummary(run.observation.summary),
          structured: sanitizeStructuredObservation(run.observation),
          engineRun: sanitizeObservationRun(run),
          capturePreviewDataUri: null,
          occurredAt: captureMetadata.capturedAt,
        },
      ]);
      await this.extractTasksForObservation(observationId);
      this.maybeKickoffSessionStartPlan(observationSessionId);
      this.maybePromptForMeeting();
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

  private async generateObservationRun(args: ObserveCaptureArgs) {
    const settings = settingsService.publicSettings();
    if (shouldUseManagedAi(settings)) {
      return generateManagedObservationForCapture(args);
    }
    return generateStructuredObservationForCapture({
      ...args,
      apiKey: process.env.GEMINI_API_KEY,
    });
  }

  private async extractTasksForObservation(observationId: string) {
    const observation = this.timeline.observationsById[observationId];
    if (observation == null) return;

    const taskResult = await runTaskEngineForObservation({
      timeline: this.timeline,
      observation,
      getLatestTimeline: () => this.timeline,
    });
    if (taskResult != null && taskResult.events.length > 0) {
      this.appendEvents(taskResult.events);
    }
  }

  async runPlannerRevision(
    request:
      | boolean
      | {
          force?: boolean;
          cause?: PlannerRevisionCause;
          sessionIdOverride?: string | null;
        } = false,
  ) {
    const normalized =
      typeof request === 'boolean'
        ? { force: request, cause: 'manual' as PlannerRevisionCause }
        : {
            force: request.force === true,
            cause: request.cause ?? ('manual' as PlannerRevisionCause),
            sessionIdOverride: request.sessionIdOverride,
          };
    this.plannerQueue = this.plannerQueue
      .catch(() => {})
      .then(() => this.runPlannerRevisionTask(normalized));
    await this.plannerQueue;
    return this.snapshot();
  }

  private async runPlannerRevisionTask(request: {
    force: boolean;
    cause: PlannerRevisionCause;
    sessionIdOverride?: string | null;
  }) {
    this.plannerInFlight = true;
    this.broadcast();
    try {
      const settings = settingsService.publicSettings();
      const useManagedAi = shouldUseManagedAi(settings);
      const windowEndAt = createOccurredAt();
      const windowStartAt = new Date(
        Date.parse(windowEndAt) - PLANNER_CONFIG.plannerRevisionWindowMs,
      ).toISOString();
      const result = await runPlannerRevision({
        timeline: this.timeline,
        now: windowEndAt,
        cause: request.cause,
        force: request.force,
        sessionIdOverride: request.sessionIdOverride,
        windowMs: PLANNER_CONFIG.plannerRevisionWindowMs,
        calendarContext: calendarService.getContextForRange(
          windowStartAt,
          windowEndAt,
        ),
        maxObservationsInPrompt:
          PLANNER_CONFIG.plannerRevisionMaxObservationsInPrompt,
        apiKey: useManagedAi ? undefined : process.env.GEMINI_API_KEY,
        runReplan: useManagedAi ? generateManagedReplanBlocks : undefined,
      });
      if (result.kind !== 'skipped') {
        this.appendEvents(result.events);
      }
      this.plannerLastRunCause = request.cause;
      this.plannerLastRunAt =
        result.kind === 'success'
          ? result.snapshot.revisedAt
          : result.kind === 'failure'
          ? result.failure.failedAt
          : createOccurredAt();
      if (result.kind === 'success') {
        this.plannerLastSnapshotId = result.snapshot.snapshotId;
        this.plannerLastFailure = null;
        this.plannerLastSkippedReason = null;
        this.plannerConsecutiveFailureCount = 0;
      } else if (result.kind === 'failure') {
        this.plannerLastFailure = result.failure;
        this.plannerLastSkippedReason = null;
        this.plannerConsecutiveFailureCount += 1;
      } else {
        this.plannerLastFailure = null;
        this.plannerLastSkippedReason = result.reason;
      }
      this.errorMessage =
        result.kind === 'failure' ? result.failure.message : null;
    } catch (error) {
      this.errorMessage =
        error instanceof Error ? error.message : 'Planner revision failed.';
      this.plannerLastFailure = {
        failedAt: createOccurredAt(),
        cause: request.cause,
        reason: 'engine_error',
        message: this.errorMessage,
        windowStartAt: new Date(
          Date.now() - PLANNER_CONFIG.plannerRevisionWindowMs,
        ).toISOString(),
        windowEndAt: createOccurredAt(),
        inputObservationCount: 0,
        inputClusterCount: 0,
      };
      this.plannerConsecutiveFailureCount += 1;
    } finally {
      this.plannerInFlight = false;
      this.broadcast();
    }
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

  updateCalendarItem(args: { itemId: string; updates: CalendarItemUpdate }) {
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

  async getAudioPermissionStatus(): Promise<AudioPermissionStatus> {
    const status = await nativeAudioClient.getPermissionsStatus();
    this.appendEvents([
      {
        id: createDomainId('event'),
        type: 'audio_permission_changed',
        status,
        occurredAt: status.checkedAt,
      },
    ]);
    return status;
  }

  async requestAudioPermissions(): Promise<AudioPermissionStatus> {
    const status = await nativeAudioClient.requestPermissions();
    this.appendEvents([
      {
        id: createDomainId('event'),
        type: 'audio_permission_changed',
        status,
        occurredAt: status.checkedAt,
      },
    ]);
    return status;
  }

  async startAudioRecording(
    args: {
      meetingId?: string | null;
      source?: AudioRecordingSource;
    } = {},
  ) {
    if (this.timeline.activeAudioRecordingId != null) {
      throw new Error('An audio recording is already running.');
    }
    if (this.timeline.currentSessionId == null) {
      this.startSession();
    }
    const source = args.source ?? 'microphone';
    const recordingId = createDomainId('recording');
    const meetingId =
      args.meetingId ?? this.timeline.activeMeetingCandidateId ?? null;
    const outputPath = this.audioOutputPath(recordingId);
    this.audioInFlight = true;
    this.audioLastError = null;
    this.currentNativeAudioRecordingId = recordingId;
    this.broadcast();
    try {
      const started = await nativeAudioClient.startRecording({
        outputPath,
        source,
      });
      const recording: AudioRecordingView = {
        recordingId,
        sessionId: this.timeline.currentSessionId,
        meetingId,
        taskSegmentId: this.timeline.currentTaskSegmentId,
        source,
        status: 'recording',
        startedAt: started.startedAt,
        pausedAt: null,
        resumedAt: null,
        stoppedAt: null,
        durationMs: null,
        filePath: outputPath,
        byteLength: null,
        errorMessage: null,
      };
      this.appendEvents([
        {
          id: createDomainId('event'),
          type: 'audio_recording_started',
          recording,
          occurredAt: recording.startedAt,
        },
      ]);
      return this.snapshot();
    } catch (error) {
      const failedAt = createOccurredAt();
      const shouldAppendFailure =
        this.currentNativeAudioRecordingId === recordingId;
      this.currentNativeAudioRecordingId = null;
      this.audioInFlight = false;
      this.audioLastError =
        error instanceof Error ? error.message : 'Failed to start recording.';
      if (shouldAppendFailure) {
        this.appendEvents([
          {
            id: createDomainId('event'),
            type: 'audio_recording_failed',
            recordingId,
            failedAt,
            errorMessage: this.audioLastError,
            occurredAt: failedAt,
          },
        ]);
      }
      throw error;
    } finally {
      this.audioInFlight = false;
      this.broadcast();
    }
  }

  pauseAudioRecording() {
    const recordingId = this.timeline.activeAudioRecordingId;
    if (recordingId == null) return this.snapshot();
    nativeAudioClient.pauseRecording();
    const pausedAt = createOccurredAt();
    this.appendEvents([
      {
        id: createDomainId('event'),
        type: 'audio_recording_paused',
        recordingId,
        pausedAt,
        occurredAt: pausedAt,
      },
    ]);
    return this.snapshot();
  }

  resumeAudioRecording() {
    const recordingId = this.timeline.activeAudioRecordingId;
    if (recordingId == null) return this.snapshot();
    nativeAudioClient.resumeRecording();
    const resumedAt = createOccurredAt();
    this.appendEvents([
      {
        id: createDomainId('event'),
        type: 'audio_recording_resumed',
        recordingId,
        resumedAt,
        occurredAt: resumedAt,
      },
    ]);
    return this.snapshot();
  }

  stopAudioRecording() {
    if (this.timeline.activeAudioRecordingId == null) return this.snapshot();
    nativeAudioClient.stopRecording();
    return this.snapshot();
  }

  deleteAudioRecording(args: { recordingId: string }) {
    const recording = this.timeline.audioRecordingsById[args.recordingId];
    if (recording?.filePath != null && existsSync(recording.filePath)) {
      unlinkSync(recording.filePath);
    }
    const deletedAt = createOccurredAt();
    this.appendEvents([
      {
        id: createDomainId('event'),
        type: 'audio_recording_deleted',
        recordingId: args.recordingId,
        deletedAt,
        occurredAt: deletedAt,
      },
    ]);
    return this.snapshot();
  }

  dismissMeetingPrompt(args: {
    meetingId: string;
    reason?: 'user_dismissed' | 'not_a_meeting' | 'cooldown';
  }) {
    const dismissedAt = createOccurredAt();
    this.appendEvents([
      {
        id: createDomainId('event'),
        type: 'meeting_prompt_dismissed',
        meetingId: args.meetingId,
        dismissedAt,
        reason: args.reason ?? 'user_dismissed',
        occurredAt: dismissedAt,
      },
    ]);
    return this.snapshot();
  }

  private audioOutputPath(recordingId: string): string {
    const now = new Date();
    const datePart = now.toISOString().slice(0, 10);
    const directory = path.join(app.getPath('userData'), 'audio', datePart);
    mkdirSync(directory, { recursive: true });
    return path.join(directory, `${recordingId}.m4a`);
  }

  private async transcribeRecording(recordingId: string, filePath: string) {
    const result = await nativeAudioClient.transcribeFile({ filePath });
    const transcript: AudioTranscriptView = {
      transcriptId: createDomainId('transcript'),
      recordingId,
      generatedAt: result.generatedAt,
      model: 'macos-speech',
      durationMs: result.durationMs,
      segments:
        result.segments.length > 0
          ? result.segments
          : [
              {
                startMs: 0,
                endMs: 0,
                speaker: null,
                text: result.transcript,
              },
            ],
    };
    this.appendEvents([
      {
        id: createDomainId('event'),
        type: 'audio_transcript_generated',
        transcript,
        occurredAt: transcript.generatedAt,
      },
    ]);
  }

  getDiagnostics() {
    return buildTimelineDiagnostics({
      timeline: this.timeline,
      eventLog: this.eventLog,
      captureEnabled: this.captureEnabled,
    });
  }

  async runDiagnosticReplan(args: { sessionId?: string | null } = {}) {
    await this.runPlannerRevision({
      force: true,
      cause: 'diagnostic_repair',
      sessionIdOverride: args.sessionId,
    });
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
        this.plannerLastFailure = null;
      }
      if (event.type === 'task_plan_revision_failed') {
        this.plannerLastRunAt = event.failure.failedAt;
        this.plannerLastFailure = event.failure;
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
  ipcMain.handle('flow:timeline:getDiagnostics', () =>
    timelineService.getDiagnostics(),
  );
  ipcMain.handle('flow:timeline:runDiagnosticReplan', (_event, args) =>
    timelineService.runDiagnosticReplan(args),
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
  ipcMain.handle('flow:timeline:correctBlock', (_event, args) =>
    timelineService.correctBlock(args),
  );
}
