import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ModalComponent } from '../../../shared/modal/modal.component';
import { ProfileService, SubjectProfile, FigureProfile, ProfileKeyword, DiscoveredSource } from '../../../services/profile.service';
import { StepNameComponent } from './steps/step-name/step-name.component';
import { StepKeywordsComponent } from './steps/step-keywords/step-keywords.component';
import { StepSubjectsComponent } from './steps/step-subjects/step-subjects.component';
import { StepSourcesComponent } from './steps/step-sources/step-sources.component';
import { StepCompleteComponent } from './steps/step-complete/step-complete.component';

export type WizardStep = 'name' | 'keywords' | 'subjects' | 'sources' | 'complete';
const STEPS: WizardStep[] = ['name', 'keywords', 'subjects', 'sources', 'complete'];

@Component({
  selector: 'profile-wizard',
  standalone: true,
  imports: [
    CommonModule,
    ModalComponent,
    StepNameComponent,
    StepKeywordsComponent,
    StepSubjectsComponent,
    StepSourcesComponent,
    StepCompleteComponent,
  ],
  templateUrl: './profile-wizard.component.html',
  styleUrl: './profile-wizard.component.scss',
})
export class ProfileWizardComponent {
  profileService = inject(ProfileService);

  currentStep = signal<WizardStep>('name');
  profileId = signal<string | null>(null);
  loading = signal(false);
  error = signal<string | null>(null);

  // Step data
  keywords = signal<ProfileKeyword[]>([]);
  subjects = signal<SubjectProfile[]>([]);
  figures = signal<FigureProfile[]>([]);
  sources = signal<DiscoveredSource[]>([]);

  get stepIndex(): number {
    return STEPS.indexOf(this.currentStep());
  }

  get stepCount(): number {
    return STEPS.length;
  }

  get stepTitle(): string {
    switch (this.currentStep()) {
      case 'name': return 'Create Profile';
      case 'keywords': return 'Review Keywords';
      case 'subjects': return 'Subjects & Figures';
      case 'sources': return 'Content Sources';
      case 'complete': return 'Ready to Go';
    }
  }

  close() {
    this.profileService.closeWizard();
  }

  // Step 1 → 2
  onNameComplete(data: { profileId: string; keywords: ProfileKeyword[] }) {
    this.profileId.set(data.profileId);
    this.keywords.set(data.keywords);
    this.currentStep.set('keywords');
  }

  // Step 2 → 3
  onKeywordsComplete(data: { subjects: SubjectProfile[]; figures: FigureProfile[] }) {
    this.subjects.set(data.subjects);
    this.figures.set(data.figures);
    this.currentStep.set('subjects');
  }

  // Step 3 → 4
  onSubjectsComplete(data: { sources: DiscoveredSource[] }) {
    this.sources.set(data.sources);
    this.currentStep.set('sources');
  }

  // Step 4 → 5
  onSourcesComplete() {
    this.currentStep.set('complete');
  }

  // Step 5: finalize
  onFinalize() {
    const pid = this.profileId();
    if (!pid) return;
    this.loading.set(true);
    this.profileService.finalizeProfile(pid).subscribe({
      next: () => {
        this.loading.set(false);
        this.profileService.closeWizard();
        this.profileService.switchProfile(pid);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err.message || 'Failed to finalize profile');
      },
    });
  }

  goBack() {
    const idx = this.stepIndex;
    if (idx > 0) {
      this.currentStep.set(STEPS[idx - 1]);
    }
  }
}
