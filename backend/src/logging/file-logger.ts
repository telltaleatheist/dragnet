import { ConsoleLogger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { getLogsDir } from '../utils/app-paths';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

export class FileLogger extends ConsoleLogger {
  private logFilePath: string;
  private stream: fs.WriteStream | null = null;

  constructor() {
    super();
    const logsDir = getLogsDir();
    fs.mkdirSync(logsDir, { recursive: true });
    this.logFilePath = path.join(logsDir, 'backend.log');
    this.openStream();
  }

  private openStream(): void {
    this.stream = fs.createWriteStream(this.logFilePath, { flags: 'a' });
    this.stream.on('error', (err) => {
      process.stderr.write(`FileLogger stream error: ${err.message}\n`);
      this.stream = null;
    });
  }

  private rotateIfNeeded(): void {
    try {
      const stats = fs.statSync(this.logFilePath);
      if (stats.size >= MAX_FILE_SIZE) {
        if (this.stream) {
          this.stream.end();
          this.stream = null;
        }
        const oldPath = path.join(path.dirname(this.logFilePath), 'backend.old.log');
        fs.renameSync(this.logFilePath, oldPath);
        this.openStream();
      }
    } catch {
      // File may not exist yet — that's fine
    }
  }

  private writeToFile(level: string, message: unknown, context?: string): void {
    if (!this.stream) return;
    this.rotateIfNeeded();
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const ctx = context ? ` [${context}]` : '';
    const line = `[${timestamp}] [${level}]${ctx} ${message}\n`;
    this.stream.write(line);
  }

  log(message: unknown, context?: string): void {
    super.log(message, context);
    this.writeToFile('LOG', message, context);
  }

  error(message: unknown, stackOrContext?: string): void {
    super.error(message, stackOrContext);
    this.writeToFile('ERROR', message, stackOrContext);
  }

  warn(message: unknown, context?: string): void {
    super.warn(message, context);
    this.writeToFile('WARN', message, context);
  }

  debug(message: unknown, context?: string): void {
    super.debug(message, context);
    this.writeToFile('DEBUG', message, context);
  }

  verbose(message: unknown, context?: string): void {
    super.verbose(message, context);
    this.writeToFile('VERBOSE', message, context);
  }
}
