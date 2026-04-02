import { Injectable, Logger } from '@nestjs/common';
import { BaseSource, RawContentItem } from './base-source';
import type { YouTubeSourceConfig } from '../../../../shared/types';

@Injectable()
export class YouTubeSource extends BaseSource {
  protected readonly logger = new Logger(YouTubeSource.name);
  readonly platform = 'youtube';

  async fetch(config: YouTubeSourceConfig): Promise<RawContentItem[]> {
    if (!config.enabled) return [];

    const { XMLParser } = await import('fast-xml-parser');
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '$' });
    const items: RawContentItem[] = [];

    for (const channel of config.channels) {
      try {
        const channelItems = await this.fetchChannel(parser, channel.channelId, channel.name);
        items.push(...channelItems);
      } catch (err) {
        this.logger.warn(`Failed to fetch YouTube channel ${channel.name}: ${(err as Error).message}`);
      }
    }

    return items;
  }

  private async fetchChannel(
    parser: any,
    channelId: string,
    channelName: string,
  ): Promise<RawContentItem[]> {
    const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'dragnet/1.0' },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    const xml = await response.text();
    const parsed = parser.parse(xml);
    const entries = parsed?.feed?.entry;
    if (!entries) return [];

    const entryList = Array.isArray(entries) ? entries : [entries];

    return entryList.map((entry) => this.parseEntry(entry, channelName));
  }

  private parseEntry(entry: any, channelName: string): RawContentItem {
    const videoId = entry['yt:videoId'] || '';
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const title = entry.title || '';
    const author = entry.author?.name || channelName;
    const published = entry.published || '';
    const description = entry['media:group']?.['media:description'] || '';
    const thumbnail = entry['media:group']?.['media:thumbnail']?.$url ||
      `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    return {
      url: this.normalizeUrl(url),
      title,
      author,
      platform: 'youtube',
      contentType: 'video',
      textContent: this.truncateText(description),
      publishedAt: published ? new Date(published).toISOString() : undefined,
      thumbnailUrl: thumbnail,
      sourceAccount: channelName,
      metadata: { channelId: entry['yt:channelId'], videoId },
    };
  }
}
