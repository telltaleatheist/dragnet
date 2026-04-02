import { Injectable, Logger } from '@nestjs/common';
import { BaseSource, RawContentItem } from './base-source';
import type { TwitterSourceConfig } from '../../../../shared/types';

const NITTER_INSTANCES = [
  'https://nitter.net',
  'https://nitter.poast.org',
  'https://nitter.privacydev.net',
];

@Injectable()
export class TwitterSource extends BaseSource {
  protected readonly logger = new Logger(TwitterSource.name);
  readonly platform = 'twitter';

  async fetch(config: TwitterSourceConfig): Promise<RawContentItem[]> {
    if (!config.enabled) return [];

    const { XMLParser } = await import('fast-xml-parser');
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '$' });
    const items: RawContentItem[] = [];

    for (const account of config.accounts) {
      try {
        const accountItems = await this.fetchAccount(parser, account);
        items.push(...accountItems);
      } catch (err) {
        this.logger.warn(`Failed to fetch @${account}: ${(err as Error).message}`);
      }
      await this.delay(1000);
    }

    return items;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async fetchAccount(
    parser: any,
    account: string,
  ): Promise<RawContentItem[]> {
    for (const instance of NITTER_INSTANCES) {
      const url = `${instance}/${account}/rss`;

      try {
        const response = await fetch(url, {
          headers: { 'User-Agent': 'dragnet/1.0 (content aggregator)' },
          signal: AbortSignal.timeout(15000),
        });

        if (!response.ok) {
          this.logger.debug(`${instance} returned ${response.status} for @${account}, trying next...`);
          continue;
        }

        const xml = await response.text();
        const parsed = parser.parse(xml);
        const entries = parsed?.rss?.channel?.item;
        if (!entries) return [];

        const entryList = Array.isArray(entries) ? entries : [entries];
        return entryList
          .filter((entry: any) => entry)
          .map((entry: any) => this.parseEntry(entry, account));
      } catch (err) {
        this.logger.debug(`${instance} failed for @${account}: ${(err as Error).message}`);
        continue;
      }
    }

    throw new Error(`All Nitter instances failed for @${account}`);
  }

  private parseEntry(entry: any, account: string): RawContentItem {
    const guid = entry.guid?.['#text'] || entry.guid || '';
    const tweetId = typeof guid === 'string' ? guid : String(guid);
    const canonicalUrl = `https://x.com/${account}/status/${tweetId}`;

    // Nitter links look like https://nitter.net/user/status/123#m
    const nitterLink = typeof entry.link === 'string' ? entry.link : '';
    const linkMatch = nitterLink.match(/\/status\/(\d+)/);
    const url = linkMatch
      ? `https://x.com/${account}/status/${linkMatch[1]}`
      : canonicalUrl;

    const title = entry.title || '';
    const creator = entry['dc:creator'] || `@${account}`;
    const description = entry.description || '';
    const pubDate = entry.pubDate || '';

    // Strip HTML from description for text content
    const textContent = this.stripHtml(description);

    // Extract images from description HTML
    const imgMatch = description.match(/<img[^>]+src=["']([^"']+)["']/);
    const hasVideo = description.includes('<video') || description.includes('gallery-video');

    return {
      url: this.normalizeUrl(url),
      title: textContent.slice(0, 120) + (textContent.length > 120 ? '...' : ''),
      author: creator,
      platform: 'twitter',
      contentType: hasVideo ? 'video' : (imgMatch ? 'image' : 'text'),
      textContent: this.truncateText(textContent),
      publishedAt: pubDate ? new Date(pubDate).toISOString() : undefined,
      thumbnailUrl: imgMatch?.[1] || undefined,
      sourceAccount: `@${account}`,
      metadata: { account },
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
