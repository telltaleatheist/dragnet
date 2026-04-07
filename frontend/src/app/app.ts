import { Component, OnInit, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import {
  WindowChromeComponent,
  StatusBarComponent,
  StatusBarItem,
  DesktopButtonComponent,
  DesktopThemeService,
} from './creamsicle-desktop';
import { FeedStoreService } from './services/feed-store.service';
import { ProfileService } from './services/profile.service';
import { ProfileSelectorComponent } from './pages/profiles/profile-selector/profile-selector.component';
import { ProfileWizardComponent } from './pages/profiles/profile-wizard/profile-wizard.component';
import { RetrieveDataModalComponent } from './pages/feed/retrieve-data/retrieve-data-modal.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    WindowChromeComponent,
    StatusBarComponent,
    DesktopButtonComponent,
    ProfileSelectorComponent,
    ProfileWizardComponent,
    RetrieveDataModalComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  themeService = inject(DesktopThemeService);
  feedStore = inject(FeedStoreService);
  profileService = inject(ProfileService);
  quickSearchQuery = '';

  statusLeftItems = computed<StatusBarItem[]>(() => {
    const items: StatusBarItem[] = [
      { id: 'version', text: 'v1.0.0' },
    ];
    if (this.feedStore.lastScanTime()) {
      items.push({
        id: 'last-scan',
        text: `Last scan: ${this.feedStore.lastScanTime()}`,
      });
    }
    if (this.feedStore.totalItems() > 0) {
      items.push({
        id: 'item-count',
        text: `${this.feedStore.totalItems()} items`,
      });
    }
    return items;
  });

  statusRightItems: StatusBarItem[] = [
    { id: 'ai', text: 'Ollama' },
    { id: 'theme', text: 'Theme', clickable: true },
  ];

  statusCenterText = computed(() => {
    // Search progress
    if (this.feedStore.searchRunning()) {
      const searchProg = this.feedStore.searchProgress();
      if (searchProg) {
        const status = searchProg.status === 'complete'
          ? `${searchProg.itemsFound} found`
          : searchProg.status === 'error' ? 'error' : 'fetching';
        return `Searching: ${searchProg.source} — ${status} (${searchProg.current}/${searchProg.total})`;
      }
      return 'Searching...';
    }

    const progress = this.feedStore.curateProgress();
    if (progress) {
      if (progress.phase === 'scoring') {
        return progress.batch
          ? `AI scoring: batch ${progress.batch}/${progress.totalBatches} (${progress.itemsProcessed} scored)`
          : `AI scoring: ${progress.itemsProcessed}/${progress.totalItems} items`;
      }
      return `Clustering: ${progress.itemsProcessed}/${progress.totalItems} items`;
    }
    if (this.feedStore.curateRunning()) {
      return 'Curating: pre-filtering items...';
    }
    if (this.feedStore.scanRunning()) {
      const scanProg = this.feedStore.scanProgress();
      if (scanProg) {
        const status = scanProg.status === 'fetching'
          ? 'fetching'
          : scanProg.status === 'complete'
            ? `${scanProg.itemsFound} found`
            : 'error';
        return `Scanning: ${scanProg.source} — ${status} (${scanProg.current}/${scanProg.total})`;
      }
      return 'Scanning: starting...';
    }
    return '';
  });

  ngOnInit() {
    this.themeService.initializeTheme();
  }

  toggleTheme() {
    this.themeService.toggleTheme();
  }

  openRetrieveModal() {
    this.feedStore.openRetrieveModal();
  }

  cancelRetrieve() {
    if (this.feedStore.scanRunning()) {
      this.feedStore.cancelScan();
    }
    if (this.feedStore.searchRunning()) {
      this.feedStore.cancelSearch();
    }
  }

  triggerCurate() {
    this.feedStore.triggerCurate();
  }

  cancelCurate() {
    this.feedStore.cancelCurate();
  }

  toggleVideoOnly() {
    this.feedStore.videoOnly.update((v) => !v);
  }

  toggleAdversarial() {
    this.feedStore.adversarial.update((v) => !v);
  }

  setDateFilter(value: number | null) {
    this.feedStore.dateFilter.set(value);
  }

  runQuickSearch() {
    const q = this.quickSearchQuery.trim();
    if (!q) return;
    this.feedStore.triggerQuickSearch(q);
    this.quickSearchQuery = '';
  }
}
