import { Injectable, Logger } from '@nestjs/common';
import { BaseSource, RawContentItem } from './base-source';
import type { DiscoverySourceConfig, SubjectProfile, FigureProfile } from '../../../../shared/types';

interface TikTokDiscoveryConfig extends DiscoverySourceConfig {
  subjects: SubjectProfile[];
  figures: FigureProfile[];
}

@Injectable()
export class TikTokDiscoverySource extends BaseSource {
  protected readonly logger = new Logger(TikTokDiscoverySource.name);
  readonly platform = 'tiktok';

  async fetch(config: TikTokDiscoveryConfig): Promise<RawContentItem[]> {
    if (!config.enabled) return [];

    const { XMLParser } = await import('fast-xml-parser');
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '$' });

    const queries = this.buildQueries(config.subjects, config.figures);
    const items: RawContentItem[] = [];

    for (const query of queries) {
      try {
        const results = await this.searchGoogleNews(parser, query);
        items.push(...results);
      } catch (err) {
        this.logger.warn(`TikTok Discovery "${query}" failed: ${(err as Error).message}`);
      }

      await new Promise((r) => setTimeout(r, 1000));
    }

    return items;
  }

  private buildQueries(subjects: SubjectProfile[], figures: FigureProfile[]): string[] {
    const queries: string[] = [];

    for (const subject of subjects) {
      if (!subject.enabled) continue;
      const topKw = subject.keywords
        .filter((kw) => !kw.startsWith('#') && kw.length >= 4)
        .slice(0, 5);
      if (topKw.length === 0) continue;
      const terms = topKw.map((kw) => kw.includes(' ') ? `"${kw}"` : kw);
      queries.push(`site:tiktok.com ${terms.join(' OR ')}`);
    }

    for (const figure of figures) {
      if (figure.tier === 'top_priority') {
        queries.push(`site:tiktok.com "${figure.name}"`);
      }
    }

    return queries.slice(0, 10);
  }

  private async searchGoogleNews(parser: any, query: string): Promise<RawContentItem[]> {
    const encoded = encodeURIComponent(query);
    const url = `https://news.google.com/rss/search?q=${encoded}&hl=en-US&gl=US&ceid=US:en`;

    const response = await fetch(url, {
      headers: { 'User-Agent': 'dragnet/1.0 (content aggregator)' },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for tiktok discovery "${query}"`);
    }

    const xml = await response.text();
    const parsed = parser.parse(xml);

    const entries = parsed?.rss?.channel?.item || [];
    const entryList = Array.isArray(entries) ? entries : [entries];

    // All results should be from TikTok since query uses site:tiktok.com
    const items: RawContentItem[] = [];

    for (const entry of entryList.slice(0, 10)) {
      if (!entry?.link) continue;

      // Use Google News link directly — the browser will redirect to TikTok.
      // Google News encrypts article URLs (2024+) so server-side resolution isn't feasible.
      const oembed = await this.enrichWithOembed(entry);
      items.push(this.parseEntry(entry, query, oembed));
    }

    return items;
  }

  private async enrichWithOembed(entry: any): Promise<{ author_name?: string; title?: string; thumbnail_url?: string } | undefined> {
    // Try to extract a TikTok URL from the entry title (sometimes contains @username)
    // For oembed we'd need the actual TikTok URL which we can't get server-side
    // Just return undefined — we'll use Google News metadata instead
    return undefined;
  }

  private parseEntry(
    entry: any,
    query: string,
    oembed?: { author_name?: string; title?: string; thumbnail_url?: string },
  ): RawContentItem {
    const url = typeof entry.link === 'string' ? entry.link : '';
    const title = oembed?.title || (typeof entry.title === 'string' ? entry.title : String(entry.title || ''));
    const source = entry.source?.['#text'] || entry.source || '';
    const googleAuthor = typeof source === 'string' ? source : String(source);
    const author = oembed?.author_name || googleAuthor || 'TikTok';
    const published = entry.pubDate || '';

    // Extract @username from title if present (TikTok titles often include @username)
    let accountName = oembed?.author_name || '';
    if (!accountName) {
      const atMatch = title.match(/@([\w.]+)/);
      if (atMatch) accountName = atMatch[1];
    }

    return {
      url: this.normalizeUrl(url),
      title,
      author,
      platform: 'tiktok',
      contentType: 'video',
      thumbnailUrl: oembed?.thumbnail_url,
      publishedAt: published ? new Date(published).toISOString() : undefined,
      sourceAccount: accountName ? `@${accountName}` : '@TikTok',
      metadata: {
        searchQuery: query,
        googleNewsSource: true,
      },
    };
  }
}
