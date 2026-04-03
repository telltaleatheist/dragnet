import { Component, inject } from '@angular/core';
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

  setView(view: ViewOption) {
    this.store.switchView(view.value);
  }
}
