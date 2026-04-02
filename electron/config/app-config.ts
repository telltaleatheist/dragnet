import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

export class AppConfig {
  private static _initialized = false;

  static initialize(): void {
    if (this._initialized) return;
    this._initialized = true;
  }

  static get isDevelopment(): boolean {
    return process.env.NODE_ENV !== 'production';
  }

  static get projectRoot(): string {
    if (this.isDevelopment) {
      // In dev, __dirname is dist-electron/electron/config, go up 3 levels
      return path.resolve(__dirname, '..', '..', '..');
    }
    return path.resolve(process.resourcesPath || '');
  }

  static get backendPath(): string {
    if (this.isDevelopment) {
      return path.join(this.projectRoot, 'backend', 'dist', 'backend', 'src', 'main.js');
    }
    return path.join(process.resourcesPath || '', 'backend', 'dist', 'backend', 'src', 'main.js');
  }

  static get frontendPath(): string {
    if (this.isDevelopment) {
      return path.join(this.projectRoot, 'frontend', 'dist', 'frontend', 'browser');
    }
    return path.join(this.projectRoot, 'frontend', 'dist', 'frontend', 'browser');
  }

  static get preloadPath(): string {
    return path.join(__dirname, '..', 'preload.js');
  }

  static get userDataPath(): string {
    return app.getPath('userData');
  }

  static get configDir(): string {
    const dir = path.join(this.userDataPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }
}
