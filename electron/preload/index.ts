import { contextBridge, ipcRenderer } from 'electron';

import type { FlowElectronApi } from '../shared/flowApi';

const flowApi: FlowElectronApi = {
  app: {
    getVersion: (): Promise<string> =>
      ipcRenderer.invoke('flow:app:getVersion'),
    getProfile: () => ipcRenderer.invoke('flow:app:getProfile'),
  },
  storage: {
    loadEventLog: () => ipcRenderer.invoke('flow:storage:loadEventLog'),
    saveEventLog: eventLog =>
      ipcRenderer.invoke('flow:storage:saveEventLog', eventLog),
  },
  capture: {
    startMonitoring: options =>
      ipcRenderer.invoke('flow:capture:startMonitoring', options),
    stopMonitoring: () => ipcRenderer.invoke('flow:capture:stopMonitoring'),
    setPreciseModeEnabled: enabled =>
      ipcRenderer.invoke('flow:capture:setPreciseModeEnabled', enabled),
    requestAccessibilityPrompt: () =>
      ipcRenderer.invoke('flow:capture:requestAccessibilityPrompt'),
    getPermissionsStatus: () =>
      ipcRenderer.invoke('flow:capture:getPermissionsStatus'),
    requestScreenCaptureAccess: () =>
      ipcRenderer.invoke('flow:capture:requestScreenCaptureAccess'),
    inspectCaptureTarget: () =>
      ipcRenderer.invoke('flow:capture:inspectCaptureTarget'),
    captureNow: () => ipcRenderer.invoke('flow:capture:captureNow'),
    addContextSnapshotListener: listener => {
      const channel = 'flow:capture:contextSnapshotDidChange';
      const handler = (
        _event: Electron.IpcRendererEvent,
        snapshot: Parameters<typeof listener>[0],
      ) => {
        listener(snapshot);
      };
      ipcRenderer.on(channel, handler);
      return {
        remove() {
          ipcRenderer.removeListener(channel, handler);
        },
      };
    },
  },
  chat: {
    runTurn: args => ipcRenderer.invoke('flow:chat:runTurn', args),
  },
  calendar: {
    getState: () => ipcRenderer.invoke('flow:calendar:getState'),
    connectGoogleAccount: () =>
      ipcRenderer.invoke('flow:calendar:connectGoogleAccount'),
    disconnectGoogleAccount: accountId =>
      ipcRenderer.invoke('flow:calendar:disconnectGoogleAccount', accountId),
    syncNow: () => ipcRenderer.invoke('flow:calendar:syncNow'),
    updateCalendarSelection: (accountId, calendarId, enabled) =>
      ipcRenderer.invoke(
        'flow:calendar:updateCalendarSelection',
        accountId,
        calendarId,
        enabled,
      ),
    updateCalendarSourceMode: (accountId, calendarId, mode) =>
      ipcRenderer.invoke(
        'flow:calendar:updateCalendarSourceMode',
        accountId,
        calendarId,
        mode,
      ),
    updateEventAnnotation: (eventId, patch) =>
      ipcRenderer.invoke('flow:calendar:updateEventAnnotation', eventId, patch),
    updateEventBlockLink: (eventId, blockId, action) =>
      ipcRenderer.invoke(
        'flow:calendar:updateEventBlockLink',
        eventId,
        blockId,
        action,
      ),
    addStateListener: listener => {
      const channel = 'flow:calendar:stateChanged';
      const handler = (
        _event: Electron.IpcRendererEvent,
        state: Parameters<typeof listener>[0],
      ) => {
        listener(state);
      };
      ipcRenderer.on(channel, handler);
      return {
        remove() {
          ipcRenderer.removeListener(channel, handler);
        },
      };
    },
  },
  settings: {
    getSettings: () => ipcRenderer.invoke('flow:settings:getSettings'),
    updateSettings: patch =>
      ipcRenderer.invoke('flow:settings:updateSettings', patch),
    setApiKey: (provider, value) =>
      ipcRenderer.invoke('flow:settings:setApiKey', provider, value),
    clearApiKey: provider =>
      ipcRenderer.invoke('flow:settings:clearApiKey', provider),
    validateApiKey: provider =>
      ipcRenderer.invoke('flow:settings:validateApiKey', provider),
  },
  proactive: {
    getState: () => ipcRenderer.invoke('flow:proactive:getState'),
    dismiss: insightId =>
      ipcRenderer.invoke('flow:proactive:dismiss', insightId),
    snooze: (insightId, minutes) =>
      ipcRenderer.invoke('flow:proactive:snooze', insightId, minutes),
    action: (insightId, actionId) =>
      ipcRenderer.invoke('flow:proactive:action', insightId, actionId),
    addStateListener: listener => {
      const channel = 'flow:proactive:stateChanged';
      const handler = (
        _event: Electron.IpcRendererEvent,
        state: Parameters<typeof listener>[0],
      ) => {
        listener(state);
      };
      ipcRenderer.on(channel, handler);
      return {
        remove() {
          ipcRenderer.removeListener(channel, handler);
        },
      };
    },
  },
  meetings: {
    getState: () => ipcRenderer.invoke('flow:meetings:getState'),
    startTranscription: args =>
      ipcRenderer.invoke('flow:meetings:startTranscription', args),
    stopTranscription: meetingId =>
      ipcRenderer.invoke('flow:meetings:stopTranscription', meetingId),
    dismissDetection: detectionId =>
      ipcRenderer.invoke('flow:meetings:dismissDetection', detectionId),
    addStateListener: listener => {
      const channel = 'flow:meetings:stateChanged';
      const handler = (
        _event: Electron.IpcRendererEvent,
        state: Parameters<typeof listener>[0],
      ) => {
        listener(state);
      };
      ipcRenderer.on(channel, handler);
      return {
        remove() {
          ipcRenderer.removeListener(channel, handler);
        },
      };
    },
  },
  timeline: {
    getState: () => ipcRenderer.invoke('flow:timeline:getState'),
    startSession: () => ipcRenderer.invoke('flow:timeline:startSession'),
    stopSession: () => ipcRenderer.invoke('flow:timeline:stopSession'),
    captureNow: () => ipcRenderer.invoke('flow:timeline:captureNow'),
    runPlannerRevision: force =>
      ipcRenderer.invoke('flow:timeline:runPlannerRevision', force),
    editBlockNotes: args =>
      ipcRenderer.invoke('flow:timeline:editBlockNotes', args),
    correctBlock: args =>
      ipcRenderer.invoke('flow:timeline:correctBlock', args),
    addStateListener: listener => {
      const channel = 'flow:timeline:stateChanged';
      const handler = (
        _event: Electron.IpcRendererEvent,
        state: Parameters<typeof listener>[0],
      ) => {
        listener(state);
      };
      ipcRenderer.on(channel, handler);
      return {
        remove() {
          ipcRenderer.removeListener(channel, handler);
        },
      };
    },
  },
};

contextBridge.exposeInMainWorld('flow', flowApi);

export type { FlowElectronApi };
