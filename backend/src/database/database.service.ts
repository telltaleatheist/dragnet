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
    return path.join(os.homedir(), '.dragnet');
  }

  private initializeTables(): void {
    // Drop old tables from previous architecture
    this.db.exec(`
      DROP TABLE IF EXISTS items;
      DROP TABLE IF EXISTS scan_history;
      DROP TABLE IF EXISTS source_status;
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bookmarks (
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

        bookmarked_at TEXT NOT NULL,
        cluster_title TEXT,
        cluster_summary TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_bookmarks_url ON bookmarks(url);
      CREATE INDEX IF NOT EXISTS idx_bookmarks_score ON bookmarks(ai_score DESC);
      CREATE INDEX IF NOT EXISTS idx_bookmarks_platform ON bookmarks(platform);
    `);
  }
}
