import { Injectable, Logger } from '@nestjs/common';
import { BaseSource, RawContentItem } from './base-source';
import type { RedditSourceConfig } from '../../../../shared/types';

interface RedditRssEntry {
  title?: string;
  link?: string;
  author?: string;
  'dc:creator'?: string;
  pubDate?: string;
  published?: string;
  updated?: string;
  description?: string;
  content?: string;
  'content:encoded'?: string;
  'media:thumbnail'?: { $: { url: string } } | { url: string };
  category?: string | string[];
  id?: string;
  guid?: string | { _: string };
}

@Injectable()
export class RedditSource extends BaseSource {
  protected readonly logger = new Logger(RedditSource.name);
  readonly platform = 'reddit';
  private topTimeframe = 'week';

  async fetch(config: RedditSourceConfig): Promise<RawContentItem[]> {
    if (!config.enabled) return [];
    this.topTimeframe = config.topTimeframe ?? 'week';

    const { XMLParser } = await import('fast-xml-parser');
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '$',
      processEntities: false,
      htmlEntities: true,
    });

    const items: RawContentItem[] = [];

    for (const subreddit of config.subreddits) {
      for (const feedType of config.feedTypes) {
        try {
          const feedItems = await this.fetchSubredditFeed(
            parser,
            subreddit,
            feedType,
          );
          items.push(...feedItems);
        } catch (err) {
          this.logger.warn(
            `Failed to fetch r/${subreddit}/${feedType}: ${(err as Error).message}`,
          );
        }
      }
    }

    return items;
  }

  private async fetchSubredditFeed(
    parser: any,
    subreddit: string,
    feedType: string,
  ): Promise<RawContentItem[]> {
    const url = feedType === 'top'
      ? `https://www.reddit.com/r/${subreddit}/${feedType}.rss?t=${this.topTimeframe}`
      : `https://www.reddit.com/r/${subreddit}/${feedType}.rss`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'dragnet/1.0 (content aggregator)',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    const xml = await response.text();
    const parsed = parser.parse(xml);

    // RSS feeds use rss.channel.item, Atom feeds use feed.entry
    const entries: RedditRssEntry[] =
      parsed?.feed?.entry ||
      parsed?.rss?.channel?.item ||
      [];

    // Normalize to array
    const entryList = Array.isArray(entries) ? entries : [entries];

    return entryList
      .filter((entry) => entry && this.getEntryUrl(entry))
      .map((entry) => this.parseEntry(entry, subreddit));
  }

  private getEntryUrl(entry: RedditRssEntry): string {
    if (typeof entry.link === 'string') return entry.link;
    // Atom: link can be an object or array of objects with $href
    if (entry.link) {
      const links = Array.isArray(entry.link) ? entry.link : [entry.link];
      for (const l of links) {
        if (typeof l === 'string') return l;
        const href = (l as any).$href || (l as any).href;
        if (href) return href;
      }
    }
    if (entry.id) return typeof entry.id === 'string' ? entry.id : String(entry.id);
    if (entry.guid) {
      return typeof entry.guid === 'string' ? entry.guid : entry.guid._;
    }
    return '';
  }

  private parseEntry(entry: RedditRssEntry, subreddit: string): RawContentItem {
    const url = this.normalizeUrl(this.getEntryUrl(entry));
    const rawTitle = entry.title || '';
    const title = (typeof rawTitle === 'string' ? rawTitle : (rawTitle as any)?.['#text'] || String(rawTitle))
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const rawAuthor = entry.author || entry['dc:creator'] || `r/${subreddit}`;
    const author = typeof rawAuthor === 'string' ? rawAuthor : (rawAuthor as any)?.name || (rawAuthor as any)?.['#text'] || `r/${subreddit}`;
    const rawContent = entry['content:encoded'] || entry.content || entry.description || '';
    const content = typeof rawContent === 'string' ? rawContent : (rawContent as any)?.['#text'] || String(rawContent || '');
    const publishedAt = entry.pubDate || entry.published || entry.updated;

    // Detect content type from URL
    const contentType = this.detectContentType(url, title);

    // Extract thumbnail
    let thumbnailUrl: string | undefined;
    if (entry['media:thumbnail']) {
      const thumb = entry['media:thumbnail'];
      thumbnailUrl = typeof thumb === 'object' && '$' in thumb
        ? (thumb as any).$.url || (thumb as any).$url
        : (thumb as any).url;
    }

    return {
      url,
      title,
      author: typeof author === 'string' ? author : (author as any)?.name || `r/${subreddit}`,
      platform: 'reddit',
      contentType,
      textContent: this.truncateText(this.stripHtml(content)),
      publishedAt: publishedAt ? new Date(publishedAt).toISOString() : undefined,
      thumbnailUrl,
      sourceAccount: `r/${subreddit}`,
      metadata: { subreddit, feedType: 'rss' },
    };
  }

  private detectContentType(url: string, title: string): string {
    if (url.includes('youtube.com') || url.includes('youtu.be') || url.includes('v.redd.it')) {
      return 'video';
    }
    if (url.includes('i.redd.it') || url.includes('imgur.com')) {
      return 'image';
    }
    if (!url.includes('reddit.com/r/')) {
      return 'article';
    }
    return 'text';
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
