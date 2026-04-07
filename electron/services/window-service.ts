import { BrowserWindow } from 'electron';
import * as log from 'electron-log';
import { AppConfig } from '../config/app-config';

export class WindowService {
  private mainWindow: BrowserWindow | null = null;
  private frontendPort: number = 3100;
  private isQuitting: boolean = false;

  setFrontendPort(port: number): void {
    this.frontendPort = port;
  }

  createMainWindow(): void {
    const windowOptions: Electron.BrowserWindowConstructorOptions = {
      width: 1800,
      height: 1200,
      minWidth: 900,
      minHeight: 600,
      backgroundColor: '#1a1917',
      webPreferences: {
        preload: AppConfig.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
      },
    };

    if (process.platform === 'darwin') {
      windowOptions.titleBarStyle = 'hidden';
      windowOptions.trafficLightPosition = { x: 12, y: 12 };
    } else {
      windowOptions.titleBarStyle = 'hidden';
      windowOptions.titleBarOverlay = {
        color: '#1a1917',
        symbolColor: '#a8a29e',
        height: 36,
      };
    }

    this.mainWindow = new BrowserWindow(windowOptions);

    this.mainWindow.webContents.setZoomFactor(1.3);

    const url = `http://localhost:${this.frontendPort}`;
    log.info(`Loading frontend from: ${url}`);
    this.mainWindow.loadURL(url);

    // Dev tools disabled by default — open manually with Cmd+Option+I if needed

    // macOS: hide to dock on close. Windows/Linux: quit normally.
    if (process.platform === 'darwin') {
      this.mainWindow.on('close', (event) => {
        if (!this.isQuitting) {
          event.preventDefault();
          this.mainWindow?.hide();
        }
      });
    }

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });
  }

  getMainWindow(): BrowserWindow | null {
    return this.mainWindow;
  }

  focusWindow(): void {
    if (this.mainWindow) {
      if (this.mainWindow.isMinimized()) this.mainWindow.restore();
      this.mainWindow.show();
      this.mainWindow.focus();
    }
  }

  setQuitting(quitting: boolean): void {
    this.isQuitting = quitting;
  }

  getAllWindows(): BrowserWindow[] {
    return BrowserWindow.getAllWindows();
  }
}
