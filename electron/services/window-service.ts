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
    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 900,
      minHeight: 600,
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 12, y: 12 },
      backgroundColor: '#1a1917',
      webPreferences: {
        preload: AppConfig.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    this.mainWindow.webContents.setZoomFactor(1.3);

    const url = `http://localhost:${this.frontendPort}`;
    log.info(`Loading frontend from: ${url}`);
    this.mainWindow.loadURL(url);

    // Dev tools disabled by default — open manually with Cmd+Option+I if needed

    this.mainWindow.on('close', (event) => {
      if (!this.isQuitting) {
        event.preventDefault();
        this.mainWindow?.hide();
      }
    });

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
