import { Injectable, Logger } from '@nestjs/common';
import { ProfileService } from './profile.service';
import { SourceDiscoveryService } from './source-discovery.service';
import { AIProviderService, AIProviderConfig } from '../scoring/ai-provider.service';
import {
  buildKeywordExpansionPrompt,
  buildSubjectDerivationPrompt,
  buildSourceDiscoveryPrompt,
  ONBOARDING_SYSTEM_PROMPT,
} from './onboarding-prompts';
import type {
  ExpandedKeyword,
  SubjectProfile,
  FigureProfile,
  NewProfileSource,
  DiscoveredSource,
} from '../../../shared/types';

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private readonly profileService: ProfileService,
    private readonly sourceDiscovery: SourceDiscoveryService,
    private readonly aiProvider: AIProviderService,
  ) {}

  initProfile(name: string, seedKeywords: string[]): { profileId: string } {
    const profile = this.profileService.createProfile(name);
    this.profileService.addKeywords(profile.id, seedKeywords, true);
    return { profileId: profile.id };
  }

  async expandKeywords(profileId: string): Promise<{ keywords: ExpandedKeyword[] }> {
    const seeds = this.profileService.getKeywords(profileId)
      .filter((k) => k.isSeed)
      .map((k) => k.keyword);

    if (seeds.length === 0) {
      return { keywords: [] };
    }

    const aiConfig = this.getAIConfig();
    const prompt = buildKeywordExpansionPrompt(seeds);

    const response = await this.aiProvider.generateText(prompt, aiConfig, 8192, ONBOARDING_SYSTEM_PROMPT);
    const parsed = this.parseJSON<{ expanded: string[]; reasoning: string[] }>(response.text);

    if (!parsed?.expanded?.length) {
      this.logger.warn('AI returned no expanded keywords');
      return { keywords: [] };
    }

    // Save expanded keywords (non-seed)
    this.profileService.clearNonSeedKeywords(profileId);
    this.profileService.addKeywords(profileId, parsed.expanded, false);

    const keywords: ExpandedKeyword[] = parsed.expanded.map((kw, i) => ({
      keyword: kw,
      reasoning: parsed.reasoning?.[i] || '',
    }));

    return { keywords };
  }

  async deriveSubjects(profileId: string): Promise<{ subjects: SubjectProfile[]; figures: FigureProfile[] }> {
    const allKeywords = this.profileService.getKeywords(profileId).map((k) => k.keyword);

    if (allKeywords.length === 0) {
      return { subjects: [], figures: [] };
    }

    const aiConfig = this.getAIConfig();
    const prompt = buildSubjectDerivationPrompt(allKeywords);

    const response = await this.aiProvider.generateText(prompt, aiConfig, 8192, ONBOARDING_SYSTEM_PROMPT);
    const parsed = this.parseJSON<{ subjects: SubjectProfile[]; figures: FigureProfile[] }>(response.text);

    if (!parsed) {
      this.logger.warn('AI returned no subjects/figures');
      return { subjects: [], figures: [] };
    }

    const subjects = (parsed.subjects || []).map((s) => ({
      ...s,
      enabled: s.enabled ?? true,
      priority: s.priority ?? 2,
    }));

    const figures = (parsed.figures || []).map((f) => ({
      ...f,
      tier: f.tier || 'monitor',
      aliases: f.aliases || [],
      subjects: f.subjects || [],
    }));

    // Save to profile
    this.profileService.updateSubjects(profileId, subjects);
    this.profileService.updateFigures(profileId, figures);

    return { subjects, figures };
  }

  async discoverSources(profileId: string): Promise<{ sources: DiscoveredSource[] }> {
    const profile = this.profileService.getProfile(profileId);
    if (!profile) return { sources: [] };

    const keywords = profile.keywords.map((k) => k.keyword);
    const subjects = profile.subjects.map((s) => ({ id: s.id, label: s.label }));
    const figures = profile.figures.map((f) => ({ name: f.name, aliases: f.aliases }));

    // Two-stage: AI suggestions + Reddit API validation
    const [aiSources, redditSubs] = await Promise.all([
      this.getAISuggestedSources(keywords, subjects, figures),
      this.sourceDiscovery.discoverSubredditsForKeywords(
        keywords.slice(0, 10),
      ),
    ]);

    // Merge Reddit API results with AI suggestions
    const allSources: NewProfileSource[] = [];
    const discovered: DiscoveredSource[] = [];
    const seen = new Set<string>();

    // Add AI-suggested sources
    if (aiSources) {
      for (const tw of aiSources.twitter || []) {
        const key = `twitter:${tw.handle.toLowerCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          allSources.push({ platform: 'twitter', sourceType: 'account', name: `@${tw.handle}`, value: tw.handle, aiSuggested: true });
          discovered.push({ platform: 'twitter', sourceType: 'account', name: `@${tw.handle}`, value: tw.handle, rationale: tw.rationale });
        }
      }

      for (const sub of aiSources.subreddits || []) {
        // Strip r/ prefix if AI included it (prompt asks for bare name but models sometimes add it)
        const cleanName = sub.name.replace(/^r\//i, '');
        const key = `reddit:${cleanName.toLowerCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          allSources.push({ platform: 'reddit', sourceType: 'subreddit', name: `r/${cleanName}`, value: cleanName, aiSuggested: true });
          discovered.push({ platform: 'reddit', sourceType: 'subreddit', name: `r/${cleanName}`, value: cleanName, rationale: sub.rationale });
        }
      }

      for (const yt of aiSources.youtube || []) {
        const key = `youtube:${yt.name.toLowerCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          allSources.push({ platform: 'youtube', sourceType: 'channel', name: yt.name, value: yt.channelId || yt.name, aiSuggested: true });
          discovered.push({ platform: 'youtube', sourceType: 'channel', name: yt.name, value: yt.channelId || yt.name, rationale: yt.rationale });
        }
      }

      for (const rss of aiSources.rss || []) {
        const key = `web:${rss.url.toLowerCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          allSources.push({ platform: 'web', sourceType: 'feed', name: rss.name, value: rss.url, aiSuggested: true });
          discovered.push({ platform: 'web', sourceType: 'feed', name: rss.name, value: rss.url, rationale: rss.rationale });
        }
      }

      if (aiSources.tiktok) {
        for (const acc of aiSources.tiktok.accounts || []) {
          const key = `tiktok:account:${acc.handle.toLowerCase()}`;
          if (!seen.has(key)) {
            seen.add(key);
            allSources.push({ platform: 'tiktok', sourceType: 'account', name: `@${acc.handle}`, value: acc.handle, aiSuggested: true });
            discovered.push({ platform: 'tiktok', sourceType: 'account', name: `@${acc.handle}`, value: acc.handle, rationale: acc.rationale });
          }
        }
        for (const ht of aiSources.tiktok.hashtags || []) {
          const key = `tiktok:hashtag:${ht.tag.toLowerCase()}`;
          if (!seen.has(key)) {
            seen.add(key);
            allSources.push({ platform: 'tiktok', sourceType: 'hashtag', name: `#${ht.tag}`, value: ht.tag, aiSuggested: true });
            discovered.push({ platform: 'tiktok', sourceType: 'hashtag', name: `#${ht.tag}`, value: ht.tag, rationale: ht.rationale });
          }
        }
      }
    }

    // Add Reddit API-discovered subreddits not already present
    // (These are already validated — they came from the Reddit API itself)
    for (const sub of redditSubs) {
      const key = `reddit:${sub.name.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        allSources.push({ platform: 'reddit', sourceType: 'subreddit', name: `r/${sub.name}`, value: sub.name });
        discovered.push({
          platform: 'reddit',
          sourceType: 'subreddit',
          name: `r/${sub.name}`,
          value: sub.name,
          rationale: `${sub.subscribers.toLocaleString()} subscribers — ${sub.description.slice(0, 100)}`,
        });
      }
    }

    // Validate all AI-suggested sources (Reddit API ones are already verified)
    this.logger.log(`Validating ${allSources.length} sources...`);
    const { valid, invalid } = await this.sourceDiscovery.validateSources(
      allSources.map((s) => ({ platform: s.platform, sourceType: s.sourceType, name: s.name, value: s.value })),
    );

    if (invalid.length > 0) {
      this.logger.warn(`Dropped ${invalid.length} invalid sources: ${invalid.map((s) => `${s.name} (${s.reason})`).join(', ')}`);
    }

    // Rebuild the sources list with validated values (e.g. resolved YouTube IDs)
    const validatedSources: NewProfileSource[] = valid.map((v) => {
      const original = allSources.find(
        (s) => s.platform === v.platform && s.name === v.name,
      );
      return {
        platform: v.platform as any,
        sourceType: v.sourceType,
        name: v.name,
        value: v.value, // May have been updated (e.g. YouTube channel ID resolved)
        aiSuggested: original?.aiSuggested,
      };
    });

    // Rebuild discovered list to match validated sources
    const validKeys = new Set(valid.map((v) => `${v.platform}:${v.name}`));
    const validatedDiscovered = discovered
      .filter((d) => validKeys.has(`${d.platform}:${d.name}`))
      .map((d) => {
        const resolved = valid.find((v) => v.platform === d.platform && v.name === d.name);
        return resolved ? { ...d, value: resolved.value } : d;
      });

    // Save validated sources
    this.profileService.clearSources(profileId);
    this.profileService.addSources(profileId, validatedSources);

    return { sources: validatedDiscovered };
  }

  finalizeProfile(profileId: string): void {
    this.profileService.markOnboarded(profileId);
    this.profileService.setActiveProfileId(profileId);
  }

  // --- Helpers ---

  private getAIConfig(): AIProviderConfig {
    const settings = this.profileService.getAISettings();
    const provider = (settings.ai_provider || 'ollama') as AIProviderConfig['provider'];
    return {
      provider,
      model: settings.ai_model || 'cogito:70b',
      apiKey: provider === 'claude' ? settings.claude_api_key : settings.openai_api_key,
      ollamaEndpoint: settings.ollama_endpoint || 'http://localhost:11434',
    };
  }

  private async getAISuggestedSources(
    keywords: string[],
    subjects: { id: string; label: string }[],
    figures: { name: string; aliases: string[] }[],
  ) {
    try {
      const aiConfig = this.getAIConfig();
      const prompt = buildSourceDiscoveryPrompt(keywords, subjects, figures);
      const response = await this.aiProvider.generateText(prompt, aiConfig, 8192, ONBOARDING_SYSTEM_PROMPT);
      return this.parseJSON<any>(response.text);
    } catch (err) {
      this.logger.warn(`AI source discovery failed: ${(err as Error).message}`);
      return null;
    }
  }

  private parseJSON<T>(text: string): T | null {
    try {
      let jsonStr = text.trim();
      const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) {
        jsonStr = fenceMatch[1].trim();
      }
      return JSON.parse(jsonStr) as T;
    } catch (err) {
      this.logger.error(`Failed to parse AI response as JSON: ${(err as Error).message}`);
      this.logger.debug(`Raw: ${text.slice(0, 500)}`);
      return null;
    }
  }
}
