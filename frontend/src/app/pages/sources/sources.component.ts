import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../services/api.service';
import { SourceStatusRecord, ScanRecord } from '../../models/feed.model';

@Component({
  selector: 'app-sources',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sources.component.html',
  styleUrl: './sources.component.scss',
})
export class SourcesComponent implements OnInit {
  private api = inject(ApiService);

  sources = signal<SourceStatusRecord[]>([]);
  scanHistory = signal<ScanRecord[]>([]);
  loading = signal(true);

  ngOnInit() {
    this.loadData();
  }

  loadData() {
    this.loading.set(true);
    this.api.getSourceStatuses().subscribe({
      next: (data) => {
        this.sources.set(data);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  getStatusIcon(source: SourceStatusRecord): string {
    if (source.consecutive_failures > 0) return '🔴';
    if (source.last_success_at) return '🟢';
    return '⚪';
  }

  formatTime(iso: string | null): string {
    if (!iso) return 'Never';
    return new Date(iso).toLocaleString();
  }
}
