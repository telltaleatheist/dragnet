import { Component, inject } from '@angular/core';
import { FeedStoreService } from '../../../../services/feed-store.service';

@Component({
  selector: 'term-set-panel',
  standalone: true,
  templateUrl: './term-set-panel.component.html',
  styleUrl: './term-set-panel.component.scss',
})
export class TermSetPanelComponent {
  store = inject(FeedStoreService);

  get profileTopicCount(): number {
    return this.store.profileTerms()?.topics.length ?? 0;
  }

  get profileFigureCount(): number {
    return this.store.profileTerms()?.figures.length ?? 0;
  }

  resolvedCount(set: { topics: string[]; figures: string[]; suggestions: { text: string; enabled: boolean }[] }): number {
    return set.topics.length + set.figures.length + set.suggestions.filter((s) => s.enabled).length;
  }
}
