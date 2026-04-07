import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import * as log from 'electron-log';
import { spawn, ChildProcess } from 'child_process';
import { AppConfig } from '../config/app-config';
import { ServerConfig } from '../config/server-config';
import { PortUtil } from '../utilities/port-util';
import { getLogsDir } from './log-service';

export class BackendService {
  private backendProcess: ChildProcess | null = null;
  private backendStarted: boolean = false;
  private actualBackendPort: number = 3100;

  async startBackendServer(): Promise<boolean> {
    if (this.backendStarted) return true;

    const backendPort = await PortUtil.findAvailablePort(
      ServerConfig.config.nestBackend.port,
      10,
    );

    if (!backendPort) {
      log.error('Could not find available port for backend server');
      return false;
    }

    this.actualBackendPort = backendPort;

    if (backendPort !== ServerConfig.config.nestBackend.port) {
      log.info(
        `Using alternative backend port: ${backendPort} (default ${ServerConfig.config.nestBackend.port} was in use)`,
      );
    }

    try {
      await this.startNodeBackend();
      const isRunning = await this.waitForBackendReady();

      if (isRunning) {
        log.info(`Backend started on port ${this.actualBackendPort}`);
        this.backendStarted = true;
      } else {
        log.error('Backend failed to start — cleaning up');
        this.cleanup();
      }

      return isRunning;
    } catch (error) {
      log.error('Error starting backend:', error);
      this.cleanup();
      return false;
    }
  }

  private async waitForBackendReady(): Promise<boolean> {
    const maxAttempts = 40;
    let delay = 100;
    const maxDelay = 1000;

    log.info('Waiting for backend to be ready...');

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay = Math.min(delay * 1.5, maxDelay);
      }

      const isReady = await this.checkBackendRunning();
      if (isReady) {
        log.info(`Backend ready after ${attempt + 1} attempt(s)`);
        return true;
      }

      if (attempt > 0 && attempt % 5 === 0) {
        log.info(`Still waiting for backend (attempt ${attempt + 1}/${maxAttempts})...`);
      }
    }

    log.error('Backend failed to respond after maximum attempts');
    return false;
  }

  private async checkBackendRunning(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.request(
        {
          hostname: 'localhost',
          port: this.actualBackendPort,
          path: '/api',
          method: 'GET',
          timeout: 5000,
        },
        (res) => {
          if (res.statusCode === 200) {
            resolve(true);
          } else {
            resolve(false);
          }
          res.resume();
        },
      );

      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    });
  }

  getBackendPort(): number {
    return this.actualBackendPort;
  }

  getBackendUrl(): string {
    return `http://localhost:${this.actualBackendPort}`;
  }

  private async startNodeBackend(): Promise<boolean> {
    try {
      const backendPath = AppConfig.backendPath;

      if (!fs.existsSync(backendPath)) {
        log.error(`Backend not found at: ${backendPath}`);
        return false;
      }

      const nodePath = process.execPath;
      const frontendPath = AppConfig.frontendPath;
      // backendPath is backend/dist/backend/src/main.js — go up to the backend root
      const backendRoot = AppConfig.isDevelopment
        ? path.join(AppConfig.projectRoot, 'backend')
        : path.join(process.resourcesPath || '', 'backend');
      const backendNodeModules = path.join(backendRoot, 'node_modules');
      const resourcesPath = process.env.RESOURCES_PATH || process.resourcesPath;

      log.info(`Backend path: ${backendPath}`);
      log.info(`Frontend path: ${frontendPath}`);

      const backendEnv: Record<string, string | undefined> = {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        FRONTEND_PATH: frontendPath,
        NODE_PATH: backendNodeModules,
        RESOURCES_PATH: resourcesPath,
        PORT: this.actualBackendPort.toString(),
        NODE_ENV: process.env.NODE_ENV || 'production',
        DRAGNET_LOG_DIR: getLogsDir(),
      };

      this.backendProcess = spawn(nodePath, [backendPath], {
        env: backendEnv,
        stdio: 'pipe',
        cwd: backendRoot,
      });

      this.setupProcessHandlers();
      return true;
    } catch (error) {
      log.error('Error starting Node.js backend:', error);
      return false;
    }
  }

  private setupProcessHandlers(): void {
    if (!this.backendProcess) return;

    if (this.backendProcess.stdout) {
      this.backendProcess.stdout.on('data', (data: Buffer) => {
        log.info(`[Backend]: ${data.toString().trim()}`);
      });
    }

    if (this.backendProcess.stderr) {
      this.backendProcess.stderr.on('data', (data: Buffer) => {
        log.error(`[Backend stderr]: ${data.toString().trim()}`);
      });
    }

    this.backendProcess.on('error', (err: Error) => {
      log.error(`[Backend process error]: ${err.message}`);
    });

    this.backendProcess.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      log.error(`[Backend process exited] code: ${code}, signal: ${signal}`);
    });
  }

  isRunning(): boolean {
    return this.backendStarted;
  }

  private cleanup(): void {
    if (this.backendProcess && !this.backendProcess.killed) {
      try {
        if (process.platform === 'win32') {
          this.backendProcess.kill();
        } else {
          this.backendProcess.kill('SIGTERM');
        }
      } catch (err) {
        log.warn('Error killing backend process:', err);
      }
    }
    this.backendStarted = false;
  }

  shutdown(): void {
    log.info('Shutting down backend service...');
    const pid = this.backendProcess?.pid;
    this.cleanup();

    if (pid) {
      try {
        if (process.platform === 'win32') {
          process.kill(pid);
        } else {
          process.kill(pid, 'SIGKILL');
        }
      } catch {
        // Process may already be dead
      }
    }

    this.backendProcess = null;
  }
}
