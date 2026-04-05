import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProfileService } from '../../../services/profile.service';

@Component({
  selector: 'profile-selector',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './profile-selector.component.html',
  styleUrl: './profile-selector.component.scss',
})
export class ProfileSelectorComponent {
  profileService = inject(ProfileService);
  dropdownOpen = signal(false);

  toggle() {
    this.dropdownOpen.update((v) => !v);
  }

  close() {
    this.dropdownOpen.set(false);
  }

  select(id: string) {
    this.close();
    if (id !== this.profileService.activeProfileId()) {
      this.profileService.switchProfile(id);
    }
  }

  deleteProfile(event: Event, id: string, name: string) {
    event.stopPropagation();
    if (confirm(`Delete profile "${name}"?`)) {
      this.profileService.deleteProfile(id);
    }
  }

  newProfile() {
    this.close();
    this.profileService.openWizard();
  }
}
