import { Injectable, Logger } from '@nestjs/common';
import { BaseSource, RawContentItem } from './base-source';
import type { DiscoverySourceConfig, SubjectProfile, FigureProfile } from '../../../../shared/types';

interface TikTokDiscoveryConfig extends DiscoverySourceConfig {
  subjects: SubjectProfile[];
  figures: FigureProfile[];
}

interface OembedResult {
  author_name?: string;
  author_url?: string;
  title?: string;
  thumbnail_url?: string;
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
      if (subject.enabled) {
        queries.push(`site:tiktok.com ${subject.label}`);
      }
    }

    for (const figure of figures) {
      if (figure.tier === 'top_priority') {
        queries.push(`site:tiktok.com ${figure.name}`);
      }
    }

    return queries.slice(0, 20);
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

    // Filter to TikTok results only
    const tiktokEntries = entryList.filter((entry: any) => {
      const source = entry.source?.['#text'] || entry.source || '';
      const sourceStr = typeof source === 'string' ? source : String(source);
      return sourceStr.toLowerCase().includes('tiktok');
    });

    const items: RawContentItem[] = [];

    for (const entry of tiktokEntries.slice(0, 10)) {
      if (!entry?.link) continue;

      const resolvedUrl = await this.resolveGoogleNewsUrl(entry.link);
      const oembed = resolvedUrl ? await this.enrichWithOembed(resolvedUrl) : undefined;
      items.push(this.parseEntry(entry, query, resolvedUrl, oembed));
    }

    return items;
  }

  private async resolveGoogleNewsUrl(googleUrl: string): Promise<string | null> {
    try {
      const response = await fetch(googleUrl, {
        method: 'HEAD',
        redirect: 'follow',
        headers: { 'User-Agent': 'dragnet/1.0 (content aggregator)' },
      });
      const finalUrl = response.url;
      if (finalUrl.includes('tiktok.com')) {
        return finalUrl;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async enrichWithOembed(tiktokUrl: string): Promise<OembedResult | undefined> {
    try {
      const encoded = encodeURIComponent(tiktokUrl);
      const response = await fetch(`https://www.tiktok.com/oembed?url=${encoded}`, {
        headers: { 'User-Agent': 'dragnet/1.0 (content aggregator)' },
      });

      if (!response.ok) return undefined;

      return (await response.json()) as OembedResult;
    } catch {
      return undefined;
    }
  }

  private parseEntry(
    entry: any,
    query: string,
    resolvedUrl: string | null,
    oembed?: OembedResult,
  ): RawContentItem {
    const url = resolvedUrl || (typeof entry.link === 'string' ? entry.link : '');
    const title = oembed?.title || (typeof entry.title === 'string' ? entry.title : String(entry.title || ''));
    const source = entry.source?.['#text'] || entry.source || '';
    const googleAuthor = typeof source === 'string' ? source : String(source);
    const author = oembed?.author_name || googleAuthor || 'TikTok';
    const published = entry.pubDate || '';

    // Strip site: prefix from query for sourceAccount
    const cleanQuery = query.replace(/^site:tiktok\.com\s*/i, '');

    return {
      url: this.normalizeUrl(url),
      title,
      author,
      platform: 'tiktok',
      contentType: 'video',
      thumbnailUrl: oembed?.thumbnail_url,
      publishedAt: published ? new Date(published).toISOString() : undefined,
      sourceAccount: `tiktok-discovery:${cleanQuery}`,
      metadata: {
        searchQuery: query,
        oembedAuthor: oembed?.author_name,
        oembedTitle: oembed?.title,
      },
    };
  }
}
