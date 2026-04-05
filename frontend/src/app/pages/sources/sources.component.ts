import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProfileService, ProfileSource } from '../../services/profile.service';
import { ApiService } from '../../services/api.service';
import { DesktopButtonComponent } from '../../creamsicle-desktop';

type Platform = 'twitter' | 'reddit' | 'youtube' | 'tiktok' | 'web';

interface PlatformTab {
  key: Platform;
  label: string;
  sourceType: string;
  placeholder: string;
  namePlaceholder?: string;
  needsName: boolean;
}

@Component({
  selector: 'app-sources',
  standalone: true,
  imports: [CommonModule, FormsModule, DesktopButtonComponent],
  templateUrl: './sources.component.html',
  styleUrl: './sources.component.scss',
})
export class SourcesComponent {
  private profileService = inject(ProfileService);
  private api = inject(ApiService);

  loading = signal(false);
  sources = signal<ProfileSource[]>([]);
  activeTab = signal<Platform>('reddit');
  addValue = signal('');
  addName = signal('');

  readonly platforms: PlatformTab[] = [
    { key: 'reddit', label: 'Reddit', sourceType: 'subreddit', placeholder: 'e.g. technology', needsName: false },
    { key: 'twitter', label: 'Twitter', sourceType: 'account', placeholder: 'e.g. @elonmusk', needsName: false },
    { key: 'youtube', label: 'YouTube', sourceType: 'channel', placeholder: 'Channel ID', namePlaceholder: 'Channel name', needsName: true },
    { key: 'web', label: 'RSS', sourceType: 'feed', placeholder: 'Feed URL', namePlaceholder: 'Feed name', needsName: true },
    { key: 'tiktok', label: 'TikTok', sourceType: 'account', placeholder: 'e.g. @username', needsName: false },
  ];

  readonly activePlatform = computed(() =>
    this.platforms.find((p) => p.key === this.activeTab())!,
  );

  readonly sourcesForTab = computed(() =>
    this.sources().filter((s) => s.platform === this.activeTab()),
  );

  readonly platformCounts = computed(() => {
    const counts: Record<string, number> = {};
    for (const p of this.platforms) {
      counts[p.key] = this.sources().filter((s) => s.platform === p.key).length;
    }
    return counts;
  });

  readonly profileId = computed(() => this.profileService.activeProfileId());
  readonly hasProfile = computed(() => !!this.profileId());

  ngOnInit() {
    this.loadSources();
  }

  loadSources() {
    const pid = this.profileId();
    if (!pid) return;
    this.loading.set(true);
    this.api.getProfileSources(pid).subscribe({
      next: (sources) => {
        this.sources.set(sources);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  switchTab(platform: Platform) {
    this.activeTab.set(platform);
    this.addValue.set('');
    this.addName.set('');
  }

  addSource() {
    const pid = this.profileId();
    const tab = this.activePlatform();
    const value = this.addValue().trim();
    if (!pid || !value) return;

    const name = tab.needsName ? this.addName().trim() || value : value;
    const cleanValue = tab.key === 'twitter' || tab.key === 'tiktok'
      ? value.replace(/^@/, '')
      : value;

    this.api.addProfileSource(pid, {
      platform: tab.key,
      sourceType: tab.sourceType,
      name,
      value: cleanValue,
    }).subscribe({
      next: (updated) => {
        this.sources.set(updated);
        this.addValue.set('');
        this.addName.set('');
      },
    });
  }

  removeSource(source: ProfileSource) {
    const pid = this.profileId();
    if (!pid) return;
    this.api.removeProfileSource(pid, source.id).subscribe({
      next: () => {
        this.sources.update((list) => list.filter((s) => s.id !== source.id));
      },
    });
  }

  toggleSource(source: ProfileSource) {
    const pid = this.profileId();
    if (!pid) return;
    const newEnabled = !source.enabled;
    this.api.toggleProfileSource(pid, source.id, newEnabled).subscribe({
      next: () => {
        this.sources.update((list) =>
          list.map((s) => s.id === source.id ? { ...s, enabled: newEnabled } : s),
        );
      },
    });
  }
}
