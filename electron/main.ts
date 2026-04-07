import { app } from 'electron';
import * as log from 'electron-log';
import { AppConfig } from './config/app-config';
import { WindowService } from './services/window-service';
import { BackendService } from './services/backend-service';
import { setupIpcHandlers } from './ipc/ipc-handlers';
import { initLogging } from './services/log-service';

let windowService: WindowService;
let backendService: BackendService;

// Configure logging
log.transports.console.level = 'info';
log.transports.file.level = 'debug';

// Handle process signals (SIGTERM/SIGINT are not reliable on Windows)
if (process.platform !== 'win32') {
  process.on('SIGTERM', () => {
    log.info('Received SIGTERM, shutting down...');
    if (backendService) backendService.shutdown();
    app.quit();
  });

  process.on('SIGINT', () => {
    log.info('Received SIGINT, shutting down...');
    if (backendService) backendService.shutdown();
    app.quit();
  });
}

process.on('uncaughtException', (error) => {
  log.error('Uncaught exception:', error);
  if (backendService) backendService.shutdown();
  app.quit();
  process.exit(1);
});

// Single instance lock
let gotTheLock = false;
try {
  gotTheLock = app.requestSingleInstanceLock();

  if (!gotTheLock) {
    log.info('Another instance is already running. Exiting.');
    app.quit();
    process.exit(0);
  }

  app.on('second-instance', () => {
    log.info('Second instance detected. Focusing main window.');
    if (windowService) windowService.focusWindow();
  });
} catch (error) {
  log.error('Error setting up single instance lock:', error);
}

// App ready
app.whenReady().then(async () => {
  try {
    AppConfig.initialize();
    initLogging();

    backendService = new BackendService();
    windowService = new WindowService();

    setupIpcHandlers(windowService, backendService);

    let backendStarted = await backendService.startBackendServer();

    if (!backendStarted) {
      log.warn('Backend failed on first attempt, retrying in 2 seconds...');
      await new Promise((resolve) => setTimeout(resolve, 2000));
      backendStarted = await backendService.startBackendServer();
    }

    if (backendStarted) {
      windowService.setFrontendPort(backendService.getBackendPort());
      windowService.createMainWindow();
    } else {
      log.error('Backend failed to start after retry');
      app.quit();
    }

    app.on('activate', () => {
      if (windowService.getAllWindows().length === 0) {
        if (backendService.isRunning()) {
          windowService.setFrontendPort(backendService.getBackendPort());
          windowService.createMainWindow();
        }
      } else {
        windowService.focusWindow();
      }
    });
  } catch (error) {
    log.error('Error during initialization:', error);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  log.info('Application is quitting...');
  if (windowService) windowService.setQuitting(true);
  if (backendService) backendService.shutdown();
});
