import { Injectable, Logger } from '@nestjs/common';
import { BaseSource, RawContentItem } from './base-source';
import type { DiscoverySourceConfig, SubjectProfile, FigureProfile } from '../../../../shared/types';

interface GoogleNewsConfig extends DiscoverySourceConfig {
  subjects: SubjectProfile[];
  figures: FigureProfile[];
}

@Injectable()
export class GoogleNewsSource extends BaseSource {
  protected readonly logger = new Logger(GoogleNewsSource.name);
  readonly platform = 'web';

  async fetch(config: GoogleNewsConfig): Promise<RawContentItem[]> {
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
        this.logger.warn(`Google News "${query}" failed: ${(err as Error).message}`);
      }

      // 1s delay between queries
      await new Promise((r) => setTimeout(r, 1000));
    }

    return items;
  }

  private buildQueries(subjects: SubjectProfile[], figures: FigureProfile[]): string[] {
    const queries: string[] = [];

    // Use subject keywords for targeted queries instead of broad labels.
    // Quote multi-word phrases, combine top keywords with OR.
    for (const subject of subjects) {
      if (!subject.enabled) continue;

      const usable = subject.keywords
        .filter((kw: string) => !kw.startsWith('#') && kw.length >= 4)
        .slice(0, 5);

      if (usable.length === 0) continue;

      const terms = usable.map((kw: string) =>
        kw.includes(' ') ? `"${kw}"` : kw,
      );
      queries.push(terms.join(' OR '));
    }

    for (const figure of figures) {
      if (figure.tier === 'top_priority') {
        const name = figure.name.includes(' ') ? `"${figure.name}"` : figure.name;
        queries.push(name);
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
      throw new Error(`HTTP ${response.status} for google news "${query}"`);
    }

    const xml = await response.text();
    const parsed = parser.parse(xml);

    const entries = parsed?.rss?.channel?.item || [];
    const entryList = Array.isArray(entries) ? entries : [entries];

    return entryList
      .slice(0, 10)
      .filter((entry: any) => entry?.link)
      .map((entry: any) => this.parseEntry(entry, query));
  }

  private parseEntry(entry: any, query: string): RawContentItem {
    const url = typeof entry.link === 'string' ? entry.link : '';
    const title = typeof entry.title === 'string' ? entry.title : String(entry.title || '');
    const source = entry.source?.['#text'] || entry.source || '';
    const author = typeof source === 'string' ? source : String(source);
    const published = entry.pubDate || '';
    const description = entry.description || '';

    // Use publisher name as sourceAccount (e.g. "NPR", "Right Wing Watch")
    // Falls back to domain name if no source attribution
    const publisherName = author || this.extractDomain(url) || 'Google News';

    return {
      url: this.normalizeUrl(url),
      title,
      author: author || 'Google News',
      platform: 'web',
      contentType: 'article',
      textContent: this.truncateText(this.stripHtml(typeof description === 'string' ? description : String(description))),
      publishedAt: published ? new Date(published).toISOString() : undefined,
      sourceAccount: publisherName,
      metadata: { searchQuery: query, source: author },
    };
  }

  private extractDomain(url: string): string {
    try {
      const hostname = new URL(url).hostname.replace(/^www\./, '');
      return hostname;
    } catch {
      return '';
    }
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
