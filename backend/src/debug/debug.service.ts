import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { InMemoryStoreService } from '../store/in-memory-store.service';
import { ProfileService } from '../profile/profile.service';
import { v4 as uuidv4 } from 'uuid';
import type { ContentItem } from '../../../shared/types';

export interface SnapshotSummary {
  id: string;
  name: string;
  profileId: string | null;
  itemCount: number;
  createdAt: string;
}

@Injectable()
export class DebugService {
  private readonly logger = new Logger(DebugService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly store: InMemoryStoreService,
    private readonly profileService: ProfileService,
  ) {}

  saveSnapshot(name: string): SnapshotSummary {
    const items = this.store.getAllItems();
    if (items.length === 0) {
      throw new Error('No items in store to snapshot');
    }

    const id = uuidv4();
    const now = new Date().toISOString();
    const profileId = this.profileService.getActiveProfileId();
    const db = this.db.getDb();

    const insertItem = db.prepare(`
      INSERT INTO snapshot_items (id, snapshot_id, url, title, author, platform, content_type,
        text_content, published_at, fetched_at, thumbnail_url, source_account, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO scan_snapshots (id, name, profile_id, item_count, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, name, profileId, items.length, now);

      for (const item of items) {
        insertItem.run(
          item.id, id, item.url, item.title, item.author,
          item.platform, item.contentType, item.textContent ?? null,
          item.publishedAt ?? null, item.fetchedAt,
          item.thumbnailUrl ?? null, item.sourceAccount,
          item.metadata ? JSON.stringify(item.metadata) : null,
        );
      }
    });
    tx();

    this.logger.log(`Saved snapshot "${name}" with ${items.length} items`);
    return { id, name, profileId, itemCount: items.length, createdAt: now };
  }

  listSnapshots(): SnapshotSummary[] {
    const rows = this.db.getDb()
      .prepare('SELECT * FROM scan_snapshots ORDER BY created_at DESC')
      .all() as any[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      profileId: r.profile_id,
      itemCount: r.item_count,
      createdAt: r.created_at,
    }));
  }

  loadSnapshot(snapshotId: string): number {
    const rows = this.db.getDb()
      .prepare('SELECT * FROM snapshot_items WHERE snapshot_id = ?')
      .all(snapshotId) as any[];

    if (rows.length === 0) {
      throw new Error(`Snapshot ${snapshotId} not found or empty`);
    }

    // Get snapshot name for the store label
    const snapRow = this.db.getDb()
      .prepare('SELECT name FROM scan_snapshots WHERE id = ?')
      .get(snapshotId) as { name: string } | undefined;

    this.store.clear();

    const snapStore = this.store.createStore(
      `Snapshot: ${snapRow?.name || snapshotId}`,
      'snapshot',
    );

    const items: ContentItem[] = rows.map((r) => ({
      id: r.id,
      url: r.url,
      title: r.title,
      author: r.author,
      platform: r.platform,
      contentType: r.content_type,
      textContent: r.text_content ?? undefined,
      publishedAt: r.published_at ?? undefined,
      fetchedAt: r.fetched_at,
      thumbnailUrl: r.thumbnail_url ?? undefined,
      sourceAccount: r.source_account,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    }));

    const added = this.store.addItems(items as any, snapStore.id);
    this.logger.log(`Loaded snapshot ${snapshotId}: ${added} items into store`);
    return added;
  }

  deleteSnapshot(id: string): void {
    this.db.getDb()
      .prepare('DELETE FROM scan_snapshots WHERE id = ?')
      .run(id);
    this.logger.log(`Deleted snapshot ${id}`);
  }
}
