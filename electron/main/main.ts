import {app, BrowserWindow, Menu, Tray, ipcMain, nativeImage} from 'electron';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

import {registerAiIpcHandlers} from './ai/aiService';
import {registerCaptureIpcHandlers} from './capture/captureService';
import {loadEventLog, saveEventLog} from './storage/eventLogStorage';
import {
  registerTimelineIpcHandlers,
  timelineService,
} from './timeline/timelineService';

const isDev = process.env.ELECTRON_RENDERER_URL != null || !app.isPackaged;
let tray: Tray | null = null;

function rendererUrl(): string {
  if (process.env.ELECTRON_RENDERER_URL != null) {
    return process.env.ELECTRON_RENDERER_URL;
  }
  if (isDev) {
    return 'http://localhost:5173';
  }
  return pathToFileURL(
    path.join(__dirname, '../../../dist-renderer/index.html'),
  ).toString();
}

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'Flow',
    icon: assetPath('brand/flow-icon-512.png'),
    backgroundColor: '#f7f5f0',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  void window.loadURL(rendererUrl());

  if (isDev) {
    window.webContents.openDevTools({mode: 'detach'});
  }
}

function assetPath(relativePath: string): string {
  return path.join(app.getAppPath(), relativePath);
}

function createTray() {
  const image = nativeImage.createFromPath(
    assetPath('brand/generated/flow-menubar@1x.png'),
  );
  image.setTemplateImage(true);
  tray = new Tray(image);
  tray.setToolTip('Flow');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Show Flow',
        click() {
          const existing = BrowserWindow.getAllWindows()[0];
          if (existing != null) {
            existing.show();
            existing.focus();
          } else {
            createMainWindow();
          }
        },
      },
      {type: 'separator'},
      {role: 'quit'},
    ]),
  );
}

ipcMain.handle('flow:app:getVersion', () => app.getVersion());
ipcMain.handle('flow:storage:loadEventLog', () => loadEventLog());
ipcMain.handle('flow:storage:saveEventLog', (_event, eventLog: unknown) => {
  if (!Array.isArray(eventLog)) {
    throw new Error('eventLog must be an array.');
  }
  return saveEventLog(eventLog);
});
registerCaptureIpcHandlers();
registerAiIpcHandlers();
registerTimelineIpcHandlers();

app.whenReady().then(() => {
  timelineService.hydrate().catch(() => {});
  createMainWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
