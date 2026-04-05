import { Controller, Get, Post, Patch, Delete, Param, Query, Body } from '@nestjs/common';
import { InMemoryStoreService } from '../store/in-memory-store.service';
import { BookmarksService, BookmarkRow } from '../database/bookmarks.service';
import { DragnetConfigService } from '../config/dragnet-config.service';

@Controller('feed')
export class FeedController {
  constructor(
    private readonly store: InMemoryStoreService,
    private readonly bookmarksService: BookmarksService,
    private readonly configService: DragnetConfigService,
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
    @Query('storeIds') storeIds?: string,
  ) {
    const parsedStoreIds = storeIds ? storeIds.split(',').filter(Boolean) : undefined;
    const result = this.store.queryItems({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      minScore: minScore ? parseFloat(minScore) : undefined,
      platform: platform as any,
      tag: tag || undefined,
      contentType: contentType as any,
      search: search || undefined,
      storeIds: parsedStoreIds,
    });

    return {
      items: result.items,
      total: result.total,
      page: page ? parseInt(page, 10) : 1,
      pageSize: limit ? parseInt(limit, 10) : 20,
    };
  }

  @Get('curated')
  getCurated(@Query('storeIds') storeIds?: string) {
    const clusters = this.store.getClusters();
    // If storeIds specified, filter clusters to only include items from those stores
    const parsedStoreIds = storeIds ? storeIds.split(',').filter(Boolean) : undefined;

    if (parsedStoreIds?.length) {
      const storeItemIds = new Set(
        this.store.getItemsByStoreIds(parsedStoreIds).map((i) => i.id),
      );
      const filtered = clusters
        .map((c) => ({
          ...c,
          itemIds: c.itemIds.filter((id) => storeItemIds.has(id)),
        }))
        .filter((c) => c.itemIds.length > 0);

      return {
        clusters: filtered.map((c) => ({
          ...c,
          items: this.store.getItemsByIds(c.itemIds),
        })),
      };
    }

    return {
      clusters: clusters.map((c) => ({
        ...c,
        items: this.store.getItemsByIds(c.itemIds),
      })),
    };
  }

  @Get('bookmarks/clusters')
  getBookmarkClusters() {
    return { clusters: this.bookmarksService.queryBookmarkClusters() };
  }

  @Get('bookmarks/grouped')
  getBookmarkedGrouped() {
    const groups = this.bookmarksService.queryBookmarkClustersWithItems();
    return {
      clusters: groups.map((g) => ({
        clusterTitle: g.clusterTitle,
        clusterSummary: g.clusterSummary,
        items: g.items.map(this.transformBookmark),
      })),
    };
  }

  @Patch('bookmarks/:id/cluster')
  updateBookmarkCluster(
    @Param('id') id: string,
    @Body() body: { clusterTitle: string; clusterSummary?: string },
  ) {
    this.bookmarksService.updateBookmarkCluster(id, body.clusterTitle, body.clusterSummary);
    return { success: true };
  }

  @Get('bookmarks')
  getBookmarks(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('platform') platform?: string,
    @Query('clusterTitle') clusterTitle?: string,
  ) {
    const result = this.bookmarksService.queryBookmarks({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      search: search || undefined,
      platform: platform || undefined,
      clusterTitle: clusterTitle || undefined,
    });

    return {
      items: result.items.map(this.transformBookmark),
      total: result.total,
      page: page ? parseInt(page, 10) : 1,
      pageSize: limit ? parseInt(limit, 10) : 20,
    };
  }

  @Get('platform-counts')
  getPlatformCounts(@Query('storeIds') storeIds?: string) {
    const parsedStoreIds = storeIds ? storeIds.split(',').filter(Boolean) : undefined;
    return this.store.getPlatformCounts(parsedStoreIds);
  }

  @Get('stores')
  getStores() {
    return this.store.getStores();
  }

  @Delete('stores/:id')
  removeStore(@Param('id') id: string) {
    const ok = this.store.removeStore(id);
    if (!ok) return { success: false, error: 'Store not found' };
    return { success: true };
  }

  // --- Term Sets ---

  @Get('term-sets')
  getTermSets() {
    return this.store.getTermSets();
  }

  @Post('term-sets')
  createTermSet(
    @Body() body: { name: string; topics: string[]; figures: string[]; suggestions: { text: string; enabled: boolean }[] },
  ) {
    return this.store.createTermSet(body.name, body.topics || [], body.figures || [], body.suggestions || []);
  }

  @Delete('term-sets/:id')
  removeTermSet(@Param('id') id: string) {
    const ok = this.store.removeTermSet(id);
    if (!ok) return { success: false, error: 'Term set not found' };
    return { success: true };
  }

  @Get('profile-terms')
  getProfileTerms() {
    const subjects = this.configService.getSubjects();
    const figures = this.configService.getFigures();
    return {
      topics: subjects.filter((s) => s.enabled).map((s) => s.label),
      figures: figures.map((f) => f.name),
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
  bookmarkItem(
    @Param('id') id: string,
    @Body() body?: { clusterTitle?: string; clusterSummary?: string },
  ) {
    const item = this.store.getItem(id);
    if (!item) return { success: false, error: 'Item not found' };

    this.bookmarksService.bookmarkItem(item, body?.clusterTitle, body?.clusterSummary);
    item.bookmarked = true;
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

  @Delete('cluster/:id')
  removeCluster(@Param('id') id: string) {
    const ok = this.store.removeCluster(id);
    if (!ok) return { success: false, error: 'Cluster not found' };
    return { success: true };
  }

  @Delete('cluster/:clusterId/item/:itemId')
  removeItemFromCluster(
    @Param('clusterId') clusterId: string,
    @Param('itemId') itemId: string,
  ) {
    const ok = this.store.removeItemFromCluster(clusterId, itemId);
    if (!ok) return { success: false, error: 'Cluster or item not found' };
    return { success: true };
  }

  @Post('cluster/:fromId/item/:itemId/move')
  moveItemBetweenClusters(
    @Param('fromId') fromId: string,
    @Param('itemId') itemId: string,
    @Body() body: { toClusterId: string },
  ) {
    const ok = this.store.moveItemBetweenClusters(itemId, fromId, body.toClusterId);
    if (!ok) return { success: false, error: 'Cluster or item not found' };
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
