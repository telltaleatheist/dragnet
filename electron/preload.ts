import { contextBridge, ipcRenderer } from 'electron';

interface ElectronAPI {
  getBackendUrl: () => Promise<string>;
  getAppVersion: () => Promise<string>;
  openExternal: (url: string) => Promise<void>;
  getSettings: () => Promise<any>;
  updateSettings: (settings: any) => Promise<{ success: boolean; error?: string }>;
  getSetting: (key: string) => Promise<any>;
  setSetting: (key: string, value: any) => Promise<{ success: boolean; error?: string }>;
}

contextBridge.exposeInMainWorld('electron', {
  getBackendUrl: () => ipcRenderer.invoke('get-backend-url'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (settings: any) => ipcRenderer.invoke('update-settings', settings),
  getSetting: (key: string) => ipcRenderer.invoke('get-setting', key),
  setSetting: (key: string, value: any) => ipcRenderer.invoke('set-setting', key, value),
} as ElectronAPI);

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
