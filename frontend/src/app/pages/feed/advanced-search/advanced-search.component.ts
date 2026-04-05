import { Component, inject, signal, Input, Output, EventEmitter } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../../../shared/modal/modal.component';
import { DesktopButtonComponent } from '../../../creamsicle-desktop';
import { ApiService } from '../../../services/api.service';
import { FeedStoreService } from '../../../services/feed-store.service';

interface Suggestion {
  text: string;
  enabled: boolean;
}

@Component({
  selector: 'advanced-search',
  standalone: true,
  imports: [NgTemplateOutlet, FormsModule, ModalComponent, DesktopButtonComponent],
  templateUrl: './advanced-search.component.html',
  styleUrl: './advanced-search.component.scss',
})
export class AdvancedSearchComponent {
  private api = inject(ApiService);
  store = inject(FeedStoreService);
  @Input() embedded = false;
  @Output() started = new EventEmitter<void>();

  suggestions = signal<Suggestion[]>([]);
  expanding = signal(false);
  expandError = signal('');

  // Local state for standalone topics/figures
  searchTopics = signal<string[]>([]);
  searchFigures = signal<string[]>([]);

  topicInput = '';
  figureInput = '';

  get totalTerms(): number {
    return this.searchTopics().length + this.searchFigures().length +
      this.suggestions().filter((s) => s.enabled).length;
  }

  addTopic() {
    const val = this.topicInput.trim();
    if (!val || this.searchTopics().includes(val)) return;
    this.searchTopics.update((t) => [...t, val]);
    this.topicInput = '';
  }

  removeTopic(i: number) {
    this.searchTopics.update((t) => t.filter((_, idx) => idx !== i));
  }

  addFigure() {
    const val = this.figureInput.trim();
    if (!val || this.searchFigures().includes(val)) return;
    this.searchFigures.update((f) => [...f, val]);
    this.figureInput = '';
  }

  removeFigure(i: number) {
    this.searchFigures.update((f) => f.filter((_, idx) => idx !== i));
  }

  expand() {
    if (this.searchTopics().length === 0 && this.searchFigures().length === 0) return;
    this.expanding.set(true);
    this.expandError.set('');
    this.api.suggestSearchTerms(this.searchTopics(), this.searchFigures()).subscribe({
      next: (res) => {
        this.suggestions.set(res.terms.map((t) => ({ text: t, enabled: true })));
        this.expanding.set(false);
      },
      error: (err) => {
        this.expandError.set('Failed to generate suggestions');
        this.expanding.set(false);
        console.error('AI expand failed:', err);
      },
    });
  }

  toggleSuggestion(i: number) {
    this.suggestions.update((s) =>
      s.map((item, idx) => idx === i ? { ...item, enabled: !item.enabled } : item),
    );
  }

  removeSuggestion(i: number) {
    this.suggestions.update((s) => s.filter((_, idx) => idx !== i));
  }

  /** Embedded mode: search using store's resolved terms */
  search() {
    this.store.triggerAdvancedSearch();
    this.started.emit();
  }

  /** Standalone mode: search using local topics/figures/suggestions */
  searchStandalone() {
    const terms = [
      ...this.searchTopics(),
      ...this.searchFigures(),
      ...this.suggestions().filter((s) => s.enabled).map((s) => s.text),
    ];
    if (terms.length === 0) return;
    this.store.triggerAdvancedSearch(terms);
    this.started.emit();
  }

  close() {
    this.store.closeRetrieveModal();
  }
}
