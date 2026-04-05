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

    // App-level settings (AI keys, active profile)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // Profiles
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_used_at TEXT,
        subjects TEXT NOT NULL DEFAULT '[]',
        figures TEXT NOT NULL DEFAULT '[]',
        scoring_config TEXT NOT NULL DEFAULT '{}',
        app_settings TEXT NOT NULL DEFAULT '{}',
        reddit_feed_types TEXT NOT NULL DEFAULT '["hot","top","new"]',
        reddit_top_timeframe TEXT NOT NULL DEFAULT 'week',
        is_onboarded INTEGER NOT NULL DEFAULT 0
      );
    `);

    // Per-profile keywords
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS profile_keywords (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        keyword TEXT NOT NULL,
        is_seed INTEGER NOT NULL DEFAULT 0,
        UNIQUE(profile_id, keyword)
      );
    `);

    // Per-profile sources
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS profile_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        platform TEXT NOT NULL,
        source_type TEXT NOT NULL,
        name TEXT NOT NULL,
        value TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        ai_suggested INTEGER NOT NULL DEFAULT 0,
        UNIQUE(profile_id, platform, source_type, value)
      );
    `);

    // Scan snapshots (raw content for replay through different scoring configs)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS scan_snapshots (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        profile_id TEXT,
        item_count INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS snapshot_items (
        id TEXT NOT NULL,
        snapshot_id TEXT NOT NULL REFERENCES scan_snapshots(id) ON DELETE CASCADE,
        url TEXT NOT NULL,
        title TEXT NOT NULL,
        author TEXT NOT NULL DEFAULT '',
        platform TEXT NOT NULL,
        content_type TEXT NOT NULL,
        text_content TEXT,
        published_at TEXT,
        fetched_at TEXT NOT NULL,
        thumbnail_url TEXT,
        source_account TEXT NOT NULL DEFAULT '',
        metadata TEXT,
        PRIMARY KEY (snapshot_id, id)
      );
    `);

    // Search term sets
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS search_term_sets (
        id TEXT PRIMARY KEY,
        profile_id TEXT,
        name TEXT NOT NULL,
        topics TEXT NOT NULL DEFAULT '[]',
        figures TEXT NOT NULL DEFAULT '[]',
        suggestions TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );
    `);

    // Add profile_id to bookmarks if not present
    try {
      this.db.exec(`ALTER TABLE bookmarks ADD COLUMN profile_id TEXT`);
    } catch {
      // Column already exists
    }
  }
}
