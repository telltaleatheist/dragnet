import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DesktopButtonComponent } from '../../../../../creamsicle-desktop';
import { ProfileKeyword, SubjectProfile, FigureProfile, DiscoveredSource } from '../../../../../services/profile.service';

@Component({
  selector: 'step-complete',
  standalone: true,
  imports: [CommonModule, DesktopButtonComponent],
  templateUrl: './step-complete.component.html',
  styleUrl: './step-complete.component.scss',
})
export class StepCompleteComponent {
  @Input() keywords: ProfileKeyword[] = [];
  @Input() subjects: SubjectProfile[] = [];
  @Input() figures: FigureProfile[] = [];
  @Input() sources: DiscoveredSource[] = [];
  @Input() loading = false;
  @Output() activate = new EventEmitter<void>();
  @Output() back = new EventEmitter<void>();

  get platformCounts(): { platform: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const s of this.sources) {
      counts.set(s.platform, (counts.get(s.platform) || 0) + 1);
    }
    return Array.from(counts.entries()).map(([platform, count]) => ({ platform, count }));
  }
}
