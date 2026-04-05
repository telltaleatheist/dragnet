import { Injectable, Logger } from '@nestjs/common';
import { BaseSource, RawContentItem } from './base-source';
import type { DiscoverySourceConfig, SubjectProfile, FigureProfile } from '../../../../shared/types';

interface InstagramDiscoveryConfig extends DiscoverySourceConfig {
  subjects: SubjectProfile[];
  figures: FigureProfile[];
}

@Injectable()
export class InstagramDiscoverySource extends BaseSource {
  protected readonly logger = new Logger(InstagramDiscoverySource.name);
  readonly platform = 'instagram';

  async fetch(config: InstagramDiscoveryConfig): Promise<RawContentItem[]> {
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
        this.logger.warn(`Instagram Discovery "${query}" failed: ${(err as Error).message}`);
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
      queries.push(`site:instagram.com/reel/ ${terms.join(' OR ')}`);
    }

    for (const figure of figures) {
      if (figure.tier === 'top_priority') {
        queries.push(`site:instagram.com/reel/ "${figure.name}"`);
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
      throw new Error(`HTTP ${response.status} for instagram discovery "${query}"`);
    }

    const xml = await response.text();
    const parsed = parser.parse(xml);

    const entries = parsed?.rss?.channel?.item || [];
    const entryList = Array.isArray(entries) ? entries : [entries];

    // All results should be from Instagram since query uses site:instagram.com/reel/
    const items: RawContentItem[] = [];

    for (const entry of entryList.slice(0, 10)) {
      if (!entry?.link) continue;

      // Use Google News link directly — the browser will redirect to Instagram.
      // Google News encrypts article URLs (2024+) so server-side resolution isn't feasible.
      items.push(this.parseEntry(entry, query));
    }

    return items;
  }

  private parseEntry(entry: any, query: string): RawContentItem {
    const url = typeof entry.link === 'string' ? entry.link : '';
    const rawTitle = typeof entry.title === 'string' ? entry.title : String(entry.title || '');
    const published = entry.pubDate || '';

    // Extract author from title: "Username on Instagram: caption..." or "@username ..."
    let author = '';
    const titleAuthorMatch = rawTitle.match(/^(.+?)\s+on\s+Instagram/i);
    if (titleAuthorMatch) {
      author = titleAuthorMatch[1].replace(/^@/, '').trim();
    }
    if (!author) {
      const atMatch = rawTitle.match(/@([\w.]+)/);
      if (atMatch) author = atMatch[1];
    }

    // Extract caption from title if present
    let title = rawTitle;
    const captionMatch = rawTitle.match(/on Instagram:\s*[""\u2018]?(.+?)[""\u2019]?\s*$/i);
    if (captionMatch) {
      title = captionMatch[1].trim();
    }

    return {
      url: this.normalizeUrl(url),
      title,
      author: author || 'Instagram',
      platform: 'instagram',
      contentType: 'video',
      publishedAt: published ? new Date(published).toISOString() : undefined,
      sourceAccount: author ? `@${author}` : '@Instagram',
      metadata: {
        searchQuery: query,
        googleNewsSource: true,
      },
    };
  }
}
