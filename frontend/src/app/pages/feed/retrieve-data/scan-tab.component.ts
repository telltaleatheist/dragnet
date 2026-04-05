import { Component, inject, Output, EventEmitter } from '@angular/core';
import { DesktopButtonComponent } from '../../../creamsicle-desktop';
import { FeedStoreService } from '../../../services/feed-store.service';

@Component({
  selector: 'scan-tab',
  standalone: true,
  imports: [DesktopButtonComponent],
  template: `
    <div class="scan-tab">
      <p class="scan-desc">Scan all configured sources for new content. Results are saved in a new Data Store.</p>
      @if (store.activeTermSetId() === '__profile__') {
        <p class="terms-info">Using profile subjects &amp; figures for discovery</p>
      } @else {
        <p class="terms-info custom">Using {{ store.resolvedTerms().length }} custom terms for discovery</p>
      }
      <div class="scan-action">
        <desktop-button
          variant="primary"
          size="sm"
          [disabled]="store.scanRunning() || store.curateRunning()"
          (click)="startScan()"
        >
          Start Scan
        </desktop-button>
      </div>
    </div>
  `,
  styles: [`
    @use '../../../creamsicle-desktop/styles/variables' as *;

    .scan-tab {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: $spacing-4 0;
    }

    .scan-desc {
      margin: 0 0 $spacing-2 0;
      font-size: $font-size-sm;
      color: var(--text-secondary);
      text-align: center;
      max-width: 400px;
    }

    .terms-info {
      margin: 0 0 $spacing-4 0;
      font-size: $font-size-xs;
      color: var(--text-muted);
      text-align: center;

      &.custom {
        color: var(--text-accent);
      }
    }
  `],
})
export class ScanTabComponent {
  store = inject(FeedStoreService);
  @Output() started = new EventEmitter<void>();

  startScan() {
    this.store.triggerScan();
    this.started.emit();
  }
}
