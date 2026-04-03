import { Injectable, Logger } from '@nestjs/common';
import { BaseSource, RawContentItem } from './base-source';
import type { DiscoverySourceConfig, SubjectProfile, FigureProfile } from '../../../../shared/types';

interface InstagramDiscoveryConfig extends DiscoverySourceConfig {
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
      if (subject.enabled) {
        queries.push(`site:instagram.com ${subject.label}`);
      }
    }

    for (const figure of figures) {
      if (figure.tier === 'top_priority') {
        queries.push(`site:instagram.com ${figure.name}`);
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
      throw new Error(`HTTP ${response.status} for instagram discovery "${query}"`);
    }

    const xml = await response.text();
    const parsed = parser.parse(xml);

    const entries = parsed?.rss?.channel?.item || [];
    const entryList = Array.isArray(entries) ? entries : [entries];

    // Filter to Instagram results only
    const instagramEntries = entryList.filter((entry: any) => {
      const source = entry.source?.['#text'] || entry.source || '';
      const sourceStr = typeof source === 'string' ? source : String(source);
      return sourceStr.toLowerCase().includes('instagram');
    });

    const items: RawContentItem[] = [];

    for (const entry of instagramEntries.slice(0, 10)) {
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
      if (finalUrl.includes('instagram.com')) {
        return finalUrl;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async enrichWithOembed(instagramUrl: string): Promise<OembedResult | undefined> {
    try {
      const encoded = encodeURIComponent(instagramUrl);
      const response = await fetch(`https://api.instagram.com/oembed?url=${encoded}`, {
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
    const author = oembed?.author_name || googleAuthor || 'Instagram';
    const published = entry.pubDate || '';

    // Strip site: prefix from query for sourceAccount
    const cleanQuery = query.replace(/^site:instagram\.com\s*/i, '');

    return {
      url: this.normalizeUrl(url),
      title,
      author,
      platform: 'web',
      contentType: 'image',
      thumbnailUrl: oembed?.thumbnail_url,
      publishedAt: published ? new Date(published).toISOString() : undefined,
      sourceAccount: `instagram-discovery:${cleanQuery}`,
      metadata: {
        searchQuery: query,
        oembedAuthor: oembed?.author_name,
        oembedTitle: oembed?.title,
      },
    };
  }
}
