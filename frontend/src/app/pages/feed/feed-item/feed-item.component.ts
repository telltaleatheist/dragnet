import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FeedItem } from '../../../models/feed.model';
import { ContextMenuComponent } from '../../../creamsicle-desktop/components/context-menu/context-menu.component';
import { ContextMenuAction, ContextMenuPosition } from '../../../creamsicle-desktop/models/cascade.model';

@Component({
  selector: 'app-feed-item',
  standalone: true,
  imports: [CommonModule, ContextMenuComponent],
  templateUrl: './feed-item.component.html',
  styleUrl: './feed-item.component.scss',
})
export class FeedItemComponent {
  @Input({ required: true }) item!: FeedItem;
  @Output() dismiss = new EventEmitter<void>();
  @Output() bookmark = new EventEmitter<void>();
  @Output() open = new EventEmitter<void>();

  contextMenuVisible = false;
  contextMenuPosition: ContextMenuPosition = { x: 0, y: 0 };

  get contextMenuActions(): ContextMenuAction[] {
    return [
      { label: 'Copy Link', icon: '🔗', action: 'copy-link' },
      { label: 'Open in Browser', icon: '↗', action: 'open' },
      { label: '', icon: '', action: '', divider: true },
      { label: this.item.bookmarked ? 'Remove Bookmark' : 'Bookmark', icon: this.item.bookmarked ? '★' : '☆', action: 'bookmark' },
      { label: 'Dismiss', icon: '✕', action: 'dismiss' },
    ];
  }

  onContextMenu(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.contextMenuPosition = { x: event.clientX, y: event.clientY };
    this.contextMenuVisible = true;
  }

  onContextMenuAction(action: string) {
    this.contextMenuVisible = false;
    switch (action) {
      case 'copy-link':
        navigator.clipboard.writeText(this.item.url);
        break;
      case 'open':
        this.open.emit();
        break;
      case 'bookmark':
        this.bookmark.emit();
        break;
      case 'dismiss':
        this.dismiss.emit();
        break;
    }
  }

  get platformIcon(): string {
    switch (this.item.platform) {
      case 'twitter': return '𝕏';
      case 'reddit': return '⬡';
      case 'youtube': return '▶';
      case 'instagram': return '◻';
      case 'tiktok': return '♪';
      case 'web': return '◎';
      default: return '○';
    }
  }

  get platformClass(): string {
    return `platform-${this.item.platform}`;
  }

  get timeAgo(): string {
    const date = this.item.publishedAt || this.item.fetchedAt;
    if (!date) return '';
    const d = new Date(date);
    const diff = Date.now() - d.getTime();
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return `${Math.floor(diff / 60000)}m ago`;
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  get scoreClass(): string {
    const score = this.item.aiScore;
    if (score >= 8) return 'score-high';
    if (score >= 5) return 'score-medium';
    if (score >= 1) return 'score-low';
    return 'score-none';
  }

  imgFailed = false;

  onImgError() {
    this.imgFailed = true;
  }
}
