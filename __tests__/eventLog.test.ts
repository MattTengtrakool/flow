import {
  createEmptyTimeline,
  EMPTY_TIMELINE,
  replayEventLog,
  stepEvent,
  type DomainEvent,
} from '../src/timeline/eventLog';

describe('replayEventLog', () => {
  test('rebuilds the planner timeline from append-only events', () => {
    const eventLog: DomainEvent[] = [
      {
        id: 'event_1',
        type: 'session_started',
        sessionId: 'session_1',
        title: 'Morning Session',
        occurredAt: '2026-04-12T15:00:00.000Z',
      },
      {
        id: 'event_2',
        type: 'observation_added',
        observationId: 'observation_1',
        sessionId: 'session_1',
        text: 'Reviewed the task board and sorted follow-ups.',
        occurredAt: '2026-04-12T15:06:00.000Z',
      },
      {
        id: 'event_3',
        type: 'observation_deleted',
        observationId: 'observation_1',
        occurredAt: '2026-04-12T15:08:00.000Z',
      },
      {
        id: 'event_4',
        type: 'session_renamed',
        sessionId: 'session_1',
        title: 'Morning Planning Session',
        occurredAt: '2026-04-12T15:09:00.000Z',
      },
    ];

    const timeline = replayEventLog(eventLog);

    expect(timeline.currentSessionId).toBe('session_1');
    expect(timeline.sessionsById.session_1.title).toBe(
      'Morning Planning Session',
    );
    expect(timeline.sessionsById.session_1.observationIds).toEqual([
      'observation_1',
    ]);
    expect(timeline.observationsById.observation_1.deletedAt).toBe(
      '2026-04-12T15:08:00.000Z',
    );
  });
});

describe('stepEvent', () => {
  const firstEvent: DomainEvent = {
    id: 'e1',
    type: 'session_started',
    sessionId: 'session_1',
    title: 'Session 1',
    occurredAt: '2026-04-12T15:00:00.000Z',
  };

  const secondEvent: DomainEvent = {
    id: 'e2',
    type: 'observation_added',
    observationId: 'obs_1',
    sessionId: 'session_1',
    text: 'Reviewed docs',
    occurredAt: '2026-04-12T15:01:00.000Z',
  };

  test('incremental stepping matches full replay', () => {
    const fullReplay = replayEventLog([firstEvent, secondEvent]);
    let incremental = createEmptyTimeline();
    incremental = stepEvent(incremental, firstEvent);
    incremental = stepEvent(incremental, secondEvent);

    expect(incremental.currentSessionId).toBe('session_1');
    expect(incremental.sessionOrder).toEqual(['session_1']);
    expect(incremental.observationOrder).toEqual(['obs_1']);
    expect(fullReplay.currentSessionId).toBe(incremental.currentSessionId);
    expect(fullReplay.sessionOrder).toEqual(incremental.sessionOrder);
    expect(fullReplay.observationOrder).toEqual(incremental.observationOrder);
  });

  test('does not mutate the input timeline', () => {
    const base = stepEvent(createEmptyTimeline(), firstEvent);
    const originalSessionsById = base.sessionsById;
    const originalSessionOrder = base.sessionOrder;
    const originalObservationsById = base.observationsById;
    const originalObservationOrder = base.observationOrder;

    const next = stepEvent(base, secondEvent);

    expect(base.sessionsById).toBe(originalSessionsById);
    expect(base.sessionOrder).toBe(originalSessionOrder);
    expect(base.observationsById).toBe(originalObservationsById);
    expect(base.observationOrder).toBe(originalObservationOrder);
    expect(base.observationOrder).toEqual([]);
    expect(next).not.toBe(base);
    expect(next.observationOrder).toEqual(['obs_1']);
    expect(next.observationsById.obs_1).toBeDefined();
  });

  test('does not mutate EMPTY_TIMELINE', () => {
    const result = stepEvent(EMPTY_TIMELINE, firstEvent);

    expect(EMPTY_TIMELINE.sessionOrder).toEqual([]);
    expect(EMPTY_TIMELINE.sessionsById).toEqual({});
    expect(result.sessionOrder).toEqual(['session_1']);
    expect(result).not.toBe(EMPTY_TIMELINE);
  });

  test('replays append-only block correction events', () => {
    const eventLog: DomainEvent[] = [
      {
        id: 'e-correction',
        type: 'user_block_corrected',
        blockId: 'block_1',
        notesKey: 'obs_1|obs_2',
        title: 'Corrected title',
        category: 'planning',
        markedWrong: true,
        feedback: 'This was planning, not coding.',
        occurredAt: '2026-04-12T15:20:00.000Z',
      },
    ];

    const timeline = replayEventLog(eventLog);

    expect(timeline.userBlockCorrections['obs_1|obs_2']).toMatchObject({
      blockId: 'block_1',
      title: 'Corrected title',
      category: 'planning',
      markedWrong: true,
      feedback: 'This was planning, not coding.',
      editedAt: '2026-04-12T15:20:00.000Z',
    });
  });

  test('replays proactive insight lifecycle events', () => {
    const eventLog: DomainEvent[] = [
      {
        id: 'e-proactive',
        type: 'proactive_insight_generated',
        occurredAt: '2026-05-02T16:50:00.000Z',
        insight: {
          id: 'insight_meeting',
          kind: 'pre_meeting_brief',
          title: 'Prep for design review',
          body: 'Starts in 10 min.',
          reason: 'Upcoming calendar event overlaps recent Flow work.',
          priority: 'normal',
          relatedBlockIds: ['block_1'],
          relatedCalendarEventIds: ['calendar_event_1'],
          relatedArtifactIds: ['Design doc'],
          relatedObservationIds: ['obs_1'],
          actions: [{ id: 'dismiss', label: 'Dismiss', kind: 'dismiss' }],
          primaryAction: { id: 'open_flow', label: 'Open Flow', kind: 'open' },
          displayMode: 'brief',
          generatedAt: '2026-05-02T16:50:00.000Z',
        },
      },
      {
        id: 'e-snooze',
        type: 'proactive_insight_snoozed',
        insightId: 'insight_meeting',
        snoozedUntil: '2026-05-02T17:00:00.000Z',
        occurredAt: '2026-05-02T16:51:00.000Z',
      },
      {
        id: 'e-dismiss',
        type: 'proactive_insight_dismissed',
        insightId: 'insight_meeting',
        occurredAt: '2026-05-02T16:55:00.000Z',
      },
    ];

    const timeline = replayEventLog(eventLog);

    expect(timeline.proactiveInsightOrder).toEqual(['insight_meeting']);
    expect(timeline.proactiveInsightsById.insight_meeting).toMatchObject({
      title: 'Prep for design review',
      reason: 'Upcoming calendar event overlaps recent Flow work.',
      relatedArtifactIds: ['Design doc'],
      relatedObservationIds: ['obs_1'],
      displayMode: 'brief',
      status: 'dismissed',
      dismissedAt: '2026-05-02T16:55:00.000Z',
    });
  });

  test('replays meeting transcription events without mutating snapshots', () => {
    const eventLog: DomainEvent[] = [
      {
        id: 'e-detect',
        type: 'meeting_detected',
        occurredAt: '2026-05-02T17:00:00.000Z',
        detection: {
          id: 'meeting_detection_1',
          dedupeKey: 'zoom:weekly-sync:calendar:1',
          detectedAt: '2026-05-02T17:00:00.000Z',
          expiresAt: '2026-05-02T17:10:00.000Z',
          score: 0.94,
          confidence: 'high',
          appName: 'zoom.us',
          bundleIdentifier: 'us.zoom.xos',
          windowTitle: 'Zoom Meeting',
          calendarEventId: 'calendar_event_1',
          calendarEventTitle: 'Weekly sync',
          calendarEventStartTime: '2026-05-02T17:00:00.000Z',
          calendarEventEndTime: '2026-05-02T17:30:00.000Z',
          reasons: ['Zoom is the active app.'],
        },
      },
      {
        id: 'e-start',
        type: 'meeting_transcription_started',
        occurredAt: '2026-05-02T17:01:00.000Z',
        recording: {
          id: 'recording_1',
          meetingId: 'meeting_1',
          detectionId: 'meeting_detection_1',
          startedAt: '2026-05-02T17:01:00.000Z',
          stoppedAt: null,
          status: 'starting',
          appName: 'zoom.us',
          bundleIdentifier: 'us.zoom.xos',
          windowTitle: 'Zoom Meeting',
          calendarEventId: 'calendar_event_1',
          sources: ['system'],
          rawAudioSaved: false,
          errorMessage: null,
        },
      },
      {
        id: 'e-transcript',
        type: 'meeting_transcript_chunk_added',
        occurredAt: '2026-05-02T17:01:20.000Z',
        chunk: {
          id: 'transcript_1',
          meetingId: 'meeting_1',
          chunkId: 'chunk_1',
          startedAt: '2026-05-02T17:01:00.000Z',
          endedAt: '2026-05-02T17:01:15.000Z',
          text: 'We decided to ship the beta next week.',
          speakerLabel: null,
          confidence: 0.91,
          language: 'en',
          source: 'system',
          transcribedAt: '2026-05-02T17:01:20.000Z',
        },
      },
      {
        id: 'e-summary',
        type: 'meeting_summary_generated',
        occurredAt: '2026-05-02T17:35:00.000Z',
        summary: {
          id: 'meeting_summary_1',
          meetingId: 'meeting_1',
          generatedAt: '2026-05-02T17:35:00.000Z',
          title: 'Weekly sync',
          summary: 'The team agreed to ship the beta next week.',
          decisions: ['Ship the beta next week.'],
          actionItems: ['Prepare beta checklist.'],
          followUps: [],
          questions: [],
        },
      },
    ];

    const timeline = replayEventLog(eventLog);

    expect(timeline.meetingDetectionOrder).toEqual(['meeting_detection_1']);
    expect(timeline.meetingRecordingsById.meeting_1.status).toBe('stopped');
    expect(timeline.meetingTranscriptChunksByMeetingId.meeting_1).toHaveLength(
      1,
    );
    expect(timeline.meetingSummariesByMeetingId.meeting_1.title).toBe(
      'Weekly sync',
    );
  });

  test('keeps legacy audio meeting summaries replayable', () => {
    const timeline = replayEventLog([
      {
        id: 'e-legacy-summary',
        type: 'meeting_summary_generated',
        meetingId: 'meeting_legacy',
        recordingId: 'recording_legacy',
        generatedAt: '2026-05-02T18:35:00.000Z',
        title: 'Legacy sync',
        summary: 'Legacy recorder captured follow-ups.',
        actionItems: ['Send the notes.'],
        occurredAt: '2026-05-02T18:35:00.000Z',
      },
    ]);

    expect(timeline.meetingSummariesById.meeting_legacy).toEqual({
      meetingId: 'meeting_legacy',
      recordingId: 'recording_legacy',
      generatedAt: '2026-05-02T18:35:00.000Z',
      title: 'Legacy sync',
      summary: 'Legacy recorder captured follow-ups.',
      actionItems: ['Send the notes.'],
    });
    expect(timeline.meetingSummariesByMeetingId.meeting_legacy).toBeUndefined();
  });

  test('updating an existing session clones the session entry', () => {
    const stopEvent: DomainEvent = {
      id: 'e3',
      type: 'session_stopped',
      sessionId: 'session_1',
      occurredAt: '2026-04-12T15:30:00.000Z',
    };
    const afterStart = stepEvent(createEmptyTimeline(), firstEvent);
    const originalSession = afterStart.sessionsById.session_1;
    expect(originalSession.endedAt).toBeUndefined();

    const afterStop = stepEvent(afterStart, stopEvent);

    expect(afterStop.sessionsById.session_1.endedAt).toBe(stopEvent.occurredAt);
    expect(afterStart.sessionsById.session_1).toBe(originalSession);
    expect(originalSession.endedAt).toBeUndefined();
    expect(afterStop.sessionsById.session_1).not.toBe(originalSession);
  });
});
