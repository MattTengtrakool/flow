import { ipcMain } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  MEETING_DETECTION_DEDUPE_MS,
  detectLikelyMeetingFromRecentSources,
  type MeetingDetectionContextSource,
} from '../../../src/meetings/detection';
import type {
  MeetingAudioChunkMetadata,
  MeetingAudioSource,
  MeetingDetection,
  MeetingPermissionState,
  MeetingRecording,
  MeetingRuntimeState,
  MeetingTranscriptChunk,
  StartMeetingTranscriptionArgs,
} from '../../../src/meetings/types';
import {
  createDomainId,
  createOccurredAt,
  type CaptureRecordView,
  type ContextSnapshotView,
  type TimelineView,
} from '../../../src/timeline/eventLog';
import type { ContextSnapshotPayload } from '../../../src/types/contextCapture';
import {
  summarizeManagedMeeting,
  transcribeManagedAudioChunk,
} from '../ai/managedAiClient';
import { getAppDataDirectoryPath } from '../appProfile';
import { calendarService } from '../calendar/googleCalendarService';
import { captureClient } from '../capture/captureService';
import { settingsService } from '../settings/settingsService';
import { timelineService } from '../timeline/timelineService';
import { sendToAllWindows } from '../windowRegistry';
import { showMainWindow } from '../windowRegistry';
import { nativeAudioClient } from './nativeAudioClient';

const DETECTION_EVALUATE_INTERVAL_MS = 15_000;
const DETECTION_SOURCE_LOOKBACK_MS = 90_000;
const DETECTION_SOURCE_LIMIT = 120;
const FINALIZATION_WAIT_TIMEOUT_MS = 2 * 60_000;
const SUMMARY_REQUEST_TIMEOUT_MS = 90_000;

class MeetingTranscriptionService {
  private timer: NodeJS.Timeout | null = null;
  private finalizationTimers = new Map<string, NodeJS.Timeout>();
  private permissionState: MeetingPermissionState = {
    helperAvailable: nativeAudioClient.helperAvailable(),
    screenCaptureGranted: null,
    microphoneGranted: null,
    microphoneStatus: 'unknown',
  };
  private lastError: string | null = null;
  private lastBroadcastKey: string | null = null;

  hydrate() {
    this.ensureTimer();
    settingsService.on('changed', settings => {
      if (settings.privacyModeEnabled) {
        const active = this.getActiveRecording();
        if (active != null) {
          this.stopTranscription(active.meetingId, 'privacy').catch(() => {});
        }
      }
      this.evaluate().catch(() => {});
      this.broadcast();
    });
    calendarService.on('changed', () => {
      this.evaluate().catch(() => {});
    });
    captureClient.on('contextSnapshotDidChange', () => {
      this.evaluate().catch(() => {});
    });
    this.refreshPermissionState().catch(() => {});
    this.evaluate().catch(() => {});
    this.recoverFinalizingRecordings().catch(() => {});
  }

  async getState(): Promise<MeetingRuntimeState> {
    await this.refreshPermissionState();
    await this.evaluate();
    await this.recoverFinalizingRecordings();
    return this.publicState();
  }

  async startTranscription(
    args: StartMeetingTranscriptionArgs,
  ): Promise<MeetingRuntimeState> {
    await this.refreshPermissionState();
    const settings = settingsService.publicSettings();
    const meetingSettings = settings.meetingAssistant;
    const requestedSources = normalizeAudioSources(args.sources);
    const sources =
      requestedSources.length > 0
        ? requestedSources
        : [
            ...(meetingSettings.systemAudioEnabled ? ['system' as const] : []),
            ...(meetingSettings.microphoneEnabled ? ['microphone' as const] : []),
          ];

    if (!meetingSettings.enabled) {
      return this.failStart('Meeting assistant is turned off.');
    }
    if (settings.privacyModeEnabled) {
      return this.failStart('Privacy mode is on. Meeting audio is paused.');
    }
    if (
      meetingSettings.askBeforeRecording &&
      !meetingSettings.defaultConsentReminderAccepted &&
      !args.consentAccepted
    ) {
      return this.failStart(
        'Confirm that you have permission before recording/transcribing this meeting.',
      );
    }
    if (sources.length === 0) {
      return this.failStart('Enable system audio or microphone capture first.');
    }
    if (!this.permissionState.helperAvailable) {
      return this.failStart(
        'Meeting audio helper is not built. Run pnpm native-audio:build and restart Flow.',
      );
    }
    if (needsPermissionPrompt(sources, this.permissionState)) {
      this.permissionState = await nativeAudioClient.requestPermissions(sources);
      this.broadcast();
    }
    if (sources.includes('microphone') && !this.permissionState.microphoneGranted) {
      return this.failStart(microphonePermissionMessage(this.permissionState));
    }
    if (sources.includes('system') && !this.permissionState.screenCaptureGranted) {
      return this.failStart(
        'Screen Recording permission is required for meeting audio. If macOS did not show a prompt, open System Settings > Privacy & Security > Screen Recording, enable FlowAudioCapture, then restart Flow.',
      );
    }

    if (
      args.consentAccepted &&
      !meetingSettings.defaultConsentReminderAccepted
    ) {
      await settingsService.updateSettings({
        meetingAssistant: {
          ...meetingSettings,
          defaultConsentReminderAccepted: true,
        },
      });
    }

    let detection =
      args.detectionId != null
        ? this.getDetectionById(args.detectionId)
        : this.getCurrentDetection();
    if (detection == null) {
      await this.evaluate();
      detection =
        args.detectionId != null
          ? this.getDetectionById(args.detectionId)
          : this.getCurrentDetection();
    }

    const meetingId = createDomainId('meeting');
    const recording: MeetingRecording = {
      id: createDomainId('recording'),
      meetingId,
      detectionId: detection?.id ?? null,
      startedAt: createOccurredAt(),
      stoppedAt: null,
      status: 'recording',
      appName: detection?.appName ?? null,
      bundleIdentifier: detection?.bundleIdentifier ?? null,
      windowTitle: detection?.windowTitle ?? null,
      calendarEventId: detection?.calendarEventId ?? null,
      sources,
      rawAudioSaved: meetingSettings.saveRawAudio,
      errorMessage: null,
    };

    timelineService.appendMeetingEvents([
      {
        id: createDomainId('event'),
        type: 'meeting_transcription_started',
        recording,
        occurredAt: recording.startedAt,
      },
    ]);

    const outputDirectory = await meetingAudioDirectoryPath();
    const started = nativeAudioClient.startCapture({
      meetingId,
      sources,
      outputDirectory,
      onEvent: event => {
        this.handleNativeEvent(event).catch(() => {});
      },
    });
    if (!started) {
      timelineService.appendMeetingEvents([
        {
          id: createDomainId('event'),
          type: 'meeting_transcription_failed',
          meetingId,
          message: 'Meeting audio helper could not be started.',
          occurredAt: createOccurredAt(),
        },
      ]);
      this.lastError = 'Meeting audio helper could not be started.';
    } else {
      this.lastError = null;
    }
    this.broadcast();
    return this.publicState();
  }

  async stopTranscription(
    meetingId: string,
    reason: 'user' | 'privacy' | 'error' | 'completed' = 'user',
  ): Promise<MeetingRuntimeState> {
    const active = this.getActiveRecording();
    if (active == null || active.meetingId !== meetingId) {
      this.broadcast();
      return this.publicState();
    }

    nativeAudioClient.stopCapture(meetingId);
    const stoppedAt = createOccurredAt();
    timelineService.appendMeetingEvents([
      {
        id: createDomainId('event'),
        type: 'meeting_transcription_stopped',
        meetingId,
        stoppedAt,
        reason: reason === 'user' ? 'completed' : reason,
        occurredAt: stoppedAt,
      },
    ]);
    if (reason === 'user' || reason === 'completed') {
      this.scheduleFinalizationTimeout(meetingId, stoppedAt);
      await this.finalizeMeetingIfStopped(meetingId);
    }
    this.broadcast();
    return this.publicState();
  }

  dismissDetection(detectionId: string): MeetingRuntimeState {
    const detection = this.getDetectionById(detectionId);
    if (detection == null) return this.publicState();
    timelineService.appendMeetingEvents([
      {
        id: createDomainId('event'),
        type: 'meeting_detection_dismissed',
        detectionId,
        dedupeKey: detection.dedupeKey,
        occurredAt: createOccurredAt(),
      },
    ]);
    this.broadcast();
    return this.publicState();
  }

  private async evaluate() {
    const settings = settingsService.publicSettings();
    if (
      !settings.meetingAssistant.enabled ||
      settings.privacyModeEnabled ||
      this.getActiveRecording() != null
    ) {
      this.broadcast();
      return;
    }

    const timeline = timelineService.getTimelineForServices();
    const detection = detectLikelyMeetingFromRecentSources({
      sources: collectRecentMeetingSources(timeline),
      calendar: await calendarService.getState(),
      enabledApps: settings.meetingAssistant.enabledApps,
      dismissedDedupeKeys: this.dismissedDedupeKeys(),
      maxAgeMs: DETECTION_SOURCE_LOOKBACK_MS,
    });
    if (
      detection != null &&
      timeline.meetingDetectionsById[detection.id] == null
    ) {
      timelineService.appendMeetingEvents([
        {
          id: createDomainId('event'),
          type: 'meeting_detected',
          detection,
          occurredAt: detection.detectedAt,
        },
      ]);
    }
    this.broadcast();
  }

  private async handleNativeEvent(
    event:
      | {
          type: 'audio_capture_failed';
          meetingId?: string;
          message?: string;
        }
      | ({
          type: 'audio_chunk_ready';
        } & MeetingAudioChunkMetadata)
      | { type: string; meetingId?: string; message?: string },
  ) {
    if (event.type === 'audio_capture_started') {
      this.lastError = null;
      this.broadcast();
      return;
    }

    if (event.type === 'audio_capture_failed') {
      const meetingId = event.meetingId ?? this.getActiveRecording()?.meetingId;
      if (meetingId == null) return;
      const message =
        event.message ??
        'Meeting audio capture failed before a transcript chunk was created.';
      this.lastError = message;
      timelineService.appendMeetingEvents([
        {
          id: createDomainId('event'),
          type: 'meeting_transcription_failed',
          meetingId,
          message,
          occurredAt: createOccurredAt(),
        },
      ]);
      this.broadcast();
      return;
    }

    if (event.type === 'audio_capture_stopped') {
      this.broadcast();
      return;
    }

    if (isAudioChunkReadyEvent(event)) {
      await this.handleAudioChunk({
        meetingId: event.meetingId,
        chunkId: event.chunkId,
        startedAt: event.startedAt,
        endedAt: event.endedAt,
        source: event.source,
        mimeType: event.mimeType,
        filePath: event.filePath,
        byteLength: event.byteLength,
      });
    }
  }

  private async handleAudioChunk(chunk: MeetingAudioChunkMetadata) {
    timelineService.appendMeetingEvents([
      {
        id: createDomainId('event'),
        type: 'meeting_audio_chunk_captured',
        chunk,
        occurredAt: chunk.endedAt,
      },
    ]);

    try {
      const audioBase64 = await fs.readFile(chunk.filePath, 'base64');
      const transcript = await transcribeManagedAudioChunk({
        meetingId: chunk.meetingId,
        chunkId: chunk.chunkId,
        startedAt: chunk.startedAt,
        endedAt: chunk.endedAt,
        source: chunk.source,
        mimeType: chunk.mimeType,
        audioBase64,
      });
      const transcriptChunk: MeetingTranscriptChunk = {
        id: createDomainId('transcript'),
        meetingId: chunk.meetingId,
        chunkId: chunk.chunkId,
        startedAt: chunk.startedAt,
        endedAt: chunk.endedAt,
        text: transcript.text,
        speakerLabel: transcript.speakerLabel ?? null,
        confidence: transcript.confidence ?? null,
        language: transcript.language ?? null,
        source: chunk.source,
        transcribedAt: createOccurredAt(),
      };
      timelineService.appendMeetingEvents([
        {
          id: createDomainId('event'),
          type: 'meeting_transcript_chunk_added',
          chunk: transcriptChunk,
          occurredAt: transcriptChunk.transcribedAt,
        },
      ]);
      await this.cleanupAudioChunk(chunk.filePath);
      await this.finalizeMeetingIfStopped(chunk.meetingId);
      this.lastError = null;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Audio transcription failed.';
      this.lastError = message;
      timelineService.appendMeetingEvents([
        {
          id: createDomainId('event'),
          type: 'meeting_transcription_failed',
          meetingId: chunk.meetingId,
          message,
          occurredAt: createOccurredAt(),
        },
      ]);
      this.clearFinalizationTimeout(chunk.meetingId);
    }
    this.broadcast();
  }

  private async finalizeMeeting(meetingId: string): Promise<boolean> {
    const timeline = timelineService.getTimelineForServices();
    if (timeline.meetingSummariesByMeetingId[meetingId] != null) {
      this.clearFinalizationTimeout(meetingId);
      return true;
    }
    const chunks = timeline.meetingTranscriptChunksByMeetingId[meetingId] ?? [];
    if (chunks.length === 0) return false;
    const recording = timeline.meetingRecordingsById[meetingId];
    const calendar =
      recording?.calendarEventId != null
        ? (await calendarService.getState()).events.find(
            event => event.id === recording.calendarEventId,
          ) ?? null
        : null;
    try {
      const result = await withTimeout(
        summarizeManagedMeeting({
          meetingId,
          transcriptChunks: chunks,
          calendarEvent:
            calendar != null
              ? {
                  id: calendar.id,
                  title: calendar.title,
                  startTime: calendar.startTime,
                  endTime: calendar.endTime,
                }
              : null,
        }),
        SUMMARY_REQUEST_TIMEOUT_MS,
        'Meeting summary generation timed out.',
      );
      timelineService.appendMeetingEvents([
        {
          id: createDomainId('event'),
          type: 'meeting_summary_generated',
          summary: {
            id: createDomainId('meeting_summary'),
            meetingId,
            generatedAt: createOccurredAt(),
            ...result,
          },
          occurredAt: createOccurredAt(),
        },
      ]);
      this.clearFinalizationTimeout(meetingId);
      return true;
    } catch (error) {
      this.failFinalization(
        meetingId,
        error instanceof Error
          ? error.message
          : 'Meeting summary generation failed.',
      );
      return true;
    }
  }

  private async finalizeMeetingIfStopped(meetingId: string) {
    const timeline = timelineService.getTimelineForServices();
    const recording = timeline.meetingRecordingsById[meetingId] ?? null;
    if (recording == null || recording.status !== 'finalizing') return;
    if (timeline.meetingSummariesByMeetingId[meetingId] != null) {
      this.clearFinalizationTimeout(meetingId);
      return;
    }
    await this.finalizeMeeting(meetingId);
  }

  private async recoverFinalizingRecordings() {
    const timeline = timelineService.getTimelineForServices();
    for (const meetingId of timeline.meetingRecordingOrder) {
      const recording = timeline.meetingRecordingsById[meetingId] ?? null;
      if (recording?.status !== 'finalizing') continue;
      if (!this.finalizationTimers.has(meetingId)) {
        this.scheduleFinalizationTimeout(meetingId, recording.stoppedAt);
      }
      await this.finalizeMeetingIfStopped(meetingId);
    }
  }

  private scheduleFinalizationTimeout(
    meetingId: string,
    stoppedAt?: string | null,
  ) {
    this.clearFinalizationTimeout(meetingId);
    const stoppedMs = stoppedAt != null ? Date.parse(stoppedAt) : NaN;
    const elapsedMs = Number.isNaN(stoppedMs)
      ? 0
      : Math.max(0, Date.now() - stoppedMs);
    const delayMs = Math.max(0, FINALIZATION_WAIT_TIMEOUT_MS - elapsedMs);
    const timer = setTimeout(() => {
      this.handleFinalizationTimeout(meetingId).catch(() => {});
    }, delayMs);
    timer.unref?.();
    this.finalizationTimers.set(meetingId, timer);
  }

  private clearFinalizationTimeout(meetingId: string) {
    const timer = this.finalizationTimers.get(meetingId);
    if (timer != null) clearTimeout(timer);
    this.finalizationTimers.delete(meetingId);
  }

  private async handleFinalizationTimeout(meetingId: string) {
    const timeline = timelineService.getTimelineForServices();
    const recording = timeline.meetingRecordingsById[meetingId] ?? null;
    if (recording == null || recording.status !== 'finalizing') {
      this.clearFinalizationTimeout(meetingId);
      return;
    }

    const finalized = await this.finalizeMeeting(meetingId);
    if (!finalized) {
      this.failFinalization(
        meetingId,
        'Meeting notes did not finish because no transcript chunks were captured after stopping.',
      );
    }
    this.broadcast();
  }

  private failFinalization(meetingId: string, message: string) {
    this.lastError = message;
    timelineService.appendMeetingEvents([
      {
        id: createDomainId('event'),
        type: 'meeting_transcription_failed',
        meetingId,
        message,
        occurredAt: createOccurredAt(),
      },
    ]);
    this.clearFinalizationTimeout(meetingId);
  }

  private async cleanupAudioChunk(filePath: string) {
    const settings = settingsService.publicSettings().meetingAssistant;
    if (!settings.deleteRawAudioAfterTranscription || settings.saveRawAudio) {
      return;
    }
    await fs.unlink(filePath).catch(() => {});
  }

  private publicState(): MeetingRuntimeState {
    const settings = settingsService.publicSettings();
    const currentDetection = settings.privacyModeEnabled
      ? null
      : this.getCurrentDetection();
    const activeRecording = this.getActiveRecording();
    const chunks =
      activeRecording != null
        ? timelineService.getTimelineForServices()
            .meetingTranscriptChunksByMeetingId[activeRecording.meetingId] ?? []
        : [];
    const transcriptionStatus =
      activeRecording != null
        ? activeRecording.status === 'starting'
          ? 'starting'
          : activeRecording.status === 'finalizing'
          ? 'finalizing'
          : activeRecording.status === 'failed'
          ? 'failed'
          : 'transcribing'
        : this.lastError != null
        ? 'failed'
        : currentDetection != null
        ? 'detected'
        : 'idle';
    const state: MeetingRuntimeState = {
      assistantEnabled: settings.meetingAssistant.enabled,
      consentAccepted: settings.meetingAssistant.defaultConsentReminderAccepted,
      currentDetection,
      activeRecording,
      permissionState: this.permissionState,
      transcriptionStatus,
      transcriptProgress: {
        chunkCount: chunks.length,
        lastChunkAt: chunks.at(-1)?.transcribedAt ?? null,
      },
      lastError: this.lastError,
    };
    timelineService.setMeetingRuntimeSnapshot(state);
    return state;
  }

  private getCurrentDetection(): MeetingDetection | null {
    const timeline = timelineService.getTimelineForServices();
    const nowMs = Date.now();
    for (let i = timeline.meetingDetectionOrder.length - 1; i >= 0; i -= 1) {
      const detection =
        timeline.meetingDetectionsById[timeline.meetingDetectionOrder[i]];
      if (detection == null) continue;
      if (Date.parse(detection.expiresAt) <= nowMs) continue;
      if (timeline.dismissedMeetingDetectionIds[detection.id] != null) continue;
      return detection;
    }
    return null;
  }

  private getDetectionById(detectionId: string): MeetingDetection | null {
    return (
      timelineService.getTimelineForServices().meetingDetectionsById[
        detectionId
      ] ?? null
    );
  }

  private getActiveRecording(): MeetingRecording | null {
    const timeline = timelineService.getTimelineForServices();
    for (let i = timeline.meetingRecordingOrder.length - 1; i >= 0; i -= 1) {
      const recording =
        timeline.meetingRecordingsById[timeline.meetingRecordingOrder[i]];
      if (
        recording != null &&
        (recording.status === 'starting' ||
          recording.status === 'recording' ||
          recording.status === 'finalizing')
      ) {
        return recording;
      }
    }
    return null;
  }

  private dismissedDedupeKeys(): Set<string> {
    const nowMs = Date.now();
    const timeline = timelineService.getTimelineForServices();
    return new Set(
      Object.values(timeline.dismissedMeetingDetectionIds)
        .filter(
          dismissed =>
            nowMs - Date.parse(dismissed.dismissedAt) <
            MEETING_DETECTION_DEDUPE_MS,
        )
        .map(dismissed => dismissed.dedupeKey),
    );
  }

  private async refreshPermissionState() {
    this.permissionState = await nativeAudioClient.getPermissionsStatus();
  }

  private failStart(message: string): MeetingRuntimeState {
    this.lastError = message;
    this.broadcast();
    return this.publicState();
  }

  private ensureTimer() {
    if (this.timer != null) return;
    this.timer = setInterval(() => {
      this.evaluate().catch(() => {});
    }, DETECTION_EVALUATE_INTERVAL_MS);
  }

  private broadcast() {
    const payload = this.publicState();
    const key = JSON.stringify(payload);
    if (key === this.lastBroadcastKey) return;
    this.lastBroadcastKey = key;
    sendToAllWindows('flow:meetings:stateChanged', payload);
  }
}

function isAudioChunkReadyEvent(event: {
  type: string;
}): event is { type: 'audio_chunk_ready' } & MeetingAudioChunkMetadata {
  return event.type === 'audio_chunk_ready' && 'chunkId' in event;
}

function normalizeAudioSources(
  sources: StartMeetingTranscriptionArgs['sources'],
): Array<'system' | 'microphone'> {
  if (!Array.isArray(sources)) return [];
  const normalized: Array<'system' | 'microphone'> = [];
  for (const source of sources) {
    if (
      (source === 'system' || source === 'microphone') &&
      !normalized.includes(source)
    ) {
      normalized.push(source);
    }
  }
  return normalized;
}

function needsPermissionPrompt(
  sources: MeetingAudioSource[],
  state: MeetingPermissionState,
): boolean {
  return (
    (sources.includes('microphone') &&
      state.microphoneStatus === 'not_determined') ||
    (sources.includes('system') && state.screenCaptureGranted === false)
  );
}

function microphonePermissionMessage(state: MeetingPermissionState): string {
  if (state.microphoneStatus === 'denied') {
    return 'Microphone permission is denied. Open System Settings > Privacy & Security > Microphone, enable FlowAudioCapture, then restart Flow.';
  }
  if (state.microphoneStatus === 'restricted') {
    return 'Microphone permission is restricted by macOS policy.';
  }
  return 'Microphone permission is required. If macOS did not show a prompt, reset Microphone permission for FlowAudioCapture and try again.';
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
    timer.unref?.();

    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function collectRecentMeetingSources(
  timeline: TimelineView,
): MeetingDetectionContextSource[] {
  const sources: MeetingDetectionContextSource[] = [];
  for (let i = timeline.contextSnapshotOrder.length - 1; i >= 0; i -= 1) {
    const snapshot =
      timeline.contextSnapshotsById[timeline.contextSnapshotOrder[i]];
    if (snapshot == null) continue;
    sources.push({
      context: contextFromSnapshot(snapshot),
      observedAt: snapshot.recordedAt,
    });
    if (sources.length >= DETECTION_SOURCE_LIMIT) return sources;
  }

  for (let i = timeline.captureRecordOrder.length - 1; i >= 0; i -= 1) {
    const record = timeline.captureRecordsById[timeline.captureRecordOrder[i]];
    if (record == null || record.capture.status !== 'captured') continue;
    sources.push({
      context: contextFromCapture(record),
      observedAt: record.capturedAt,
    });
    if (sources.length >= DETECTION_SOURCE_LIMIT) return sources;
  }

  return sources;
}

function contextFromSnapshot(
  snapshot: ContextSnapshotView,
): ContextSnapshotPayload {
  const context = { ...snapshot } as ContextSnapshotPayload & { id?: string };
  delete context.id;
  return context;
}

function contextFromCapture(record: CaptureRecordView): ContextSnapshotPayload {
  const capture = record.capture;
  return {
    hostBundleIdentifier: null,
    hostBundlePath: null,
    appName: capture.appName,
    bundleIdentifier: capture.bundleIdentifier,
    processId: capture.processId,
    windowTitle: capture.windowTitle,
    windowFrame: null,
    source: capture.targetType === 'application' ? 'app' : 'window',
    preciseModeEnabled: true,
    accessibilityTrusted: true,
    captureAccessGranted: capture.status === 'captured',
    isIdle: false,
    idleSeconds: 0,
    changeReasons: [],
    recordedAt: record.capturedAt,
  };
}

async function meetingAudioDirectoryPath(): Promise<string> {
  const directory = path.join(getAppDataDirectoryPath(), 'meeting-audio');
  await fs.mkdir(directory, { recursive: true });
  return directory;
}

export const meetingTranscriptionService = new MeetingTranscriptionService();

export function registerMeetingIpcHandlers() {
  ipcMain.handle('flow:meetings:getState', () =>
    meetingTranscriptionService.getState(),
  );
  ipcMain.handle('flow:meetings:startTranscription', (_event, args) =>
    meetingTranscriptionService.startTranscription(args),
  );
  ipcMain.handle('flow:meetings:stopTranscription', (_event, meetingId) =>
    meetingTranscriptionService.stopTranscription(meetingId),
  );
  ipcMain.handle('flow:meetings:dismissDetection', (_event, detectionId) =>
    meetingTranscriptionService.dismissDetection(detectionId),
  );
  ipcMain.handle('flow:meetings:openFlow', () => {
    showMainWindow();
    return meetingTranscriptionService.getState();
  });
}
