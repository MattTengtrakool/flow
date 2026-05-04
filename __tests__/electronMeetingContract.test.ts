import fs from 'node:fs';
import path from 'node:path';

const root = path.join(__dirname, '..');
const flowApiSourcePath = path.join(root, 'electron', 'shared', 'flowApi.ts');
const preloadSourcePath = path.join(root, 'electron', 'preload', 'index.ts');
const mainSourcePath = path.join(root, 'electron', 'main', 'main.ts');
const meetingServiceSourcePath = path.join(
  root,
  'electron',
  'main',
  'meetings',
  'meetingService.ts',
);
const nativeAudioClientSourcePath = path.join(
  root,
  'electron',
  'main',
  'meetings',
  'nativeAudioClient.ts',
);
const nativeAudioHelperSourcePath = path.join(
  root,
  'electron',
  'native-audio',
  'FlowAudioCapture.mm',
);
const packageJsonPath = path.join(root, 'package.json');
const managedAiClientSourcePath = path.join(
  root,
  'electron',
  'main',
  'ai',
  'managedAiClient.ts',
);

describe('Electron meeting assistant contract', () => {
  test('exposes meetings IPC through the preload bridge', () => {
    const flowApiSource = fs.readFileSync(flowApiSourcePath, 'utf8');
    const preloadSource = fs.readFileSync(preloadSourcePath, 'utf8');
    const mainSource = fs.readFileSync(mainSourcePath, 'utf8');
    const meetingServiceSource = fs.readFileSync(
      meetingServiceSourcePath,
      'utf8',
    );

    expect(flowApiSource).toContain('meetings: {');
    expect(mainSource).toContain('registerMeetingIpcHandlers()');
    for (const channel of [
      'flow:meetings:getState',
      'flow:meetings:startTranscription',
      'flow:meetings:stopTranscription',
      'flow:meetings:dismissDetection',
      'flow:meetings:stateChanged',
    ]) {
      expect(preloadSource + meetingServiceSource).toContain(channel);
    }
  });

  test('keeps meeting audio consent-first and privacy-aware', () => {
    const meetingServiceSource = fs.readFileSync(
      meetingServiceSourcePath,
      'utf8',
    );

    expect(meetingServiceSource).toContain('askBeforeRecording');
    expect(meetingServiceSource).toContain('consentAccepted');
    expect(meetingServiceSource).toContain('Privacy mode is on');
    expect(meetingServiceSource).toContain('stopTranscription');
    expect(meetingServiceSource).toContain('meeting_detected');
    expect(meetingServiceSource).toContain('meeting_transcription_started');
  });

  test('adds native audio helper contract and packaging', () => {
    const nativeAudioSource = fs.readFileSync(
      nativeAudioHelperSourcePath,
      'utf8',
    );
    const nativeClientSource = fs.readFileSync(
      nativeAudioClientSourcePath,
      'utf8',
    );
    const packageJson = fs.readFileSync(packageJsonPath, 'utf8');

    expect(nativeAudioSource).toContain('ScreenCaptureKit/ScreenCaptureKit.h');
    expect(nativeAudioSource).toContain('audio_capture_started');
    expect(nativeAudioSource).toContain('audio_chunk_ready');
    expect(nativeAudioSource).toContain('audio_capture_failed');
    expect(nativeClientSource).toContain('native-audio');
    expect(packageJson).toContain('native-audio:build');
    expect(packageJson).toContain('FlowAudioCapture');
  });

  test('adds managed transcription and meeting summary endpoints', () => {
    const managedAiSource = fs.readFileSync(managedAiClientSourcePath, 'utf8');

    expect(managedAiSource).toContain('transcribeManagedAudioChunk');
    expect(managedAiSource).toContain('summarizeManagedMeeting');
    expect(managedAiSource).toContain('/v1/audio/transcribe');
    expect(managedAiSource).toContain('/v1/meetings/summarize');
  });
});
