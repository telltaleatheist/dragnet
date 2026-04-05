import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FeedStoreService } from '../../../services/feed-store.service';
import { FeedItemComponent } from '../feed-item/feed-item.component';
import { FeedItem, StoryCluster } from '../../../models/feed.model';

@Component({
  selector: 'app-curated-view',
  standalone: true,
  imports: [CommonModule, FormsModule, FeedItemComponent],
  templateUrl: './curated-view.component.html',
  styleUrl: './curated-view.component.scss',
})
export class CuratedViewComponent {
  store = inject(FeedStoreService);

  expandedClusters = signal<Set<string>>(new Set());
  dragItemId: string | null = null;
  dragFromClusterId: string | null = null;
  dragFromIndex: number | null = null;
  dragOverClusterId: string | null = null;
  dragOverIndex: number | null = null;

  isExpanded(clusterId: string): boolean {
    return this.expandedClusters().has(clusterId);
  }

  toggleCluster(clusterId: string) {
    this.expandedClusters.update((set) => {
      const next = new Set(set);
      if (next.has(clusterId)) {
        next.delete(clusterId);
      } else {
        next.add(clusterId);
      }
      return next;
    });
  }

  getScoreBadgeClass(score: number): string {
    if (score >= 8) return 'score-high';
    if (score >= 5) return 'score-medium';
    return 'score-low';
  }

  getClusterAge(cluster: StoryCluster): string {
    const dates = cluster.items
      .map((i) => i.publishedAt ? new Date(i.publishedAt).getTime() : 0)
      .filter((t) => t > 0);

    if (dates.length === 0) return '';

    const newest = Math.max(...dates);
    const oldest = Math.min(...dates);
    const now = Date.now();
    const newestDate = new Date(newest);
    const oldestDate = new Date(oldest);

    const daysAgo = Math.floor((now - newest) / 86_400_000);
    const spanDays = Math.floor((newest - oldest) / 86_400_000);

    const fmtFull = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    // Age label for the most recent item
    let age: string;
    if (daysAgo === 0) age = 'today';
    else if (daysAgo === 1) age = 'yesterday';
    else if (daysAgo < 7) age = `${daysAgo}d ago`;
    else age = fmtFull(newestDate);

    // If items span multiple days, show range with year
    if (spanDays > 0) {
      const sameYear = oldestDate.getFullYear() === newestDate.getFullYear();
      if (sameYear) {
        const fmtShort = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return `${fmtShort(oldestDate)} – ${fmtFull(newestDate)}`;
      }
      return `${fmtFull(oldestDate)} – ${fmtFull(newestDate)}`;
    }
    return age;
  }

  getClusterAgeClass(cluster: StoryCluster): string {
    const dates = cluster.items
      .map((i) => i.publishedAt ? new Date(i.publishedAt).getTime() : 0)
      .filter((t) => t > 0);

    if (dates.length === 0) return 'age-old';

    const newest = Math.max(...dates);
    const daysAgo = Math.floor((Date.now() - newest) / 86_400_000);

    if (daysAgo <= 1) return 'age-fresh';
    if (daysAgo <= 7) return 'age-recent';
    return 'age-old';
  }

  onDismiss(item: FeedItem) {
    this.store.dismissItem(item.id);
  }

  onBookmark(item: FeedItem, cluster?: StoryCluster) {
    if (item.bookmarked) {
      this.store.unbookmarkItem(item.id);
    } else {
      this.store.bookmarkItem(item.id, cluster?.title, cluster?.summary);
    }
  }

  onOpen(item: FeedItem) {
    this.store.openItem(item);
  }

  onBookmarkCluster(cluster: StoryCluster) {
    this.store.bookmarkCluster(cluster.id);
  }

  onRemoveCluster(cluster: StoryCluster) {
    this.store.removeCluster(cluster.id);
  }

  // --- Drag and drop ---

  onDragStart(event: DragEvent, item: FeedItem, cluster: StoryCluster, index: number) {
    this.dragItemId = item.id;
    this.dragFromClusterId = cluster.id;
    this.dragFromIndex = index;
    event.dataTransfer?.setData('text/plain', item.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  onDragEnd() {
    this.dragItemId = null;
    this.dragFromClusterId = null;
    this.dragFromIndex = null;
    this.dragOverClusterId = null;
    this.dragOverIndex = null;
  }

  /** Drop on a collapsed cluster header — move item between clusters */
  onDragOver(event: DragEvent, cluster: StoryCluster) {
    if (this.dragFromClusterId && this.dragFromClusterId !== cluster.id) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      this.dragOverClusterId = cluster.id;
    }
  }

  onDragLeave(cluster: StoryCluster) {
    if (this.dragOverClusterId === cluster.id) {
      this.dragOverClusterId = null;
      this.dragOverIndex = null;
    }
  }

  onDrop(event: DragEvent, toCluster: StoryCluster) {
    event.preventDefault();
    this.dragOverClusterId = null;
    this.dragOverIndex = null;
    if (this.dragItemId && this.dragFromClusterId && this.dragFromClusterId !== toCluster.id) {
      this.store.moveItemBetweenClusters(this.dragFromClusterId, this.dragItemId, toCluster.id);
    }
    this.dragItemId = null;
    this.dragFromClusterId = null;
    this.dragFromIndex = null;
  }

  /** Drop on a specific item row — reorder within cluster or move between clusters */
  onItemDragOver(event: DragEvent, cluster: StoryCluster, index: number) {
    if (!this.dragItemId) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    this.dragOverClusterId = cluster.id;
    this.dragOverIndex = index;
  }

  onItemDrop(event: DragEvent, toCluster: StoryCluster, toIndex: number) {
    event.preventDefault();
    event.stopPropagation();
    this.dragOverClusterId = null;
    this.dragOverIndex = null;

    if (!this.dragItemId || !this.dragFromClusterId) return;

    if (this.dragFromClusterId === toCluster.id) {
      // Reorder within same cluster
      if (this.dragFromIndex !== null && this.dragFromIndex !== toIndex) {
        this.store.reorderClusterItem(toCluster.id, this.dragFromIndex, toIndex);
      }
    } else {
      // Move between clusters
      this.store.moveItemBetweenClusters(this.dragFromClusterId, this.dragItemId, toCluster.id);
    }

    this.dragItemId = null;
    this.dragFromClusterId = null;
    this.dragFromIndex = null;
  }
}
