import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DiscoveredSource } from '../../../../../services/profile.service';
import { DesktopButtonComponent } from '../../../../../creamsicle-desktop';

@Component({
  selector: 'step-sources',
  standalone: true,
  imports: [CommonModule, DesktopButtonComponent],
  templateUrl: './step-sources.component.html',
  styleUrl: './step-sources.component.scss',
})
export class StepSourcesComponent {
  @Input() profileId!: string;
  @Input() sources: DiscoveredSource[] = [];
  @Output() complete = new EventEmitter<void>();
  @Output() back = new EventEmitter<void>();

  localSources = signal<DiscoveredSource[]>([]);
  activeTab = signal<string>('reddit');

  readonly platforms = [
    { key: 'reddit', label: 'Reddit' },
    { key: 'twitter', label: 'Twitter' },
    { key: 'youtube', label: 'YouTube' },
    { key: 'web', label: 'RSS' },
    { key: 'tiktok', label: 'TikTok' },
  ];

  ngOnInit() {
    this.localSources.set([...this.sources]);
    // Set active tab to first platform with sources
    const firstWithSources = this.platforms.find(
      (p) => this.sourcesForPlatform(p.key).length > 0,
    );
    if (firstWithSources) {
      this.activeTab.set(firstWithSources.key);
    }
  }

  sourcesForPlatform(platform: string): DiscoveredSource[] {
    return this.localSources().filter((s) => s.platform === platform);
  }

  platformCount(platform: string): number {
    return this.sourcesForPlatform(platform).length;
  }

  removeSource(source: DiscoveredSource) {
    this.localSources.update((list) =>
      list.filter((s) => !(s.platform === source.platform && s.value === source.value)),
    );
  }

  proceed() {
    this.complete.emit();
  }
}
