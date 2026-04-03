import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FeedStoreService } from '../../services/feed-store.service';
import { FeedItem } from '../../models/feed.model';
import { FeedItemComponent } from './feed-item/feed-item.component';
import { FeedSidebarComponent } from './feed-sidebar/feed-sidebar.component';
import { CuratedViewComponent } from './curated-view/curated-view.component';
import { SplitPaneComponent } from '../../creamsicle-desktop';

@Component({
  selector: 'app-feed',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    FeedItemComponent,
    FeedSidebarComponent,
    CuratedViewComponent,
    SplitPaneComponent,
  ],
  templateUrl: './feed.component.html',
  styleUrl: './feed.component.scss',
})
export class FeedComponent {
  store = inject(FeedStoreService);
  showInstructions = false;

  viewLabel = computed(() => {
    const view = this.store.activeView();
    switch (view) {
      case 'curated': return 'Curated';
      case 'bookmarked': return 'Bookmarked';
      default: return 'All Items';
    }
  });

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
}
