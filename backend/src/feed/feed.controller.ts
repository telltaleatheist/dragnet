import { Controller, Get, Post, Param, Query } from '@nestjs/common';
import { ItemsService, StoredItem, FeedQuery } from '../database/items.service';
import { SourceStatusService, SourceStatusRecord } from '../database/source-status.service';

@Controller('feed')
export class FeedController {
  constructor(
    private readonly itemsService: ItemsService,
    private readonly sourceStatusService: SourceStatusService,
  ) {}

  @Get()
  getFeed(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('minScore') minScore?: string,
    @Query('maxScore') maxScore?: string,
    @Query('platform') platform?: string,
    @Query('tag') tag?: string,
    @Query('contentType') contentType?: string,
    @Query('bookmarked') bookmarked?: string,
    @Query('dismissed') dismissed?: string,
    @Query('search') search?: string,
  ) {
    const query: FeedQuery = {
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      minScore: minScore ? parseFloat(minScore) : undefined,
      maxScore: maxScore ? parseFloat(maxScore) : undefined,
      platform: platform || undefined,
      tag: tag || undefined,
      contentType: contentType || undefined,
      bookmarked: bookmarked === 'true' ? true : undefined,
      dismissed: dismissed === 'true' ? true : undefined,
      search: search || undefined,
    };

    const result = this.itemsService.queryFeed(query);

    return {
      items: result.items.map(this.transformItem),
      total: result.total,
      page: query.page,
      pageSize: query.limit,
    };
  }

  @Get('stats')
  getStats() {
    const total = this.itemsService.getItemCount();
    return { totalItems: total };
  }

  @Post(':id/dismiss')
  dismissItem(@Param('id') id: string) {
    this.itemsService.dismissItem(id);
    return { success: true };
  }

  @Post(':id/bookmark')
  bookmarkItem(@Param('id') id: string) {
    this.itemsService.bookmarkItem(id);
    return { success: true };
  }

  @Post(':id/unbookmark')
  unbookmarkItem(@Param('id') id: string) {
    this.itemsService.unbookmarkItem(id);
    return { success: true };
  }

  @Post(':id/open')
  markOpened(@Param('id') id: string) {
    this.itemsService.markOpened(id);
    return { success: true };
  }

  @Get('sources')
  getSourceStatuses(): SourceStatusRecord[] {
    return this.sourceStatusService.getAllStatuses();
  }

  private transformItem(item: StoredItem) {
    return {
      id: item.id,
      url: item.url,
      title: item.title,
      author: item.author,
      platform: item.platform,
      contentType: item.content_type,
      textContent: item.text_content,
      publishedAt: item.published_at,
      fetchedAt: item.fetched_at,
      thumbnailUrl: item.thumbnail_url,
      sourceAccount: item.source_account,
      metadata: item.metadata ? JSON.parse(item.metadata) : null,
      preFilterScore: item.pre_filter_score,
      aiScore: item.ai_score,
      aiTags: item.ai_tags ? JSON.parse(item.ai_tags) : [],
      aiSummary: item.ai_summary,
      aiClipType: item.ai_clip_type,
      aiReasoning: item.ai_reasoning,
      scoredAt: item.scored_at,
      aiProvider: item.ai_provider,
      aiModel: item.ai_model,
      dismissed: !!item.dismissed,
      bookmarked: !!item.bookmarked,
      opened: !!item.opened,
    };
  }
}
