import { Injectable, Logger } from '@nestjs/common';
import { BaseSource, RawContentItem } from './base-source';
import type { DiscoverySourceConfig, SubjectProfile, FigureProfile } from '../../../../shared/types';

interface YouTubeShortsDiscoveryConfig extends DiscoverySourceConfig {
  subjects: SubjectProfile[];
  figures: FigureProfile[];
}

@Injectable()
export class YouTubeShortsDiscoverySource extends BaseSource {
  protected readonly logger = new Logger(YouTubeShortsDiscoverySource.name);
  readonly platform = 'youtube';

  async fetch(config: YouTubeShortsDiscoveryConfig): Promise<RawContentItem[]> {
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
        this.logger.warn(`YouTube Shorts Discovery "${query}" failed: ${(err as Error).message}`);
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
      queries.push(`site:youtube.com/shorts/ ${terms.join(' OR ')}`);
    }

    for (const figure of figures) {
      if (figure.tier === 'top_priority') {
        queries.push(`site:youtube.com/shorts/ "${figure.name}"`);
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
      throw new Error(`HTTP ${response.status} for youtube shorts discovery "${query}"`);
    }

    const xml = await response.text();
    const parsed = parser.parse(xml);

    const entries = parsed?.rss?.channel?.item || [];
    const entryList = Array.isArray(entries) ? entries : [entries];

    const items: RawContentItem[] = [];

    for (const entry of entryList.slice(0, 10)) {
      if (!entry?.link) continue;
      items.push(this.parseEntry(entry, query));
    }

    return items;
  }

  private parseEntry(entry: any, query: string): RawContentItem {
    const url = typeof entry.link === 'string' ? entry.link : '';
    const title = typeof entry.title === 'string' ? entry.title : String(entry.title || '');
    const source = entry.source?.['#text'] || entry.source || '';
    const author = typeof source === 'string' ? source : String(source);
    const published = entry.pubDate || '';

    return {
      url: this.normalizeUrl(url),
      title,
      author: author || 'YouTube',
      platform: 'youtube',
      contentType: 'video',
      publishedAt: published ? new Date(published).toISOString() : undefined,
      sourceAccount: author || 'YouTube Shorts',
      metadata: {
        searchQuery: query,
        googleNewsSource: true,
        shortForm: true,
      },
    };
  }
}
