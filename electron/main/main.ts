import './env';

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
import { pathToFileURL } from 'node:url';

import {
  getAppDataDirectoryPath,
  getAppDisplayName,
  getAppProfile,
  getCompanionWindowTitle,
} from './appProfile';
import { registerAiIpcHandlers } from './ai/aiService';
import { registerAudioIpcHandlers } from './audio/audioService';
import { registerCaptureIpcHandlers } from './capture/captureService';
import {
  calendarService,
  registerCalendarIpcHandlers,
} from './calendar/googleCalendarService';
import { loadEventLog, saveEventLog } from './storage/eventLogStorage';
import {
  companionInitialBounds,
  configureCompanionWindow,
} from './proactive/companionWindow';
import {
  proactiveService,
  registerProactiveIpcHandlers,
} from './proactive/proactiveService';
import {
  meetingTranscriptionService,
  registerMeetingIpcHandlers,
} from './meetings/meetingService';
import {
  registerSettingsIpcHandlers,
  settingsService,
} from './settings/settingsService';
import {
  registerTimelineIpcHandlers,
  timelineService,
} from './timeline/timelineService';

const isDev = process.env.ELECTRON_RENDERER_URL != null || !app.isPackaged;
app.setName(getAppDisplayName());
app.setPath('userData', getAppDataDirectoryPath());

let tray: Tray | null = null;
let mainWindow: BrowserWindow | null = null;
let companionWindow: BrowserWindow | null = null;
const FLOW_APP_ICON_PATH = 'brand/flow-icon-512.png';
const FLOW_TRAY_ICON_PATH = 'brand/generated/flow-menubar@1x.png';

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
  if (mainWindow != null && !mainWindow.isDestroyed()) {
    return mainWindow;
  }
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: getAppDisplayName(),
    icon: assetPath(FLOW_APP_ICON_PATH),
    backgroundColor: '#f7f5f0',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow = window;
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });

  void window.loadURL(rendererUrl());

  if (isDev) {
    window.webContents.openDevTools({ mode: 'detach' });
  }

  return window;
}

function createCompanionWindow() {
  const bounds = companionInitialBounds();
  const window = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    hasShadow: false,
    skipTaskbar: true,
    show: false,
    title: getCompanionWindowTitle(),
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  companionWindow = window;
  configureCompanionWindow(window);
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  void window.loadURL(`${rendererUrl()}#/companion`);
  window.once('ready-to-show', () => {
    if (settingsService.publicSettings().proactive.companionEnabled) {
      window.showInactive();
    }
  });
  window.on('closed', () => {
    if (companionWindow === window) companionWindow = null;
  });
}

function assetPath(relativePath: string): string {
  return path.join(app.getAppPath(), relativePath);
}

function createTray() {
  const image = nativeImage.createFromPath(assetPath(FLOW_TRAY_ICON_PATH));
  image.setTemplateImage(true);
  tray = new Tray(image);
  tray.setToolTip(getAppDisplayName());
  tray.setContextMenu(
    Menu.buildFromTemplate([
          {
            label: `Show ${getAppDisplayName()}`,
            click() {
              showMainWindow();
            },
          },
      { type: 'separator' },
      { role: 'quit' },
    ]),
  );
}

function showMainWindow() {
  const window = createMainWindow();
  window.show();
  window.focus();
}

function setDockIcon() {
  if (process.platform !== 'darwin') return;
  app.dock?.setIcon(nativeImage.createFromPath(assetPath(FLOW_APP_ICON_PATH)));
}

ipcMain.handle('flow:app:getVersion', () => app.getVersion());
ipcMain.handle('flow:app:getProfile', () => getAppProfile());
ipcMain.handle('flow:companion:setVisible', (_event, visible: boolean) => {
  if (companionWindow == null || companionWindow.isDestroyed()) return;
  if (visible) {
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
  const bounds = companionWindow.getBounds();
  companionWindow.setBounds({...bounds, height: nextHeight}, false);
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
registerCalendarIpcHandlers();
registerProactiveIpcHandlers();
registerMeetingIpcHandlers();
registerSettingsIpcHandlers();
registerTimelineIpcHandlers();

app.whenReady().then(() => {
  setDockIcon();
  settingsService
    .hydrate()
    .then(() => calendarService.hydrate())
    .then(() => timelineService.hydrate())
    .then(() => proactiveService.hydrate())
    .then(() => meetingTranscriptionService.hydrate())
    .catch(() => {
      timelineService.hydrate().catch(() => {});
    });
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
