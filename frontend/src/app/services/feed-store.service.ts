import { Injectable, signal, computed, inject } from '@angular/core';
import { ApiService } from './api.service';
import {
  FeedItem,
  FeedFilters,
  ScanProgressEvent,
  StoryCluster,
  ClusteringProgressEvent,
  CurateCompleteEvent,
  DataStore,
  SearchTermSet,
  BookmarkClusterSummary,
  BookmarkedClusterDetail,
} from '../models/feed.model';

export type ActiveView = 'all' | 'curated' | 'bookmarked';

@Injectable({ providedIn: 'root' })
export class FeedStoreService {
  private api = inject(ApiService);

  // State signals
  readonly items = signal<FeedItem[]>([]);
  readonly totalItems = signal(0);
  readonly loading = signal(false);
  readonly scanRunning = signal(false);
  readonly scanProgress = signal<ScanProgressEvent | null>(null);
  readonly curateRunning = signal(false);
  readonly curateProgress = signal<ClusteringProgressEvent | null>(null);
  readonly lastScanTime = signal<string | null>(null);
  readonly lastCurateResult = signal<CurateCompleteEvent | null>(null);

  readonly activeView = signal<ActiveView>('all');
  readonly clusters = signal<StoryCluster[]>([]);
  readonly customInstructions = signal('');

  // Bookmark clusters
  readonly bookmarkClusters = signal<BookmarkClusterSummary[]>([]);
  readonly bookmarkedClusters = signal<BookmarkedClusterDetail[]>([]);
  readonly selectedBookmarkCluster = signal<string | null>(null);

  // Search/retrieve state
  readonly searchRunning = signal(false);
  readonly searchProgress = signal<ScanProgressEvent | null>(null);

  // Retrieve Data modal
  readonly retrieveModalOpen = signal(false);

  // Search Term Sets
  readonly termSets = signal<SearchTermSet[]>([]);
  readonly activeTermSetId = signal<string>('__profile__');
  readonly editingTermSet = signal(false);
  readonly profileTerms = signal<{ topics: string[]; figures: string[] } | null>(null);

  readonly activeTermSet = computed(() => {
    const id = this.activeTermSetId();
    if (id === '__profile__') return null;
    return this.termSets().find((s) => s.id === id) ?? null;
  });

  readonly resolvedTerms = computed<string[]>(() => {
    const set = this.activeTermSet();
    if (!set) {
      // Profile default — return profile terms if loaded
      const pt = this.profileTerms();
      return pt ? [...pt.topics, ...pt.figures] : [];
    }
    return [
      ...set.topics,
      ...set.figures,
      ...set.suggestions.filter((s) => s.enabled).map((s) => s.text),
    ];
  });

  // Data Stores
  readonly dataStores = signal<DataStore[]>([]);
  readonly checkedStoreIds = signal<Set<string>>(new Set());
  readonly selectedStoreIds = computed(() => [...this.checkedStoreIds()]);

  // Platform + video filter
  readonly platformCounts = signal<Record<string, number>>({});
  readonly videoCount = signal(0);
  readonly activePlatformFilter = signal<string | null>(null);
  readonly videoOnly = signal(true);
  readonly adversarial = signal(true);
  readonly dateFilter = signal<number | null>(7);

  readonly filters = signal<FeedFilters>({
    page: 1,
    limit: 20,
  });

  // Computed
  readonly totalPages = computed(() =>
    Math.ceil(this.totalItems() / this.filters().limit),
  );

  readonly hasMore = computed(() =>
    this.filters().page < this.totalPages(),
  );

  readonly hasCheckedStores = computed(() => this.checkedStoreIds().size > 0);

  constructor() {
    this.api.scanStarted$.subscribe(() => {
      this.scanProgress.set(null);
    });

    this.api.scanProgress$.subscribe((event) => {
      this.scanProgress.set(event);
    });

    this.api.scanComplete$.subscribe((event) => {
      this.scanRunning.set(false);
      this.scanProgress.set(null);
      this.lastScanTime.set(new Date().toLocaleTimeString());
      // Add new store and auto-check it
      if (event.storeId) {
        this.addAndCheckStore({ id: event.storeId, name: event.storeName || 'Scan', type: 'scan', createdAt: new Date().toISOString(), itemCount: event.newItems });
      }
      if (this.activeView() === 'all') {
        this.loadItems();
        this.loadPlatformCounts();
      }
    });

    this.api.scanError$.subscribe(() => {
      this.scanRunning.set(false);
    });

    this.api.curateStarted$.subscribe(() => {
      this.curateProgress.set(null);
    });

    this.api.clusteringProgress$.subscribe((event) => {
      this.curateProgress.set(event);
    });

    this.api.curateComplete$.subscribe((event) => {
      this.curateRunning.set(false);
      this.curateProgress.set(null);
      this.lastCurateResult.set(event);
      this.switchView('curated');
    });

    this.api.quickSearchStarted$.subscribe(() => {
      this.searchProgress.set(null);
    });

    this.api.quickSearchProgress$.subscribe((event) => {
      this.searchProgress.set(event);
    });

    this.api.quickSearchComplete$.subscribe((event) => {
      this.searchRunning.set(false);
      this.searchProgress.set(null);
      // Add new store and auto-check it
      if (event.storeId) {
        this.addAndCheckStore({ id: event.storeId, name: event.storeName || `Search: ${event.query}`, type: 'search', createdAt: new Date().toISOString(), itemCount: event.itemsFound });
      }
      if (this.activeView() === 'all') {
        this.loadItems();
        this.loadPlatformCounts();
      }
    });

    this.api.scanCancelled$.subscribe(() => {
      this.scanRunning.set(false);
      this.scanProgress.set(null);
      if (this.activeView() === 'all') {
        this.loadItems();
        this.loadPlatformCounts();
      }
    });

    this.api.curateCancelled$.subscribe(() => {
      this.curateRunning.set(false);
      this.curateProgress.set(null);
    });

    this.api.quickSearchCancelled$.subscribe(() => {
      this.searchRunning.set(false);
      this.searchProgress.set(null);
    });

    this.api.feedUpdated$.subscribe(() => {
      if (this.activeView() === 'all') {
        this.loadItems();
      }
    });

    // Wait for API baseUrl to resolve (async IPC in Electron) before initial load
    this.api.ready.then(() => {
      this.loadItems();
      this.loadScanStatus();
      this.loadPlatformCounts();
      this.loadStores();
      this.loadTermSets();
      this.loadBookmarkClusters();
    });
  }

  // --- Data Store management ---

  loadStores() {
    this.api.getStores().subscribe({
      next: (stores) => {
        this.dataStores.set(stores);
        // Auto-check all existing stores on load
        if (stores.length > 0) {
          this.checkedStoreIds.set(new Set(stores.map((s) => s.id)));
        }
      },
      error: () => {},
    });
  }

  toggleStore(id: string) {
    this.checkedStoreIds.update((set) => {
      const next = new Set(set);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    // Reload current view with new store selection
    this.reloadCurrentView();
  }

  removeStore(id: string) {
    this.api.removeStore(id).subscribe({
      next: () => {
        this.dataStores.update((stores) => stores.filter((s) => s.id !== id));
        this.checkedStoreIds.update((set) => {
          const next = new Set(set);
          next.delete(id);
          return next;
        });
        this.reloadCurrentView();
      },
      error: () => {},
    });
  }

  private addAndCheckStore(store: DataStore) {
    this.dataStores.update((stores) => {
      // Don't add if already exists
      if (stores.find((s) => s.id === store.id)) return stores;
      return [...stores, store];
    });
    this.checkedStoreIds.update((set) => {
      const next = new Set(set);
      next.add(store.id);
      return next;
    });
  }

  openRetrieveModal() {
    this.retrieveModalOpen.set(true);
    this.loadProfileTerms();
  }

  closeRetrieveModal() {
    this.retrieveModalOpen.set(false);
    this.editingTermSet.set(false);
  }

  // --- Term Set management ---

  loadTermSets() {
    this.api.getTermSets().subscribe({
      next: (sets) => this.termSets.set(sets),
      error: () => {},
    });
  }

  loadProfileTerms() {
    this.api.getProfileTerms().subscribe({
      next: (pt) => this.profileTerms.set(pt),
      error: () => {},
    });
  }

  createTermSet(data: { name: string; topics: string[]; figures: string[]; suggestions: { text: string; enabled: boolean }[] }) {
    this.api.createTermSet(data).subscribe({
      next: (set) => {
        this.termSets.update((sets) => [...sets, set]);
        this.activeTermSetId.set(set.id);
        this.editingTermSet.set(false);
      },
      error: () => {},
    });
  }

  removeTermSet(id: string) {
    this.api.removeTermSet(id).subscribe({
      next: () => {
        this.termSets.update((sets) => sets.filter((s) => s.id !== id));
        if (this.activeTermSetId() === id) {
          this.activeTermSetId.set('__profile__');
        }
      },
      error: () => {},
    });
  }

  selectTermSet(id: string) {
    this.activeTermSetId.set(id);
  }

  startEditingTermSet() {
    this.editingTermSet.set(true);
  }

  cancelEditingTermSet() {
    this.editingTermSet.set(false);
  }

  createTermSetFromTerms(terms: string[]) {
    const name = `Reused (${terms.length} terms)`;
    this.api.createTermSet({ name, topics: terms, figures: [], suggestions: [] }).subscribe({
      next: (set) => {
        this.termSets.update((sets) => [...sets, set]);
        this.activeTermSetId.set(set.id);
        this.openRetrieveModal();
      },
      error: () => {},
    });
  }

  // --- View management ---

  switchView(view: ActiveView) {
    this.activeView.set(view);
    this.activePlatformFilter.set(null);
    this.filters.update((f) => ({ ...f, page: 1, search: undefined, platform: undefined, contentType: undefined }));
    switch (view) {
      case 'all':
        this.loadItems();
        this.loadPlatformCounts();
        break;
      case 'curated':
        this.loadCurated();
        break;
      case 'bookmarked':
        this.selectedBookmarkCluster.set(null);
        this.loadBookmarkClusters();
        this.loadBookmarkedGrouped();
        break;
    }
  }

  private reloadCurrentView() {
    const view = this.activeView();
    if (view === 'all') {
      this.loadItems();
      this.loadPlatformCounts();
    } else if (view === 'curated') {
      this.loadCurated();
    } else if (view === 'bookmarked') {
      this.loadBookmarkedGrouped();
    }
  }

  loadItems() {
    this.loading.set(true);
    const storeIds = this.selectedStoreIds();
    this.api.getItems(this.filters(), storeIds.length ? storeIds : undefined).subscribe({
      next: (response) => {
        this.items.set(response.items);
        this.totalItems.set(response.total);
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Failed to load items:', err);
        this.loading.set(false);
      },
    });
  }

  loadCurated() {
    this.loading.set(true);
    const storeIds = this.selectedStoreIds();
    this.api.getCurated(storeIds.length ? storeIds : undefined).subscribe({
      next: (response) => {
        this.clusters.set(response.clusters);
        const allItems = response.clusters.flatMap((c) => c.items);
        this.items.set(allItems);
        this.totalItems.set(allItems.length);
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Failed to load curated:', err);
        this.loading.set(false);
      },
    });
  }

  loadBookmarks() {
    this.loading.set(true);
    const clusterTitle = this.selectedBookmarkCluster() ?? undefined;
    this.api.getBookmarks(this.filters(), clusterTitle).subscribe({
      next: (response) => {
        this.items.set(response.items);
        this.totalItems.set(response.total);
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Failed to load bookmarks:', err);
        this.loading.set(false);
      },
    });
  }

  loadBookmarkClusters() {
    this.api.getBookmarkClusters().subscribe({
      next: (response) => {
        this.bookmarkClusters.set(response.clusters);
      },
      error: () => {},
    });
  }

  loadBookmarkedGrouped() {
    this.loading.set(true);
    this.api.getBookmarkedGrouped().subscribe({
      next: (response) => {
        this.bookmarkedClusters.set(response.clusters);
        const flat = response.clusters.flatMap((c) => c.items);
        this.items.set(flat);
        this.totalItems.set(flat.length);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }

  selectBookmarkCluster(title: string) {
    this.selectedBookmarkCluster.set(title);
  }

  clearBookmarkCluster() {
    this.selectedBookmarkCluster.set(null);
  }

  moveBookmarkToCluster(itemId: string, newClusterTitle: string, newClusterSummary?: string) {
    this.api.updateBookmarkCluster(itemId, newClusterTitle, newClusterSummary).subscribe({
      next: () => {
        this.loadBookmarkClusters();
        if (this.activeView() === 'bookmarked') {
          this.loadBookmarkedGrouped();
        }
      },
      error: () => {},
    });
  }

  loadScanStatus() {
    this.api.getScanStatus().subscribe({
      next: (status) => {
        this.scanRunning.set(status.scanning);
        this.searchRunning.set(status.searching);
      },
      error: () => {},
    });
  }

  loadPlatformCounts() {
    const storeIds = this.selectedStoreIds();
    this.api.getPlatformCounts(storeIds.length ? storeIds : undefined).subscribe({
      next: (res) => {
        this.platformCounts.set(res.platforms);
        this.videoCount.set(res.videoCount);
      },
      error: () => {},
    });
  }

  togglePlatformFilter(platform: string) {
    const current = this.activePlatformFilter();
    if (current === platform) {
      this.clearPlatformFilter();
    } else {
      this.activePlatformFilter.set(platform);
      this.updateFilters({ platform: platform as any });
    }
  }

  clearPlatformFilter() {
    this.activePlatformFilter.set(null);
    this.updateFilters({ platform: undefined });
  }

  toggleVideoOnly() {
    const next = !this.videoOnly();
    this.videoOnly.set(next);
    this.updateFilters({ contentType: next ? 'video' : undefined });
  }

  cancelScan() {
    this.api.cancelScan().subscribe({
      next: () => {
        this.scanRunning.set(false);
        this.scanProgress.set(null);
      },
      error: () => {
        this.scanRunning.set(false);
        this.scanProgress.set(null);
      },
    });
  }

  cancelCurate() {
    this.api.cancelCurate().subscribe({
      next: () => {
        this.curateRunning.set(false);
        this.curateProgress.set(null);
      },
      error: () => {
        this.curateRunning.set(false);
        this.curateProgress.set(null);
      },
    });
  }

  cancelSearch() {
    this.api.cancelSearch().subscribe({
      next: () => {
        this.searchRunning.set(false);
        this.searchProgress.set(null);
      },
      error: () => {
        this.searchRunning.set(false);
        this.searchProgress.set(null);
      },
    });
  }

  triggerScan() {
    if (this.scanRunning() || this.curateRunning()) return;
    this.scanRunning.set(true);
    const searchTerms = this.activeTermSetId() !== '__profile__' ? this.resolvedTerms() : undefined;
    this.api.triggerScan(this.videoOnly(), this.adversarial(), this.dateFilter() ?? undefined, searchTerms).subscribe({
      error: (err) => {
        this.scanRunning.set(false);
        console.error('Failed to trigger scan:', err);
      },
    });
  }

  triggerQuickSearch(query: string) {
    if (this.curateRunning() || this.searchRunning()) return;
    if (!query.trim()) return;
    this.searchRunning.set(true);
    // Quick search is intentionally simple: no AI expansion, no adversarial.
    // Just the user's query sent verbatim to all discovery sources.
    this.api.triggerQuickSearch(query.trim(), false, this.videoOnly(), false, this.dateFilter() ?? undefined).subscribe({
      error: (err) => {
        this.searchRunning.set(false);
        console.error('Failed to trigger quick search:', err);
      },
    });
  }

  triggerAdvancedSearch(terms?: string[]) {
    if (this.curateRunning() || this.searchRunning()) return;
    const searchTerms = terms ?? this.resolvedTerms();
    if (searchTerms.length === 0) return;
    this.searchRunning.set(true);
    this.retrieveModalOpen.set(false);
    this.api.triggerAdvancedSearch(searchTerms, this.videoOnly(), this.adversarial(), this.dateFilter() ?? undefined).subscribe({
      error: (err) => {
        this.searchRunning.set(false);
        console.error('Failed to trigger advanced search:', err);
      },
    });
  }

  triggerCurate() {
    if (this.scanRunning() || this.curateRunning() || this.searchRunning()) return;
    this.curateRunning.set(true);
    this.lastCurateResult.set(null);
    const instructions = this.customInstructions().trim() || undefined;
    const storeIds = this.selectedStoreIds();
    this.api.triggerCurate(instructions, storeIds.length ? storeIds : undefined, this.adversarial(), this.dateFilter() ?? undefined).subscribe({
      error: (err) => {
        this.curateRunning.set(false);
        console.error('Failed to trigger curation:', err);
      },
    });
  }

  updateFilters(partial: Partial<FeedFilters>) {
    this.filters.update((current) => ({
      ...current,
      ...partial,
      page: partial.page ?? 1,
    }));
    const view = this.activeView();
    if (view === 'all') this.loadItems();
  }

  nextPage() {
    if (!this.hasMore()) return;
    this.filters.update((f) => ({ ...f, page: f.page + 1 }));
    const view = this.activeView();
    if (view === 'all') this.loadItems();
  }

  prevPage() {
    if (this.filters().page <= 1) return;
    this.filters.update((f) => ({ ...f, page: f.page - 1 }));
    const view = this.activeView();
    if (view === 'all') this.loadItems();
  }

  dismissItem(id: string) {
    this.api.dismissItem(id).subscribe(() => {
      this.items.update((items) => items.filter((i) => i.id !== id));
      this.totalItems.update((n) => n - 1);
      this.clusters.update((clusters) =>
        clusters.map((c) => ({
          ...c,
          items: c.items.filter((i) => i.id !== id),
        })).filter((c) => c.items.length > 0),
      );
      this.bookmarkedClusters.update((clusters) =>
        clusters.map((c) => ({
          ...c,
          items: c.items.filter((i) => i.id !== id),
        })).filter((c) => c.items.length > 0),
      );
    });
  }

  bookmarkItem(id: string, clusterTitle?: string, clusterSummary?: string) {
    this.api.bookmarkItem(id, clusterTitle, clusterSummary).subscribe(() => {
      this.items.update((items) =>
        items.map((i) => (i.id === id ? { ...i, bookmarked: true } : i)),
      );
      this.clusters.update((clusters) =>
        clusters.map((c) => ({
          ...c,
          items: c.items.map((i) => (i.id === id ? { ...i, bookmarked: true } : i)),
        })),
      );
      // Refresh sidebar cluster list so new bookmark appears immediately
      this.loadBookmarkClusters();
      if (this.activeView() === 'bookmarked') {
        this.loadBookmarkedGrouped();
      }
    });
  }

  unbookmarkItem(id: string) {
    this.api.unbookmarkItem(id).subscribe(() => {
      this.items.update((items) =>
        items.map((i) => (i.id === id ? { ...i, bookmarked: false } : i)),
      );
      this.clusters.update((clusters) =>
        clusters.map((c) => ({
          ...c,
          items: c.items.map((i) => (i.id === id ? { ...i, bookmarked: false } : i)),
        })),
      );
      this.bookmarkedClusters.update((clusters) =>
        clusters.map((c) => ({
          ...c,
          items: c.items.filter((i) => i.id !== id),
        })).filter((c) => c.items.length > 0),
      );
      // Refresh sidebar cluster list
      this.loadBookmarkClusters();
    });
  }

  bookmarkCluster(clusterId: string) {
    this.api.bookmarkCluster(clusterId).subscribe(() => {
      this.clusters.update((clusters) =>
        clusters.map((c) => {
          if (c.id !== clusterId) return c;
          return { ...c, items: c.items.map((i) => ({ ...i, bookmarked: true })) };
        }),
      );
      this.loadBookmarkClusters();
    });
  }

  removeCluster(clusterId: string) {
    this.api.removeCluster(clusterId).subscribe(() => {
      this.clusters.update((clusters) => clusters.filter((c) => c.id !== clusterId));
    });
  }

  removeItemFromCluster(clusterId: string, itemId: string) {
    this.api.removeItemFromCluster(clusterId, itemId).subscribe(() => {
      this.clusters.update((clusters) =>
        clusters.map((c) => {
          if (c.id !== clusterId) return c;
          return { ...c, items: c.items.filter((i) => i.id !== itemId) };
        }),
      );
    });
  }

  reorderClusterItem(clusterId: string, fromIndex: number, toIndex: number) {
    this.clusters.update((clusters) =>
      clusters.map((c) => {
        if (c.id !== clusterId) return c;
        const items = [...c.items];
        const [moved] = items.splice(fromIndex, 1);
        items.splice(toIndex, 0, moved);
        return { ...c, items };
      }),
    );
  }

  moveItemBetweenClusters(fromClusterId: string, itemId: string, toClusterId: string) {
    this.api.moveItemBetweenClusters(fromClusterId, itemId, toClusterId).subscribe(() => {
      this.clusters.update((clusters) => {
        let movedItem: FeedItem | undefined;
        return clusters.map((c) => {
          if (c.id === fromClusterId) {
            movedItem = c.items.find((i) => i.id === itemId);
            return { ...c, items: c.items.filter((i) => i.id !== itemId) };
          }
          if (c.id === toClusterId && movedItem) {
            return { ...c, items: [...c.items, movedItem] };
          }
          return c;
        });
      });
    });
  }

  openItem(item: FeedItem) {
    this.api.markOpened(item.id).subscribe();
    this.items.update((items) =>
      items.map((i) => (i.id === item.id ? { ...i, opened: true } : i)),
    );

    try {
      const electronApi = (window as any).electron;
      if (electronApi?.openExternal) {
        electronApi.openExternal(item.url);
      } else {
        window.open(item.url, '_blank');
      }
    } catch {
      window.open(item.url, '_blank');
    }
  }
}
