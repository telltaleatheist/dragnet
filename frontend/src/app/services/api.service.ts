import { Injectable, OnDestroy } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import {
  FeedResponse,
  FeedFilters,
  ScanStatus,
  ScanProgressEvent,
  ScanCompleteEvent,
  SourceStatusRecord,
} from '../models/feed.model';

@Injectable({ providedIn: 'root' })
export class ApiService implements OnDestroy {
  private baseUrl = '';
  private socket: Socket | null = null;
  private initialized = false;

  // WebSocket event subjects
  readonly scanStarted$ = new Subject<{ scanId: number; timestamp: string }>();
  readonly scanProgress$ = new Subject<ScanProgressEvent>();
  readonly scanComplete$ = new Subject<ScanCompleteEvent>();
  readonly scanError$ = new Subject<{ source?: string; error: string }>();
  readonly scanScoring$ = new Subject<{ batch: number; totalBatches: number; itemsScored: number }>();
  readonly curateStarted$ = new Subject<{ timestamp: string }>();
  readonly curateComplete$ = new Subject<{ itemsScored: number; duration: number }>();
  readonly feedUpdated$ = new Subject<void>();

  constructor(private http: HttpClient) {
    this.init();
  }

  ngOnDestroy() {
    this.socket?.disconnect();
  }

  private async init() {
    // Resolve backend URL — try Electron IPC first, then same-origin
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

    // Fallback: derive from current page URL (frontend is served by NestJS)
    if (!this.baseUrl) {
      this.baseUrl = `${window.location.origin}/api`;
    }

    console.log(`[API] Using backend URL: ${this.baseUrl}`);
    this.connectSocket();
    this.initialized = true;
  }

  // --- Feed ---

  getFeed(filters: Partial<FeedFilters> = {}): Observable<FeedResponse> {
    let params = new HttpParams();
    if (filters.page) params = params.set('page', filters.page.toString());
    if (filters.limit) params = params.set('limit', filters.limit.toString());
    if (filters.minScore !== undefined) params = params.set('minScore', filters.minScore.toString());
    if (filters.platform) params = params.set('platform', filters.platform);
    if (filters.tag) params = params.set('tag', filters.tag);
    if (filters.contentType) params = params.set('contentType', filters.contentType);
    if (filters.bookmarked) params = params.set('bookmarked', 'true');
    if (filters.dismissed) params = params.set('dismissed', 'true');
    if (filters.search) params = params.set('search', filters.search);

    return this.http.get<FeedResponse>(`${this.baseUrl}/feed`, { params });
  }

  dismissItem(id: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/feed/${id}/dismiss`, {});
  }

  bookmarkItem(id: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/feed/${id}/bookmark`, {});
  }

  unbookmarkItem(id: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/feed/${id}/unbookmark`, {});
  }

  markOpened(id: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/feed/${id}/open`, {});
  }

  getFeedStats(): Observable<{ totalItems: number }> {
    return this.http.get<{ totalItems: number }>(`${this.baseUrl}/feed/stats`);
  }

  // --- Scan ---

  triggerScan(): Observable<{ scanId: number }> {
    return this.http.post<{ scanId: number }>(`${this.baseUrl}/scan/trigger`, {});
  }

  triggerCurate(): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.baseUrl}/scan/curate`, {});
  }

  getScanStatus(): Observable<ScanStatus> {
    return this.http.get<ScanStatus>(`${this.baseUrl}/scan/status`);
  }

  // --- Sources ---

  getSourceStatuses(): Observable<SourceStatusRecord[]> {
    return this.http.get<SourceStatusRecord[]>(`${this.baseUrl}/feed/sources`);
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
    this.socket.on('scan:scoring', (data) => this.scanScoring$.next(data));
    this.socket.on('scan:complete', (data) => this.scanComplete$.next(data));
    this.socket.on('scan:error', (data) => this.scanError$.next(data));
    this.socket.on('curate:started', (data) => this.curateStarted$.next(data));
    this.socket.on('curate:complete', (data) => this.curateComplete$.next(data));
    this.socket.on('feed:updated', () => this.feedUpdated$.next());

    this.socket.on('disconnect', () => {
      console.log('[WS] Disconnected');
    });
  }
}
