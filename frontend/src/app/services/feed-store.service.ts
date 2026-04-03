import { Injectable, signal, computed, inject } from '@angular/core';
import { ApiService } from './api.service';
import {
  FeedItem,
  FeedFilters,
  ScanProgressEvent,
  StoryCluster,
  ClusteringProgressEvent,
  CurateCompleteEvent,
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

  constructor() {
    this.api.scanStarted$.subscribe(() => {
      this.scanProgress.set(null);
    });

    this.api.scanProgress$.subscribe((event) => {
      this.scanProgress.set(event);
    });

    this.api.scanComplete$.subscribe(() => {
      this.scanRunning.set(false);
      this.scanProgress.set(null);
      this.lastScanTime.set(new Date().toLocaleTimeString());
      if (this.activeView() === 'all') {
        this.loadItems();
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

    this.api.feedUpdated$.subscribe(() => {
      if (this.activeView() === 'all') {
        this.loadItems();
      }
    });

    // Initial load
    this.loadItems();
    this.loadScanStatus();
  }

  switchView(view: ActiveView) {
    this.activeView.set(view);
    this.filters.update((f) => ({ ...f, page: 1, search: undefined }));
    switch (view) {
      case 'all':
        this.loadItems();
        break;
      case 'curated':
        this.loadCurated();
        break;
      case 'bookmarked':
        this.loadBookmarks();
        break;
    }
  }

  loadItems() {
    this.loading.set(true);
    this.api.getItems(this.filters()).subscribe({
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
    this.api.getCurated().subscribe({
      next: (response) => {
        this.clusters.set(response.clusters);
        // Also set flat items for total count
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
    this.api.getBookmarks(this.filters()).subscribe({
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

  loadScanStatus() {
    this.api.getScanStatus().subscribe({
      next: (status) => {
        this.scanRunning.set(status.scanning);
      },
      error: () => {},
    });
  }

  triggerScan() {
    if (this.scanRunning() || this.curateRunning()) return;
    this.scanRunning.set(true);
    this.api.triggerScan().subscribe({
      error: (err) => {
        this.scanRunning.set(false);
        console.error('Failed to trigger scan:', err);
      },
    });
  }

  triggerCurate() {
    if (this.scanRunning() || this.curateRunning()) return;
    this.curateRunning.set(true);
    this.lastCurateResult.set(null);
    const instructions = this.customInstructions().trim() || undefined;
    this.api.triggerCurate(instructions).subscribe({
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
    else if (view === 'bookmarked') this.loadBookmarks();
  }

  nextPage() {
    if (!this.hasMore()) return;
    this.filters.update((f) => ({ ...f, page: f.page + 1 }));
    const view = this.activeView();
    if (view === 'all') this.loadItems();
    else if (view === 'bookmarked') this.loadBookmarks();
  }

  prevPage() {
    if (this.filters().page <= 1) return;
    this.filters.update((f) => ({ ...f, page: f.page - 1 }));
    const view = this.activeView();
    if (view === 'all') this.loadItems();
    else if (view === 'bookmarked') this.loadBookmarks();
  }

  dismissItem(id: string) {
    this.api.dismissItem(id).subscribe(() => {
      this.items.update((items) => items.filter((i) => i.id !== id));
      this.totalItems.update((n) => n - 1);
    });
  }

  bookmarkItem(id: string) {
    this.api.bookmarkItem(id).subscribe(() => {
      this.items.update((items) =>
        items.map((i) => (i.id === id ? { ...i, bookmarked: true } : i)),
      );
    });
  }

  unbookmarkItem(id: string) {
    this.api.unbookmarkItem(id).subscribe(() => {
      if (this.activeView() === 'bookmarked') {
        this.items.update((items) => items.filter((i) => i.id !== id));
        this.totalItems.update((n) => n - 1);
      } else {
        this.items.update((items) =>
          items.map((i) => (i.id === id ? { ...i, bookmarked: false } : i)),
        );
      }
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
