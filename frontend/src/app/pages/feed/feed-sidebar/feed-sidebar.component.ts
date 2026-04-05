import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FeedStoreService, ActiveView } from '../../../services/feed-store.service';

interface ViewOption {
  label: string;
  value: ActiveView;
  icon: string;
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

  views: ViewOption[] = [
    { label: 'All Items', value: 'all', icon: '&#9776;' },
    { label: 'Curated', value: 'curated', icon: '&#9670;' },
    { label: 'Bookmarked', value: 'bookmarked', icon: '&#9733;' },
  ];

  expandedStoreId = signal<string | null>(null);

  setView(view: ViewOption) {
    this.store.switchView(view.value);
  }

  selectBookmarkCluster(title: string) {
    // Switch to bookmarked view if not already there
    if (this.store.activeView() !== 'bookmarked') {
      this.store.switchView('bookmarked');
    }
    this.store.selectBookmarkCluster(title);
  }

  isStoreChecked(id: string): boolean {
    return this.store.checkedStoreIds().has(id);
  }

  toggleStore(id: string) {
    this.store.toggleStore(id);
  }

  removeStore(id: string) {
    this.store.removeStore(id);
  }

  storeTypeIcon(type: string): string {
    switch (type) {
      case 'scan': return '&#x1F4E1;';
      case 'search': return '&#x1F50E;';
      case 'browser-assist': return '&#x1F310;';
      case 'snapshot': return '&#x1F4BE;';
      default: return '&#x1F4C1;';
    }
  }

  toggleStoreExpansion(id: string) {
    this.expandedStoreId.update((current) => current === id ? null : id);
  }

  reuseStoreTerms(terms: string[]) {
    this.store.createTermSetFromTerms(terms);
  }
}
