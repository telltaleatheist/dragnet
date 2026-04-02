import { Module, Global } from '@nestjs/common';
import { DragnetConfigService } from './dragnet-config.service';
import { DragnetConfigController } from './dragnet-config.controller';
import { ScoringModule } from '../scoring/scoring.module';

@Global()
@Module({
  imports: [ScoringModule],
  controllers: [DragnetConfigController],
  providers: [DragnetConfigService],
  exports: [DragnetConfigService],
})
export class DragnetConfigModule {}
