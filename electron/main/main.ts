import './env';

import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  ipcMain,
  nativeImage,
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
import { registerCaptureIpcHandlers } from './capture/captureService';
import {
  calendarService,
  registerCalendarIpcHandlers,
} from './calendar/googleCalendarService';
import { loadEventLog, saveEventLog } from './storage/eventLogStorage';
import {
  companionInitialBounds,
  configureCompanionWindow,
  resizeCompanionWindowToContent,
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
import {
  clearMainWindow,
  getMainWindow,
  setMainWindow,
  setMainWindowFactory,
  showMainWindow,
} from './windowRegistry';

const isDev = process.env.ELECTRON_RENDERER_URL != null || !app.isPackaged;
app.setName(getAppDisplayName());
app.setPath('userData', getAppDataDirectoryPath());

let tray: Tray | null = null;
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
  const existing = getMainWindow();
  if (existing != null) return existing;
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
  setMainWindow(window);
  window.on('closed', () => {
    clearMainWindow(window);
  });

  void window.loadURL(rendererUrl());

  if (isDev) {
    window.webContents.openDevTools({ mode: 'detach' });
  }

  return window;
}

setMainWindowFactory(createMainWindow);

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
  const bounds = companionWindow.getBounds();
  resizeCompanionWindowToContent(companionWindow, {
    width: bounds.width,
    height,
  });
});
ipcMain.handle('flow:companion:setContentSize', (_event, size) => {
  if (companionWindow == null || companionWindow.isDestroyed()) return;
  if (
    size == null ||
    typeof size !== 'object' ||
    typeof size.width !== 'number' ||
    typeof size.height !== 'number'
  ) {
    return;
  }
  resizeCompanionWindowToContent(companionWindow, size);
});
ipcMain.handle('flow:companion:setMouseEventsIgnored', (_event, ignored) => {
  if (companionWindow == null || companionWindow.isDestroyed()) return;
  companionWindow.setIgnoreMouseEvents(Boolean(ignored), { forward: true });
});
ipcMain.handle('flow:storage:loadEventLog', () => loadEventLog());
ipcMain.handle('flow:storage:saveEventLog', (_event, eventLog: unknown) => {
  if (!Array.isArray(eventLog)) {
    throw new Error('eventLog must be an array.');
  }
  return saveEventLog(eventLog);
});
registerCaptureIpcHandlers();
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
    if (getMainWindow() == null) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
