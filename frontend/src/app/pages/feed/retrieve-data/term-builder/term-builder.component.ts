import { Component, inject, signal, Output, EventEmitter } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DesktopButtonComponent } from '../../../../creamsicle-desktop';
import { ApiService } from '../../../../services/api.service';

interface Suggestion {
  text: string;
  enabled: boolean;
}

export interface TermBuilderResult {
  name: string;
  topics: string[];
  figures: string[];
  suggestions: Suggestion[];
}

@Component({
  selector: 'term-builder',
  standalone: true,
  imports: [FormsModule, DesktopButtonComponent],
  templateUrl: './term-builder.component.html',
  styleUrl: './term-builder.component.scss',
})
export class TermBuilderComponent {
  private api = inject(ApiService);

  @Output() saved = new EventEmitter<TermBuilderResult>();
  @Output() cancelled = new EventEmitter<void>();

  name = '';
  topics = signal<string[]>([]);
  figures = signal<string[]>([]);
  suggestions = signal<Suggestion[]>([]);
  expanding = signal(false);
  expandError = signal('');

  topicInput = '';
  figureInput = '';

  get totalTerms(): number {
    return this.topics().length + this.figures().length +
      this.suggestions().filter((s) => s.enabled).length;
  }

  addTopic() {
    const val = this.topicInput.trim();
    if (!val || this.topics().includes(val)) return;
    this.topics.update((t) => [...t, val]);
    this.topicInput = '';
  }

  removeTopic(i: number) {
    this.topics.update((t) => t.filter((_, idx) => idx !== i));
  }

  addFigure() {
    const val = this.figureInput.trim();
    if (!val || this.figures().includes(val)) return;
    this.figures.update((f) => [...f, val]);
    this.figureInput = '';
  }

  removeFigure(i: number) {
    this.figures.update((f) => f.filter((_, idx) => idx !== i));
  }

  expand() {
    if (this.topics().length === 0 && this.figures().length === 0) return;
    this.expanding.set(true);
    this.expandError.set('');
    this.api.suggestSearchTerms(this.topics(), this.figures()).subscribe({
      next: (res) => {
        this.suggestions.set(res.terms.map((t) => ({ text: t, enabled: true })));
        this.expanding.set(false);
      },
      error: () => {
        this.expandError.set('Failed to generate suggestions');
        this.expanding.set(false);
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

  save() {
    if (!this.name.trim() || this.totalTerms === 0) return;
    this.saved.emit({
      name: this.name.trim(),
      topics: this.topics(),
      figures: this.figures(),
      suggestions: this.suggestions(),
    });
  }

  cancel() {
    this.cancelled.emit();
  }
}
