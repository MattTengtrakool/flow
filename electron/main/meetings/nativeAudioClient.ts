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
  chunkSeconds: number;
  outputDirectory: string;
  onEvent: (event: NativeAudioEvent) => void;
};

class NativeAudioClient {
  private activeProcesses = new Map<string, ChildProcessWithoutNullStreams>();

  helperPath(): string {
    if (app.isPackaged) {
      return path.join(
        process.resourcesPath,
        'native-audio',
        'FlowAudioCapture',
      );
    }
    return path.join(
      app.getAppPath(),
      'electron',
      'native-audio',
      'build',
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
      return {
        helperAvailable: false,
        screenCaptureGranted: null,
        microphoneGranted: null,
      };
    }

    try {
      const { stdout } = await execFileAsync(this.helperPath(), [
        'getPermissionsStatus',
      ]);
      const payload = parseNativeAudioEvent(stdout.split(/\r?\n/)[0] ?? '');
      return {
        helperAvailable: true,
        screenCaptureGranted:
          payload != null && 'screenCaptureGranted' in payload
            ? Boolean(payload.screenCaptureGranted)
            : null,
        microphoneGranted:
          payload != null && 'microphoneGranted' in payload
            ? Boolean(payload.microphoneGranted)
            : null,
      };
    } catch {
      return {
        helperAvailable: false,
        screenCaptureGranted: null,
        microphoneGranted: null,
      };
    }
  }

  startCapture(args: StartCaptureArgs): boolean {
    if (!this.helperAvailable()) return false;
    const child = spawn(this.helperPath(), [
      'start',
      '--meeting-id',
      args.meetingId,
      '--sources',
      args.sources.join(','),
      '--chunk-seconds',
      String(args.chunkSeconds),
      '--output-directory',
      args.outputDirectory,
    ]);
    this.activeProcesses.set(args.meetingId, child);

    let buffer = '';
    child.stdout.on('data', data => {
      buffer += data.toString('utf8');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const event = parseNativeAudioEvent(line);
        if (event != null) args.onEvent(event);
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
    child.on('close', () => {
      this.activeProcesses.delete(args.meetingId);
    });
    child.on('error', error => {
      this.activeProcesses.delete(args.meetingId);
      args.onEvent({
        type: 'audio_capture_failed',
        meetingId: args.meetingId,
        message: error.message,
      });
    });
    return true;
  }

  stopCapture(meetingId: string) {
    const child = this.activeProcesses.get(meetingId);
    if (child != null) {
      child.kill('SIGTERM');
      this.activeProcesses.delete(meetingId);
    }
  }
}

function parseNativeAudioEvent(
  line: string,
): (NativeAudioEvent & Record<string, unknown>) | null {
  if (line.trim().length === 0) return null;
  try {
    return JSON.parse(line) as NativeAudioEvent & Record<string, unknown>;
  } catch {
    return null;
  }
}

export const nativeAudioClient = new NativeAudioClient();
