import { ipcMain, shell, app } from 'electron';
import * as log from 'electron-log';
import Store from 'electron-store';
import { WindowService } from '../services/window-service';
import { BackendService } from '../services/backend-service';

interface Settings {
  lastUsedProvider: string;
  lastUsedModel: string;
  claudeApiKey: string;
  openaiApiKey: string;
}

const store = new Store<Settings>({
  name: 'dragnet-settings',
  defaults: {
    lastUsedProvider: 'ollama',
    lastUsedModel: 'cogito:70b',
    claudeApiKey: '',
    openaiApiKey: '',
  },
});

let backendServiceRef: BackendService;

export function setupIpcHandlers(
  windowService: WindowService,
  backendService: BackendService,
): void {
  backendServiceRef = backendService;
  setupConfigHandlers();
  setupSettingsHandlers();
  setupShellHandlers();
}

function setupConfigHandlers(): void {
  ipcMain.handle('get-backend-url', () => {
    return backendServiceRef.getBackendUrl();
  });

  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });
}

function setupSettingsHandlers(): void {
  ipcMain.handle('get-settings', () => {
    try {
      return (store as any).store;
    } catch (error) {
      log.error('Error getting settings:', error);
      return {};
    }
  });

  ipcMain.handle('update-settings', (_, settings) => {
    try {
      Object.keys(settings).forEach((key) => {
        (store as any).set(key, settings[key]);
      });
      return { success: true };
    } catch (error) {
      log.error('Error updating settings:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('get-setting', (_, key) => {
    try {
      return (store as any).get(key);
    } catch (error) {
      log.error(`Error getting setting ${key}:`, error);
      return null;
    }
  });

  ipcMain.handle('set-setting', (_, key, value) => {
    try {
      (store as any).set(key, value);
      return { success: true };
    } catch (error) {
      log.error(`Error setting ${key}:`, error);
      return { success: false, error: (error as Error).message };
    }
  });
}

function setupShellHandlers(): void {
  ipcMain.handle('open-external', (_, url: string) => {
    return shell.openExternal(url);
  });
}
