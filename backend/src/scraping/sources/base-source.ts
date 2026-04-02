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

export abstract class BaseSource {
  protected abstract readonly logger: Logger;
  abstract readonly platform: string;

  abstract fetch(config: any): Promise<RawContentItem[]>;

  protected normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      parsed.hash = '';
      // Remove common tracking params
      ['utm_source', 'utm_medium', 'utm_campaign', 'ref', 'fbclid'].forEach(
        (p) => parsed.searchParams.delete(p),
      );
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
