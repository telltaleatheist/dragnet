import { Module } from '@nestjs/common';
import { AIProviderService } from './ai-provider.service';
import { PreFilterService } from './pre-filter.service';
import { ScoringPromptService } from './scoring-prompt.service';
import { ScoringService } from './scoring.service';

@Module({
  providers: [
    AIProviderService,
    PreFilterService,
    ScoringPromptService,
    ScoringService,
  ],
  exports: [ScoringService, AIProviderService, PreFilterService],
})
export class ScoringModule {}
