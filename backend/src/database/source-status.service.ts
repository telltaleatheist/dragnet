import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from './database.service';

export interface SourceStatusRecord {
  source_key: string;
  platform: string;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error_message: string | null;
  consecutive_failures: number;
  total_items_fetched: number;
}

@Injectable()
export class SourceStatusService {
  private readonly logger = new Logger(SourceStatusService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  recordSuccess(sourceKey: string, platform: string, itemsFetched: number): void {
    const db = this.databaseService.getDb();
    db.prepare(`
      INSERT INTO source_status (source_key, platform, last_success_at, consecutive_failures, total_items_fetched)
      VALUES (?, ?, ?, 0, ?)
      ON CONFLICT(source_key) DO UPDATE SET
        last_success_at = excluded.last_success_at,
        consecutive_failures = 0,
        total_items_fetched = total_items_fetched + excluded.total_items_fetched
    `).run(sourceKey, platform, new Date().toISOString(), itemsFetched);
  }

  recordError(sourceKey: string, platform: string, errorMessage: string): void {
    const db = this.databaseService.getDb();
    db.prepare(`
      INSERT INTO source_status (source_key, platform, last_error_at, last_error_message, consecutive_failures, total_items_fetched)
      VALUES (?, ?, ?, ?, 1, 0)
      ON CONFLICT(source_key) DO UPDATE SET
        last_error_at = excluded.last_error_at,
        last_error_message = excluded.last_error_message,
        consecutive_failures = consecutive_failures + 1
    `).run(sourceKey, platform, new Date().toISOString(), errorMessage);
  }

  getAllStatuses(): SourceStatusRecord[] {
    const db = this.databaseService.getDb();
    return db.prepare('SELECT * FROM source_status ORDER BY platform, source_key').all() as SourceStatusRecord[];
  }

  getStatus(sourceKey: string): SourceStatusRecord | null {
    const db = this.databaseService.getDb();
    return db.prepare('SELECT * FROM source_status WHERE source_key = ?').get(sourceKey) as SourceStatusRecord | null;
  }
}
