import {ipcMain} from 'electron';

import {runChatTurn, type RunChatTurnArgs} from '../../../src/chat/runChat';

function withGeminiApiKey<T extends {apiKey?: string}>(args: T): T {
  return {
    ...args,
    apiKey: args.apiKey ?? process.env.GEMINI_API_KEY,
  };
}

export function registerAiIpcHandlers() {
  ipcMain.handle('flow:chat:runTurn', (_event, args: RunChatTurnArgs) =>
    runChatTurn(withGeminiApiKey(args)),
  );
}
