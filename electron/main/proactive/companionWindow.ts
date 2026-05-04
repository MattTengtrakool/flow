import { BrowserWindow, screen } from 'electron';

import type {
  ProactiveSettings,
  ProactiveState,
} from '../../../src/proactive/types';
import { getCompanionWindowTitle } from '../appProfile';
import { settingsService } from '../settings/settingsService';

const PILL_BOUNDS = {
  width: 276,
  height: 112,
};

const CARD_BOUNDS = {
  width: 404,
  height: 230,
};

const SCREEN_MARGIN = 18;
const MOVE_PERSIST_DELAY_MS = 350;

let programmaticMoveInFlight = false;
let persistTimer: NodeJS.Timeout | null = null;

export function companionInitialBounds(): Electron.Rectangle {
  return companionBoundsForSettings(
    settingsService.publicSettings().proactive,
    PILL_BOUNDS,
  );
}

export function configureCompanionWindow(window: BrowserWindow) {
  window.on('move', () => {
    scheduleCompanionPositionPersist(window);
  });
  window.on('closed', () => {
    if (persistTimer != null) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
  });
}

export function syncCompanionWindow(payload: ProactiveState) {
  const window = BrowserWindow.getAllWindows().find(
    candidate => candidate.getTitle() === getCompanionWindowTitle(),
  );
  if (window == null) return;

  const size = payload.activeInsight == null ? PILL_BOUNDS : CARD_BOUNDS;
  applyCompanionBounds(
    window,
    companionBoundsForSettings(payload.settings, size),
  );

  if (payload.companionEnabled) {
    if (!window.isVisible()) window.showInactive();
  } else {
    window.hide();
  }
}

function scheduleCompanionPositionPersist(window: BrowserWindow) {
  if (programmaticMoveInFlight || window.isDestroyed()) return;
  if (persistTimer != null) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    if (programmaticMoveInFlight || window.isDestroyed()) return;
    const [x, y] = window.getPosition();
    const settings = settingsService.publicSettings();
    settingsService
      .updateSettings({
        proactive: {
          ...settings.proactive,
          companionCustomPosition: { x, y },
        },
      })
      .catch(() => {});
  }, MOVE_PERSIST_DELAY_MS);
}

function applyCompanionBounds(
  window: BrowserWindow,
  bounds: Electron.Rectangle,
) {
  const current = window.getBounds();
  if (
    current.x === bounds.x &&
    current.y === bounds.y &&
    current.width === bounds.width &&
    current.height === bounds.height
  ) {
    return;
  }

  programmaticMoveInFlight = true;
  window.setBounds(bounds, false);
  setTimeout(() => {
    programmaticMoveInFlight = false;
  }, 250);
}

function companionBoundsForSettings(
  settings: ProactiveSettings,
  size: Pick<Electron.Rectangle, 'width' | 'height'>,
): Electron.Rectangle {
  const { workArea } = screen.getPrimaryDisplay();
  const fallback = presetPosition(settings, workArea, size);
  const custom = settings.companionCustomPosition;
  return clampBoundsToWorkArea(
    {
      x: custom?.x ?? fallback.x,
      y: custom?.y ?? fallback.y,
      width: size.width,
      height: size.height,
    },
    workArea,
  );
}

function presetPosition(
  settings: ProactiveSettings,
  workArea: Electron.Rectangle,
  size: Pick<Electron.Rectangle, 'width' | 'height'>,
): Pick<Electron.Rectangle, 'x' | 'y'> {
  const x =
    settings.companionPosition === 'bottom-left'
      ? workArea.x + SCREEN_MARGIN
      : workArea.x + workArea.width - size.width - SCREEN_MARGIN;
  const y =
    settings.companionPosition === 'right-center'
      ? workArea.y + Math.round((workArea.height - size.height) / 2)
      : workArea.y + workArea.height - size.height - SCREEN_MARGIN;
  return { x, y };
}

function clampBoundsToWorkArea(
  bounds: Electron.Rectangle,
  workArea: Electron.Rectangle,
): Electron.Rectangle {
  const maxX = workArea.x + workArea.width - bounds.width - SCREEN_MARGIN;
  const maxY = workArea.y + workArea.height - bounds.height - SCREEN_MARGIN;
  return {
    ...bounds,
    x: Math.min(Math.max(bounds.x, workArea.x + SCREEN_MARGIN), maxX),
    y: Math.min(Math.max(bounds.y, workArea.y + SCREEN_MARGIN), maxY),
  };
}
