import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AiSettingsComponent } from './ai-settings/ai-settings.component';
import { SourcesSettingsComponent } from './sources-settings/sources-settings.component';

type SettingsTab = 'ai' | 'scan' | 'sources' | 'data';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, AiSettingsComponent, SourcesSettingsComponent],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent implements OnInit {
  private api = inject(ApiService);

  activeTab = signal<SettingsTab>('ai');
  config = signal<any>(null);
  saving = signal(false);

  tabs: { id: SettingsTab; label: string; icon: string }[] = [
    { id: 'ai', label: 'AI Provider', icon: '🤖' },
    { id: 'scan', label: 'Scanning', icon: '🔍' },
    { id: 'sources', label: 'Sources', icon: '🔌' },
    { id: 'data', label: 'Data', icon: '💾' },
  ];

  // Scan settings
  requestDelayMs = 2500;
  maxResultsPerSource = 20;
  autoScanIntervalMinutes = 120;
  maxItemAgeDays = 7;
  minScoreToShow = 1;

  // Data stats
  totalItems = signal(0);

  ngOnInit() {
    this.loadConfig();
    this.loadStats();
  }

  loadConfig() {
    this.api.getConfig().subscribe({
      next: (config) => {
        this.config.set(config);
        this.requestDelayMs = config.settings.requestDelayMs;
        this.maxResultsPerSource = config.settings.maxResultsPerSource;
        this.autoScanIntervalMinutes = config.settings.autoScanIntervalMinutes;
        this.maxItemAgeDays = config.settings.maxItemAgeDays;
        this.minScoreToShow = config.settings.minScoreToShow;
      },
    });
  }

  loadStats() {
    this.api.getFeedStats().subscribe({
      next: (stats) => this.totalItems.set(stats.totalItems),
    });
  }

  saveScanSettings() {
    this.saving.set(true);
    this.api.updateConfig({
      settings: {
        requestDelayMs: this.requestDelayMs,
        maxResultsPerSource: this.maxResultsPerSource,
        autoScanIntervalMinutes: this.autoScanIntervalMinutes,
        maxItemAgeDays: this.maxItemAgeDays,
        minScoreToShow: this.minScoreToShow,
        autoScanEnabled: false,
        feedPageSize: 20,
      },
    }).subscribe({
      next: () => this.saving.set(false),
      error: () => this.saving.set(false),
    });
  }
}
