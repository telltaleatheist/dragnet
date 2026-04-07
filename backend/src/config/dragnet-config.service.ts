import { Injectable, Logger, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { getDataDir } from '../utils/app-paths';
import { DEFAULT_CONFIG } from './default-config';
import { ProfileService } from '../profile/profile.service';

export {
  DragnetConfig,
  SourcesConfig,
  ScoringConfig,
  SubjectProfile,
  FigureProfile,
  AppSettings,
} from '../../../shared/types';

import {
  DragnetConfig,
  SubjectProfile,
  FigureProfile,
} from '../../../shared/types';

@Injectable()
export class DragnetConfigService implements OnModuleInit {
  private readonly logger = new Logger(DragnetConfigService.name);
  private config!: DragnetConfig;

  constructor(
    @Inject(forwardRef(() => ProfileService))
    private readonly profileService: ProfileService,
  ) {}

  onModuleInit() {
    this.loadFromProfiles();
  }

  private loadFromProfiles(): void {
    const profiles = this.profileService.listProfiles();

    if (profiles.length === 0) {
      // Check for legacy JSON config to migrate
      const jsonPath = this.getConfigPath();
      if (fs.existsSync(jsonPath)) {
        this.logger.log('Found legacy JSON config — migrating to profile...');
        this.migrateFromJson(jsonPath);
        return;
      }

      // No profiles, no JSON — use defaults (user will see wizard)
      this.logger.log('No profiles found, using default config');
      this.config = { ...DEFAULT_CONFIG };
      return;
    }

    // Load active profile
    let activeId = this.profileService.getActiveProfileId();
    if (!activeId || !profiles.find((p) => p.id === activeId)) {
      activeId = profiles[0].id;
      this.profileService.setActiveProfileId(activeId);
    }

    this.config = this.profileService.buildConfigForProfile(activeId);
    this.logger.log(`Loaded config from profile: ${profiles.find((p) => p.id === activeId)?.name}`);
  }

  private migrateFromJson(jsonPath: string): void {
    try {
      const raw = fs.readFileSync(jsonPath, 'utf-8');
      const loaded = JSON.parse(raw) as DragnetConfig;
      const merged = this.mergeWithDefaults(loaded);

      // Create a profile from the JSON config
      const profile = this.profileService.createProfile('Migrated Profile');

      // Save subjects & figures
      this.profileService.updateSubjects(profile.id, merged.subjects);
      this.profileService.updateFigures(profile.id, merged.figures);

      // Save scoring config (without API keys — those go to app_settings)
      this.profileService.updateScoringConfig(profile.id, {
        batchSize: merged.scoring.batchSize,
        editorialNotes: merged.scoring.editorialNotes,
        weights: merged.scoring.weights,
      } as any);

      // Save app settings
      this.profileService.updateProfileSettings(profile.id, merged.settings);

      // Migrate AI keys to app_settings
      const aiSettings: Record<string, string> = {
        ai_provider: merged.scoring.aiProvider,
        ai_model: merged.scoring.aiModel,
        ollama_endpoint: merged.scoring.ollamaEndpoint,
      };
      if (merged.scoring.claudeApiKey) aiSettings.claude_api_key = merged.scoring.claudeApiKey;
      if (merged.scoring.openaiApiKey) aiSettings.openai_api_key = merged.scoring.openaiApiKey;
      this.profileService.updateAISettings(aiSettings);

      // Migrate sources
      const sources: any[] = [];
      if (merged.sources.reddit?.subreddits) {
        for (const sub of merged.sources.reddit.subreddits) {
          sources.push({ platform: 'reddit', sourceType: 'subreddit', name: `r/${sub}`, value: sub });
        }
      }
      if (merged.sources.twitter?.accounts) {
        for (const acc of merged.sources.twitter.accounts) {
          sources.push({ platform: 'twitter', sourceType: 'account', name: `@${acc}`, value: acc });
        }
      }
      if (merged.sources.youtube?.channels) {
        for (const ch of merged.sources.youtube.channels) {
          sources.push({ platform: 'youtube', sourceType: 'channel', name: ch.name, value: ch.channelId });
        }
      }
      if (merged.sources.tiktok?.accounts) {
        for (const acc of merged.sources.tiktok.accounts) {
          sources.push({ platform: 'tiktok', sourceType: 'account', name: `@${acc}`, value: acc });
        }
      }
      if (merged.sources.tiktok?.hashtags) {
        for (const tag of merged.sources.tiktok.hashtags) {
          sources.push({ platform: 'tiktok', sourceType: 'hashtag', name: `#${tag}`, value: tag });
        }
      }
      if (merged.sources.webRss?.feeds) {
        for (const feed of merged.sources.webRss.feeds) {
          sources.push({ platform: 'web', sourceType: 'feed', name: feed.name, value: feed.url });
        }
      }
      this.profileService.addSources(profile.id, sources);

      // Mark as onboarded and activate
      this.profileService.markOnboarded(profile.id);
      this.profileService.setActiveProfileId(profile.id);

      // Rename JSON to backup
      const backupPath = jsonPath.replace('.json', '.json.backup');
      fs.renameSync(jsonPath, backupPath);
      this.logger.log(`Migrated JSON config to profile "${profile.name}", backed up to ${backupPath}`);

      this.config = this.profileService.buildConfigForProfile(profile.id);
    } catch (err) {
      this.logger.error(`Migration failed: ${(err as Error).message}`);
      this.config = { ...DEFAULT_CONFIG };
    }
  }

  getConfig(): DragnetConfig {
    return this.config;
  }

  updateConfig(partial: Partial<DragnetConfig>): DragnetConfig {
    if (partial.scoring) {
      partial.scoring = { ...this.config.scoring, ...partial.scoring };
    }
    if (partial.settings) {
      partial.settings = { ...this.config.settings, ...partial.settings };
    }
    if (partial.sources) {
      partial.sources = { ...this.config.sources, ...partial.sources };
    }
    this.config = { ...this.config, ...partial };

    // Also persist scoring keys to app_settings
    if (partial.scoring) {
      const aiSettings: Record<string, string> = {};
      if (partial.scoring.aiProvider) aiSettings.ai_provider = partial.scoring.aiProvider;
      if (partial.scoring.aiModel) aiSettings.ai_model = partial.scoring.aiModel;
      if (partial.scoring.ollamaEndpoint) aiSettings.ollama_endpoint = partial.scoring.ollamaEndpoint;
      if (partial.scoring.claudeApiKey) aiSettings.claude_api_key = partial.scoring.claudeApiKey;
      if (partial.scoring.openaiApiKey) aiSettings.openai_api_key = partial.scoring.openaiApiKey;
      if (Object.keys(aiSettings).length > 0) {
        this.profileService.updateAISettings(aiSettings);
      }
    }

    return this.config;
  }

  switchProfile(id: string): void {
    this.profileService.setActiveProfileId(id);
    this.config = this.profileService.buildConfigForProfile(id);
    this.logger.log(`Switched to profile ${id}`);
  }

  reloadActiveProfile(): void {
    const activeId = this.profileService.getActiveProfileId();
    if (activeId) {
      this.config = this.profileService.buildConfigForProfile(activeId);
    }
  }

  getSubjects(): SubjectProfile[] {
    return this.config.subjects;
  }

  updateSubjects(subjects: SubjectProfile[]): SubjectProfile[] {
    this.config.subjects = subjects;
    const activeId = this.profileService.getActiveProfileId();
    if (activeId) {
      this.profileService.updateSubjects(activeId, subjects);
    }
    return this.config.subjects;
  }

  getFigures(): FigureProfile[] {
    return this.config.figures;
  }

  updateFigures(figures: FigureProfile[]): FigureProfile[] {
    this.config.figures = figures;
    const activeId = this.profileService.getActiveProfileId();
    if (activeId) {
      this.profileService.updateFigures(activeId, figures);
    }
    return this.config.figures;
  }

  updateScoringKeys(keys: { claudeApiKey?: string; openaiApiKey?: string }): void {
    if (keys.claudeApiKey !== undefined) {
      this.config.scoring.claudeApiKey = keys.claudeApiKey;
      this.profileService.updateAISettings({ claude_api_key: keys.claudeApiKey });
    }
    if (keys.openaiApiKey !== undefined) {
      this.config.scoring.openaiApiKey = keys.openaiApiKey;
      this.profileService.updateAISettings({ openai_api_key: keys.openaiApiKey });
    }
  }

  private getConfigPath(): string {
    return path.join(getDataDir(), 'dragnet.config.json');
  }

  private mergeWithDefaults(loaded: Partial<DragnetConfig>): DragnetConfig {
    return {
      sources: loaded.sources
        ? { ...DEFAULT_CONFIG.sources, ...loaded.sources }
        : DEFAULT_CONFIG.sources,
      scoring: { ...DEFAULT_CONFIG.scoring, ...loaded.scoring },
      subjects: loaded.subjects ?? DEFAULT_CONFIG.subjects,
      figures: loaded.figures ?? DEFAULT_CONFIG.figures,
      settings: { ...DEFAULT_CONFIG.settings, ...loaded.settings },
    };
  }
}
