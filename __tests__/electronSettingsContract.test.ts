import fs from 'node:fs';
import path from 'node:path';

const settingsSourcePath = path.join(
  __dirname,
  '..',
  'electron',
  'main',
  'settings',
  'settingsService.ts',
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
const envSourcePath = path.join(__dirname, '..', 'electron', 'main', 'env.ts');

describe('Electron settings contract', () => {
  test('stores settings in the profile-specific Application Support directory', () => {
    const source = fs.readFileSync(settingsSourcePath, 'utf8');

    expect(source).toContain('getAppDataDirectoryPath');
    expect(source).toContain("'settings.json'");
  });

  test('uses safeStorage for saved API keys and exposes status only', () => {
    const source = fs.readFileSync(settingsSourcePath, 'utf8');

    expect(source).toContain('safeStorage.encryptString(value)');
    expect(source).toContain('safeStorage.decryptString(buffer)');
    expect(source).toContain("source: stored != null ? 'stored'");
    expect(source).not.toContain('apiKey: decryptApiKey');
  });

  test('keeps environment keys as fallback', () => {
    const source = fs.readFileSync(settingsSourcePath, 'utf8');

    expect(source).toContain('GEMINI_API_KEY');
    expect(source).toContain('ANTHROPIC_API_KEY');
    expect(source).toContain('process.env[ENV_BY_PROVIDER[provider]]');
  });

  test('supports managed AI without exposing provider keys to the renderer', () => {
    const source = fs.readFileSync(settingsSourcePath, 'utf8');

    expect(source).toContain('FLOW_AI_PROXY_URL');
    expect(source).toContain('FLOW_AI_PROXY_TOKEN');
    expect(source).toContain("aiConnectionMode: 'managed'");
    expect(source).toContain("return 'managed';");
    expect(source).toContain('getManagedAiConfig()');
  });

  test('normalizes proactive companion settings', () => {
    const source = fs.readFileSync(settingsSourcePath, 'utf8');

    for (const field of [
      'postMeetingNotesEnabled',
      'returnToTaskEnabled',
      'endOfDaySummaryEnabled',
      'lowConfidenceCorrectionsEnabled',
      'companionPosition',
      'companionCustomPosition',
      'quietHoursStart',
      'quietHoursEnd',
      'intensity',
    ]) {
      expect(source).toContain(field);
    }
  });

  test('normalizes consent-first meeting assistant settings', () => {
    const source = fs.readFileSync(settingsSourcePath, 'utf8');

    for (const field of [
      'DEFAULT_MEETING_ASSISTANT_SETTINGS',
      'askBeforeRecording',
      'systemAudioEnabled',
      'microphoneEnabled',
      'saveRawAudio',
      'deleteRawAudioAfterTranscription',
      'defaultConsentReminderAccepted',
      'enabledApps',
    ]) {
      expect(source).toContain(field);
    }
  });

  test('loads local env before registering Electron services', () => {
    const mainSource = fs.readFileSync(mainSourcePath, 'utf8');
    const envSource = fs.readFileSync(envSourcePath, 'utf8');

    expect(mainSource.startsWith("import './env';")).toBe(true);
    expect(envSource).toContain("'.env'");
    expect(envSource).toContain('profileEnvFile');
    expect(envSource).toContain('process.env[key]');
  });

  test('registers and exposes settings IPC handlers', () => {
    const preloadSource = fs.readFileSync(preloadSourcePath, 'utf8');
    const mainSource = fs.readFileSync(mainSourcePath, 'utf8');

    expect(mainSource).toContain('registerSettingsIpcHandlers()');
    for (const channel of [
      'flow:settings:getSettings',
      'flow:settings:updateSettings',
      'flow:settings:setApiKey',
      'flow:settings:clearApiKey',
      'flow:settings:validateApiKey',
    ]) {
      expect(preloadSource).toContain(channel);
    }
  });
});
