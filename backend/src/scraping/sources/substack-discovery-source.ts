import { Injectable, Logger } from '@nestjs/common';
import { BaseSource, RawContentItem } from './base-source';
import type { DiscoverySourceConfig, SubjectProfile, FigureProfile } from '../../../../shared/types';

interface SubstackDiscoveryConfig extends DiscoverySourceConfig {
  subjects: SubjectProfile[];
  figures: FigureProfile[];
}

@Injectable()
export class SubstackDiscoverySource extends BaseSource {
  protected readonly logger = new Logger(SubstackDiscoverySource.name);
  readonly platform = 'web';

  async fetch(config: SubstackDiscoveryConfig): Promise<RawContentItem[]> {
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
        this.logger.warn(`Substack Discovery "${query}" failed: ${(err as Error).message}`);
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
        .filter((kw: string) => !kw.startsWith('#') && kw.length >= 4)
        .slice(0, 5);
      if (topKw.length === 0) continue;
      const terms = topKw.map((kw: string) => kw.includes(' ') ? `"${kw}"` : kw);
      queries.push(`site:substack.com ${terms.join(' OR ')}`);
    }

    for (const figure of figures) {
      if (figure.tier === 'top_priority') {
        queries.push(`site:substack.com "${figure.name}"`);
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
      throw new Error(`HTTP ${response.status} for substack discovery "${query}"`);
    }

    const xml = await response.text();
    const parsed = parser.parse(xml);

    const entries = parsed?.rss?.channel?.item || [];
    const entryList = Array.isArray(entries) ? entries : [entries];

    // Filter to Substack results only
    const substackEntries = entryList.filter((entry: any) => {
      const source = entry.source?.['#text'] || entry.source || '';
      const sourceStr = typeof source === 'string' ? source : String(source);
      const link = typeof entry.link === 'string' ? entry.link : '';
      return sourceStr.toLowerCase().includes('substack') || link.includes('substack.com');
    });

    return substackEntries
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

    // Use publisher name as sourceAccount (e.g. "The Atlantic" not "substack-discovery:Christian Nationalism")
    const publisherName = author || this.extractDomain(url) || 'Substack';

    return {
      url: this.normalizeUrl(url),
      title,
      author: author || 'Substack',
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
