import { Module } from '@nestjs/common';
import { AIProviderService } from './ai-provider.service';
import { PreFilterService } from './pre-filter.service';
import { ScoringPromptService } from './scoring-prompt.service';
import { ScoringService } from './scoring.service';
import { ClusteringPromptService } from './clustering-prompt.service';
import { ClusteringService } from './clustering.service';
import { ExpansionPromptService } from './expansion-prompt.service';

@Module({
  providers: [
    AIProviderService,
    PreFilterService,
    ScoringPromptService,
    ScoringService,
    ClusteringPromptService,
    ClusteringService,
    ExpansionPromptService,
  ],
  exports: [ScoringService, ClusteringService, AIProviderService, PreFilterService, ExpansionPromptService],
})
export class ScoringModule {}
