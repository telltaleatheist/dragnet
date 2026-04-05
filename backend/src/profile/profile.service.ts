import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { v4 as uuidv4 } from 'uuid';
import { DEFAULT_CONFIG } from '../config/default-config';
import type {
  DragnetConfig,
  ProfileSummary,
  ProfileFull,
  ProfileKeyword,
  ProfileSource,
  NewProfileSource,
  SubjectProfile,
  FigureProfile,
  AppSettings,
  ScoringConfig,
  Platform,
  RedditTopTimeframe,
  YouTubeChannel,
  RssFeed,
} from '../../../shared/types';

@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);

  constructor(private readonly db: DatabaseService) {}

  // --- App Settings ---

  getAppSetting(key: string): string | null {
    const row = this.db.getDb()
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setAppSetting(key: string, value: string): void {
    this.db.getDb()
      .prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)')
      .run(key, value);
  }

  getAISettings(): Record<string, string> {
    const keys = ['ai_provider', 'ai_model', 'ollama_endpoint', 'claude_api_key', 'openai_api_key'];
    const result: Record<string, string> = {};
    for (const key of keys) {
      const val = this.getAppSetting(key);
      if (val !== null) result[key] = val;
    }
    return result;
  }

  updateAISettings(settings: Record<string, string>): void {
    const allowed = ['ai_provider', 'ai_model', 'ollama_endpoint', 'claude_api_key', 'openai_api_key'];
    for (const [key, value] of Object.entries(settings)) {
      if (allowed.includes(key)) {
        this.setAppSetting(key, value);
      }
    }
  }

  // --- Active Profile ---

  getActiveProfileId(): string | null {
    return this.getAppSetting('active_profile_id');
  }

  setActiveProfileId(id: string): void {
    this.setAppSetting('active_profile_id', id);
    this.db.getDb()
      .prepare('UPDATE profiles SET last_used_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
  }

  // --- Profile CRUD ---

  createProfile(name: string): ProfileSummary {
    // If a profile with this name already exists and isn't onboarded, reuse it
    const existing = this.db.getDb()
      .prepare('SELECT id, name, created_at, is_onboarded FROM profiles WHERE name = ?')
      .get(name) as any;
    if (existing) {
      if (!existing.is_onboarded) {
        // Reset the incomplete profile for reuse
        this.db.getDb().prepare(`
          UPDATE profiles SET updated_at = ?, subjects = '[]', figures = '[]',
            scoring_config = '{}', app_settings = '{}' WHERE id = ?
        `).run(new Date().toISOString(), existing.id);
        this.db.getDb().prepare('DELETE FROM profile_keywords WHERE profile_id = ?').run(existing.id);
        this.db.getDb().prepare('DELETE FROM profile_sources WHERE profile_id = ?').run(existing.id);
        return { id: existing.id, name: existing.name, createdAt: existing.created_at, isOnboarded: false };
      }
      // Onboarded profile with same name — append a number
      let suffix = 2;
      let newName = `${name} ${suffix}`;
      while (this.db.getDb().prepare('SELECT 1 FROM profiles WHERE name = ?').get(newName)) {
        suffix++;
        newName = `${name} ${suffix}`;
      }
      name = newName;
    }

    const id = uuidv4();
    const now = new Date().toISOString();
    this.db.getDb().prepare(`
      INSERT INTO profiles (id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(id, name, now, now);
    return { id, name, createdAt: now, isOnboarded: false };
  }

  listProfiles(): ProfileSummary[] {
    const rows = this.db.getDb()
      .prepare('SELECT id, name, created_at, last_used_at, is_onboarded FROM profiles ORDER BY last_used_at DESC NULLS LAST, created_at DESC')
      .all() as any[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at || undefined,
      isOnboarded: !!r.is_onboarded,
    }));
  }

  getProfile(id: string): ProfileFull | null {
    const row = this.db.getDb()
      .prepare('SELECT * FROM profiles WHERE id = ?')
      .get(id) as any;
    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastUsedAt: row.last_used_at || undefined,
      isOnboarded: !!row.is_onboarded,
      subjects: JSON.parse(row.subjects),
      figures: JSON.parse(row.figures),
      scoringConfig: JSON.parse(row.scoring_config),
      appSettings: JSON.parse(row.app_settings),
      redditFeedTypes: JSON.parse(row.reddit_feed_types),
      redditTopTimeframe: row.reddit_top_timeframe as RedditTopTimeframe,
      keywords: this.getKeywords(id),
      sources: this.getSources(id),
    };
  }

  deleteProfile(id: string): void {
    this.db.getDb().prepare('DELETE FROM profiles WHERE id = ?').run(id);
    const activeId = this.getActiveProfileId();
    if (activeId === id) {
      // Clear active, let app handle the empty state
      this.db.getDb().prepare("DELETE FROM app_settings WHERE key = 'active_profile_id'").run();
    }
  }

  markOnboarded(id: string): void {
    this.db.getDb()
      .prepare('UPDATE profiles SET is_onboarded = 1, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
  }

  // --- Keywords ---

  addKeywords(profileId: string, keywords: string[], isSeed: boolean): void {
    const stmt = this.db.getDb().prepare(`
      INSERT OR IGNORE INTO profile_keywords (profile_id, keyword, is_seed)
      VALUES (?, ?, ?)
    `);
    const tx = this.db.getDb().transaction(() => {
      for (const kw of keywords) {
        stmt.run(profileId, kw.toLowerCase().trim(), isSeed ? 1 : 0);
      }
    });
    tx();
    this.touchProfile(profileId);
  }

  removeKeyword(profileId: string, keyword: string): void {
    this.db.getDb()
      .prepare('DELETE FROM profile_keywords WHERE profile_id = ? AND keyword = ?')
      .run(profileId, keyword);
    this.touchProfile(profileId);
  }

  getKeywords(profileId: string): ProfileKeyword[] {
    const rows = this.db.getDb()
      .prepare('SELECT id, keyword, is_seed FROM profile_keywords WHERE profile_id = ? ORDER BY is_seed DESC, keyword')
      .all(profileId) as any[];
    return rows.map((r) => ({
      id: r.id,
      keyword: r.keyword,
      isSeed: !!r.is_seed,
    }));
  }

  clearNonSeedKeywords(profileId: string): void {
    this.db.getDb()
      .prepare('DELETE FROM profile_keywords WHERE profile_id = ? AND is_seed = 0')
      .run(profileId);
  }

  // --- Sources ---

  addSource(profileId: string, source: NewProfileSource): void {
    this.db.getDb().prepare(`
      INSERT OR IGNORE INTO profile_sources (profile_id, platform, source_type, name, value, ai_suggested)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(profileId, source.platform, source.sourceType, source.name, source.value, source.aiSuggested ? 1 : 0);
    this.touchProfile(profileId);
  }

  addSources(profileId: string, sources: NewProfileSource[]): void {
    const stmt = this.db.getDb().prepare(`
      INSERT OR IGNORE INTO profile_sources (profile_id, platform, source_type, name, value, ai_suggested)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const tx = this.db.getDb().transaction(() => {
      for (const s of sources) {
        stmt.run(profileId, s.platform, s.sourceType, s.name, s.value, s.aiSuggested ? 1 : 0);
      }
    });
    tx();
    this.touchProfile(profileId);
  }

  removeSource(profileId: string, sourceId: number): void {
    this.db.getDb()
      .prepare('DELETE FROM profile_sources WHERE id = ? AND profile_id = ?')
      .run(sourceId, profileId);
    this.touchProfile(profileId);
  }

  toggleSource(profileId: string, sourceId: number, enabled: boolean): void {
    this.db.getDb()
      .prepare('UPDATE profile_sources SET enabled = ? WHERE id = ? AND profile_id = ?')
      .run(enabled ? 1 : 0, sourceId, profileId);
    this.touchProfile(profileId);
  }

  updateSourceValue(profileId: string, sourceId: number, newValue: string): void {
    this.db.getDb()
      .prepare('UPDATE profile_sources SET value = ? WHERE id = ? AND profile_id = ?')
      .run(newValue, sourceId, profileId);
    this.touchProfile(profileId);
  }

  getSources(profileId: string, platform?: string): ProfileSource[] {
    let query = 'SELECT * FROM profile_sources WHERE profile_id = ?';
    const params: any[] = [profileId];
    if (platform) {
      query += ' AND platform = ?';
      params.push(platform);
    }
    query += ' ORDER BY platform, name';
    const rows = this.db.getDb().prepare(query).all(...params) as any[];
    return rows.map((r) => ({
      id: r.id,
      platform: r.platform as Platform,
      sourceType: r.source_type,
      name: r.name,
      value: r.value,
      enabled: !!r.enabled,
      aiSuggested: !!r.ai_suggested,
    }));
  }

  clearSources(profileId: string): void {
    this.db.getDb()
      .prepare('DELETE FROM profile_sources WHERE profile_id = ?')
      .run(profileId);
  }

  // --- Subjects & Figures ---

  updateSubjects(profileId: string, subjects: SubjectProfile[]): void {
    this.db.getDb()
      .prepare('UPDATE profiles SET subjects = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(subjects), new Date().toISOString(), profileId);
  }

  removeSubject(profileId: string, subjectId: string): void {
    const profile = this.getProfile(profileId);
    if (!profile) return;
    const filtered = profile.subjects.filter((s) => s.id !== subjectId);
    this.updateSubjects(profileId, filtered);
  }

  updateFigures(profileId: string, figures: FigureProfile[]): void {
    this.db.getDb()
      .prepare('UPDATE profiles SET figures = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(figures), new Date().toISOString(), profileId);
  }

  removeFigure(profileId: string, name: string): void {
    const profile = this.getProfile(profileId);
    if (!profile) return;
    const filtered = profile.figures.filter((f) => f.name !== name);
    this.updateFigures(profileId, filtered);
  }

  // --- Profile Settings ---

  updateProfileSettings(profileId: string, settings: Partial<AppSettings>): void {
    const profile = this.getProfile(profileId);
    if (!profile) return;
    const merged = { ...profile.appSettings, ...settings };
    this.db.getDb()
      .prepare('UPDATE profiles SET app_settings = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(merged), new Date().toISOString(), profileId);
  }

  updateScoringConfig(profileId: string, config: Partial<ScoringConfig>): void {
    const profile = this.getProfile(profileId);
    if (!profile) return;
    const merged = { ...profile.scoringConfig, ...config };
    this.db.getDb()
      .prepare('UPDATE profiles SET scoring_config = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(merged), new Date().toISOString(), profileId);
  }

  // --- Build DragnetConfig ---

  buildConfigForProfile(id: string): DragnetConfig {
    const profile = this.getProfile(id);
    if (!profile) {
      this.logger.warn(`Profile ${id} not found, returning default config`);
      return { ...DEFAULT_CONFIG };
    }

    const aiSettings = this.getAISettings();
    const sources = this.getSources(id);

    const subreddits = sources
      .filter((s) => s.platform === 'reddit' && s.sourceType === 'subreddit' && s.enabled)
      .map((s) => s.value);

    const twitterAccounts = sources
      .filter((s) => s.platform === 'twitter' && s.sourceType === 'account' && s.enabled)
      .map((s) => s.value);

    const youtubeChannels: YouTubeChannel[] = sources
      .filter((s) => s.platform === 'youtube' && s.sourceType === 'channel' && s.enabled)
      .map((s) => ({ name: s.name, channelId: s.value }));

    const tiktokAccounts = sources
      .filter((s) => s.platform === 'tiktok' && s.sourceType === 'account' && s.enabled)
      .map((s) => s.value);

    const tiktokHashtags = sources
      .filter((s) => s.platform === 'tiktok' && s.sourceType === 'hashtag' && s.enabled)
      .map((s) => s.value);

    const rssFeeds: RssFeed[] = sources
      .filter((s) => s.platform === 'web' && s.sourceType === 'feed' && s.enabled)
      .map((s) => ({ name: s.name, url: s.value }));

    const scoringConfig = profile.scoringConfig || {};

    return {
      sources: {
        twitter: {
          enabled: twitterAccounts.length > 0,
          accounts: twitterAccounts,
        },
        reddit: {
          enabled: subreddits.length > 0,
          subreddits,
          feedTypes: (profile.redditFeedTypes || ['hot', 'top', 'new']) as any,
          topTimeframe: profile.redditTopTimeframe || 'week',
        },
        youtube: {
          enabled: youtubeChannels.length > 0,
          channels: youtubeChannels,
        },
        tiktok: {
          enabled: tiktokAccounts.length > 0 || tiktokHashtags.length > 0,
          accounts: tiktokAccounts,
          hashtags: tiktokHashtags,
        },
        webRss: {
          enabled: rssFeeds.length > 0,
          feeds: rssFeeds,
        },
        redditSearch: { enabled: true },
        googleNews: { enabled: true },
        tiktokDiscovery: { enabled: true },
        instagramDiscovery: { enabled: true },
        substackDiscovery: { enabled: true },
        twitterDiscovery: { enabled: true },
      },
      scoring: {
        aiProvider: (aiSettings.ai_provider as any) || DEFAULT_CONFIG.scoring.aiProvider,
        aiModel: aiSettings.ai_model || DEFAULT_CONFIG.scoring.aiModel,
        ollamaEndpoint: aiSettings.ollama_endpoint || DEFAULT_CONFIG.scoring.ollamaEndpoint,
        claudeApiKey: aiSettings.claude_api_key,
        openaiApiKey: aiSettings.openai_api_key,
        batchSize: (scoringConfig as any).batchSize ?? DEFAULT_CONFIG.scoring.batchSize,
        editorialNotes: (scoringConfig as any).editorialNotes ?? DEFAULT_CONFIG.scoring.editorialNotes,
        weights: (scoringConfig as any).weights ?? DEFAULT_CONFIG.scoring.weights,
      },
      subjects: profile.subjects.length > 0 ? profile.subjects : [],
      figures: profile.figures.length > 0 ? profile.figures : [],
      settings: { ...DEFAULT_CONFIG.settings, ...profile.appSettings },
    };
  }

  // --- Duplicate & Rename ---

  duplicateProfile(sourceId: string, newName: string): ProfileSummary {
    const source = this.getProfile(sourceId);
    if (!source) throw new Error('Source profile not found');

    const newProfile = this.createProfile(newName);
    const newId = newProfile.id;

    // Copy keywords
    const keywords = this.getKeywords(sourceId);
    const seedKws = keywords.filter((k) => k.isSeed).map((k) => k.keyword);
    const nonSeedKws = keywords.filter((k) => !k.isSeed).map((k) => k.keyword);
    if (seedKws.length > 0) this.addKeywords(newId, seedKws, true);
    if (nonSeedKws.length > 0) this.addKeywords(newId, nonSeedKws, false);

    // Copy sources
    const sources = this.getSources(sourceId);
    const newSources: NewProfileSource[] = sources.map((s) => ({
      platform: s.platform,
      sourceType: s.sourceType,
      name: s.name,
      value: s.value,
      aiSuggested: s.aiSuggested,
    }));
    if (newSources.length > 0) this.addSources(newId, newSources);

    // Copy subjects, figures, scoring config, app settings
    if (source.subjects.length > 0) this.updateSubjects(newId, source.subjects);
    if (source.figures.length > 0) this.updateFigures(newId, source.figures);
    if (Object.keys(source.scoringConfig).length > 0) this.updateScoringConfig(newId, source.scoringConfig);
    if (Object.keys(source.appSettings).length > 0) this.updateProfileSettings(newId, source.appSettings);

    // Copy reddit settings via direct SQL
    this.db.getDb().prepare(`
      UPDATE profiles SET reddit_feed_types = ?, reddit_top_timeframe = ? WHERE id = ?
    `).run(JSON.stringify(source.redditFeedTypes), source.redditTopTimeframe, newId);

    this.markOnboarded(newId);
    this.logger.log(`Duplicated profile "${source.name}" → "${newName}" (${newId})`);

    return { id: newId, name: newProfile.name, createdAt: newProfile.createdAt, isOnboarded: true };
  }

  renameProfile(id: string, newName: string): void {
    const existing = this.db.getDb()
      .prepare('SELECT id FROM profiles WHERE name = ? AND id != ?')
      .get(newName, id);
    if (existing) throw new Error(`Profile name "${newName}" already exists`);

    this.db.getDb()
      .prepare('UPDATE profiles SET name = ?, updated_at = ? WHERE id = ?')
      .run(newName, new Date().toISOString(), id);
  }

  // --- Helpers ---

  private touchProfile(id: string): void {
    this.db.getDb()
      .prepare('UPDATE profiles SET updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
  }
}
