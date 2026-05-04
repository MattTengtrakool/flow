import {EventEmitter} from 'node:events';
import {execFile, spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {app} from 'electron';

import type {
  AudioTranscriptSegment,
  AudioPermissionStatus,
  AudioRecordingSource,
} from '../../../src/audio/types';

export type NativeAudioRecordingStarted = {
  status: 'recording';
  startedAt: string;
  outputPath: string;
};

export type NativeAudioRecordingStopped = {
  status: 'stopped';
  stoppedAt: string;
  outputPath: string;
  durationMs: number;
  byteLength: number;
};

export type NativeAudioTranscriptionResult = {
  transcript: string;
  generatedAt: string;
  durationMs: number;
  segments: AudioTranscriptSegment[];
};

type NativeAudioEvents = {
  stopped: [NativeAudioRecordingStopped];
  failed: [Error];
};

const execFileAsync = promisify(execFile);

function nativeAudioHelperPath(): string {
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

async function callNativeHelper<T>(
  command: string,
  payload?: unknown,
): Promise<T | null> {
  const helperPath = nativeAudioHelperPath();
  if (!existsSync(helperPath)) return null;

  const args =
    payload == null ? [command] : [command, JSON.stringify(payload)];
  const {stdout} = await execFileAsync(helperPath, args, {
    maxBuffer: 1024 * 1024,
  });
  const firstLine = stdout.trim().split('\n')[0];
  if (firstLine == null || firstLine.length === 0) {
    throw new Error(`Native audio helper returned no payload for ${command}.`);
  }
  const parsed = JSON.parse(firstLine) as unknown;
  if (
    parsed != null &&
    typeof parsed === 'object' &&
    'error' in parsed &&
    typeof parsed.error === 'string'
  ) {
    throw new Error(parsed.error);
  }
  return parsed as T;
}

function unavailablePermissions(): AudioPermissionStatus {
  return {
    microphone: 'unknown',
    microphoneAccessGranted: false,
    systemAudioCaptureAvailable: false,
    checkedAt: new Date().toISOString(),
  };
}

export class NativeAudioClient extends EventEmitter<NativeAudioEvents> {
  private process: ChildProcessWithoutNullStreams | null = null;
  private stdoutBuffer = '';
  private startPromise: Promise<NativeAudioRecordingStarted> | null = null;
  private resolveStart: ((value: NativeAudioRecordingStarted) => void) | null =
    null;
  private rejectStart: ((error: Error) => void) | null = null;

  async getPermissionsStatus(): Promise<AudioPermissionStatus> {
    return (
      (await callNativeHelper<AudioPermissionStatus>('getPermissionsStatus')) ??
      unavailablePermissions()
    );
  }

  async requestPermissions(): Promise<AudioPermissionStatus> {
    return (
      (await callNativeHelper<AudioPermissionStatus>('requestPermissions')) ??
      unavailablePermissions()
    );
  }

  async transcribeFile(args: {
    filePath: string;
  }): Promise<NativeAudioTranscriptionResult> {
    const result = await callNativeHelper<NativeAudioTranscriptionResult>(
      'transcribe',
      args,
    );
    if (result == null) {
      throw new Error('Native audio helper is not built. Run pnpm native-audio:build.');
    }
    return result;
  }

  async startRecording(args: {
    outputPath: string;
    source: AudioRecordingSource;
  }): Promise<NativeAudioRecordingStarted> {
    if (this.process != null) {
      throw new Error('An audio recording is already running.');
    }
    if (args.source === 'combined') {
      throw new Error(
        'Combined mic + meeting audio mixing is not available yet. Choose microphone or meeting audio.',
      );
    }

    const helperPath = nativeAudioHelperPath();
    if (!existsSync(helperPath)) {
      throw new Error(
        'Native audio helper is not built. Run pnpm native-audio:build.',
      );
    }

    this.stdoutBuffer = '';
    this.startPromise = new Promise((resolve, reject) => {
      this.resolveStart = resolve;
      this.rejectStart = reject;
    });
    this.process = spawn(helperPath, [
      'record',
      JSON.stringify({
        outputPath: args.outputPath,
        source: args.source,
      }),
    ]);
    this.process.stdout.setEncoding('utf8');
    this.process.stderr.setEncoding('utf8');
    this.process.stdout.on('data', chunk => this.handleStdout(chunk));
    this.process.stderr.on('data', chunk => {
      const message = String(chunk).trim();
      if (message.length > 0) this.fail(new Error(message));
    });
    this.process.on('error', error => this.fail(error));
    this.process.on('exit', code => {
      if (code !== 0 && this.process != null) {
        this.fail(new Error(`Audio helper exited with code ${code ?? 'null'}.`));
      }
      this.process = null;
    });
    return this.startPromise;
  }

  pauseRecording(): void {
    this.writeCommand('pause');
  }

  resumeRecording(): void {
    this.writeCommand('resume');
  }

  stopRecording(): void {
    this.writeCommand('stop');
  }

  private writeCommand(command: string) {
    if (this.process == null) return;
    this.process.stdin.write(`${command}\n`);
  }

  private handleStdout(chunk: string) {
    this.stdoutBuffer += chunk;
    let newlineIndex = this.stdoutBuffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line.length > 0) this.handleLine(line);
      newlineIndex = this.stdoutBuffer.indexOf('\n');
    }
  }

  private handleLine(line: string) {
    let payload: unknown;
    try {
      payload = JSON.parse(line) as unknown;
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    if (
      payload != null &&
      typeof payload === 'object' &&
      'error' in payload &&
      typeof payload.error === 'string'
    ) {
      this.fail(new Error(payload.error));
      return;
    }
    if (
      payload != null &&
      typeof payload === 'object' &&
      (payload as {status?: unknown}).status === 'recording'
    ) {
      this.resolveStart?.(payload as NativeAudioRecordingStarted);
      this.clearStartCallbacks();
      return;
    }
    if (
      payload != null &&
      typeof payload === 'object' &&
      (payload as {status?: unknown}).status === 'stopped'
    ) {
      this.emit('stopped', payload as NativeAudioRecordingStopped);
      this.process = null;
    }
  }

  private fail(error: Error) {
    this.rejectStart?.(error);
    this.clearStartCallbacks();
    this.emit('failed', error);
    if (this.process != null) {
      this.process.kill();
      this.process = null;
    }
  }

  private clearStartCallbacks() {
    this.startPromise = null;
    this.resolveStart = null;
    this.rejectStart = null;
  }
}

export const nativeAudioClient = new NativeAudioClient();
