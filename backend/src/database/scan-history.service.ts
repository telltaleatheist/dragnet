import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from './database.service';

export interface ScanRecord {
  id: number;
  started_at: string;
  completed_at: string | null;
  items_found: number;
  new_items: number;
  items_scored: number;
  errors: string | null;
  status: string;
}

@Injectable()
export class ScanHistoryService {
  private readonly logger = new Logger(ScanHistoryService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  startScan(): number {
    const db = this.databaseService.getDb();
    const result = db
      .prepare('INSERT INTO scan_history (started_at, status) VALUES (?, ?)')
      .run(new Date().toISOString(), 'running');
    return result.lastInsertRowid as number;
  }

  completeScan(
    scanId: number,
    itemsFound: number,
    newItems: number,
    itemsScored: number,
    errors: any[],
  ): void {
    const db = this.databaseService.getDb();
    db.prepare(`
      UPDATE scan_history SET
        completed_at = ?, items_found = ?, new_items = ?,
        items_scored = ?, errors = ?, status = ?
      WHERE id = ?
    `).run(
      new Date().toISOString(),
      itemsFound,
      newItems,
      itemsScored,
      errors.length > 0 ? JSON.stringify(errors) : null,
      'completed',
      scanId,
    );
  }

  failScan(scanId: number, error: string): void {
    const db = this.databaseService.getDb();
    db.prepare(`
      UPDATE scan_history SET
        completed_at = ?, errors = ?, status = ?
      WHERE id = ?
    `).run(
      new Date().toISOString(),
      JSON.stringify([{ error }]),
      'failed',
      scanId,
    );
  }

  getLastScan(): ScanRecord | null {
    const db = this.databaseService.getDb();
    return db
      .prepare('SELECT * FROM scan_history ORDER BY id DESC LIMIT 1')
      .get() as ScanRecord | null;
  }

  getScanHistory(limit: number = 20): ScanRecord[] {
    const db = this.databaseService.getDb();
    return db
      .prepare('SELECT * FROM scan_history ORDER BY id DESC LIMIT ?')
      .all(limit) as ScanRecord[];
  }
}
