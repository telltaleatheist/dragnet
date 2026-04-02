import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { v4 as uuidv4 } from 'uuid';

export interface InsertableItem {
  url: string;
  title: string;
  author: string;
  platform: string;
  contentType: string;
  textContent?: string;
  publishedAt?: string;
  thumbnailUrl?: string;
  sourceAccount: string;
  metadata?: Record<string, unknown>;
}

export interface StoredItem {
  id: string;
  url: string;
  title: string;
  author: string;
  platform: string;
  content_type: string;
  text_content: string | null;
  published_at: string | null;
  fetched_at: string;
  thumbnail_url: string | null;
  source_account: string;
  metadata: string | null;
  pre_filter_score: number;
  ai_score: number;
  ai_tags: string | null;
  ai_summary: string | null;
  ai_clip_type: string | null;
  ai_reasoning: string | null;
  scored_at: string | null;
  ai_provider: string | null;
  ai_model: string | null;
  dismissed: number;
  bookmarked: number;
  opened: number;
  dismissed_at: string | null;
  bookmarked_at: string | null;
  opened_at: string | null;
}

export interface FeedQuery {
  page?: number;
  limit?: number;
  minScore?: number;
  maxScore?: number;
  platform?: string;
  tag?: string;
  contentType?: string;
  bookmarked?: boolean;
  dismissed?: boolean;
  search?: string;
}

@Injectable()
export class ItemsService {
  private readonly logger = new Logger(ItemsService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  insertItem(item: InsertableItem): string | null {
    const db = this.databaseService.getDb();
    const id = uuidv4();
    const now = new Date().toISOString();

    try {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO items
          (id, url, title, author, platform, content_type, text_content,
           published_at, fetched_at, thumbnail_url, source_account, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        id,
        item.url,
        item.title,
        item.author,
        item.platform,
        item.contentType,
        item.textContent || null,
        item.publishedAt || null,
        now,
        item.thumbnailUrl || null,
        item.sourceAccount,
        item.metadata ? JSON.stringify(item.metadata) : null,
      );

      if (result.changes === 0) {
        return null; // Duplicate URL
      }

      return id;
    } catch (error) {
      this.logger.error(`Error inserting item: ${(error as Error).message}`);
      return null;
    }
  }

  insertItems(items: InsertableItem[]): number {
    const db = this.databaseService.getDb();
    let inserted = 0;

    const insertMany = db.transaction((itemList: InsertableItem[]) => {
      for (const item of itemList) {
        const result = this.insertItem(item);
        if (result) inserted++;
      }
    });

    insertMany(items);
    return inserted;
  }

  getItemByUrl(url: string): StoredItem | null {
    const db = this.databaseService.getDb();
    return db.prepare('SELECT * FROM items WHERE url = ?').get(url) as StoredItem | null;
  }

  isUrlSeen(url: string): boolean {
    const db = this.databaseService.getDb();
    const row = db.prepare('SELECT 1 FROM items WHERE url = ? LIMIT 1').get(url);
    return !!row;
  }

  getSeenUrls(): Set<string> {
    const db = this.databaseService.getDb();
    const rows = db.prepare('SELECT url FROM items').all() as { url: string }[];
    return new Set(rows.map((r) => r.url));
  }

  updateScore(
    id: string,
    score: number,
    tags: string[],
    summary: string,
    clipType?: string,
    reasoning?: string,
    provider?: string,
    model?: string,
  ): void {
    const db = this.databaseService.getDb();
    db.prepare(`
      UPDATE items SET
        ai_score = ?, ai_tags = ?, ai_summary = ?, ai_clip_type = ?,
        ai_reasoning = ?, scored_at = ?, ai_provider = ?, ai_model = ?
      WHERE id = ?
    `).run(
      score,
      JSON.stringify(tags),
      summary,
      clipType || null,
      reasoning || null,
      new Date().toISOString(),
      provider || null,
      model || null,
      id,
    );
  }

  updatePreFilterScore(id: string, score: number): void {
    const db = this.databaseService.getDb();
    db.prepare('UPDATE items SET pre_filter_score = ? WHERE id = ?').run(score, id);
  }

  dismissItem(id: string): void {
    const db = this.databaseService.getDb();
    db.prepare(
      'UPDATE items SET dismissed = 1, dismissed_at = ? WHERE id = ?',
    ).run(new Date().toISOString(), id);
  }

  bookmarkItem(id: string): void {
    const db = this.databaseService.getDb();
    db.prepare(
      'UPDATE items SET bookmarked = 1, bookmarked_at = ? WHERE id = ?',
    ).run(new Date().toISOString(), id);
  }

  unbookmarkItem(id: string): void {
    const db = this.databaseService.getDb();
    db.prepare(
      'UPDATE items SET bookmarked = 0, bookmarked_at = NULL WHERE id = ?',
    ).run(id);
  }

  markOpened(id: string): void {
    const db = this.databaseService.getDb();
    db.prepare(
      'UPDATE items SET opened = 1, opened_at = ? WHERE id = ?',
    ).run(new Date().toISOString(), id);
  }

  queryFeed(query: FeedQuery): { items: StoredItem[]; total: number } {
    const db = this.databaseService.getDb();
    const conditions: string[] = [];
    const params: any[] = [];

    // Default: hide dismissed items
    if (query.dismissed === true) {
      conditions.push('dismissed = 1');
    } else {
      conditions.push('dismissed = 0');
    }

    if (query.bookmarked === true) {
      conditions.push('bookmarked = 1');
    }

    if (query.minScore !== undefined) {
      conditions.push('ai_score >= ?');
      params.push(query.minScore);
    }

    if (query.maxScore !== undefined) {
      conditions.push('ai_score <= ?');
      params.push(query.maxScore);
    }

    if (query.platform) {
      conditions.push('platform = ?');
      params.push(query.platform);
    }

    if (query.contentType) {
      conditions.push('content_type = ?');
      params.push(query.contentType);
    }

    if (query.tag) {
      conditions.push("ai_tags LIKE ?");
      params.push(`%"${query.tag}"%`);
    }

    if (query.search) {
      conditions.push('(title LIKE ? OR text_content LIKE ? OR author LIKE ?)');
      const searchTerm = `%${query.search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const countRow = db
      .prepare(`SELECT COUNT(*) as count FROM items ${where}`)
      .get(...params) as { count: number };

    // Get paginated results
    const page = query.page || 1;
    const limit = query.limit || 20;
    const offset = (page - 1) * limit;

    const items = db
      .prepare(
        `SELECT * FROM items ${where}
         ORDER BY ai_score DESC, pre_filter_score DESC, fetched_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as StoredItem[];

    return { items, total: countRow.count };
  }

  getItemCount(): number {
    const db = this.databaseService.getDb();
    const row = db.prepare('SELECT COUNT(*) as count FROM items').get() as {
      count: number;
    };
    return row.count;
  }

  clearAllItems(): void {
    const db = this.databaseService.getDb();
    db.prepare('DELETE FROM items').run();
  }
}
