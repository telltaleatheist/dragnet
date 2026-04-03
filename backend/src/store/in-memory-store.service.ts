import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ScoredItem, StoryCluster, FeedFilters } from '../../../shared/types';
import { DatabaseService } from '../database/database.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class InMemoryStoreService implements OnModuleInit {
  private readonly logger = new Logger(InMemoryStoreService.name);
  private items = new Map<string, ScoredItem>();
  private seenUrls = new Set<string>();
  private clusters: StoryCluster[] = [];

  constructor(private readonly databaseService: DatabaseService) {}

  onModuleInit() {
    this.loadBookmarkedUrls();
  }

  private loadBookmarkedUrls() {
    try {
      const db = this.databaseService.getDb();
      const rows = db.prepare('SELECT url FROM bookmarks').all() as { url: string }[];
      for (const row of rows) {
        this.seenUrls.add(row.url);
      }
      this.logger.log(`Loaded ${this.seenUrls.size} bookmarked URLs into seenUrls`);
    } catch {
      // Table might not exist yet on first run
      this.logger.log('No bookmarks table yet — starting with empty seenUrls');
    }
  }

  // --- Item ops ---

  addItems(contentItems: Omit<ScoredItem, 'preFilterScore' | 'aiScore' | 'aiTags' | 'aiSummary' | 'dismissed' | 'bookmarked' | 'opened'>[]): number {
    let added = 0;
    for (const item of contentItems) {
      if (this.seenUrls.has(item.url)) continue;
      const scored: ScoredItem = {
        ...item,
        id: item.id || uuidv4(),
        preFilterScore: 0,
        aiScore: 0,
        aiTags: [],
        aiSummary: '',
        dismissed: false,
        bookmarked: false,
        opened: false,
      };
      this.items.set(scored.id, scored);
      this.seenUrls.add(scored.url);
      added++;
    }
    return added;
  }

  getItem(id: string): ScoredItem | undefined {
    return this.items.get(id);
  }

  getAllItems(): ScoredItem[] {
    return Array.from(this.items.values());
  }

  getItemsByIds(ids: string[]): ScoredItem[] {
    return ids.map((id) => this.items.get(id)).filter(Boolean) as ScoredItem[];
  }

  getSeenUrls(): Set<string> {
    return this.seenUrls;
  }

  getItemCount(): number {
    return this.items.size;
  }

  // --- Score ops ---

  updatePreFilterScore(id: string, score: number) {
    const item = this.items.get(id);
    if (item) item.preFilterScore = score;
  }

  updateAIScore(id: string, score: number, tags: string[], summary: string, clipType?: string, reasoning?: string, provider?: string, model?: string) {
    const item = this.items.get(id);
    if (!item) return;
    item.aiScore = score;
    item.aiTags = tags;
    item.aiSummary = summary;
    item.aiClipType = clipType;
    item.aiReasoning = reasoning;
    item.scoredAt = new Date().toISOString();
    item.aiProvider = provider;
    item.aiModel = model;
  }

  getScoredItems(): ScoredItem[] {
    return this.getAllItems().filter((i) => i.scoredAt);
  }

  getUnscoredItems(): ScoredItem[] {
    return this.getAllItems().filter((i) => !i.scoredAt);
  }

  // --- Cluster ops ---

  setClusters(clusters: StoryCluster[]) {
    this.clusters = clusters;
  }

  getClusters(): StoryCluster[] {
    return this.clusters;
  }

  getCluster(id: string): StoryCluster | undefined {
    return this.clusters.find((c) => c.id === id);
  }

  // --- Query ---

  queryItems(filters: Partial<FeedFilters>): { items: ScoredItem[]; total: number } {
    let result = this.getAllItems();

    // Filter dismissed
    if (filters.dismissed === true) {
      result = result.filter((i) => i.dismissed);
    } else {
      result = result.filter((i) => !i.dismissed);
    }

    if (filters.bookmarked === true) {
      result = result.filter((i) => i.bookmarked);
    }

    if (filters.minScore !== undefined) {
      result = result.filter((i) => i.aiScore >= filters.minScore!);
    }

    if (filters.platform) {
      result = result.filter((i) => i.platform === filters.platform);
    }

    if (filters.contentType) {
      result = result.filter((i) => i.contentType === filters.contentType);
    }

    if (filters.tag) {
      result = result.filter((i) => i.aiTags.includes(filters.tag!));
    }

    if (filters.search) {
      const term = filters.search.toLowerCase();
      result = result.filter(
        (i) =>
          i.title.toLowerCase().includes(term) ||
          (i.textContent?.toLowerCase().includes(term)) ||
          i.author.toLowerCase().includes(term),
      );
    }

    // Sort: aiScore desc, preFilterScore desc, fetchedAt desc
    result.sort((a, b) => {
      if (b.aiScore !== a.aiScore) return b.aiScore - a.aiScore;
      if (b.preFilterScore !== a.preFilterScore) return b.preFilterScore - a.preFilterScore;
      return new Date(b.fetchedAt).getTime() - new Date(a.fetchedAt).getTime();
    });

    const total = result.length;
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const offset = (page - 1) * limit;
    const paged = result.slice(offset, offset + limit);

    return { items: paged, total };
  }

  // --- Session ops ---

  dismissItem(id: string) {
    const item = this.items.get(id);
    if (item) item.dismissed = true;
  }

  markOpened(id: string) {
    const item = this.items.get(id);
    if (item) item.opened = true;
  }

  markBookmarked(id: string) {
    const item = this.items.get(id);
    if (item) item.bookmarked = true;
  }

  unmarkBookmarked(id: string) {
    const item = this.items.get(id);
    if (item) item.bookmarked = false;
  }

  clear() {
    this.items.clear();
    this.clusters = [];
    // Keep seenUrls — they include bookmarked URLs
  }
}
