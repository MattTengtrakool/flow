import {readFileSync} from 'node:fs';
import path from 'node:path';

const mainSourcePath = path.join(
  __dirname,
  '..',
  'electron',
  'main',
  'main.ts',
);
const windowRegistrySourcePath = path.join(
  __dirname,
  '..',
  'electron',
  'main',
  'windowRegistry.ts',
);
const proactiveSourcePath = path.join(
  __dirname,
  '..',
  'electron',
  'main',
  'proactive',
  'proactiveService.ts',
);
const meetingSourcePath = path.join(
  __dirname,
  '..',
  'electron',
  'main',
  'meetings',
  'meetingService.ts',
);

describe('Electron main window contract', () => {
  test('tracks the main window separately from the companion window', () => {
    const source = readFileSync(mainSourcePath, 'utf8');
    const registrySource = readFileSync(windowRegistrySourcePath, 'utf8');
    const proactiveSource = readFileSync(proactiveSourcePath, 'utf8');
    const meetingSource = readFileSync(meetingSourcePath, 'utf8');

    expect(source).toContain('setMainWindowFactory(createMainWindow)');
    expect(source).toContain('if (getMainWindow() == null)');
    expect(registrySource).toContain('let mainWindow: BrowserWindow | null = null;');
    expect(registrySource).toContain('export function showMainWindow()');
    expect(registrySource).toContain('mainWindow == null || mainWindow.isDestroyed()');
    expect(proactiveSource).toContain("import { showMainWindow } from '../windowRegistry';");
    expect(meetingSource).toContain("import { showMainWindow } from '../windowRegistry';");
    expect(proactiveSource).not.toContain('getCompanionWindowTitle');
    expect(meetingSource).not.toContain('getCompanionWindowTitle');
    expect(source).not.toContain('BrowserWindow.getAllWindows()[0]');
    expect(source).not.toContain('BrowserWindow.getAllWindows().length');
  });
});
