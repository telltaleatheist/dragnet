import { Controller, Get, Post, Param, Query } from '@nestjs/common';
import { InMemoryStoreService } from '../store/in-memory-store.service';
import { BookmarksService, BookmarkRow } from '../database/bookmarks.service';

@Controller('feed')
export class FeedController {
  constructor(
    private readonly store: InMemoryStoreService,
    private readonly bookmarksService: BookmarksService,
  ) {}

  @Get('items')
  getItems(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('minScore') minScore?: string,
    @Query('platform') platform?: string,
    @Query('tag') tag?: string,
    @Query('contentType') contentType?: string,
    @Query('search') search?: string,
  ) {
    const result = this.store.queryItems({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      minScore: minScore ? parseFloat(minScore) : undefined,
      platform: platform as any,
      tag: tag || undefined,
      contentType: contentType as any,
      search: search || undefined,
    });

    return {
      items: result.items,
      total: result.total,
      page: page ? parseInt(page, 10) : 1,
      pageSize: limit ? parseInt(limit, 10) : 20,
    };
  }

  @Get('curated')
  getCurated() {
    const clusters = this.store.getClusters();
    return {
      clusters: clusters.map((c) => ({
        ...c,
        items: this.store.getItemsByIds(c.itemIds),
      })),
    };
  }

  @Get('bookmarks')
  getBookmarks(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('platform') platform?: string,
  ) {
    const result = this.bookmarksService.queryBookmarks({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      search: search || undefined,
      platform: platform || undefined,
    });

    return {
      items: result.items.map(this.transformBookmark),
      total: result.total,
      page: page ? parseInt(page, 10) : 1,
      pageSize: limit ? parseInt(limit, 10) : 20,
    };
  }

  @Get('stats')
  getStats() {
    return {
      totalItems: this.store.getItemCount(),
      bookmarkCount: this.bookmarksService.getBookmarkCount(),
    };
  }

  @Post(':id/bookmark')
  bookmarkItem(@Param('id') id: string) {
    const item = this.store.getItem(id);
    if (!item) return { success: false, error: 'Item not found' };

    this.bookmarksService.bookmarkItem(item);
    this.store.markBookmarked(id);
    return { success: true };
  }

  @Post(':id/unbookmark')
  unbookmarkItem(@Param('id') id: string) {
    this.bookmarksService.unbookmarkItem(id);
    this.store.unmarkBookmarked(id);
    return { success: true };
  }

  @Post('cluster/:id/bookmark')
  bookmarkCluster(@Param('id') id: string) {
    const cluster = this.store.getCluster(id);
    if (!cluster) return { success: false, error: 'Cluster not found' };

    const items = this.store.getItemsByIds(cluster.itemIds);
    this.bookmarksService.bookmarkCluster(cluster, items);
    for (const item of items) {
      this.store.markBookmarked(item.id);
    }
    return { success: true };
  }

  @Post(':id/dismiss')
  dismissItem(@Param('id') id: string) {
    this.store.dismissItem(id);
    return { success: true };
  }

  @Post(':id/open')
  markOpened(@Param('id') id: string) {
    this.store.markOpened(id);
    return { success: true };
  }

  private transformBookmark(row: BookmarkRow) {
    return {
      id: row.id,
      url: row.url,
      title: row.title,
      author: row.author,
      platform: row.platform,
      contentType: row.content_type,
      textContent: row.text_content,
      publishedAt: row.published_at,
      fetchedAt: row.fetched_at,
      thumbnailUrl: row.thumbnail_url,
      sourceAccount: row.source_account,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
      preFilterScore: row.pre_filter_score,
      aiScore: row.ai_score,
      aiTags: row.ai_tags ? JSON.parse(row.ai_tags) : [],
      aiSummary: row.ai_summary,
      aiClipType: row.ai_clip_type,
      aiReasoning: row.ai_reasoning,
      scoredAt: row.scored_at,
      aiProvider: row.ai_provider,
      aiModel: row.ai_model,
      dismissed: false,
      bookmarked: true,
      opened: false,
    };
  }
}
