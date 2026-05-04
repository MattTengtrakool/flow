import {contextBridge, ipcRenderer} from 'electron';

import type {FlowElectronApi} from '../shared/flowApi';

const flowApi: FlowElectronApi = {
  app: {
    getVersion: (): Promise<string> => ipcRenderer.invoke('flow:app:getVersion'),
  },
  companion: {
    setVisible: visible =>
      ipcRenderer.invoke('flow:companion:setVisible', visible),
    setContentHeight: height =>
      ipcRenderer.invoke('flow:companion:setContentHeight', height),
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
      const handler = (_event: Electron.IpcRendererEvent, snapshot: Parameters<typeof listener>[0]) => {
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
  audio: {
    getPermissionsStatus: () =>
      ipcRenderer.invoke('flow:audio:getPermissionsStatus'),
    requestPermissions: () =>
      ipcRenderer.invoke('flow:audio:requestPermissions'),
    startRecording: args =>
      ipcRenderer.invoke('flow:audio:startRecording', args),
    pauseRecording: () => ipcRenderer.invoke('flow:audio:pauseRecording'),
    resumeRecording: () => ipcRenderer.invoke('flow:audio:resumeRecording'),
    stopRecording: () => ipcRenderer.invoke('flow:audio:stopRecording'),
    deleteRecording: args =>
      ipcRenderer.invoke('flow:audio:deleteRecording', args),
  },
  meeting: {
    dismissPrompt: args => ipcRenderer.invoke('flow:meeting:dismissPrompt', args),
  },
  timeline: {
    getState: () => ipcRenderer.invoke('flow:timeline:getState'),
    startSession: () => ipcRenderer.invoke('flow:timeline:startSession'),
    stopSession: () => ipcRenderer.invoke('flow:timeline:stopSession'),
    captureNow: () => ipcRenderer.invoke('flow:timeline:captureNow'),
    runPlannerRevision: force =>
      ipcRenderer.invoke('flow:timeline:runPlannerRevision', force),
    getDiagnostics: () => ipcRenderer.invoke('flow:timeline:getDiagnostics'),
    runDiagnosticReplan: args =>
      ipcRenderer.invoke('flow:timeline:runDiagnosticReplan', args),
    editBlockNotes: args => ipcRenderer.invoke('flow:timeline:editBlockNotes', args),
    createCalendarItem: input =>
      ipcRenderer.invoke('flow:timeline:createCalendarItem', input),
    updateCalendarItem: args =>
      ipcRenderer.invoke('flow:timeline:updateCalendarItem', args),
    deleteCalendarItem: itemId =>
      ipcRenderer.invoke('flow:timeline:deleteCalendarItem', itemId),
    addStateListener: listener => {
      const channel = 'flow:timeline:stateChanged';
      const handler = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) => {
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

export type {FlowElectronApi};
