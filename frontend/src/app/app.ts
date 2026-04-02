import { Component, OnInit, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import {
  WindowChromeComponent,
  StatusBarComponent,
  StatusBarItem,
  DesktopButtonComponent,
  DesktopThemeService,
} from './creamsicle-desktop';
import { FeedStoreService } from './services/feed-store.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    WindowChromeComponent,
    StatusBarComponent,
    DesktopButtonComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  themeService = inject(DesktopThemeService);
  feedStore = inject(FeedStoreService);

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
    const scoring = this.feedStore.scoringProgress();
    if (scoring) {
      return `Scoring batch ${scoring.batch}/${scoring.totalBatches}...`;
    }
    if (this.feedStore.curateRunning()) {
      return 'Curating...';
    }
    if (this.feedStore.scanRunning()) {
      const progress = this.feedStore.scanProgress();
      if (progress) {
        return `Scanning ${progress.source} (${progress.current}/${progress.total})...`;
      }
      return 'Scanning...';
    }
    return 'Ready';
  });

  ngOnInit() {
    this.themeService.initializeTheme();
  }

  toggleTheme() {
    this.themeService.toggleTheme();
  }

  triggerScan() {
    this.feedStore.triggerScan();
  }

  triggerCurate() {
    this.feedStore.triggerCurate();
  }
}
