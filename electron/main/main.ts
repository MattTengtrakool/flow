import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  ipcMain,
  nativeImage,
  screen,
} from 'electron';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

import {registerAiIpcHandlers} from './ai/aiService';
import {registerAudioIpcHandlers} from './audio/audioService';
import {registerCaptureIpcHandlers} from './capture/captureService';
import {loadEventLog, saveEventLog} from './storage/eventLogStorage';
import {
  registerTimelineIpcHandlers,
  timelineService,
} from './timeline/timelineService';

const isDev = process.env.ELECTRON_RENDERER_URL != null || !app.isPackaged;
let tray: Tray | null = null;
let mainWindow: BrowserWindow | null = null;
let companionWindow: BrowserWindow | null = null;

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

function rendererUrlWithMode(mode: string): string {
  const url = new URL(rendererUrl());
  url.searchParams.set('mode', mode);
  return url.toString();
}

function createMainWindow() {
  if (mainWindow != null && !mainWindow.isDestroyed()) {
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
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

  void mainWindow.loadURL(rendererUrl());

  if (isDev) {
    mainWindow.webContents.openDevTools({mode: 'detach'});
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

function createCompanionWindow() {
  companionWindow = new BrowserWindow({
    width: 380,
    height: 148,
    minWidth: 340,
    maxWidth: 420,
    minHeight: 96,
    maxHeight: 520,
    resizable: false,
    frame: false,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: 'Flow Companion',
    icon: assetPath('brand/flow-icon-512.png'),
    backgroundColor: '#f8f7f4',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  companionWindow.setVisibleOnAllWorkspaces(true, {visibleOnFullScreen: true});
  void companionWindow.loadURL(rendererUrlWithMode('companion'));
  companionWindow.on('closed', () => {
    companionWindow = null;
  });
}

function positionCompanionWindow(window: BrowserWindow) {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const bounds = display.workArea;
  const [width, height] = window.getSize();
  window.setPosition(
    Math.round(bounds.x + bounds.width - width - 18),
    Math.round(bounds.y + bounds.height - height - 18),
    false,
  );
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
          showMainWindow();
        },
      },
      {type: 'separator'},
      {role: 'quit'},
    ]),
  );
}

function showMainWindow() {
  const window = createMainWindow();
  window.show();
  window.focus();
}

ipcMain.handle('flow:app:getVersion', () => app.getVersion());
ipcMain.handle('flow:companion:setVisible', (_event, visible: boolean) => {
  if (companionWindow == null || companionWindow.isDestroyed()) return;
  if (visible) {
    positionCompanionWindow(companionWindow);
    companionWindow.showInactive();
  } else {
    companionWindow.hide();
  }
});
ipcMain.handle('flow:companion:setContentHeight', (_event, height: number) => {
  if (companionWindow == null || companionWindow.isDestroyed()) return;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const maxHeight = Math.max(120, display.workArea.height - 36);
  const nextHeight = Math.min(Math.max(Math.ceil(height), 96), maxHeight);
  companionWindow.setContentSize(380, nextHeight, false);
  positionCompanionWindow(companionWindow);
});
ipcMain.handle('flow:storage:loadEventLog', () => loadEventLog());
ipcMain.handle('flow:storage:saveEventLog', (_event, eventLog: unknown) => {
  if (!Array.isArray(eventLog)) {
    throw new Error('eventLog must be an array.');
  }
  return saveEventLog(eventLog);
});
registerCaptureIpcHandlers();
registerAudioIpcHandlers();
registerAiIpcHandlers();
registerTimelineIpcHandlers();

app.whenReady().then(() => {
  timelineService.hydrate().catch(() => {});
  createMainWindow();
  createCompanionWindow();
  createTray();

  app.on('activate', () => {
    if (mainWindow == null || mainWindow.isDestroyed()) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
