import { app } from 'electron';
import * as log from 'electron-log';
import * as path from 'path';
import * as fs from 'fs';

let logsDir: string;

export function getLogsDir(): string {
  if (!logsDir) {
    logsDir = path.join(app.getPath('userData'), 'logs');
  }
  return logsDir;
}

export function initLogging(): void {
  const dir = getLogsDir();
  fs.mkdirSync(dir, { recursive: true });

  log.transports.file.resolvePathFn = () => path.join(dir, 'main.log');
  log.transports.file.maxSize = 5 * 1024 * 1024; // 5 MB

  purgeOldLogs(dir);
  log.info(`Logging initialized — logs directory: ${dir}`);
}

function purgeOldLogs(dir: string, maxAgeDays = 30): void {
  try {
    const files = fs.readdirSync(dir);
    const now = Date.now();
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

    for (const file of files) {
      if (!file.endsWith('.log') && !file.endsWith('.old.log')) continue;
      const filePath = path.join(dir, file);
      try {
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > maxAgeMs) {
          fs.unlinkSync(filePath);
          log.info(`Purged old log file: ${file}`);
        }
      } catch {
        // Skip files we can't stat/delete
      }
    }
  } catch {
    // Logs dir might not exist yet on first run
  }
}
