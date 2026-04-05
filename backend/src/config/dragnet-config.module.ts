import { Module, Global, forwardRef } from '@nestjs/common';
import { DragnetConfigService } from './dragnet-config.service';
import { DragnetConfigController } from './dragnet-config.controller';
import { ScoringModule } from '../scoring/scoring.module';
import { ProfileModule } from '../profile/profile.module';

@Global()
@Module({
  imports: [ScoringModule, forwardRef(() => ProfileModule)],
  controllers: [DragnetConfigController],
  providers: [DragnetConfigService],
  exports: [DragnetConfigService],
})
export class DragnetConfigModule {}
