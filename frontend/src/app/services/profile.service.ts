import { Injectable, signal, inject } from '@angular/core';
import { ApiService } from './api.service';

export interface ProfileSummary {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt?: string;
  isOnboarded: boolean;
}

export interface ProfileKeyword {
  id: number;
  keyword: string;
  isSeed: boolean;
}

export interface ProfileSource {
  id: number;
  platform: string;
  sourceType: string;
  name: string;
  value: string;
  enabled: boolean;
  aiSuggested: boolean;
}

export interface ExpandedKeyword {
  keyword: string;
  reasoning: string;
}

export interface DiscoveredSource {
  platform: string;
  sourceType: string;
  name: string;
  value: string;
  rationale: string;
}

export interface SubjectProfile {
  id: string;
  label: string;
  color: string;
  keywords: string[];
  enabled: boolean;
  priority: number;
}

export interface FigureProfile {
  name: string;
  aliases: string[];
  tier: string;
  subjects: string[];
}

@Injectable({ providedIn: 'root' })
export class ProfileService {
  private api = inject(ApiService);

  readonly profiles = signal<ProfileSummary[]>([]);
  readonly activeProfileId = signal<string | null>(null);
  readonly wizardOpen = signal(false);
  readonly wizardProfileId = signal<string | null>(null);

  constructor() {
    // Wait for ApiService to resolve its baseUrl (async IPC in Electron)
    this.api.ready.then(() => this.loadProfiles());
  }

  loadProfiles() {
    // Load profiles first, then check active — avoids race condition
    this.api.getProfiles().subscribe({
      next: (profiles) => {
        this.profiles.set(profiles);
        this.api.getActiveProfile().subscribe({
          next: (res) => {
            this.activeProfileId.set(res.id);
            if (!res.id && profiles.length === 0) {
              // No profiles exist — show wizard
              this.openWizard();
            }
          },
          error: () => {},
        });
      },
      error: (err) => console.error('Failed to load profiles:', err),
    });
  }

  switchProfile(id: string) {
    this.api.activateProfile(id).subscribe({
      next: () => {
        this.activeProfileId.set(id);
        // Reload the app state
        window.location.reload();
      },
      error: (err) => console.error('Failed to switch profile:', err),
    });
  }

  openWizard() {
    this.wizardProfileId.set(null);
    this.wizardOpen.set(true);
  }

  closeWizard() {
    this.wizardOpen.set(false);
    this.wizardProfileId.set(null);
  }

  // --- Onboarding ---

  initProfile(name: string, seedKeywords: string[]) {
    return this.api.initProfile(name, seedKeywords);
  }

  expandKeywords(profileId: string) {
    return this.api.expandKeywords(profileId);
  }

  deriveSubjects(profileId: string) {
    return this.api.deriveSubjects(profileId);
  }

  discoverSources(profileId: string) {
    return this.api.discoverSources(profileId);
  }

  finalizeProfile(profileId: string) {
    return this.api.finalizeProfile(profileId);
  }

  // --- Entity management ---

  addKeywords(profileId: string, keywords: string[], isSeed = false) {
    return this.api.addProfileKeywords(profileId, keywords, isSeed);
  }

  removeKeyword(profileId: string, keyword: string) {
    return this.api.removeProfileKeyword(profileId, keyword);
  }

  addSource(profileId: string, source: any) {
    return this.api.addProfileSource(profileId, source);
  }

  removeSource(profileId: string, sourceId: number) {
    return this.api.removeProfileSource(profileId, sourceId);
  }

  deleteProfile(id: string) {
    this.api.deleteProfile(id).subscribe({
      next: () => {
        this.profiles.update((p) => p.filter((pr) => pr.id !== id));
        if (this.activeProfileId() === id) {
          this.activeProfileId.set(null);
        }
      },
    });
  }

  getActiveProfileName(): string {
    const id = this.activeProfileId();
    if (!id) return 'No Profile';
    const profile = this.profiles().find((p) => p.id === id);
    return profile?.name || 'Unknown';
  }
}
