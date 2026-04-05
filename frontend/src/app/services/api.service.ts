import { Injectable, OnDestroy } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import {
  FeedResponse,
  FeedFilters,
  CuratedResponse,
  ClusteringProgressEvent,
  CurateCompleteEvent,
  ScanProgressEvent,
  ScanCompleteEvent,
  SearchCompleteEvent,
  DataStore,
  SearchTermSet,
  BookmarkClusterSummary,
  BookmarkedClusterDetail,
} from '../models/feed.model';

@Injectable({ providedIn: 'root' })
export class ApiService implements OnDestroy {
  private baseUrl = '';
  private socket: Socket | null = null;
  private initialized = false;
  private readyResolve!: () => void;
  readonly ready = new Promise<void>(resolve => { this.readyResolve = resolve; });

  // WebSocket event subjects
  readonly scanStarted$ = new Subject<{ scanId: string; timestamp: string }>();
  readonly scanProgress$ = new Subject<ScanProgressEvent>();
  readonly scanComplete$ = new Subject<ScanCompleteEvent>();
  readonly scanError$ = new Subject<{ source?: string; error: string }>();
  readonly curateStarted$ = new Subject<{ timestamp: string }>();
  readonly clusteringProgress$ = new Subject<ClusteringProgressEvent>();
  readonly curateComplete$ = new Subject<CurateCompleteEvent>();
  readonly quickSearchStarted$ = new Subject<{ query: string; timestamp: string }>();
  readonly quickSearchProgress$ = new Subject<ScanProgressEvent>();
  readonly quickSearchComplete$ = new Subject<SearchCompleteEvent>();
  readonly scanCancelled$ = new Subject<void>();
  readonly curateCancelled$ = new Subject<void>();
  readonly quickSearchCancelled$ = new Subject<void>();
  readonly feedUpdated$ = new Subject<void>();

  constructor(private http: HttpClient) {
    this.init();
  }

  ngOnDestroy() {
    this.socket?.disconnect();
  }

  private async init() {
    try {
      const electronApi = (window as any).electron;
      if (electronApi?.getBackendUrl) {
        const url = await electronApi.getBackendUrl();
        if (url) {
          this.baseUrl = `${url}/api`;
        }
      }
    } catch {
      // Not in Electron
    }

    if (!this.baseUrl) {
      this.baseUrl = `${window.location.origin}/api`;
    }

    console.log(`[API] Using backend URL: ${this.baseUrl}`);
    this.connectSocket();
    this.initialized = true;
    this.readyResolve();
  }

  // --- Feed: All Items ---

  getItems(filters: Partial<FeedFilters> = {}, storeIds?: string[]): Observable<FeedResponse> {
    let params = new HttpParams();
    if (filters.page) params = params.set('page', filters.page.toString());
    if (filters.limit) params = params.set('limit', filters.limit.toString());
    if (filters.minScore !== undefined) params = params.set('minScore', filters.minScore.toString());
    if (filters.platform) params = params.set('platform', filters.platform);
    if (filters.tag) params = params.set('tag', filters.tag);
    if (filters.contentType) params = params.set('contentType', filters.contentType);
    if (filters.search) params = params.set('search', filters.search);
    if (storeIds?.length) params = params.set('storeIds', storeIds.join(','));

    return this.http.get<FeedResponse>(`${this.baseUrl}/feed/items`, { params });
  }

  getPlatformCounts(storeIds?: string[]): Observable<{ platforms: Record<string, number>; videoCount: number }> {
    let params = new HttpParams();
    if (storeIds?.length) params = params.set('storeIds', storeIds.join(','));
    return this.http.get<{ platforms: Record<string, number>; videoCount: number }>(`${this.baseUrl}/feed/platform-counts`, { params });
  }

  // --- Feed: Curated ---

  getCurated(storeIds?: string[]): Observable<CuratedResponse> {
    let params = new HttpParams();
    if (storeIds?.length) params = params.set('storeIds', storeIds.join(','));
    return this.http.get<CuratedResponse>(`${this.baseUrl}/feed/curated`, { params });
  }

  // --- Feed: Bookmarks ---

  getBookmarkClusters(): Observable<{ clusters: BookmarkClusterSummary[] }> {
    return this.http.get<{ clusters: BookmarkClusterSummary[] }>(`${this.baseUrl}/feed/bookmarks/clusters`);
  }

  getBookmarkedGrouped(): Observable<{ clusters: BookmarkedClusterDetail[] }> {
    return this.http.get<{ clusters: BookmarkedClusterDetail[] }>(`${this.baseUrl}/feed/bookmarks/grouped`);
  }

  getBookmarks(filters: Partial<FeedFilters> = {}, clusterTitle?: string): Observable<FeedResponse> {
    let params = new HttpParams();
    if (filters.page) params = params.set('page', filters.page.toString());
    if (filters.limit) params = params.set('limit', filters.limit.toString());
    if (filters.search) params = params.set('search', filters.search);
    if (filters.platform) params = params.set('platform', filters.platform);
    if (clusterTitle) params = params.set('clusterTitle', clusterTitle);

    return this.http.get<FeedResponse>(`${this.baseUrl}/feed/bookmarks`, { params });
  }

  updateBookmarkCluster(id: string, clusterTitle: string, clusterSummary?: string): Observable<any> {
    return this.http.patch(`${this.baseUrl}/feed/bookmarks/${id}/cluster`, { clusterTitle, clusterSummary });
  }

  // --- Feed: Data Stores ---

  getStores(): Observable<DataStore[]> {
    return this.http.get<DataStore[]>(`${this.baseUrl}/feed/stores`);
  }

  removeStore(id: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/feed/stores/${id}`);
  }

  // --- Feed: Term Sets ---

  getTermSets(): Observable<SearchTermSet[]> {
    return this.http.get<SearchTermSet[]>(`${this.baseUrl}/feed/term-sets`);
  }

  createTermSet(body: { name: string; topics: string[]; figures: string[]; suggestions: { text: string; enabled: boolean }[] }): Observable<SearchTermSet> {
    return this.http.post<SearchTermSet>(`${this.baseUrl}/feed/term-sets`, body);
  }

  removeTermSet(id: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/feed/term-sets/${id}`);
  }

  getProfileTerms(): Observable<{ topics: string[]; figures: string[] }> {
    return this.http.get<{ topics: string[]; figures: string[] }>(`${this.baseUrl}/feed/profile-terms`);
  }

  // --- Feed: Actions ---

  dismissItem(id: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/feed/${id}/dismiss`, {});
  }

  bookmarkItem(id: string, clusterTitle?: string, clusterSummary?: string): Observable<any> {
    const body: any = {};
    if (clusterTitle) body.clusterTitle = clusterTitle;
    if (clusterSummary) body.clusterSummary = clusterSummary;
    return this.http.post(`${this.baseUrl}/feed/${id}/bookmark`, body);
  }

  unbookmarkItem(id: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/feed/${id}/unbookmark`, {});
  }

  bookmarkCluster(id: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/feed/cluster/${id}/bookmark`, {});
  }

  removeCluster(id: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/feed/cluster/${id}`);
  }

  removeItemFromCluster(clusterId: string, itemId: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/feed/cluster/${clusterId}/item/${itemId}`);
  }

  moveItemBetweenClusters(fromClusterId: string, itemId: string, toClusterId: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/feed/cluster/${fromClusterId}/item/${itemId}/move`, { toClusterId });
  }

  markOpened(id: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/feed/${id}/open`, {});
  }

  getFeedStats(): Observable<{ totalItems: number; bookmarkCount: number }> {
    return this.http.get<{ totalItems: number; bookmarkCount: number }>(`${this.baseUrl}/feed/stats`);
  }

  // --- Scan ---

  triggerScan(videoOnly = false, adversarial = false, maxAgeDays?: number, searchTerms?: string[]): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.baseUrl}/scan/trigger`, { videoOnly, adversarial, maxAgeDays, searchTerms });
  }

  triggerCurate(customInstructions?: string, storeIds?: string[], adversarial = false, maxAgeDays?: number): Observable<{ message: string }> {
    const body: any = {};
    if (customInstructions) body.customInstructions = customInstructions;
    if (storeIds?.length) body.storeIds = storeIds;
    if (adversarial) body.adversarial = true;
    if (maxAgeDays) body.maxAgeDays = maxAgeDays;
    return this.http.post<{ message: string }>(`${this.baseUrl}/scan/curate`, body);
  }

  triggerQuickSearch(query: string, aiExpand = false, videoOnly = false, adversarial = false, maxAgeDays?: number): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.baseUrl}/scan/quick-search`, { query, aiExpand, videoOnly, adversarial, maxAgeDays });
  }

  suggestSearchTerms(topics: string[], figures: string[]): Observable<{ terms: string[] }> {
    return this.http.post<{ terms: string[] }>(`${this.baseUrl}/scan/suggest-search-terms`, { topics, figures });
  }

  triggerAdvancedSearch(terms: string[], videoOnly = false, adversarial = false, maxAgeDays?: number): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.baseUrl}/scan/advanced-search`, { terms, videoOnly, adversarial, maxAgeDays });
  }

  cancelScan(): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.baseUrl}/scan/cancel-scan`, {});
  }

  cancelCurate(): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.baseUrl}/scan/cancel-curate`, {});
  }

  cancelSearch(): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.baseUrl}/scan/cancel-search`, {});
  }

  getScanStatus(): Observable<{ scanning: boolean; curating: boolean; searching: boolean }> {
    return this.http.get<{ scanning: boolean; curating: boolean; searching: boolean }>(`${this.baseUrl}/scan/status`);
  }

  // --- Profiles ---

  getProfiles(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/profiles`);
  }

  getActiveProfile(): Observable<{ id: string | null }> {
    return this.http.get<{ id: string | null }>(`${this.baseUrl}/profiles/active`);
  }

  activateProfile(id: string): Observable<any> {
    return this.http.put(`${this.baseUrl}/profiles/${id}/activate`, {});
  }

  getProfile(id: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/profiles/${id}`);
  }

  createProfile(name: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/profiles`, { name });
  }

  deleteProfile(id: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/profiles/${id}`);
  }

  // Onboarding
  initProfile(name: string, seedKeywords: string[]): Observable<{ profileId: string }> {
    return this.http.post<{ profileId: string }>(`${this.baseUrl}/profiles/onboard/init`, { name, seedKeywords });
  }

  expandKeywords(profileId: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/profiles/onboard/${profileId}/expand`, {});
  }

  deriveSubjects(profileId: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/profiles/onboard/${profileId}/derive`, {});
  }

  discoverSources(profileId: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/profiles/onboard/${profileId}/discover`, {});
  }

  finalizeProfile(profileId: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/profiles/onboard/${profileId}/finalize`, {});
  }

  // Profile entities
  getProfileKeywords(profileId: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/profiles/${profileId}/keywords`);
  }

  addProfileKeywords(profileId: string, keywords: string[], isSeed = false): Observable<any[]> {
    return this.http.post<any[]>(`${this.baseUrl}/profiles/${profileId}/keywords`, { keywords, isSeed });
  }

  removeProfileKeyword(profileId: string, keyword: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/profiles/${profileId}/keywords/${encodeURIComponent(keyword)}`);
  }

  getProfileSources(profileId: string, platform?: string): Observable<any[]> {
    let params = new HttpParams();
    if (platform) params = params.set('platform', platform);
    return this.http.get<any[]>(`${this.baseUrl}/profiles/${profileId}/sources`, { params });
  }

  addProfileSource(profileId: string, source: any): Observable<any[]> {
    return this.http.post<any[]>(`${this.baseUrl}/profiles/${profileId}/sources`, source);
  }

  removeProfileSource(profileId: string, sourceId: number): Observable<any> {
    return this.http.delete(`${this.baseUrl}/profiles/${profileId}/sources/${sourceId}`);
  }

  toggleProfileSource(profileId: string, sourceId: number, enabled: boolean): Observable<any> {
    return this.http.put(`${this.baseUrl}/profiles/${profileId}/sources/${sourceId}/toggle`, { enabled });
  }

  // App settings
  getAISettings(): Observable<Record<string, string>> {
    return this.http.get<Record<string, string>>(`${this.baseUrl}/app-settings/ai`);
  }

  updateAISettings(settings: Record<string, string>): Observable<any> {
    return this.http.put(`${this.baseUrl}/app-settings/ai`, settings);
  }

  // --- Profiles: Management ---

  duplicateProfile(id: string, name: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/profiles/${id}/duplicate`, { name });
  }

  renameProfile(id: string, name: string): Observable<any> {
    return this.http.put(`${this.baseUrl}/profiles/${id}/rename`, { name });
  }

  // --- Debug: Snapshots ---

  getSnapshots(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/debug/snapshots`);
  }

  saveSnapshot(name: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/debug/snapshots`, { name });
  }

  deleteSnapshot(id: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/debug/snapshots/${id}`);
  }

  loadSnapshot(id: string): Observable<{ loaded: number }> {
    return this.http.post<{ loaded: number }>(`${this.baseUrl}/debug/snapshots/${id}/load`, {});
  }

  curateSnapshot(id: string, customInstructions?: string): Observable<any> {
    const body = customInstructions ? { customInstructions } : {};
    return this.http.post(`${this.baseUrl}/debug/snapshots/${id}/curate`, body);
  }

  // --- Browser Assist ---

  generateBrowserAssistPrompts(platforms: string[], searchTerms?: string[], videoOnly?: boolean, adversarial?: boolean, maxAgeDays?: number): Observable<{ prompts: { platform: string; prompt: string }[] }> {
    return this.http.post<{ prompts: { platform: string; prompt: string }[] }>(`${this.baseUrl}/browser-assist/generate-prompts`, { platforms, searchTerms, videoOnly, adversarial, maxAgeDays });
  }

  importBrowserAssistUrls(rawText: string): Observable<{ imported: number; skipped: number; storeId: string; storeName: string }> {
    return this.http.post<{ imported: number; skipped: number; storeId: string; storeName: string }>(`${this.baseUrl}/browser-assist/import`, { rawText });
  }

  // --- Config ---

  getConfig(): Observable<any> {
    return this.http.get(`${this.baseUrl}/config`);
  }

  updateConfig(config: any): Observable<any> {
    return this.http.put(`${this.baseUrl}/config`, config);
  }

  testAiProvider(config: { provider: string; model: string; apiKey?: string; ollamaEndpoint?: string }): Observable<{ success: boolean; error?: string }> {
    return this.http.post<{ success: boolean; error?: string }>(`${this.baseUrl}/config/ai/test`, config);
  }

  getOllamaModels(): Observable<string[]> {
    return this.http.get<string[]>(`${this.baseUrl}/config/ollama/models`);
  }

  getClaudeModels(apiKey?: string): Observable<string[]> {
    let params = new HttpParams();
    if (apiKey) params = params.set('apiKey', apiKey);
    return this.http.get<string[]>(`${this.baseUrl}/config/claude/models`, { params });
  }

  getOpenAIModels(apiKey?: string): Observable<string[]> {
    let params = new HttpParams();
    if (apiKey) params = params.set('apiKey', apiKey);
    return this.http.get<string[]>(`${this.baseUrl}/config/openai/models`, { params });
  }

  // --- WebSocket ---

  private connectSocket() {
    const wsUrl = this.baseUrl.replace('/api', '');
    this.socket = io(wsUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
    });

    this.socket.on('connect', () => {
      console.log('[WS] Connected');
    });

    this.socket.on('scan:started', (data) => this.scanStarted$.next(data));
    this.socket.on('scan:progress', (data) => this.scanProgress$.next(data));
    this.socket.on('scan:complete', (data) => this.scanComplete$.next(data));
    this.socket.on('scan:error', (data) => this.scanError$.next(data));
    this.socket.on('curate:started', (data) => this.curateStarted$.next(data));
    this.socket.on('curate:clustering', (data) => this.clusteringProgress$.next(data));
    this.socket.on('curate:complete', (data) => this.curateComplete$.next(data));
    this.socket.on('quicksearch:started', (data) => this.quickSearchStarted$.next(data));
    this.socket.on('quicksearch:progress', (data) => this.quickSearchProgress$.next(data));
    this.socket.on('quicksearch:complete', (data) => this.quickSearchComplete$.next(data));
    this.socket.on('scan:cancelled', () => this.scanCancelled$.next());
    this.socket.on('curate:cancelled', () => this.curateCancelled$.next());
    this.socket.on('quicksearch:cancelled', () => this.quickSearchCancelled$.next());
    this.socket.on('feed:updated', () => this.feedUpdated$.next());

    this.socket.on('disconnect', () => {
      console.log('[WS] Disconnected');
    });
  }
}
