import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../../../shared/modal/modal.component';
import { FeedStoreService } from '../../../services/feed-store.service';
import { ScanTabComponent } from './scan-tab.component';
import { AdvancedSearchComponent } from '../advanced-search/advanced-search.component';
import { BrowserAssistComponent } from '../browser-assist/browser-assist.component';
import { TermSetPanelComponent } from './term-set-panel/term-set-panel.component';
import { TermBuilderComponent, TermBuilderResult } from './term-builder/term-builder.component';

@Component({
  selector: 'retrieve-data-modal',
  standalone: true,
  imports: [
    FormsModule,
    ModalComponent,
    ScanTabComponent,
    AdvancedSearchComponent,
    BrowserAssistComponent,
    TermSetPanelComponent,
    TermBuilderComponent,
  ],
  templateUrl: './retrieve-data-modal.component.html',
  styleUrl: './retrieve-data-modal.component.scss',
})
export class RetrieveDataModalComponent {
  store = inject(FeedStoreService);
  activeTab = signal<'scan' | 'search' | 'browser-assist'>('scan');

  toggleAdversarial() {
    this.store.adversarial.update((v) => !v);
  }

  toggleVideoOnly() {
    this.store.videoOnly.update((v) => !v);
  }

  close() {
    this.store.retrieveModalOpen.set(false);
    this.store.editingTermSet.set(false);
  }

  onStarted() {
    this.close();
  }

  onTermSetSaved(data: TermBuilderResult) {
    this.store.createTermSet(data);
  }

  get activeTermLabel(): string {
    const set = this.store.activeTermSet();
    return set ? `"${set.name}"` : '"Profile Default"';
  }
}
