import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProfileService, SubjectProfile, FigureProfile, DiscoveredSource } from '../../../../../services/profile.service';
import { DesktopButtonComponent } from '../../../../../creamsicle-desktop';

@Component({
  selector: 'step-subjects',
  standalone: true,
  imports: [CommonModule, DesktopButtonComponent],
  templateUrl: './step-subjects.component.html',
  styleUrl: './step-subjects.component.scss',
})
export class StepSubjectsComponent {
  @Input() profileId!: string;
  @Input() subjects: SubjectProfile[] = [];
  @Input() figures: FigureProfile[] = [];
  @Output() complete = new EventEmitter<{ sources: DiscoveredSource[] }>();
  @Output() back = new EventEmitter<void>();

  profileService = inject(ProfileService);
  loading = signal(false);
  error = signal<string | null>(null);

  localSubjects = signal<SubjectProfile[]>([]);
  localFigures = signal<FigureProfile[]>([]);

  ngOnInit() {
    this.localSubjects.set([...this.subjects]);
    this.localFigures.set([...this.figures]);
  }

  removeSubject(id: string) {
    this.localSubjects.update((list) => list.filter((s) => s.id !== id));
  }

  removeFigure(name: string) {
    this.localFigures.update((list) => list.filter((f) => f.name !== name));
  }

  getTierLabel(tier: string): string {
    switch (tier) {
      case 'top_priority': return 'Top';
      case 'high_priority': return 'High';
      case 'monitor': return 'Watch';
      default: return tier;
    }
  }

  proceed() {
    this.loading.set(true);
    this.error.set(null);

    // Save updated subjects/figures before discovering sources
    this.profileService.discoverSources(this.profileId).subscribe({
      next: (result: any) => {
        this.loading.set(false);
        this.complete.emit({ sources: result.sources || [] });
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Failed to discover sources. Check your AI settings and try again.');
      },
    });
  }
}
