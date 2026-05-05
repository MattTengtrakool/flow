import { BrowserWindow } from 'electron';

let mainWindow: BrowserWindow | null = null;
let createMainWindow: (() => BrowserWindow) | null = null;

export function setMainWindowFactory(factory: () => BrowserWindow) {
  createMainWindow = factory;
}

export function setMainWindow(window: BrowserWindow) {
  mainWindow = window;
}

export function clearMainWindow(window: BrowserWindow) {
  if (mainWindow === window) {
    mainWindow = null;
  }
}

export function getMainWindow(): BrowserWindow | null {
  if (mainWindow == null || mainWindow.isDestroyed()) {
    return null;
  }
  return mainWindow;
}

export function ensureMainWindow(): BrowserWindow | null {
  const current = getMainWindow();
  if (current != null) return current;
  return createMainWindow?.() ?? null;
}

export function showMainWindow(): BrowserWindow | null {
  const window = ensureMainWindow();
  if (window == null) return null;
  window.show();
  window.focus();
  return window;
}

export function sendToAllWindows(channel: string, ...args: unknown[]) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) continue;
    try {
      window.webContents.send(channel, ...args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('Render frame was disposed')) {
        console.warn(`Failed to send ${channel}: ${message}`);
      }
    }
  }
}
