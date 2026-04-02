import { Injectable, Logger } from '@nestjs/common';
import { BaseSource, RawContentItem } from './base-source';
import type { WebRssSourceConfig } from '../../../../shared/types';

@Injectable()
export class WebRssSource extends BaseSource {
  protected readonly logger = new Logger(WebRssSource.name);
  readonly platform = 'web';

  async fetch(config: WebRssSourceConfig): Promise<RawContentItem[]> {
    if (!config.enabled) return [];

    const { XMLParser } = await import('fast-xml-parser');
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '$' });
    const items: RawContentItem[] = [];

    for (const feed of config.feeds) {
      try {
        const feedItems = await this.fetchFeed(parser, feed.url, feed.name);
        items.push(...feedItems);
      } catch (err) {
        this.logger.warn(`Failed to fetch RSS feed "${feed.name}": ${(err as Error).message}`);
      }
    }

    return items;
  }

  private async fetchFeed(
    parser: any,
    feedUrl: string,
    feedName: string,
  ): Promise<RawContentItem[]> {
    const response = await fetch(feedUrl, {
      headers: { 'User-Agent': 'dragnet/1.0 (content aggregator)' },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${feedUrl}`);
    }

    const xml = await response.text();
    const parsed = parser.parse(xml);

    // Handle both RSS and Atom formats
    const entries =
      parsed?.rss?.channel?.item ||
      parsed?.feed?.entry ||
      [];

    const entryList = Array.isArray(entries) ? entries : [entries];

    return entryList
      .filter((entry) => entry)
      .map((entry) => this.parseEntry(entry, feedName));
  }

  private parseEntry(entry: any, feedName: string): RawContentItem {
    const url = this.extractUrl(entry);
    const title = entry.title || '';
    const author = entry.author?.name || entry.author || entry['dc:creator'] || feedName;
    const content = entry['content:encoded'] || entry.content || entry.description || '';
    const published = entry.pubDate || entry.published || entry.updated || '';

    // Try to extract thumbnail from content or media tags
    let thumbnailUrl: string | undefined;
    if (entry['media:thumbnail']?.$url) {
      thumbnailUrl = entry['media:thumbnail'].$url;
    } else if (entry['media:content']?.$url) {
      thumbnailUrl = entry['media:content'].$url;
    } else {
      // Try to extract first image from content HTML
      const imgMatch = content.match(/<img[^>]+src=["']([^"']+)["']/);
      if (imgMatch) thumbnailUrl = imgMatch[1];
    }

    return {
      url: this.normalizeUrl(url),
      title: typeof title === 'string' ? title : String(title),
      author: typeof author === 'string' ? author : String(author),
      platform: 'web',
      contentType: 'article',
      textContent: this.truncateText(this.stripHtml(content)),
      publishedAt: published ? new Date(published).toISOString() : undefined,
      thumbnailUrl,
      sourceAccount: feedName,
      metadata: { feedName },
    };
  }

  private extractUrl(entry: any): string {
    if (typeof entry.link === 'string') return entry.link;
    if (entry.link?.$href) return entry.link.$href;
    if (Array.isArray(entry.link)) {
      const alt = entry.link.find((l: any) => l.$rel === 'alternate');
      return alt?.$href || entry.link[0]?.$href || '';
    }
    if (entry.guid) {
      return typeof entry.guid === 'string' ? entry.guid : entry.guid._ || entry.guid['#text'] || '';
    }
    return '';
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
