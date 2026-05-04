import fs from 'node:fs';
import path from 'node:path';

const appProfileSourcePath = path.join(
  __dirname,
  '..',
  'electron',
  'main',
  'appProfile.ts',
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
const flowApiSourcePath = path.join(
  __dirname,
  '..',
  'electron',
  'shared',
  'flowApi.ts',
);
const packageJsonPath = path.join(__dirname, '..', 'package.json');

describe('Electron app profile contract', () => {
  test('defines separate dev and prod identities', () => {
    const source = fs.readFileSync(appProfileSourcePath, 'utf8');

    expect(source).toContain('FLOW_APP_PROFILE');
    expect(source).toContain("'dev'");
    expect(source).toContain("'prod'");
    expect(source).toContain('!app.isPackaged');
    expect(source).toContain("'Flow Dev'");
    expect(source).toContain("'Flow'");
    expect(source).toContain("app.getPath('appData')");
  });

  test('main process applies profile identity to app windows and tray', () => {
    const source = fs.readFileSync(mainSourcePath, 'utf8');

    expect(source).toContain('app.setName(getAppDisplayName())');
    expect(source).toContain(
      "app.setPath('userData', getAppDataDirectoryPath())",
    );
    expect(source).toContain('title: getAppDisplayName()');
    expect(source).toContain('title: getCompanionWindowTitle()');
    expect(source).toContain('configureCompanionWindow(window)');
    expect(source).toContain('tray.setToolTip(getAppDisplayName())');
    expect(source).toContain('flow:app:getProfile');
  });

  test('preload exposes the app profile through the typed bridge', () => {
    const preloadSource = fs.readFileSync(preloadSourcePath, 'utf8');
    const flowApiSource = fs.readFileSync(flowApiSourcePath, 'utf8');

    expect(flowApiSource).toContain(
      "export type FlowAppProfile = 'dev' | 'prod'",
    );
    expect(flowApiSource).toContain(
      'getProfile: () => Promise<FlowAppProfile>',
    );
    expect(preloadSource).toContain('flow:app:getProfile');
  });

  test('package scripts support local dev and dev packaging without prod data', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(packageJsonPath, 'utf8'),
    ) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts['electron:dev']).toContain(
      'FLOW_APP_PROFILE=dev electron .',
    );
    expect(packageJson.scripts['electron:dev:prod-data']).toContain(
      'FLOW_APP_PROFILE=prod electron .',
    );
    expect(packageJson.scripts['electron:dist:dev']).toContain(
      'com.flow.worklog.dev',
    );
    expect(packageJson.scripts['electron:dist:dev']).toContain('Flow Dev');
  });
});
