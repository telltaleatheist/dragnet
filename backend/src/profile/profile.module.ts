import { Module, Global } from '@nestjs/common';
import { ProfileService } from './profile.service';
import { ProfileController, AppSettingsController } from './profile.controller';
import { OnboardingService } from './onboarding.service';
import { SourceDiscoveryService } from './source-discovery.service';
import { ScoringModule } from '../scoring/scoring.module';

@Global()
@Module({
  imports: [ScoringModule],
  controllers: [ProfileController, AppSettingsController],
  providers: [ProfileService, OnboardingService, SourceDiscoveryService],
  exports: [ProfileService, SourceDiscoveryService],
})
export class ProfileModule {}
