import { Component, EventEmitter, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProfileService, ProfileKeyword } from '../../../../../services/profile.service';
import { DesktopButtonComponent } from '../../../../../creamsicle-desktop';

@Component({
  selector: 'step-name',
  standalone: true,
  imports: [CommonModule, FormsModule, DesktopButtonComponent],
  templateUrl: './step-name.component.html',
  styleUrl: './step-name.component.scss',
})
export class StepNameComponent {
  @Output() complete = new EventEmitter<{ profileId: string; keywords: ProfileKeyword[] }>();

  profileService = inject(ProfileService);

  profileName = '';
  keywordInput = '';
  seedKeywords = signal<string[]>([]);
  loading = signal(false);
  error = signal<string | null>(null);

  addKeyword() {
    const kw = this.keywordInput.trim().toLowerCase();
    if (kw && !this.seedKeywords().includes(kw)) {
      this.seedKeywords.update((list) => [...list, kw]);
    }
    this.keywordInput = '';
  }

  onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.addKeyword();
    }
  }

  removeKeyword(kw: string) {
    this.seedKeywords.update((list) => list.filter((k) => k !== kw));
  }

  get canProceed(): boolean {
    return this.profileName.trim().length > 0 && this.seedKeywords().length >= 2;
  }

  proceed() {
    if (!this.canProceed) return;
    this.loading.set(true);
    this.error.set(null);

    this.profileService.initProfile(this.profileName.trim(), this.seedKeywords()).subscribe({
      next: (result) => {
        this.loading.set(false);
        const keywords: ProfileKeyword[] = this.seedKeywords().map((kw, i) => ({
          id: i,
          keyword: kw,
          isSeed: true,
        }));
        this.complete.emit({ profileId: result.profileId, keywords });
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err.error?.message || 'Failed to create profile');
      },
    });
  }
}
