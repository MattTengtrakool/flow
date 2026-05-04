import { ipcMain } from 'electron';

import type { RunChatTurnArgs } from '../../../src/chat/runChat';
import { calendarService } from '../calendar/googleCalendarService';
import { runManagedChatTurn } from './managedAiClient';

export function registerAiIpcHandlers() {
  ipcMain.handle('flow:chat:runTurn', (_event, args: RunChatTurnArgs) => {
    const nextArgs = {
      ...args,
      calendarContext: calendarService.getContextForRange(
        new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(),
        new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString(),
      ),
    };
    return runManagedChatTurn(nextArgs);
  });
}
