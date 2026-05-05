import {
  detectLikelyMeeting,
  detectLikelyMeetingFromRecentSources,
  scoreMeetingContext,
} from '../src/meetings/detection';
import type { CalendarStatePayload } from '../src/calendar/types';
import type { ContextSnapshotPayload } from '../src/types/contextCapture';

const now = new Date('2026-05-02T17:00:00.000Z');

describe('meeting detection', () => {
  test('scores Zoom windows as high confidence when calendar overlaps', () => {
    const detection = detectLikelyMeeting({
      context: context({
        appName: 'zoom.us',
        bundleIdentifier: 'us.zoom.xos',
        windowTitle: 'Zoom Meeting',
      }),
      calendar: calendarWithBusyEvent('Team sync'),
      now,
    });

    expect(detection).toMatchObject({
      confidence: 'high',
      calendarEventTitle: 'Team sync',
    });
    expect(detection?.score).toBeGreaterThanOrEqual(0.9);
  });

  test('detects browser-based Google Meet without calendar context', () => {
    const result = scoreMeetingContext({
      context: context({
        appName: 'Google Chrome',
        bundleIdentifier: 'com.google.Chrome',
        windowTitle: 'meet.google.com/abc-defg-hij - Google Meet',
      }),
      calendar: null,
      now,
    });

    expect(result.score).toBeGreaterThanOrEqual(0.75);
    expect(result.reasons.join(' ')).toContain('Google Meet');
  });

  test('detects Chrome Meet recording titles even when bundle id is missing', () => {
    const detection = detectLikelyMeeting({
      context: context({
        appName: 'Google Chrome',
        bundleIdentifier: null,
        windowTitle:
          'Meet - bds-zhpv-nmq - Camera and microphone recording - Google Chrome',
      }),
      calendar: null,
      now,
    });

    expect(detection).toMatchObject({
      appName: 'Google Chrome',
      confidence: 'likely',
    });
    expect(detection?.score).toBeGreaterThanOrEqual(0.75);
  });

  test('uses recent meeting source after Flow becomes foreground', () => {
    const detection = detectLikelyMeetingFromRecentSources({
      sources: [
        {
          context: context({
            appName: 'Electron',
            bundleIdentifier: null,
            windowTitle: 'Flow',
            recordedAt: '2026-05-02T16:59:59.000Z',
          }),
        },
        {
          context: context({
            appName: 'Google Chrome',
            bundleIdentifier: null,
            windowTitle:
              'Meet - bds-zhpv-nmq - Camera and microphone recording - Google Chrome',
            recordedAt: '2026-05-02T16:59:45.000Z',
          }),
        },
      ],
      calendar: null,
      now,
      maxAgeMs: 60_000,
    });

    expect(detection?.windowTitle).toContain('Meet - bds-zhpv-nmq');
  });

  test('ignores stale recent-source meeting evidence', () => {
    const detection = detectLikelyMeetingFromRecentSources({
      sources: [
        {
          context: context({
            appName: 'Google Chrome',
            bundleIdentifier: null,
            windowTitle:
              'Meet - bds-zhpv-nmq - Camera and microphone recording - Google Chrome',
            recordedAt: '2026-05-02T16:57:00.000Z',
          }),
        },
        {
          context: context({
            appName: 'Google Chrome',
            bundleIdentifier: null,
            windowTitle: 'New Tab - Google Chrome',
            recordedAt: '2026-05-02T16:59:59.000Z',
          }),
        },
      ],
      calendar: null,
      now,
      maxAgeMs: 60_000,
    });

    expect(detection).toBeNull();
  });

  test('suppresses dismissed meeting dedupe keys', () => {
    const first = detectLikelyMeeting({
      context: context({
        appName: 'Microsoft Teams',
        bundleIdentifier: 'com.microsoft.teams2',
        windowTitle: 'Weekly planning call',
      }),
      calendar: calendarWithBusyEvent('Weekly planning'),
      now,
    });

    expect(first).not.toBeNull();
    const second = detectLikelyMeeting({
      context: context({
        appName: 'Microsoft Teams',
        bundleIdentifier: 'com.microsoft.teams2',
        windowTitle: 'Weekly planning call',
      }),
      calendar: calendarWithBusyEvent('Weekly planning'),
      now,
      dismissedDedupeKeys: new Set([first!.dedupeKey]),
    });

    expect(second).toBeNull();
  });
});

function context(
  patch: Partial<ContextSnapshotPayload>,
): ContextSnapshotPayload {
  return {
    hostBundleIdentifier: null,
    hostBundlePath: null,
    appName: null,
    bundleIdentifier: null,
    processId: 123,
    windowTitle: null,
    windowFrame: null,
    source: 'window',
    preciseModeEnabled: true,
    accessibilityTrusted: true,
    captureAccessGranted: true,
    isIdle: false,
    idleSeconds: 0,
    changeReasons: [],
    recordedAt: now.toISOString(),
    ...patch,
  };
}

function calendarWithBusyEvent(title: string): CalendarStatePayload {
  return {
    accounts: [],
    sources: [],
    events: [
      {
        id: 'calendar_event_1',
        accountId: 'account_1',
        sourceId: 'source_1',
        provider: 'google',
        externalId: 'external_1',
        iCalUID: null,
        title,
        startTime: '2026-05-02T16:30:00.000Z',
        endTime: '2026-05-02T17:30:00.000Z',
        allDay: false,
        status: 'confirmed',
        transparency: 'opaque',
        visibility: 'default',
        eventType: 'default',
        location: null,
        attendees: [],
        conferenceUrl: null,
        htmlLink: null,
        updatedAt: null,
        syncedAt: now.toISOString(),
        busy: true,
      },
    ],
    annotations: [],
    scheduledItems: [],
    taskFitSuggestions: [],
    status: 'idle',
    errorMessage: null,
    lastSyncedAt: now.toISOString(),
    oauthClientConfigured: true,
  };
}
