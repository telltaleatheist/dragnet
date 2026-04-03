import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FeedStoreService } from '../../../services/feed-store.service';
import { FeedItemComponent } from '../feed-item/feed-item.component';
import { FeedItem, StoryCluster } from '../../../models/feed.model';

@Component({
  selector: 'app-curated-view',
  standalone: true,
  imports: [CommonModule, FeedItemComponent],
  templateUrl: './curated-view.component.html',
  styleUrl: './curated-view.component.scss',
})
export class CuratedViewComponent {
  store = inject(FeedStoreService);

  expandedClusters = signal<Set<string>>(new Set());

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

  onDismiss(item: FeedItem) {
    this.store.dismissItem(item.id);
  }

  onBookmark(item: FeedItem) {
    if (item.bookmarked) {
      this.store.unbookmarkItem(item.id);
    } else {
      this.store.bookmarkItem(item.id);
    }
  }

  onOpen(item: FeedItem) {
    this.store.openItem(item);
  }

  onBookmarkCluster(cluster: StoryCluster) {
    this.store.bookmarkCluster(cluster.id);
  }
}
