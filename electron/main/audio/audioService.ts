import {ipcMain} from 'electron';

import {timelineService} from '../timeline/timelineService';

export function registerAudioIpcHandlers() {
  ipcMain.handle('flow:audio:getPermissionsStatus', () =>
    timelineService.getAudioPermissionStatus(),
  );
  ipcMain.handle('flow:audio:requestPermissions', () =>
    timelineService.requestAudioPermissions(),
  );
  ipcMain.handle('flow:audio:startRecording', (_event, args) =>
    timelineService.startAudioRecording(args),
  );
  ipcMain.handle('flow:audio:pauseRecording', () =>
    timelineService.pauseAudioRecording(),
  );
  ipcMain.handle('flow:audio:resumeRecording', () =>
    timelineService.resumeAudioRecording(),
  );
  ipcMain.handle('flow:audio:stopRecording', () =>
    timelineService.stopAudioRecording(),
  );
  ipcMain.handle('flow:audio:deleteRecording', (_event, args) =>
    timelineService.deleteAudioRecording(args),
  );
  ipcMain.handle('flow:meeting:dismissPrompt', (_event, args) =>
    timelineService.dismissMeetingPrompt(args),
  );
}
