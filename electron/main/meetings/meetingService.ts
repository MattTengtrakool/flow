import { BrowserWindow, ipcMain } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  MEETING_DETECTION_DEDUPE_MS,
  detectLikelyMeeting,
} from '../../../src/meetings/detection';
import type {
  MeetingAudioChunkMetadata,
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
  getCurrentContext,
} from '../../../src/timeline/eventLog';
import {
  summarizeManagedMeeting,
  transcribeManagedAudioChunk,
} from '../ai/managedAiClient';
import {
  getAppDataDirectoryPath,
  getCompanionWindowTitle,
} from '../appProfile';
import { calendarService } from '../calendar/googleCalendarService';
import { captureClient } from '../capture/captureService';
import { settingsService } from '../settings/settingsService';
import { timelineService } from '../timeline/timelineService';
import { nativeAudioClient } from './nativeAudioClient';

const DETECTION_EVALUATE_INTERVAL_MS = 15_000;
const AUDIO_CHUNK_SECONDS = 15;
const FINALIZATION_WAIT_TIMEOUT_MS = 2 * 60_000;
const SUMMARY_REQUEST_TIMEOUT_MS = 90_000;

class MeetingTranscriptionService {
  private timer: NodeJS.Timeout | null = null;
  private finalizationTimers = new Map<string, NodeJS.Timeout>();
  private permissionState: MeetingPermissionState = {
    helperAvailable: nativeAudioClient.helperAvailable(),
    screenCaptureGranted: null,
    microphoneGranted: null,
  };
  private lastError: string | null = null;

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
    const sources = [
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
    if (
      meetingSettings.systemAudioEnabled &&
      this.permissionState.screenCaptureGranted === false
    ) {
      return this.failStart(
        'Screen Recording permission is required for meeting audio.',
      );
    }
    if (
      meetingSettings.microphoneEnabled &&
      this.permissionState.microphoneGranted === false
    ) {
      return this.failStart('Microphone permission is required.');
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
      status: 'starting',
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
      chunkSeconds: AUDIO_CHUNK_SECONDS,
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
    const detection = detectLikelyMeeting({
      context: getCurrentContext(timeline),
      calendar: await calendarService.getState(),
      enabledApps: settings.meetingAssistant.enabledApps,
      dismissedDedupeKeys: this.dismissedDedupeKeys(),
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
      this.lastError = null;
      await this.finalizeMeetingIfStopped(chunk.meetingId);
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
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('flow:meetings:stateChanged', payload);
    }
  }
}

function isAudioChunkReadyEvent(event: {
  type: string;
}): event is { type: 'audio_chunk_ready' } & MeetingAudioChunkMetadata {
  return event.type === 'audio_chunk_ready' && 'chunkId' in event;
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

function showMainWindow() {
  const companionTitle = getCompanionWindowTitle();
  const window = BrowserWindow.getAllWindows().find(
    candidate => candidate.getTitle() !== companionTitle,
  );
  if (window != null) {
    window.show();
    window.focus();
  }
}
