import { Component, ElementRef, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FeedStoreService } from '../../../services/feed-store.service';
import { FeedItemComponent } from '../feed-item/feed-item.component';
import { FeedItem, BookmarkedClusterDetail } from '../../../models/feed.model';

@Component({
  selector: 'app-bookmarked-view',
  standalone: true,
  imports: [CommonModule, FeedItemComponent],
  templateUrl: './bookmarked-view.component.html',
  styleUrl: './bookmarked-view.component.scss',
})
export class BookmarkedViewComponent {
  store = inject(FeedStoreService);
  private host = inject(ElementRef<HTMLElement>);

  // Track which clusters are expanded (collapsed by default)
  expandedClusters = signal<Set<string>>(new Set());

  dragItemId: string | null = null;
  dragFromClusterTitle: string | null = null;
  dragOverClusterTitle: string | null = null;

  constructor() {
    // When sidebar selects a bookmark cluster, expand and scroll it into view
    effect(() => {
      const selected = this.store.selectedBookmarkCluster();
      if (!selected) return;
      this.expandedClusters.update((set) => {
        const next = new Set(set);
        next.add(selected);
        return next;
      });
      queueMicrotask(() => {
        const el = this.host.nativeElement.querySelector(
          `[data-cluster-title="${CSS.escape(selected)}"]`,
        );
        if (el) (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  isExpanded(title: string): boolean {
    return this.expandedClusters().has(title);
  }

  toggleCluster(title: string) {
    this.expandedClusters.update((set) => {
      const next = new Set(set);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  }

  clusterAge(cluster: BookmarkedClusterDetail): string {
    const dates = cluster.items
      .map((i) => (i.publishedAt ? new Date(i.publishedAt).getTime() : 0))
      .filter((t) => t > 0);
    if (dates.length === 0) return '';
    const newest = Math.max(...dates);
    const oldest = Math.min(...dates);
    const daysAgo = Math.floor((Date.now() - newest) / 86_400_000);
    const spanDays = Math.floor((newest - oldest) / 86_400_000);
    const fmtFull = (d: Date) =>
      d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const fmtShort = (d: Date) =>
      d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (spanDays > 0) {
      const o = new Date(oldest);
      const n = new Date(newest);
      if (o.getFullYear() === n.getFullYear()) {
        return `${fmtShort(o)} – ${fmtFull(n)}`;
      }
      return `${fmtFull(o)} – ${fmtFull(n)}`;
    }
    if (daysAgo === 0) return 'today';
    if (daysAgo === 1) return 'yesterday';
    if (daysAgo < 7) return `${daysAgo}d ago`;
    return fmtFull(new Date(newest));
  }

  onDismiss(item: FeedItem) {
    this.store.dismissItem(item.id);
  }

  onBookmark(item: FeedItem) {
    // In bookmarked view, clicking star always unbookmarks
    this.store.unbookmarkItem(item.id);
  }

  onOpen(item: FeedItem) {
    this.store.openItem(item);
  }

  // --- Drag and drop between clusters ---

  onDragStart(event: DragEvent, item: FeedItem, fromTitle: string) {
    this.dragItemId = item.id;
    this.dragFromClusterTitle = fromTitle;
    event.dataTransfer?.setData('text/plain', item.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  onDragEnd() {
    this.dragItemId = null;
    this.dragFromClusterTitle = null;
    this.dragOverClusterTitle = null;
  }

  onDragOver(event: DragEvent, cluster: BookmarkedClusterDetail) {
    if (this.dragFromClusterTitle && this.dragFromClusterTitle !== cluster.clusterTitle) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      this.dragOverClusterTitle = cluster.clusterTitle;
    }
  }

  onDragLeave(cluster: BookmarkedClusterDetail) {
    if (this.dragOverClusterTitle === cluster.clusterTitle) {
      this.dragOverClusterTitle = null;
    }
  }

  onDrop(event: DragEvent, toCluster: BookmarkedClusterDetail) {
    event.preventDefault();
    this.dragOverClusterTitle = null;
    if (
      this.dragItemId &&
      this.dragFromClusterTitle &&
      this.dragFromClusterTitle !== toCluster.clusterTitle
    ) {
      this.store.moveBookmarkToCluster(
        this.dragItemId,
        toCluster.clusterTitle,
        toCluster.clusterSummary ?? undefined,
      );
    }
    this.dragItemId = null;
    this.dragFromClusterTitle = null;
  }
}
