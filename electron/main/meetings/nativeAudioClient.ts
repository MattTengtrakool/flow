import { app } from 'electron';
import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import type {
  MeetingAudioChunkMetadata,
  MeetingAudioSource,
  MeetingMicrophonePermissionStatus,
  MeetingPermissionState,
} from '../../../src/meetings/types';

const execFileAsync = promisify(execFile);

type NativeAudioEvent =
  | {
      type: 'audio_capture_started';
      meetingId: string;
      startedAt: string;
    }
  | ({
      type: 'audio_chunk_ready';
    } & MeetingAudioChunkMetadata)
  | {
      type: 'audio_capture_stopped';
      meetingId: string;
      stoppedAt: string;
    }
  | {
      type: 'audio_capture_failed';
      meetingId?: string;
      message: string;
    };

type StartCaptureArgs = {
  meetingId: string;
  sources: MeetingAudioSource[];
  outputDirectory: string;
  onEvent: (event: NativeAudioEvent) => void;
};

type ActiveCapture = {
  child: ChildProcessWithoutNullStreams;
  meetingId: string;
  source: MeetingAudioSource;
  outputPath: string;
  startedAt: string;
  stopping: boolean;
  stdoutBuffer: string;
  onEvent: (event: NativeAudioEvent) => void;
};

class NativeAudioClient {
  private activeCaptures = new Map<string, ActiveCapture[]>();

  helperPath(): string {
    if (app.isPackaged) {
      return path.join(
        process.resourcesPath,
        'native-audio',
        'FlowAudioCapture.app',
        'Contents',
        'MacOS',
        'FlowAudioCapture',
      );
    }
    return path.join(
      app.getAppPath(),
      'electron',
      'native-audio',
      'build',
      'FlowAudioCapture.app',
      'Contents',
      'MacOS',
      'FlowAudioCapture',
    );
  }

  helperAvailable(): boolean {
    try {
      fs.accessSync(this.helperPath(), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  async getPermissionsStatus(): Promise<MeetingPermissionState> {
    if (!this.helperAvailable()) {
      return unavailablePermissionState();
    }

    try {
      const { stdout } = await execFileAsync(this.helperPath(), [
        'getPermissionsStatus',
      ]);
      const payload = parseNativeAudioEvent(stdout.split(/\r?\n/)[0] ?? '');
      return permissionStateFromPayload(payload);
    } catch {
      return unavailablePermissionState();
    }
  }

  async requestPermissions(
    sources: MeetingAudioSource[],
  ): Promise<MeetingPermissionState> {
    if (!this.helperAvailable()) {
      return unavailablePermissionState();
    }

    try {
      const { stdout } = await execFileAsync(this.helperPath(), [
        'requestPermissions',
        JSON.stringify({
          microphone: sources.includes('microphone'),
          system: sources.includes('system'),
        }),
      ]);
      const payload = parseNativeAudioEvent(stdout.split(/\r?\n/)[0] ?? '');
      return permissionStateFromPayload(payload);
    } catch {
      return unavailablePermissionState();
    }
  }

  startCapture(args: StartCaptureArgs): boolean {
    if (!this.helperAvailable()) return false;
    const sources = captureSources(args.sources);
    if (sources.length === 0) return false;

    let startedCount = 0;
    for (const source of sources) {
      const outputPath = path.join(
        args.outputDirectory,
        `${safeFilePart(args.meetingId)}-${source}-${Date.now()}.m4a`,
      );
      const child = spawn(this.helperPath(), [
        'record',
        JSON.stringify({
          outputPath,
          source,
        }),
      ]);
      const active: ActiveCapture = {
        child,
        meetingId: args.meetingId,
        source,
        outputPath,
        startedAt: new Date().toISOString(),
        stopping: false,
        stdoutBuffer: '',
        onEvent: args.onEvent,
      };
      this.addActiveCapture(active);
      startedCount += 1;

      child.stdout.on('data', data => {
        active.stdoutBuffer += data.toString('utf8');
        const lines = active.stdoutBuffer.split(/\r?\n/);
        active.stdoutBuffer = lines.pop() ?? '';
        for (const line of lines) {
          this.handleLine(active, line);
        }
      });
      child.stderr.on('data', data => {
        const message = data.toString('utf8').trim();
        if (message.length > 0) {
          args.onEvent({
            type: 'audio_capture_failed',
            meetingId: args.meetingId,
            message,
          });
        }
      });
      child.on('close', code => {
        this.removeActiveCapture(active);
        if (!active.stopping && code !== 0) {
          args.onEvent({
            type: 'audio_capture_failed',
            meetingId: args.meetingId,
            message: `Meeting audio helper exited with code ${code ?? 'null'}.`,
          });
        }
      });
      child.on('error', error => {
        this.removeActiveCapture(active);
        args.onEvent({
          type: 'audio_capture_failed',
          meetingId: args.meetingId,
          message: error.message,
        });
      });
    }
    return startedCount > 0;
  }

  stopCapture(meetingId: string) {
    const activeCaptures = this.activeCaptures.get(meetingId) ?? [];
    for (const active of activeCaptures) {
      active.stopping = true;
      active.child.stdin.write('stop\n', error => {
        if (error != null) {
          active.child.kill('SIGTERM');
          this.removeActiveCapture(active);
          active.onEvent({
            type: 'audio_capture_failed',
            meetingId,
            message: error.message,
          });
        }
      });
    }
  }

  private addActiveCapture(active: ActiveCapture) {
    const existing = this.activeCaptures.get(active.meetingId) ?? [];
    existing.push(active);
    this.activeCaptures.set(active.meetingId, existing);
  }

  private removeActiveCapture(active: ActiveCapture) {
    const existing = this.activeCaptures.get(active.meetingId) ?? [];
    const next = existing.filter(candidate => candidate !== active);
    if (next.length === 0) {
      this.activeCaptures.delete(active.meetingId);
    } else {
      this.activeCaptures.set(active.meetingId, next);
    }
  }

  private handleLine(active: ActiveCapture, line: string) {
    const payload = parseNativeAudioEvent(line);
    if (payload == null) return;
    if ('error' in payload && typeof payload.error === 'string') {
      active.onEvent({
        type: 'audio_capture_failed',
        meetingId: active.meetingId,
        message: payload.error,
      });
      return;
    }
    if (typeof payload.type === 'string') {
      active.onEvent(payload as NativeAudioEvent);
      return;
    }
    if (payload.status === 'recording') {
      active.startedAt =
        typeof payload.startedAt === 'string' ? payload.startedAt : active.startedAt;
      active.outputPath =
        typeof payload.outputPath === 'string'
          ? payload.outputPath
          : active.outputPath;
      active.onEvent({
        type: 'audio_capture_started',
        meetingId: active.meetingId,
        startedAt: active.startedAt,
      });
      return;
    }
    if (payload.status === 'stopped') {
      const stoppedAt =
        typeof payload.stoppedAt === 'string'
          ? payload.stoppedAt
          : new Date().toISOString();
      const filePath =
        typeof payload.outputPath === 'string' ? payload.outputPath : active.outputPath;
      const byteLength =
        typeof payload.byteLength === 'number'
          ? payload.byteLength
          : fileByteLength(filePath);
      active.onEvent({
        type: 'audio_chunk_ready',
        meetingId: active.meetingId,
        chunkId: `audio_chunk_${active.source}_${Date.now().toString(36)}`,
        startedAt: active.startedAt,
        endedAt: stoppedAt,
        source: active.source,
        mimeType: 'audio/mp4',
        filePath,
        byteLength,
      });
      active.onEvent({
        type: 'audio_capture_stopped',
        meetingId: active.meetingId,
        stoppedAt,
      });
      this.removeActiveCapture(active);
    }
  }
}

function parseNativeAudioEvent(
  line: string,
): Record<string, unknown> | null {
  if (line.trim().length === 0) return null;
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function captureSources(sources: MeetingAudioSource[]): MeetingAudioSource[] {
  const captureOrder: MeetingAudioSource[] = [];
  if (sources.includes('system')) captureOrder.push('system');
  if (sources.includes('microphone')) captureOrder.push('microphone');
  return captureOrder;
}

function unavailablePermissionState(): MeetingPermissionState {
  return {
    helperAvailable: false,
    screenCaptureGranted: null,
    microphoneGranted: null,
    microphoneStatus: 'unknown',
  };
}

function permissionStateFromPayload(payload: unknown): MeetingPermissionState {
  return {
    helperAvailable: true,
    screenCaptureGranted: readBoolean(payload, 'screenCaptureGranted'),
    microphoneGranted: readBoolean(payload, 'microphoneGranted'),
    microphoneStatus: readMicrophoneStatus(payload),
  };
}

function readBoolean(payload: unknown, key: string): boolean | null {
  if (payload == null || typeof payload !== 'object' || !(key in payload)) {
    return null;
  }
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'boolean' ? value : null;
}

function readMicrophoneStatus(
  payload: unknown,
): MeetingMicrophonePermissionStatus {
  if (
    payload == null ||
    typeof payload !== 'object' ||
    !('microphone' in payload)
  ) {
    return 'unknown';
  }
  const status = (payload as Record<string, unknown>).microphone;
  switch (status) {
    case 'granted':
    case 'denied':
    case 'not_determined':
    case 'restricted':
      return status;
    default:
      return 'unknown';
  }
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '_').slice(0, 80) || 'meeting';
}

function fileByteLength(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

export const nativeAudioClient = new NativeAudioClient();
