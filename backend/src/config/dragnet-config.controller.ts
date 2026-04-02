import { Controller, Get, Put, Post, Body, Query, Logger } from '@nestjs/common';
import { DragnetConfigService } from './dragnet-config.service';
import { AIProviderService } from '../scoring/ai-provider.service';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type {
  DragnetConfig,
  SubjectProfile,
  FigureProfile,
} from '../../../shared/types';

@Controller('config')
export class DragnetConfigController {
  constructor(
    private readonly configService: DragnetConfigService,
    private readonly aiProvider: AIProviderService,
  ) {}

  @Get()
  getConfig(): DragnetConfig {
    return this.configService.getConfig();
  }

  @Put()
  updateConfig(@Body() body: Partial<DragnetConfig>): DragnetConfig {
    return this.configService.updateConfig(body);
  }

  @Get('subjects')
  getSubjects(): SubjectProfile[] {
    return this.configService.getSubjects();
  }

  @Put('subjects')
  updateSubjects(@Body() subjects: SubjectProfile[]): SubjectProfile[] {
    return this.configService.updateSubjects(subjects);
  }

  @Get('figures')
  getFigures(): FigureProfile[] {
    return this.configService.getFigures();
  }

  @Put('figures')
  updateFigures(@Body() figures: FigureProfile[]): FigureProfile[] {
    return this.configService.updateFigures(figures);
  }

  @Put('ai')
  updateAiKeys(@Body() body: { claudeApiKey?: string; openaiApiKey?: string }): { success: boolean } {
    this.configService.updateScoringKeys(body);
    return { success: true };
  }

  @Post('ai/test')
  async testAiProvider(@Body() body: {
    provider: string;
    model: string;
    apiKey?: string;
    ollamaEndpoint?: string;
  }): Promise<{ success: boolean; error?: string }> {
    return this.aiProvider.testProvider({
      provider: body.provider as any,
      model: body.model,
      apiKey: body.apiKey,
      ollamaEndpoint: body.ollamaEndpoint,
    });
  }

  private readonly logger = new Logger(DragnetConfigController.name);

  @Get('ollama/models')
  async getOllamaModels(): Promise<string[]> {
    const config = this.configService.getConfig();
    const endpoint = config.scoring.ollamaEndpoint || 'http://localhost:11434';
    try {
      const response = await fetch(`${endpoint}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return [];
      const data = await response.json();
      return (data.models || []).map((m: any) => m.name);
    } catch {
      return [];
    }
  }

  @Get('claude/models')
  async getClaudeModels(@Query('apiKey') apiKey?: string): Promise<string[]> {
    const key = apiKey || this.configService.getConfig().scoring.claudeApiKey;
    if (!key) return [];
    try {
      const client = new Anthropic({ apiKey: key });
      const response = await client.models.list({ limit: 50 });
      return response.data
        .map((m: any) => m.id)
        .filter((id: string) => !id.includes('@'));
    } catch (err) {
      this.logger.debug(`Failed to fetch Claude models: ${(err as Error).message}`);
      return [];
    }
  }

  @Get('openai/models')
  async getOpenAIModels(@Query('apiKey') apiKey?: string): Promise<string[]> {
    const key = apiKey || this.configService.getConfig().scoring.openaiApiKey;
    if (!key) return [];
    try {
      const client = new OpenAI({ apiKey: key });
      const response = await client.models.list();
      const chatModels = response.data
        .map((m) => m.id)
        .filter((id) => id.startsWith('gpt-'))
        .sort();
      return chatModels;
    } catch (err) {
      this.logger.debug(`Failed to fetch OpenAI models: ${(err as Error).message}`);
      return [];
    }
  }
}
