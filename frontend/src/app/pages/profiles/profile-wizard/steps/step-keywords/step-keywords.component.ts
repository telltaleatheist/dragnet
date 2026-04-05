import { Component, EventEmitter, Input, Output, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProfileService, ProfileKeyword, SubjectProfile, FigureProfile } from '../../../../../services/profile.service';
import { DesktopButtonComponent } from '../../../../../creamsicle-desktop';

@Component({
  selector: 'step-keywords',
  standalone: true,
  imports: [CommonModule, FormsModule, DesktopButtonComponent],
  templateUrl: './step-keywords.component.html',
  styleUrl: './step-keywords.component.scss',
})
export class StepKeywordsComponent implements OnInit {
  @Input() profileId!: string;
  @Input() keywords: ProfileKeyword[] = [];
  @Output() complete = new EventEmitter<{ subjects: SubjectProfile[]; figures: FigureProfile[] }>();
  @Output() back = new EventEmitter<void>();

  profileService = inject(ProfileService);

  allKeywords = signal<ProfileKeyword[]>([]);
  loading = signal(false);
  expanding = signal(false);
  error = signal<string | null>(null);
  keywordInput = '';

  ngOnInit() {
    this.allKeywords.set([...this.keywords]);
    this.expand();
  }

  expand() {
    this.expanding.set(true);
    this.error.set(null);

    this.profileService.expandKeywords(this.profileId).subscribe({
      next: (result: any) => {
        this.expanding.set(false);
        // Merge seed + expanded
        const seeds = this.allKeywords().filter((k) => k.isSeed);
        const expanded: ProfileKeyword[] = (result.keywords || []).map((kw: any, i: number) => ({
          id: 1000 + i,
          keyword: kw.keyword,
          isSeed: false,
        }));
        this.allKeywords.set([...seeds, ...expanded]);
      },
      error: (err) => {
        this.expanding.set(false);
        this.error.set('Failed to expand keywords. You can add keywords manually and continue.');
      },
    });
  }

  addKeyword() {
    const kw = this.keywordInput.trim().toLowerCase();
    if (kw && !this.allKeywords().find((k) => k.keyword === kw)) {
      this.allKeywords.update((list) => [...list, { id: Date.now(), keyword: kw, isSeed: false }]);
      this.profileService.addKeywords(this.profileId, [kw]).subscribe();
    }
    this.keywordInput = '';
  }

  onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.addKeyword();
    }
  }

  removeKeyword(kw: ProfileKeyword) {
    this.allKeywords.update((list) => list.filter((k) => k.keyword !== kw.keyword));
    this.profileService.removeKeyword(this.profileId, kw.keyword).subscribe();
  }

  proceed() {
    this.loading.set(true);
    this.error.set(null);

    this.profileService.deriveSubjects(this.profileId).subscribe({
      next: (result: any) => {
        this.loading.set(false);
        this.complete.emit({
          subjects: result.subjects || [],
          figures: result.figures || [],
        });
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set('Failed to derive subjects. Check your AI settings and try again.');
      },
    });
  }
}
