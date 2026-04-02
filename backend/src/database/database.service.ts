import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private db!: Database.Database;
  private readonly logger = new Logger(DatabaseService.name);

  onModuleInit() {
    const dbPath = this.getDbPath();
    this.logger.log(`Opening database at: ${dbPath}`);

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initializeTables();

    this.logger.log('Database initialized');
  }

  onModuleDestroy() {
    if (this.db) {
      this.db.close();
      this.logger.log('Database closed');
    }
  }

  getDb(): Database.Database {
    return this.db;
  }

  private getDbPath(): string {
    const dir = this.getDataDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return path.join(dir, 'dragnet.db');
  }

  private getDataDir(): string {
    if (process.platform === 'darwin') {
      return path.join(
        os.homedir(),
        'Library',
        'Application Support',
        'dragnet',
      );
    }
    // Fallback for other platforms
    return path.join(os.homedir(), '.dragnet');
  }

  private initializeTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        url TEXT UNIQUE NOT NULL,
        title TEXT,
        author TEXT,
        platform TEXT NOT NULL,
        content_type TEXT NOT NULL,
        text_content TEXT,
        published_at TEXT,
        fetched_at TEXT NOT NULL,
        thumbnail_url TEXT,
        source_account TEXT,
        metadata TEXT,

        pre_filter_score REAL DEFAULT 0,
        ai_score REAL DEFAULT 0,
        ai_tags TEXT,
        ai_summary TEXT,
        ai_clip_type TEXT,
        ai_reasoning TEXT,
        scored_at TEXT,
        ai_provider TEXT,
        ai_model TEXT,

        dismissed INTEGER DEFAULT 0,
        bookmarked INTEGER DEFAULT 0,
        opened INTEGER DEFAULT 0,
        dismissed_at TEXT,
        bookmarked_at TEXT,
        opened_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_items_feed
        ON items(dismissed, ai_score DESC, published_at DESC);
      CREATE INDEX IF NOT EXISTS idx_items_url ON items(url);
      CREATE INDEX IF NOT EXISTS idx_items_platform ON items(platform);

      CREATE TABLE IF NOT EXISTS scan_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        items_found INTEGER DEFAULT 0,
        new_items INTEGER DEFAULT 0,
        items_scored INTEGER DEFAULT 0,
        errors TEXT,
        status TEXT DEFAULT 'running'
      );

      CREATE TABLE IF NOT EXISTS source_status (
        source_key TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        last_success_at TEXT,
        last_error_at TEXT,
        last_error_message TEXT,
        consecutive_failures INTEGER DEFAULT 0,
        total_items_fetched INTEGER DEFAULT 0
      );
    `);
  }
}
