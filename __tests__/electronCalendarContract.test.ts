import fs from 'node:fs';
import path from 'node:path';

const calendarSourcePath = path.join(
  __dirname,
  '..',
  'electron',
  'main',
  'calendar',
  'googleCalendarService.ts',
);
const preloadSourcePath = path.join(
  __dirname,
  '..',
  'electron',
  'preload',
  'index.ts',
);
const mainSourcePath = path.join(
  __dirname,
  '..',
  'electron',
  'main',
  'main.ts',
);
const settingsScreenSourcePath = path.join(
  __dirname,
  '..',
  'electron',
  'renderer',
  'screens',
  'SettingsScreen.tsx',
);

describe('Electron Google Calendar contract', () => {
  test('stores calendar integration files in profile-specific app data', () => {
    const source = fs.readFileSync(calendarSourcePath, 'utf8');

    expect(source).toContain('getAppDataDirectoryPath');
    expect(source).toContain("'calendar-integrations.json'");
    expect(source).toContain("'calendar-cache.json'");
  });

  test('encrypts refresh tokens with safeStorage and writes atomically', () => {
    const source = fs.readFileSync(calendarSourcePath, 'utf8');

    expect(source).toContain('safeStorage.encryptString(value)');
    expect(source).toContain('safeStorage.decryptString(buffer)');
    expect(source).toContain('const temporaryPath = `${filePath}.tmp`');
    expect(source).toContain('JSON.stringify(value, null, 2)');
    expect(source).toContain('await fs.rename(temporaryPath, filePath)');
  });

  test('uses read-only Google Calendar scopes and loopback PKCE OAuth', () => {
    const source = fs.readFileSync(calendarSourcePath, 'utf8');

    expect(source).toContain('calendar.calendarlist.readonly');
    expect(source).toContain('calendar.events.readonly');
    expect(source).toContain('http.createServer');
    expect(source).toContain("code_challenge_method', 'S256'");
    expect(source).toContain("prompt', 'select_account consent'");
    expect(source).toContain('shell.openExternal');
    expect(source).not.toContain("from 'googleapis'");
    expect(source).not.toContain('from "googleapis"');
  });

  test('registers and exposes calendar IPC handlers', () => {
    const calendarSource = fs.readFileSync(calendarSourcePath, 'utf8');
    const preloadSource = fs.readFileSync(preloadSourcePath, 'utf8');
    const mainSource = fs.readFileSync(mainSourcePath, 'utf8');

    expect(mainSource).toContain('registerCalendarIpcHandlers()');
    for (const channel of [
      'flow:calendar:getState',
      'flow:calendar:connectGoogleAccount',
      'flow:calendar:disconnectGoogleAccount',
      'flow:calendar:syncNow',
      'flow:calendar:updateCalendarSelection',
      'flow:calendar:updateCalendarSourceMode',
      'flow:calendar:updateEventAnnotation',
      'flow:calendar:updateEventBlockLink',
      'flow:calendar:stateChanged',
    ]) {
      expect(calendarSource + preloadSource).toContain(channel);
    }
  });

  test('stores source modes and local event annotations without Google writeback', () => {
    const source = fs.readFileSync(calendarSourcePath, 'utf8');

    expect(source).toContain('calendarSourceModes');
    expect(source).toContain('eventAnnotations');
    expect(source).toContain('modeOverride');
    expect(source).toContain('updateEventAnnotation');
    expect(source).toContain('updateEventBlockLink');
    expect(source).not.toContain('calendar.events.update');
    expect(source).not.toContain('calendar.events.patch');
  });

  test('migrates legacy task-context calendars to scheduled mode', () => {
    const source = fs.readFileSync(calendarSourcePath, 'utf8');

    expect(source).toContain("value === 'task_context'");
    expect(source).toContain("return 'scheduled'");
    expect(source).toContain("? 'scheduled'");
    expect(source).toContain(": 'ignored'");
  });

  test('settings present scheduled context ignore source controls', () => {
    const source = fs.readFileSync(settingsScreenSourcePath, 'utf8');

    expect(source).toContain("label: 'Scheduled'");
    expect(source).toContain("label: 'Context'");
    expect(source).toContain("label: 'Ignore'");
    expect(source).toContain('sourceModeDescription');
    expect(source).not.toContain("label: 'Task'");
  });

  test('preserves Google calendar source titles for display', () => {
    const source = fs.readFileSync(calendarSourcePath, 'utf8');

    expect(source).toContain(
      'summary: sanitizeCalendarSourceTitle(entry.summary)',
    );
    expect(source).toContain('function sanitizeCalendarText');
    expect(source).toContain('redactSensitiveText(value)');
    expect(source).toContain('function sanitizeCalendarSourceTitle');
  });

  test('reduces private calendar event details before cache/context use', () => {
    const source = fs.readFileSync(calendarSourcePath, 'utf8');

    expect(source).toContain('function reducePrivateCalendarEvent');
    expect(source).toContain("title: 'Private event'");
    expect(source).toContain('attendees: []');
    expect(source).toContain('conferenceUrl: null');
    expect(source).toContain('htmlLink: null');
  });

  test('hydrates before returning calendar state to the renderer', () => {
    const source = fs.readFileSync(calendarSourcePath, 'utf8');

    expect(source).toContain('async getState(): Promise<CalendarStatePayload>');
    expect(source).toContain('await this.ensureLoaded();');
    expect(source).toContain('this.broadcast();');
  });

  test('asks for confirmation before disconnecting Google Calendar', () => {
    const source = fs.readFileSync(settingsScreenSourcePath, 'utf8');

    expect(source).toContain('confirmDisconnectAccountId');
    expect(source).toContain('Confirm disconnect');
    expect(source).toContain('Click Confirm disconnect to remove');
  });
});
