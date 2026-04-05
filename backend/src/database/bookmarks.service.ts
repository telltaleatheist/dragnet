import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { ProfileService } from '../profile/profile.service';
import { ScoredItem, StoryCluster } from '../../../shared/types';

export interface BookmarkRow {
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
  bookmarked_at: string;
  cluster_title: string | null;
  cluster_summary: string | null;
}

@Injectable()
export class BookmarksService {
  private readonly logger = new Logger(BookmarksService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    @Inject(forwardRef(() => ProfileService))
    private readonly profileService: ProfileService,
  ) {}

  bookmarkItem(item: ScoredItem, clusterTitle?: string, clusterSummary?: string): void {
    const db = this.databaseService.getDb();
    const profileId = this.profileService.getActiveProfileId();
    db.prepare(`
      INSERT OR REPLACE INTO bookmarks
        (id, url, title, author, platform, content_type, text_content,
         published_at, fetched_at, thumbnail_url, source_account, metadata,
         pre_filter_score, ai_score, ai_tags, ai_summary, ai_clip_type,
         ai_reasoning, scored_at, ai_provider, ai_model,
         bookmarked_at, cluster_title, cluster_summary, profile_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      item.id,
      item.url,
      item.title,
      item.author,
      item.platform,
      item.contentType,
      item.textContent || null,
      item.publishedAt || null,
      item.fetchedAt,
      item.thumbnailUrl || null,
      item.sourceAccount,
      item.metadata ? JSON.stringify(item.metadata) : null,
      item.preFilterScore,
      item.aiScore,
      item.aiTags.length > 0 ? JSON.stringify(item.aiTags) : null,
      item.aiSummary || null,
      item.aiClipType || null,
      item.aiReasoning || null,
      item.scoredAt || null,
      item.aiProvider || null,
      item.aiModel || null,
      new Date().toISOString(),
      clusterTitle || null,
      clusterSummary || null,
      profileId,
    );
  }

  bookmarkCluster(cluster: StoryCluster, items: ScoredItem[]): void {
    const db = this.databaseService.getDb();
    const tx = db.transaction(() => {
      for (const item of items) {
        this.bookmarkItem(item, cluster.title, cluster.summary);
      }
    });
    tx();
  }

  unbookmarkItem(id: string): void {
    const db = this.databaseService.getDb();
    db.prepare('DELETE FROM bookmarks WHERE id = ?').run(id);
  }

  queryBookmarks(filters: {
    page?: number;
    limit?: number;
    search?: string;
    platform?: string;
    clusterTitle?: string;
  }): { items: BookmarkRow[]; total: number } {
    const db = this.databaseService.getDb();
    const conditions: string[] = [];
    const params: any[] = [];

    // Filter by active profile
    const profileId = this.profileService.getActiveProfileId();
    if (profileId) {
      conditions.push('(profile_id = ? OR profile_id IS NULL)');
      params.push(profileId);
    }

    if (filters.clusterTitle) {
      if (filters.clusterTitle === 'Unclustered') {
        conditions.push('cluster_title IS NULL');
      } else {
        conditions.push('cluster_title = ?');
        params.push(filters.clusterTitle);
      }
    }

    if (filters.search) {
      conditions.push('(title LIKE ? OR text_content LIKE ? OR author LIKE ?)');
      const term = `%${filters.search}%`;
      params.push(term, term, term);
    }

    if (filters.platform) {
      conditions.push('platform = ?');
      params.push(filters.platform);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRow = db
      .prepare(`SELECT COUNT(*) as count FROM bookmarks ${where}`)
      .get(...params) as { count: number };

    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const offset = (page - 1) * limit;

    const items = db
      .prepare(
        `SELECT * FROM bookmarks ${where}
         ORDER BY bookmarked_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as BookmarkRow[];

    return { items, total: countRow.count };
  }

  queryBookmarkClustersWithItems(): { clusterTitle: string; clusterSummary: string | null; items: BookmarkRow[] }[] {
    const db = this.databaseService.getDb();
    const profileId = this.profileService.getActiveProfileId();
    const conditions: string[] = [];
    const params: any[] = [];

    if (profileId) {
      conditions.push('(profile_id = ? OR profile_id IS NULL)');
      params.push(profileId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = db.prepare(`
      SELECT * FROM bookmarks
      ${where}
      ORDER BY bookmarked_at DESC
    `).all(...params) as BookmarkRow[];

    // Group by cluster_title (null becomes 'Unclustered')
    const groups = new Map<string, { title: string; summary: string | null; items: BookmarkRow[] }>();
    for (const row of rows) {
      const title = row.cluster_title || 'Unclustered';
      if (!groups.has(title)) {
        groups.set(title, { title, summary: row.cluster_summary, items: [] });
      }
      groups.get(title)!.items.push(row);
    }

    return Array.from(groups.values()).map((g) => ({
      clusterTitle: g.title,
      clusterSummary: g.summary,
      items: g.items,
    }));
  }

  queryBookmarkClusters(): { clusterTitle: string; clusterSummary: string | null; itemCount: number; latestBookmarkedAt: string }[] {
    const db = this.databaseService.getDb();
    const profileId = this.profileService.getActiveProfileId();
    const conditions: string[] = [];
    const params: any[] = [];

    if (profileId) {
      conditions.push('(profile_id = ? OR profile_id IS NULL)');
      params.push(profileId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = db.prepare(`
      SELECT
        COALESCE(cluster_title, 'Unclustered') as cluster_title,
        cluster_summary,
        COUNT(*) as item_count,
        MAX(bookmarked_at) as latest_bookmarked_at
      FROM bookmarks
      ${where}
      GROUP BY COALESCE(cluster_title, 'Unclustered')
      ORDER BY latest_bookmarked_at DESC
    `).all(...params) as { cluster_title: string; cluster_summary: string | null; item_count: number; latest_bookmarked_at: string }[];

    return rows.map((r) => ({
      clusterTitle: r.cluster_title,
      clusterSummary: r.cluster_summary,
      itemCount: r.item_count,
      latestBookmarkedAt: r.latest_bookmarked_at,
    }));
  }

  updateBookmarkCluster(id: string, newClusterTitle: string, newClusterSummary?: string): void {
    const db = this.databaseService.getDb();
    db.prepare('UPDATE bookmarks SET cluster_title = ?, cluster_summary = ? WHERE id = ?')
      .run(newClusterTitle, newClusterSummary ?? null, id);
  }

  getBookmarkedUrls(): Set<string> {
    const db = this.databaseService.getDb();
    const profileId = this.profileService.getActiveProfileId();
    let query = 'SELECT url FROM bookmarks';
    const params: any[] = [];
    if (profileId) {
      query += ' WHERE profile_id = ? OR profile_id IS NULL';
      params.push(profileId);
    }
    const rows = db.prepare(query).all(...params) as { url: string }[];
    return new Set(rows.map((r) => r.url));
  }

  getBookmarkCount(): number {
    const db = this.databaseService.getDb();
    const row = db.prepare('SELECT COUNT(*) as count FROM bookmarks').get() as { count: number };
    return row.count;
  }
}
