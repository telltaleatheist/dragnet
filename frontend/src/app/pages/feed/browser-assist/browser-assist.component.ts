import { Component, inject, signal, Input, Output, EventEmitter } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../../../shared/modal/modal.component';
import { DesktopButtonComponent } from '../../../creamsicle-desktop';
import { ApiService } from '../../../services/api.service';
import { FeedStoreService } from '../../../services/feed-store.service';

interface PlatformOption {
  id: string;
  label: string;
  selected: boolean;
}

@Component({
  selector: 'browser-assist',
  standalone: true,
  imports: [NgTemplateOutlet, FormsModule, ModalComponent, DesktopButtonComponent],
  templateUrl: './browser-assist.component.html',
  styleUrl: './browser-assist.component.scss',
})
export class BrowserAssistComponent {
  private api = inject(ApiService);
  private feedStore = inject(FeedStoreService);

  @Input() embedded = false;
  @Output() started = new EventEmitter<void>();

  phase = signal<'generate' | 'import'>('generate');

  platforms = signal<PlatformOption[]>([
    { id: 'twitter', label: 'Twitter / X', selected: true },
    { id: 'reddit', label: 'Reddit', selected: true },
    { id: 'youtube', label: 'YouTube', selected: true },
    { id: 'tiktok', label: 'TikTok', selected: false },
    { id: 'instagram', label: 'Instagram', selected: false },
  ]);

  // Generate state
  generating = signal(false);
  generateError = signal('');
  prompts = signal<{ platform: string; prompt: string }[]>([]);
  copiedIndex = signal<number | null>(null);

  // Import state
  pasteText = '';
  importing = signal(false);
  importError = signal('');
  importResult = signal<{ imported: number; skipped: number } | null>(null);

  togglePlatform(i: number) {
    this.platforms.update((list) =>
      list.map((p, idx) => (idx === i ? { ...p, selected: !p.selected } : p)),
    );
  }

  generate() {
    const selected = this.platforms().filter((p) => p.selected).map((p) => p.id);
    if (selected.length === 0) return;

    this.generating.set(true);
    this.generateError.set('');
    this.prompts.set([]);

    const terms = this.feedStore.resolvedTerms();
    const searchTerms = terms.length > 0 ? terms : undefined;
    const videoOnly = this.feedStore.videoOnly();
    const adversarial = this.feedStore.adversarial();
    const maxAgeDays = this.feedStore.dateFilter() ?? undefined;
    this.api.generateBrowserAssistPrompts(selected, searchTerms, videoOnly, adversarial, maxAgeDays).subscribe({
      next: (res) => {
        this.prompts.set(res.prompts);
        this.generating.set(false);
      },
      error: (err) => {
        this.generateError.set('Failed to generate prompts. Check your AI settings.');
        this.generating.set(false);
        console.error('Generate prompts failed:', err);
      },
    });
  }

  copyPrompt(i: number) {
    const prompt = this.prompts()[i];
    if (!prompt) return;
    navigator.clipboard.writeText(prompt.prompt);
    this.copiedIndex.set(i);
    setTimeout(() => {
      if (this.copiedIndex() === i) this.copiedIndex.set(null);
    }, 2000);
  }

  switchToGenerate() {
    this.phase.set('generate');
  }

  switchToImport() {
    this.phase.set('import');
  }

  importUrls() {
    if (!this.pasteText.trim()) return;
    this.importing.set(true);
    this.importError.set('');
    this.importResult.set(null);

    this.api.importBrowserAssistUrls(this.pasteText).subscribe({
      next: (res) => {
        this.importResult.set(res);
        this.importing.set(false);
        // Reload feed with the new store and close modal
        this.feedStore.loadStores();
        this.feedStore.loadItems();
        this.feedStore.loadPlatformCounts();
        this.feedStore.closeRetrieveModal();
      },
      error: (err) => {
        this.importError.set('Failed to import URLs');
        this.importing.set(false);
        console.error('Import failed:', err);
      },
    });
  }

  close() {
    this.feedStore.closeRetrieveModal();
  }

  get selectedCount(): number {
    return this.platforms().filter((p) => p.selected).length;
  }
}
