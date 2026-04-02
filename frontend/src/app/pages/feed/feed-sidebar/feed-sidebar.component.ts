import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FeedStoreService } from '../../../services/feed-store.service';

interface FilterOption {
  label: string;
  value: string | undefined;
  icon?: string;
}

@Component({
  selector: 'app-feed-sidebar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './feed-sidebar.component.html',
  styleUrl: './feed-sidebar.component.scss',
})
export class FeedSidebarComponent {
  store = inject(FeedStoreService);

  views: FilterOption[] = [
    { label: 'All Items', value: undefined, icon: '📋' },
    { label: 'Curated', value: 'curated', icon: '◆' },
    { label: 'Bookmarked', value: 'bookmarked', icon: '★' },
    { label: 'Dismissed', value: 'dismissed', icon: '✕' },
  ];

  platforms: FilterOption[] = [
    { label: 'All Platforms', value: undefined },
    { label: 'Twitter / X', value: 'twitter', icon: '𝕏' },
    { label: 'Reddit', value: 'reddit', icon: '⬡' },
    { label: 'YouTube', value: 'youtube', icon: '▶' },
    { label: 'Web / RSS', value: 'web', icon: '🌐' },
  ];

  contentTypes: FilterOption[] = [
    { label: 'All Types', value: undefined },
    { label: 'Video', value: 'video', icon: '🎬' },
    { label: 'Text', value: 'text', icon: '📝' },
    { label: 'Article', value: 'article', icon: '📰' },
    { label: 'Image', value: 'image', icon: '🖼' },
  ];

  activePlatform: string | undefined = undefined;
  activeContentType: string | undefined = undefined;

  setView(option: FilterOption) {
    this.store.activeView.set(option.value);
    if (option.value === 'curated') {
      this.store.updateFilters({ minScore: 1, bookmarked: false, dismissed: false });
    } else if (option.value === 'bookmarked') {
      this.store.updateFilters({ minScore: undefined, bookmarked: true, dismissed: false });
    } else if (option.value === 'dismissed') {
      this.store.updateFilters({ minScore: undefined, bookmarked: false, dismissed: true });
    } else {
      this.store.updateFilters({ minScore: undefined, bookmarked: false, dismissed: false });
    }
  }

  setPlatform(option: FilterOption) {
    this.activePlatform = option.value;
    this.store.updateFilters({ platform: option.value });
  }

  setContentType(option: FilterOption) {
    this.activeContentType = option.value;
    this.store.updateFilters({ contentType: option.value });
  }
}
