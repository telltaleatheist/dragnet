import { Logger } from '@nestjs/common';

export interface RawContentItem {
  url: string;
  title: string;
  author: string;
  platform: string;
  contentType: string;
  textContent?: string;
  publishedAt?: string;
  thumbnailUrl?: string;
  sourceAccount: string;
  metadata?: Record<string, unknown>;
}

export interface DeadSource {
  platform: string;
  sourceType: string;
  value: string;
  reason: string;
}

export abstract class BaseSource {
  protected abstract readonly logger: Logger;
  abstract readonly platform: string;

  /** Sources that returned 404/410 during the last fetch — should be removed */
  protected deadSources: DeadSource[] = [];

  abstract fetch(config: any): Promise<RawContentItem[]>;

  /** Get sources that were confirmed dead (404/410) during the last fetch, then clear the list */
  getAndClearDeadSources(): DeadSource[] {
    const dead = [...this.deadSources];
    this.deadSources = [];
    return dead;
  }

  protected normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      parsed.hash = '';
      // Strip tracking params
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
       'ref', 'fbclid', 'gclid', 'mc_cid', 'mc_eid'].forEach(
        (p) => parsed.searchParams.delete(p),
      );
      // Normalize www — strip www. prefix
      if (parsed.hostname.startsWith('www.')) {
        parsed.hostname = parsed.hostname.slice(4);
      }
      // Strip trailing slash from pathname (but keep "/" root)
      if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
        parsed.pathname = parsed.pathname.slice(0, -1);
      }
      return parsed.toString();
    } catch {
      return url;
    }
  }

  protected truncateText(text: string, maxLength: number = 5000): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + '...';
  }
}
