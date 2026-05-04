import {readFileSync} from 'node:fs';
import path from 'node:path';

const mainSourcePath = path.join(
  __dirname,
  '..',
  'electron',
  'main',
  'main.ts',
);

describe('Electron main window contract', () => {
  test('tracks the main window separately from the companion window', () => {
    const source = readFileSync(mainSourcePath, 'utf8');

    expect(source).toContain('let mainWindow: BrowserWindow | null = null;');
    expect(source).toContain('function showMainWindow()');
    expect(source).toContain('if (mainWindow == null || mainWindow.isDestroyed())');
    expect(source).not.toContain('BrowserWindow.getAllWindows()[0]');
    expect(source).not.toContain('BrowserWindow.getAllWindows().length');
  });
});
