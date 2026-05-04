import fs from 'node:fs';
import path from 'node:path';

const flowApiSourcePath = path.join(
  __dirname,
  '..',
  'electron',
  'shared',
  'flowApi.ts',
);
const mainSourcePath = path.join(
  __dirname,
  '..',
  'electron',
  'main',
  'main.ts',
);
const preloadSourcePath = path.join(
  __dirname,
  '..',
  'electron',
  'preload',
  'index.ts',
);
const proactiveServiceSourcePath = path.join(
  __dirname,
  '..',
  'electron',
  'main',
  'proactive',
  'proactiveService.ts',
);
const companionWindowSourcePath = path.join(
  __dirname,
  '..',
  'electron',
  'main',
  'proactive',
  'companionWindow.ts',
);
const managedAiClientSourcePath = path.join(
  __dirname,
  '..',
  'electron',
  'main',
  'ai',
  'managedAiClient.ts',
);

describe('Electron proactive companion contract', () => {
  test('exposes proactive IPC through the preload bridge', () => {
    const flowApiSource = fs.readFileSync(flowApiSourcePath, 'utf8');
    const preloadSource = fs.readFileSync(preloadSourcePath, 'utf8');
    const mainSource = fs.readFileSync(mainSourcePath, 'utf8');
    const proactiveSource = fs.readFileSync(proactiveServiceSourcePath, 'utf8');

    expect(flowApiSource).toContain('proactive: {');
    expect(mainSource).toContain('registerProactiveIpcHandlers()');
    for (const channel of [
      'flow:proactive:getState',
      'flow:proactive:dismiss',
      'flow:proactive:snooze',
      'flow:proactive:action',
      'flow:proactive:stateChanged',
    ]) {
      expect(preloadSource + proactiveSource).toContain(channel);
    }
  });

  test('creates a separate transparent companion window', () => {
    const mainSource = fs.readFileSync(mainSourcePath, 'utf8');
    const proactiveSource = fs.readFileSync(proactiveServiceSourcePath, 'utf8');
    const companionWindowSource = fs.readFileSync(
      companionWindowSourcePath,
      'utf8',
    );

    expect(mainSource).toContain('createCompanionWindow()');
    expect(mainSource).toContain('transparent: true');
    expect(mainSource).toContain('hasShadow: false');
    expect(mainSource).toContain('skipTaskbar: true');
    expect(mainSource).toContain('#/companion');
    expect(proactiveSource + companionWindowSource).toContain('showInactive()');
    expect(mainSource + companionWindowSource).toContain('companionPosition');
    expect(companionWindowSource).toContain('companionCustomPosition');
    expect(companionWindowSource).toContain('setBounds');
  });

  test('builds a rule-based companion candidate pipeline', () => {
    const source = fs.readFileSync(proactiveServiceSourcePath, 'utf8');

    expect(source).toContain('PRE_MEETING_WINDOW_MS');
    for (const kind of [
      'pre_meeting_brief',
      'post_meeting_notes',
      'return_to_task',
      'low_confidence_block',
      'end_of_day_summary',
    ]) {
      expect(source).toContain(kind);
    }
    expect(source).toContain('ACTIVE_LIMIT_BY_INTENSITY');
    expect(source).toContain('quietHoursEnabled');
    expect(source).toContain('snoozedUntil');
    expect(source).toContain('proactive_insight_generated');
    expect(source).toContain('privacyModeEnabled');
  });

  test('adds managed proactive brief endpoint support', () => {
    const managedAiSource = fs.readFileSync(managedAiClientSourcePath, 'utf8');
    const proactiveSource = fs.readFileSync(proactiveServiceSourcePath, 'utf8');

    expect(managedAiSource).toContain('generateManagedProactiveBrief');
    expect(managedAiSource).toContain('/v1/proactive/brief');
    expect(proactiveSource).toContain('generateManagedProactiveBrief');
  });
});
