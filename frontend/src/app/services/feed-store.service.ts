import { Injectable, signal, computed, inject } from '@angular/core';
import { ApiService } from './api.service';
import { FeedItem, FeedFilters, ScanProgressEvent } from '../models/feed.model';

interface ScoringProgress {
  batch: number;
  totalBatches: number;
  itemsScored: number;
}

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
  readonly scoringProgress = signal<ScoringProgress | null>(null);
  readonly lastScanTime = signal<string | null>(null);

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
    // Subscribe to WebSocket events
    this.api.scanStarted$.subscribe(() => {
      this.scanRunning.set(true);
      this.scanProgress.set(null);
    });

    this.api.scanProgress$.subscribe((event) => {
      this.scanProgress.set(event);
    });

    this.api.scanComplete$.subscribe((event) => {
      this.scanRunning.set(false);
      this.scanProgress.set(null);
      this.scoringProgress.set(null);
      this.lastScanTime.set(new Date().toLocaleTimeString());
      this.loadFeed();
    });

    this.api.scanScoring$.subscribe((event) => {
      this.scoringProgress.set(event);
    });

    this.api.scanError$.subscribe(() => {
      this.scanRunning.set(false);
    });

    this.api.curateStarted$.subscribe(() => {
      this.curateRunning.set(true);
      this.scoringProgress.set(null);
    });

    this.api.curateComplete$.subscribe(() => {
      this.curateRunning.set(false);
      this.scoringProgress.set(null);
      this.loadFeed();
    });

    this.api.feedUpdated$.subscribe(() => {
      this.loadFeed();
    });

    // Initial load
    this.loadFeed();
    this.loadScanStatus();
  }

  loadFeed() {
    this.loading.set(true);
    this.api.getFeed(this.filters()).subscribe({
      next: (response) => {
        this.items.set(response.items);
        this.totalItems.set(response.total);
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Failed to load feed:', err);
        this.loading.set(false);
      },
    });
  }

  loadScanStatus() {
    this.api.getScanStatus().subscribe({
      next: (status) => {
        this.scanRunning.set(status.running);
        if (status.lastScan?.completed_at) {
          this.lastScanTime.set(
            new Date(status.lastScan.completed_at).toLocaleTimeString(),
          );
        }
      },
      error: () => {},
    });
  }

  triggerScan() {
    if (this.scanRunning() || this.curateRunning()) return;
    this.api.triggerScan().subscribe({
      next: () => {
        this.scanRunning.set(true);
      },
      error: (err) => console.error('Failed to trigger scan:', err),
    });
  }

  triggerCurate() {
    if (this.scanRunning() || this.curateRunning()) return;
    this.api.triggerCurate().subscribe({
      next: () => {
        this.curateRunning.set(true);
      },
      error: (err) => console.error('Failed to trigger curation:', err),
    });
  }

  updateFilters(partial: Partial<FeedFilters>) {
    this.filters.update((current) => ({
      ...current,
      ...partial,
      page: partial.page ?? 1, // Reset to page 1 on filter change unless explicit
    }));
    this.loadFeed();
  }

  nextPage() {
    if (!this.hasMore()) return;
    this.filters.update((f) => ({ ...f, page: f.page + 1 }));
    this.loadFeed();
  }

  prevPage() {
    if (this.filters().page <= 1) return;
    this.filters.update((f) => ({ ...f, page: f.page - 1 }));
    this.loadFeed();
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
      this.items.update((items) =>
        items.map((i) => (i.id === id ? { ...i, bookmarked: false } : i)),
      );
    });
  }

  openItem(item: FeedItem) {
    this.api.markOpened(item.id).subscribe();
    this.items.update((items) =>
      items.map((i) => (i.id === item.id ? { ...i, opened: true } : i)),
    );

    // Open in external browser
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
