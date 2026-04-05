import { Injectable, Logger } from '@nestjs/common';
import { BaseSource, RawContentItem } from './base-source';
import type { TwitterSourceConfig } from '../../../../shared/types';

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

@Injectable()
export class TwitterSource extends BaseSource {
  protected readonly logger = new Logger(TwitterSource.name);
  readonly platform = 'twitter';

  async fetch(config: TwitterSourceConfig): Promise<RawContentItem[]> {
    if (!config.enabled || config.accounts.length === 0) return [];
    this.deadSources = [];

    const { XMLParser } = await import('fast-xml-parser');
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '$' });
    const items: RawContentItem[] = [];
    const seenUrls = new Set<string>();

    for (const account of config.accounts) {
      try {
        const accountItems = await this.searchAccountViaGoogle(parser, account);
        for (const item of accountItems) {
          if (!seenUrls.has(item.url)) {
            seenUrls.add(item.url);
            items.push(item);
          }
        }
      } catch (err) {
        this.logger.warn(`Twitter @${account} search failed: ${(err as Error).message}`);
      }

      // Rate limit: 1s between Google News queries
      await new Promise((r) => setTimeout(r, 1000));
    }

    this.logger.log(`Twitter: found ${items.length} items via Google News for ${config.accounts.length} accounts`);
    return items;
  }

  private async searchAccountViaGoogle(parser: any, account: string): Promise<RawContentItem[]> {
    // Search Google News for tweets from this account
    // Try both x.com and twitter.com since Google indexes both
    const query = `site:x.com OR site:twitter.com "${account}"`;
    const encoded = encodeURIComponent(query);
    const url = `https://news.google.com/rss/search?q=${encoded}&hl=en-US&gl=US&ceid=US:en`;

    const response = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA, 'Accept': 'application/rss+xml, application/xml, text/xml' },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for Google News search`);
    }

    const xml = await response.text();
    const parsed = parser.parse(xml);

    const entries = parsed?.rss?.channel?.item || [];
    const entryList = Array.isArray(entries) ? entries : [entries];

    // Filter to entries that reference x.com or twitter.com
    const twitterEntries = entryList.filter((entry: any) => {
      const link = typeof entry.link === 'string' ? entry.link : '';
      const title = typeof entry.title === 'string' ? entry.title : '';
      const desc = typeof entry.description === 'string' ? entry.description : '';
      const combined = `${link} ${title} ${desc}`.toLowerCase();
      return combined.includes('x.com') || combined.includes('twitter.com');
    });

    const items: RawContentItem[] = [];

    for (const entry of twitterEntries.slice(0, 15)) {
      if (!entry?.link) continue;
      // Use Google News link directly — browser will redirect to X/Twitter.
      // Google News encrypts article URLs (2024+) so server-side resolution isn't feasible.
      items.push(this.parseEntry(entry, account, null));
    }

    if (items.length > 0) {
      this.logger.debug(`@${account}: found ${items.length} items via Google News`);
    }

    return items;
  }

  private parseEntry(entry: any, account: string, resolvedUrl: string | null): RawContentItem {
    const googleLink = typeof entry.link === 'string' ? entry.link : '';
    const url = resolvedUrl || googleLink;

    const rawTitle = typeof entry.title === 'string' ? entry.title : String(entry.title || '');
    const title = rawTitle
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"');

    const source = entry.source?.['#text'] || entry.source || '';
    const author = typeof source === 'string' ? source : String(source);
    const published = entry.pubDate || '';

    // Try to extract tweet text from description
    const rawDesc = typeof entry.description === 'string' ? entry.description : '';
    const textContent = this.stripHtml(rawDesc);

    return {
      url: this.normalizeUrl(url),
      title,
      author: author || `@${account}`,
      platform: 'twitter',
      contentType: 'text',
      textContent: this.truncateText(textContent),
      publishedAt: published ? new Date(published).toISOString() : undefined,
      sourceAccount: `@${account}`,
      metadata: { account, resolvedUrl: !!resolvedUrl },
    };
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }
}
