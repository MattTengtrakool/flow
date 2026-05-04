import {
  ORPHANED_AUDIO_RECORDING_MESSAGE,
  buildOrphanedAudioRecordingRepairEvent,
} from '../src/audio/orphanRepair';
import {detectMeetingCandidate} from '../src/meeting/detector';
import {
  applyEventInPlace,
  createEmptyTimeline,
  replayEventLog,
  type DomainEvent,
} from '../src/timeline/eventLog';

function contextEvent(
  snapshotId: string,
  at: string,
  appName: string,
  bundleIdentifier: string | null,
  windowTitle: string,
): DomainEvent {
  return {
    id: `event_${snapshotId}`,
    type: 'context_snapshot_recorded',
    snapshotId,
    occurredAt: at,
    snapshot: {
      hostBundleIdentifier: 'com.flow.worklog',
      hostBundlePath: null,
      appName,
      bundleIdentifier,
      processId: 123,
      windowTitle,
      windowFrame: null,
      source: 'window',
      preciseModeEnabled: true,
      accessibilityTrusted: true,
      captureAccessGranted: true,
      isIdle: false,
      idleSeconds: 0,
      changeReasons: ['frontmostApplication', 'windowTitle'],
      recordedAt: at,
    },
  };
}

function captureEvent(
  captureId: string,
  at: string,
  appName: string,
  bundleIdentifier: string | null,
  windowTitle: string,
): DomainEvent {
  return {
    id: `event_${captureId}`,
    type: 'capture_performed',
    captureId,
    occurredAt: at,
    capture: {
      capturedAt: at,
      status: 'captured',
      targetType: 'window',
      appName,
      bundleIdentifier,
      processId: null,
      windowId: null,
      windowTitle,
      displayId: 1,
      confidence: 1,
      width: 1200,
      height: 900,
      frameHash: `${captureId}_hash`,
      perceptualHash: `${captureId}_phash`,
      errorMessage: null,
      previewByteLength: 100,
      privacyRedaction: {
        checked: true,
        applied: false,
        version: 'capture-privacy-v1',
        matchCount: 0,
        matchTypes: [],
      },
      staleFrame: false,
      blankFrame: false,
    },
  };
}

describe('meeting detection and audio event replay', () => {
  test('detects a meeting from focused window context', () => {
    const timeline = createEmptyTimeline();
    applyEventInPlace(timeline, {
      id: 'event_context',
      type: 'context_snapshot_recorded',
      snapshotId: 'context_meet',
      occurredAt: '2026-05-04T17:00:00.000Z',
      snapshot: {
        hostBundleIdentifier: 'com.flow.worklog',
        hostBundlePath: null,
        appName: 'Google Chrome',
        bundleIdentifier: 'com.google.Chrome',
        processId: 123,
        windowTitle: 'Weekly Sync - Google Meet',
        windowFrame: null,
        source: 'window',
        preciseModeEnabled: true,
        accessibilityTrusted: true,
        captureAccessGranted: true,
        isIdle: false,
        idleSeconds: 0,
        changeReasons: ['frontmostApplication', 'windowTitle'],
        recordedAt: '2026-05-04T17:00:00.000Z',
      },
    });

    const result = detectMeetingCandidate({
      timeline,
      createMeetingId: () => 'meeting_1',
      now: '2026-05-04T17:00:10.000Z',
    });

    expect(result?.shouldPrompt).toBe(true);
    expect(result?.candidate.meetingId).toBe('meeting_1');
    expect(result?.candidate.confidence).toBeGreaterThanOrEqual(0.72);
    expect(result?.candidate.reasonCodes).toEqual(
      expect.arrayContaining(['meeting_app', 'meeting_window_title']),
    );
  });

  test('detects Google Meet window titles reported by Chrome', () => {
    const timeline = createEmptyTimeline();
    applyEventInPlace(timeline, {
      id: 'event_context',
      type: 'context_snapshot_recorded',
      snapshotId: 'context_meet',
      occurredAt: '2026-05-04T06:13:33.083Z',
      snapshot: {
        hostBundleIdentifier: 'com.flow.worklog',
        hostBundlePath: null,
        appName: 'Google Chrome',
        bundleIdentifier: 'com.google.Chrome',
        processId: 123,
        windowTitle: 'Meet - eds-buoa-tza - Camera and microphone recording - Google Chrome',
        windowFrame: null,
        source: 'window',
        preciseModeEnabled: true,
        accessibilityTrusted: true,
        captureAccessGranted: true,
        isIdle: false,
        idleSeconds: 0,
        changeReasons: ['frontmostApplication', 'windowTitle'],
        recordedAt: '2026-05-04T06:13:33.083Z',
      },
    });

    const result = detectMeetingCandidate({
      timeline,
      createMeetingId: () => 'meeting_chrome_title',
      now: '2026-05-04T06:13:33.083Z',
    });

    expect(result?.candidate.meetingId).toBe('meeting_chrome_title');
    expect(result?.candidate.reasonCodes).toEqual(
      expect.arrayContaining(['meeting_window_title']),
    );
  });

  test('keeps a recent Meet capture eligible after Flow becomes frontmost', () => {
    const timeline = replayEventLog([
      contextEvent(
        'context_meet',
        '2026-05-04T17:00:00.000Z',
        'Google Chrome',
        'com.google.Chrome',
        'Meet - oxb-rbrv-xvv - Camera and microphone recording - Google Chrome',
      ),
      captureEvent(
        'capture_meet',
        '2026-05-04T17:00:05.000Z',
        'Google Chrome',
        'com.google.Chrome',
        'Meet - oxb-rbrv-xvv',
      ),
      contextEvent(
        'context_flow',
        '2026-05-04T17:00:10.000Z',
        'Electron',
        null,
        'Flow',
      ),
      captureEvent(
        'capture_flow',
        '2026-05-04T17:00:11.000Z',
        'Electron',
        null,
        'Flow',
      ),
    ]);

    const result = detectMeetingCandidate({
      timeline,
      createMeetingId: () => 'meeting_recent_meet',
      now: '2026-05-04T17:00:11.000Z',
    });

    expect(result?.shouldPrompt).toBe(true);
    expect(result?.candidate.meetingId).toBe('meeting_recent_meet');
    expect(result?.candidate.windowTitle).toContain('Meet - oxb-rbrv-xvv');
  });

  test('does not prompt from stale Meet evidence after the user has moved on', () => {
    const timeline = replayEventLog([
      captureEvent(
        'capture_meet',
        '2026-05-04T17:00:00.000Z',
        'Google Chrome',
        'com.google.Chrome',
        'Meet - oxb-rbrv-xvv',
      ),
      contextEvent(
        'context_flow',
        '2026-05-04T17:01:00.000Z',
        'Electron',
        null,
        'Flow',
      ),
    ]);

    const result = detectMeetingCandidate({
      timeline,
      createMeetingId: () => 'meeting_stale_meet',
      now: '2026-05-04T17:01:00.000Z',
    });

    expect(result).toBeNull();
  });

  test('hydrates meeting prompt and recording lifecycle events', () => {
    const events: DomainEvent[] = [
      {
        id: 'event_session',
        type: 'session_started',
        sessionId: 'session_1',
        title: 'Session 1',
        occurredAt: '2026-05-04T17:00:00.000Z',
      },
      {
        id: 'event_meeting',
        type: 'meeting_candidate_detected',
        occurredAt: '2026-05-04T17:01:00.000Z',
        candidate: {
          meetingId: 'meeting_1',
          sessionId: 'session_1',
          status: 'candidate',
          detectedAt: '2026-05-04T17:01:00.000Z',
          updatedAt: '2026-05-04T17:01:00.000Z',
          promptShownAt: null,
          dismissedAt: null,
          endedAt: null,
          recordingId: null,
          appName: 'Google Chrome',
          bundleIdentifier: 'com.google.Chrome',
          windowTitle: 'Weekly Sync - Google Meet',
          confidence: 0.95,
          reasonCodes: ['meeting_window_title'],
          sourceEventIds: ['context_1'],
        },
      },
      {
        id: 'event_prompt',
        type: 'meeting_prompt_shown',
        meetingId: 'meeting_1',
        shownAt: '2026-05-04T17:01:01.000Z',
        occurredAt: '2026-05-04T17:01:01.000Z',
      },
      {
        id: 'event_recording',
        type: 'audio_recording_started',
        occurredAt: '2026-05-04T17:01:05.000Z',
        recording: {
          recordingId: 'recording_1',
          sessionId: 'session_1',
          meetingId: 'meeting_1',
          taskSegmentId: null,
          source: 'microphone',
          status: 'recording',
          startedAt: '2026-05-04T17:01:05.000Z',
          pausedAt: null,
          resumedAt: null,
          stoppedAt: null,
          durationMs: null,
          filePath: '/tmp/recording_1.m4a',
          byteLength: null,
          errorMessage: null,
        },
      },
      {
        id: 'event_stopped',
        type: 'audio_recording_stopped',
        recordingId: 'recording_1',
        stoppedAt: '2026-05-04T17:31:05.000Z',
        durationMs: 30 * 60 * 1000,
        filePath: '/tmp/recording_1.m4a',
        byteLength: 12345,
        occurredAt: '2026-05-04T17:31:05.000Z',
      },
    ];

    const timeline = replayEventLog(events);

    expect(timeline.audioRecordingOrder).toEqual(['recording_1']);
    expect(timeline.activeAudioRecordingId).toBeNull();
    expect(timeline.audioRecordingsById.recording_1).toMatchObject({
      status: 'stopped',
      durationMs: 30 * 60 * 1000,
      byteLength: 12345,
    });
    expect(timeline.meetingCandidatesById.meeting_1).toMatchObject({
      status: 'ended',
      recordingId: 'recording_1',
    });
  });

  test('does not re-prompt a recently dismissed meeting signature', () => {
    const timeline = replayEventLog([
      {
        id: 'event_meeting',
        type: 'meeting_candidate_detected',
        occurredAt: '2026-05-04T17:01:00.000Z',
        candidate: {
          meetingId: 'meeting_1',
          sessionId: null,
          status: 'candidate',
          detectedAt: '2026-05-04T17:01:00.000Z',
          updatedAt: '2026-05-04T17:01:00.000Z',
          promptShownAt: null,
          dismissedAt: null,
          endedAt: null,
          recordingId: null,
          appName: 'Google Chrome',
          bundleIdentifier: 'com.google.Chrome',
          windowTitle: 'Weekly Sync - Google Meet',
          confidence: 0.95,
          reasonCodes: ['meeting_window_title'],
          sourceEventIds: ['context_1'],
        },
      },
      {
        id: 'event_dismiss',
        type: 'meeting_prompt_dismissed',
        meetingId: 'meeting_1',
        dismissedAt: '2026-05-04T17:02:00.000Z',
        reason: 'user_dismissed',
        occurredAt: '2026-05-04T17:02:00.000Z',
      },
      {
        id: 'event_context',
        type: 'context_snapshot_recorded',
        snapshotId: 'context_meet',
        occurredAt: '2026-05-04T17:10:00.000Z',
        snapshot: {
          hostBundleIdentifier: 'com.flow.worklog',
          hostBundlePath: null,
          appName: 'Google Chrome',
          bundleIdentifier: 'com.google.Chrome',
          processId: 123,
          windowTitle: 'Weekly Sync - Google Meet',
          windowFrame: null,
          source: 'window',
          preciseModeEnabled: true,
          accessibilityTrusted: true,
          captureAccessGranted: true,
          isIdle: false,
          idleSeconds: 0,
          changeReasons: ['frontmostApplication', 'windowTitle'],
          recordedAt: '2026-05-04T17:10:00.000Z',
        },
      },
    ]);

    const result = detectMeetingCandidate({
      timeline,
      createMeetingId: () => 'meeting_2',
      now: '2026-05-04T17:10:00.000Z',
    });

    expect(result).toBeNull();
  });

  test('repairs active recording state after restart with a failed event', () => {
    const timeline = replayEventLog([
      {
        id: 'event_recording',
        type: 'audio_recording_started',
        occurredAt: '2026-05-04T17:01:05.000Z',
        recording: {
          recordingId: 'recording_orphan',
          sessionId: 'session_1',
          meetingId: 'meeting_1',
          taskSegmentId: null,
          source: 'microphone',
          status: 'recording',
          startedAt: '2026-05-04T17:01:05.000Z',
          pausedAt: null,
          resumedAt: null,
          stoppedAt: null,
          durationMs: null,
          filePath: '/tmp/recording_orphan.m4a',
          byteLength: null,
          errorMessage: null,
        },
      },
    ]);

    const repairEvent = buildOrphanedAudioRecordingRepairEvent({
      timeline,
      occurredAt: '2026-05-04T17:05:00.000Z',
      createEventId: () => 'event_orphan_repair',
    });

    expect(repairEvent).toMatchObject({
      id: 'event_orphan_repair',
      type: 'audio_recording_failed',
      recordingId: 'recording_orphan',
      errorMessage: ORPHANED_AUDIO_RECORDING_MESSAGE,
    });
    applyEventInPlace(timeline, repairEvent!);
    expect(timeline.activeAudioRecordingId).toBeNull();
    expect(timeline.audioRecordingsById.recording_orphan).toMatchObject({
      status: 'failed',
      errorMessage: ORPHANED_AUDIO_RECORDING_MESSAGE,
    });
  });

  test('ignores stale meeting observations for ordinary browser context', () => {
    const timeline = replayEventLog([
      {
        id: 'event_observation',
        type: 'observation_added',
        observationId: 'observation_meeting',
        text: 'Participated in a Google Meet weekly sync.',
        structured: {
          summary: 'Participated in a Google Meet weekly sync.',
          activityType: 'meeting',
          taskHypothesis: 'Weekly Sync - Google Meet',
          confidence: 0.9,
          sensitivity: 'low',
          sensitivityReason: 'Visible meeting context only.',
          artifacts: [],
          entities: {
            apps: ['Google Chrome'],
            documents: [],
            tickets: [],
            repos: [],
            urls: ['meet.google.com'],
            people: [],
          },
          nextAction: null,
        },
        occurredAt: '2026-05-04T17:00:00.000Z',
      },
      {
        id: 'event_context',
        type: 'context_snapshot_recorded',
        snapshotId: 'context_docs',
        occurredAt: '2026-05-04T17:20:00.000Z',
        snapshot: {
          hostBundleIdentifier: 'com.flow.worklog',
          hostBundlePath: null,
          appName: 'Google Chrome',
          bundleIdentifier: 'com.google.Chrome',
          processId: 123,
          windowTitle: 'Quarterly planning doc - Google Docs',
          windowFrame: null,
          source: 'window',
          preciseModeEnabled: true,
          accessibilityTrusted: true,
          captureAccessGranted: true,
          isIdle: false,
          idleSeconds: 0,
          changeReasons: ['frontmostApplication', 'windowTitle'],
          recordedAt: '2026-05-04T17:20:00.000Z',
        },
      },
    ]);

    const result = detectMeetingCandidate({
      timeline,
      createMeetingId: () => 'meeting_false_positive',
      now: '2026-05-04T17:20:00.000Z',
    });

    expect(result).toBeNull();
  });
});
