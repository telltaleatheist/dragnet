import { Injectable, Logger, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { ScoredItem, StoryCluster, FeedFilters, DataStore, DataStoreType, SearchTermSet } from '../../../shared/types';
import { DatabaseService } from '../database/database.service';
import { ProfileService } from '../profile/profile.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class InMemoryStoreService implements OnModuleInit {
  private readonly logger = new Logger(InMemoryStoreService.name);
  private items = new Map<string, ScoredItem>();
  private seenUrls = new Set<string>();
  private seenTitles = new Map<string, string>(); // normalized title → item ID
  private seenContentIds = new Set<string>(); // cross-platform content IDs (e.g. youtube video IDs)
  private clusters: StoryCluster[] = [];

  // Data Store registry
  private dataStores = new Map<string, DataStore>();
  private storeIdIndex = new Map<string, Set<string>>(); // storeId → item ID set

  // Search Term Set registry
  private termSets = new Map<string, SearchTermSet>();

  constructor(
    private readonly databaseService: DatabaseService,
    @Inject(forwardRef(() => ProfileService))
    private readonly profileService: ProfileService,
  ) {}

  onModuleInit() {
    this.loadBookmarkedUrls();
    this.loadTermSetsFromDb();
  }

  private loadBookmarkedUrls() {
    try {
      const db = this.databaseService.getDb();
      const profileId = this.profileService.getActiveProfileId();
      let query = 'SELECT url FROM bookmarks';
      const params: any[] = [];
      if (profileId) {
        query += ' WHERE profile_id = ? OR profile_id IS NULL';
        params.push(profileId);
      }
      const rows = db.prepare(query).all(...params) as { url: string }[];
      for (const row of rows) {
        this.seenUrls.add(row.url);
      }
      this.logger.log(`Loaded ${this.seenUrls.size} bookmarked URLs into seenUrls`);
    } catch {
      // Table might not exist yet on first run
      this.logger.log('No bookmarks table yet — starting with empty seenUrls');
    }
  }

  // --- Data Store ops ---

  createStore(name: string, type: DataStoreType, searchTerms?: string[]): DataStore {
    const store: DataStore = {
      id: uuidv4(),
      name,
      type,
      createdAt: new Date().toISOString(),
      itemCount: 0,
      searchTerms,
    };
    this.dataStores.set(store.id, store);
    this.storeIdIndex.set(store.id, new Set());
    this.logger.log(`Created data store: "${name}" (${type}) [${store.id}]`);
    return store;
  }

  getStores(): DataStore[] {
    return Array.from(this.dataStores.values());
  }

  getStore(id: string): DataStore | undefined {
    return this.dataStores.get(id);
  }

  removeStore(id: string): boolean {
    const store = this.dataStores.get(id);
    if (!store) return false;

    // Remove all items that belong only to this store
    const itemIds = this.storeIdIndex.get(id);
    if (itemIds) {
      for (const itemId of itemIds) {
        // Check if item belongs to other stores
        let inOtherStore = false;
        for (const [sid, set] of this.storeIdIndex) {
          if (sid !== id && set.has(itemId)) {
            inOtherStore = true;
            break;
          }
        }
        if (!inOtherStore) {
          this.items.delete(itemId);
        }
      }
    }

    this.storeIdIndex.delete(id);
    this.dataStores.delete(id);
    this.logger.log(`Removed data store: "${store.name}" [${id}]`);
    return true;
  }

  // --- Term Set ops ---

  private loadTermSetsFromDb(): void {
    try {
      const db = this.databaseService.getDb();
      const profileId = this.profileService.getActiveProfileId();
      let query = 'SELECT * FROM search_term_sets';
      const params: any[] = [];
      if (profileId) {
        query += ' WHERE profile_id = ? OR profile_id IS NULL';
        params.push(profileId);
      }
      query += ' ORDER BY created_at ASC';
      const rows = db.prepare(query).all(...params) as any[];
      for (const row of rows) {
        const termSet: SearchTermSet = {
          id: row.id,
          name: row.name,
          topics: JSON.parse(row.topics || '[]'),
          figures: JSON.parse(row.figures || '[]'),
          suggestions: JSON.parse(row.suggestions || '[]'),
          createdAt: row.created_at,
        };
        this.termSets.set(termSet.id, termSet);
      }
      if (rows.length > 0) {
        this.logger.log(`Loaded ${rows.length} search term sets from database`);
      }
    } catch {
      this.logger.log('No search_term_sets table yet — starting with empty term sets');
    }
  }

  createTermSet(name: string, topics: string[], figures: string[], suggestions: { text: string; enabled: boolean }[]): SearchTermSet {
    const termSet: SearchTermSet = {
      id: uuidv4(),
      name,
      topics,
      figures,
      suggestions,
      createdAt: new Date().toISOString(),
    };
    this.termSets.set(termSet.id, termSet);

    // Persist to database
    try {
      const db = this.databaseService.getDb();
      const profileId = this.profileService.getActiveProfileId();
      db.prepare(`
        INSERT OR REPLACE INTO search_term_sets (id, profile_id, name, topics, figures, suggestions, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        termSet.id,
        profileId || null,
        termSet.name,
        JSON.stringify(termSet.topics),
        JSON.stringify(termSet.figures),
        JSON.stringify(termSet.suggestions),
        termSet.createdAt,
      );
    } catch (err) {
      this.logger.warn(`Failed to persist term set: ${(err as Error).message}`);
    }

    this.logger.log(`Created term set: "${name}" [${termSet.id}]`);
    return termSet;
  }

  getTermSets(): SearchTermSet[] {
    return Array.from(this.termSets.values());
  }

  removeTermSet(id: string): boolean {
    const set = this.termSets.get(id);
    if (!set) return false;
    this.termSets.delete(id);

    // Remove from database
    try {
      const db = this.databaseService.getDb();
      db.prepare('DELETE FROM search_term_sets WHERE id = ?').run(id);
    } catch (err) {
      this.logger.warn(`Failed to delete term set from db: ${(err as Error).message}`);
    }

    this.logger.log(`Removed term set: "${set.name}" [${id}]`);
    return true;
  }

  // --- Item ops ---

  addItems(
    contentItems: Omit<ScoredItem, 'preFilterScore' | 'aiScore' | 'aiTags' | 'aiSummary' | 'dismissed' | 'bookmarked' | 'opened'>[],
    storeId?: string,
    localDedup = false,
  ): number {
    let added = 0;
    let deduped = 0;

    // For search stores, use local dedup (only within the store)
    const localSeenUrls = localDedup ? new Set<string>() : null;
    const localSeenContentIds = localDedup ? new Set<string>() : null;
    const localSeenTitles = localDedup ? new Map<string, string>() : null;

    // Pre-populate local dedup sets from existing store items
    if (localDedup && storeId) {
      const storeItemIds = this.storeIdIndex.get(storeId);
      if (storeItemIds) {
        for (const id of storeItemIds) {
          const item = this.items.get(id);
          if (item) {
            localSeenUrls!.add(item.url);
            const cid = this.extractContentId(item.url);
            if (cid) localSeenContentIds!.add(cid);
            const norm = this.normalizeTitle(item.title);
            if (norm) localSeenTitles!.set(norm, item.id);
          }
        }
      }
    }

    for (const item of contentItems) {
      // Dedup check — global or local depending on store type
      if (localDedup) {
        if (localSeenUrls!.has(item.url)) { deduped++; continue; }
        const contentId = this.extractContentId(item.url);
        if (contentId && localSeenContentIds!.has(contentId)) { deduped++; continue; }
        const normTitle = this.normalizeTitle(item.title);
        if (normTitle && localSeenTitles!.has(normTitle)) { deduped++; continue; }
      } else {
        if (this.seenUrls.has(item.url)) { deduped++; continue; }

        // Cross-platform content dedup
        const contentId = this.extractContentId(item.url);
        if (contentId && this.seenContentIds.has(contentId)) {
          this.seenUrls.add(item.url);
          deduped++;
          continue;
        }

        // Title-based dedup
        const normTitle = this.normalizeTitle(item.title);
        let existingId = normTitle ? this.seenTitles.get(normTitle) : undefined;
        if (!existingId && normTitle) {
          existingId = this.findNearDuplicateTitle(normTitle);
        }

        if (existingId) {
          const existing = this.items.get(existingId);
          if (existing) {
            if (item.contentType === 'video' && existing.contentType !== 'video') {
              const altSources = ((existing.metadata as any)?.altSources || []) as string[];
              altSources.push(`${existing.platform}:${existing.sourceAccount}`);
              const scored: ScoredItem = {
                ...item,
                id: item.id || uuidv4(),
                storeId: storeId || existing.storeId,
                preFilterScore: 0,
                aiScore: 0,
                aiTags: [],
                aiSummary: '',
                dismissed: false,
                bookmarked: false,
                opened: false,
                metadata: { ...item.metadata, altSources, replacedUrl: existing.url },
              };
              // Update store index: remove old, add new
              if (storeId) {
                const storeSet = this.storeIdIndex.get(existing.storeId || storeId);
                if (storeSet) storeSet.delete(existingId);
                const newSet = this.storeIdIndex.get(storeId);
                if (newSet) newSet.add(scored.id);
              }
              this.items.delete(existingId);
              this.items.set(scored.id, scored);
              this.seenUrls.add(scored.url);
              if (normTitle) this.seenTitles.set(normTitle, scored.id);
              for (const [key, val] of this.seenTitles) {
                if (val === existingId) this.seenTitles.set(key, scored.id);
              }
              deduped++;
              continue;
            }

            const altSources = ((existing.metadata as any)?.altSources || []) as string[];
            altSources.push(`${item.platform}:${item.sourceAccount}`);
            existing.metadata = { ...existing.metadata, altSources };
            this.seenUrls.add(item.url);
            deduped++;
            continue;
          }
        }
      }

      const scored: ScoredItem = {
        ...item,
        id: item.id || uuidv4(),
        storeId,
        preFilterScore: 0,
        aiScore: 0,
        aiTags: [],
        aiSummary: '',
        dismissed: false,
        bookmarked: false,
        opened: false,
      };
      this.items.set(scored.id, scored);

      // Update dedup indexes
      if (localDedup) {
        localSeenUrls!.add(scored.url);
        const cid = this.extractContentId(scored.url);
        if (cid) localSeenContentIds!.add(cid);
        const norm = this.normalizeTitle(scored.title);
        if (norm) localSeenTitles!.set(norm, scored.id);
      } else {
        this.seenUrls.add(scored.url);
        const normTitle = this.normalizeTitle(scored.title);
        if (normTitle) this.seenTitles.set(normTitle, scored.id);
        const contentId = this.extractContentId(scored.url);
        if (contentId) this.seenContentIds.add(contentId);
      }

      // Update store index
      if (storeId) {
        const storeSet = this.storeIdIndex.get(storeId);
        if (storeSet) storeSet.add(scored.id);
      }

      added++;
    }

    // Update store item count
    if (storeId) {
      const store = this.dataStores.get(storeId);
      if (store) {
        store.itemCount = this.storeIdIndex.get(storeId)?.size || 0;
      }
    }

    if (deduped > 0) {
      this.logger.log(`Deduped ${deduped} items by title/content`);
    }
    return added;
  }

  /** Normalize a title for dedup comparison: lowercase, strip punctuation, collapse whitespace */
  private normalizeTitle(title: string): string {
    if (!title) return '';
    return title
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Find an existing item with a near-duplicate title (word-set Jaccard similarity > 0.85). */
  private findNearDuplicateTitle(normTitle: string): string | undefined {
    const newWords = new Set(normTitle.split(' ').filter((w) => w.length > 2));
    if (newWords.size < 4) return undefined;

    for (const [existingTitle, existingId] of this.seenTitles) {
      const existingWords = new Set(existingTitle.split(' ').filter((w) => w.length > 2));
      if (existingWords.size < 4) continue;

      let intersection = 0;
      for (const w of newWords) {
        if (existingWords.has(w)) intersection++;
      }
      const union = new Set([...newWords, ...existingWords]).size;
      const similarity = intersection / union;

      if (similarity > 0.85) return existingId;
    }
    return undefined;
  }

  /** Extract a cross-platform content ID from a URL (e.g., YouTube video ID) */
  private extractContentId(url: string): string | null {
    try {
      const u = new URL(url);
      if (u.hostname.includes('youtube.com') || u.hostname === 'youtu.be') {
        const videoId = u.hostname === 'youtu.be'
          ? u.pathname.slice(1)
          : u.searchParams.get('v') || u.pathname.match(/\/(?:shorts|embed|v)\/([^/?]+)/)?.[1];
        if (videoId) return `yt:${videoId}`;
      }
      if (u.hostname.includes('tiktok.com')) {
        const videoMatch = u.pathname.match(/\/video\/(\d+)/);
        if (videoMatch) return `tt:${videoMatch[1]}`;
      }
      if (u.hostname.includes('instagram.com')) {
        const postMatch = u.pathname.match(/\/(?:p|reel)\/([^/?]+)/);
        if (postMatch) return `ig:${postMatch[1]}`;
      }
    } catch {
      // Invalid URL
    }
    return null;
  }

  getItem(id: string): ScoredItem | undefined {
    return this.items.get(id);
  }

  getAllItems(): ScoredItem[] {
    return Array.from(this.items.values());
  }

  getItemsByStoreIds(storeIds: string[]): ScoredItem[] {
    const itemIds = new Set<string>();
    for (const sid of storeIds) {
      const set = this.storeIdIndex.get(sid);
      if (set) {
        for (const id of set) itemIds.add(id);
      }
    }
    return Array.from(itemIds).map((id) => this.items.get(id)).filter(Boolean) as ScoredItem[];
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

  getScoredItems(storeIds?: string[]): ScoredItem[] {
    const source = storeIds?.length ? this.getItemsByStoreIds(storeIds) : this.getAllItems();
    return source.filter((i) => i.scoredAt);
  }

  getUnscoredItems(storeIds?: string[]): ScoredItem[] {
    const source = storeIds?.length ? this.getItemsByStoreIds(storeIds) : this.getAllItems();
    return source.filter((i) => !i.scoredAt);
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

  removeCluster(id: string): boolean {
    const idx = this.clusters.findIndex((c) => c.id === id);
    if (idx === -1) return false;
    this.clusters.splice(idx, 1);
    return true;
  }

  removeItemFromCluster(clusterId: string, itemId: string): boolean {
    const cluster = this.clusters.find((c) => c.id === clusterId);
    if (!cluster) return false;
    const idx = cluster.itemIds.indexOf(itemId);
    if (idx === -1) return false;
    cluster.itemIds.splice(idx, 1);
    return true;
  }

  moveItemBetweenClusters(itemId: string, fromClusterId: string, toClusterId: string): boolean {
    const from = this.clusters.find((c) => c.id === fromClusterId);
    const to = this.clusters.find((c) => c.id === toClusterId);
    if (!from || !to) return false;
    const idx = from.itemIds.indexOf(itemId);
    if (idx === -1) return false;
    from.itemIds.splice(idx, 1);
    if (!to.itemIds.includes(itemId)) {
      to.itemIds.push(itemId);
    }
    return true;
  }

  // --- Query ---

  queryItems(filters: Partial<FeedFilters>): { items: ScoredItem[]; total: number } {
    let result = filters.storeIds?.length
      ? this.getItemsByStoreIds(filters.storeIds)
      : this.getAllItems();

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

  // --- Platform counts ---

  getPlatformCounts(storeIds?: string[]): { platforms: Record<string, number>; videoCount: number } {
    const source = storeIds?.length ? this.getItemsByStoreIds(storeIds) : this.items.values();
    const platforms: Record<string, number> = {};
    let videoCount = 0;
    for (const item of source) {
      if (item.dismissed) continue;
      platforms[item.platform] = (platforms[item.platform] || 0) + 1;
      if (item.contentType === 'video') videoCount++;
    }
    return { platforms, videoCount };
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
    this.seenTitles.clear();
    this.seenContentIds.clear();
    this.dataStores.clear();
    this.storeIdIndex.clear();
    this.termSets.clear();
    // Keep seenUrls — they include bookmarked URLs
  }
}
