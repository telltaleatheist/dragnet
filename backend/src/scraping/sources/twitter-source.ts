import { Injectable, Logger } from '@nestjs/common';
import { BaseSource, RawContentItem } from './base-source';
import type { TwitterSourceConfig } from '../../../../shared/types';

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const NITTER_INSTANCES = [
  'https://xcancel.com',
  'https://nitter.poast.org',
];

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
        const accountItems = await this.fetchAccount(parser, account);
        for (const item of accountItems) {
          if (!seenUrls.has(item.url)) {
            seenUrls.add(item.url);
            items.push(item);
          }
        }
      } catch (err) {
        this.logger.warn(`Twitter @${account} failed: ${(err as Error).message}`);
      }

      // Rate limit between accounts
      await new Promise((r) => setTimeout(r, 1000));
    }

    this.logger.log(`Twitter: found ${items.length} items for ${config.accounts.length} accounts`);
    return items;
  }

  /** Try Nitter RSS instances first, fall back to Google News search. */
  private async fetchAccount(parser: any, account: string): Promise<RawContentItem[]> {
    // Try each Nitter instance
    for (const instance of NITTER_INSTANCES) {
      try {
        const items = await this.fetchNitterRss(parser, instance, account);
        if (items.length > 0) {
          this.logger.debug(`@${account}: ${items.length} tweets via ${instance}`);
          return items;
        }
      } catch {
        // Nitter instance down or blocked — try next
      }
    }

    // All Nitter instances failed — fall back to Google News
    this.logger.debug(`@${account}: Nitter unavailable, falling back to Google News`);
    return this.searchAccountViaGoogle(parser, account);
  }

  private async fetchNitterRss(parser: any, instance: string, account: string): Promise<RawContentItem[]> {
    const url = `${instance}/${account}/rss`;

    const response = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA, 'Accept': 'application/rss+xml, application/xml, text/xml' },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${instance}`);
    }

    const xml = await response.text();
    if (!xml.includes('<item>') && !xml.includes('<item ')) {
      return []; // Empty feed or not RSS
    }

    const parsed = parser.parse(xml);
    const entries = parsed?.rss?.channel?.item || [];
    const entryList = Array.isArray(entries) ? entries : [entries];

    return entryList.slice(0, 25).map((entry: any) => this.parseNitterEntry(entry, account));
  }

  private parseNitterEntry(entry: any, account: string): RawContentItem {
    const nitterLink = typeof entry.link === 'string' ? entry.link : '';
    // Convert Nitter URLs to x.com
    const tweetUrl = nitterLink
      .replace(/https?:\/\/[^/]+\//, `https://x.com/`)
      .replace(/#m$/, '');

    const rawTitle = typeof entry.title === 'string' ? entry.title : String(entry.title || '');
    const rawDesc = typeof entry.description === 'string' ? entry.description : '';
    const textContent = this.stripHtml(rawDesc);

    // Use description as title if title is just "R to @..." or very short
    const title = rawTitle.length < 10 || rawTitle.startsWith('R to @')
      ? (textContent.slice(0, 200) || rawTitle)
      : rawTitle;

    const published = entry.pubDate || '';
    const contentType = this.detectTweetContentType(rawDesc, nitterLink);

    return {
      url: this.normalizeUrl(tweetUrl || nitterLink),
      title: this.stripHtml(title).slice(0, 300),
      author: `@${account}`,
      platform: 'twitter',
      contentType,
      textContent: this.truncateText(textContent),
      publishedAt: published ? new Date(published).toISOString() : undefined,
      sourceAccount: `@${account}`,
      metadata: { account, source: 'nitter' },
    };
  }

  private detectTweetContentType(description: string, link: string): string {
    const combined = `${description} ${link}`.toLowerCase();
    if (combined.includes('youtube.com') || combined.includes('youtu.be') ||
        combined.includes('video') || combined.includes('/video/')) {
      return 'video';
    }
    if (combined.includes('/photo/') || combined.includes('pic.twitter') ||
        combined.includes('.jpg') || combined.includes('.png')) {
      return 'image';
    }
    if (combined.includes('http') && !combined.includes('twitter.com') && !combined.includes('x.com')) {
      return 'article';
    }
    return 'text';
  }

  private async searchAccountViaGoogle(parser: any, account: string): Promise<RawContentItem[]> {
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
      items.push(this.parseGoogleEntry(entry, account));
    }

    if (items.length > 0) {
      this.logger.debug(`@${account}: found ${items.length} items via Google News`);
    }

    return items;
  }

  private parseGoogleEntry(entry: any, account: string): RawContentItem {
    const googleLink = typeof entry.link === 'string' ? entry.link : '';

    const rawTitle = typeof entry.title === 'string' ? entry.title : String(entry.title || '');
    const title = rawTitle
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"');

    const source = entry.source?.['#text'] || entry.source || '';
    const author = typeof source === 'string' ? source : String(source);
    const published = entry.pubDate || '';

    const rawDesc = typeof entry.description === 'string' ? entry.description : '';
    const textContent = this.stripHtml(rawDesc);

    return {
      url: this.normalizeUrl(googleLink),
      title,
      author: author || `@${account}`,
      platform: 'twitter',
      contentType: 'text',
      textContent: this.truncateText(textContent),
      publishedAt: published ? new Date(published).toISOString() : undefined,
      sourceAccount: `@${account}`,
      metadata: { account, source: 'google-news' },
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
