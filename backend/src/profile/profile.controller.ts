import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  HttpException,
  HttpStatus,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ProfileService } from './profile.service';
import { OnboardingService } from './onboarding.service';
import { SourceDiscoveryService } from './source-discovery.service';
import { DragnetConfigService } from '../config/dragnet-config.service';
import type {
  ProfileSummary,
  ProfileFull,
  NewProfileSource,
  SubjectProfile,
  FigureProfile,
} from '../../../shared/types';

@Controller('profiles')
export class ProfileController {
  constructor(
    private readonly profileService: ProfileService,
    private readonly onboardingService: OnboardingService,
    private readonly sourceDiscovery: SourceDiscoveryService,
    @Inject(forwardRef(() => DragnetConfigService))
    private readonly configService: DragnetConfigService,
  ) {}

  // --- Profile CRUD ---

  @Get()
  listProfiles(): ProfileSummary[] {
    return this.profileService.listProfiles();
  }

  @Post()
  createProfile(@Body() body: { name: string }): ProfileSummary {
    if (!body.name?.trim()) {
      throw new HttpException('Profile name is required', HttpStatus.BAD_REQUEST);
    }
    return this.profileService.createProfile(body.name.trim());
  }

  @Get('active')
  getActiveProfile(): { id: string | null } {
    return { id: this.profileService.getActiveProfileId() };
  }

  @Put(':id/activate')
  activateProfile(@Param('id') id: string): { success: boolean } {
    const profile = this.profileService.getProfile(id);
    if (!profile) {
      throw new HttpException('Profile not found', HttpStatus.NOT_FOUND);
    }
    this.configService.switchProfile(id);
    return { success: true };
  }

  @Get(':id')
  getProfile(@Param('id') id: string): ProfileFull {
    const profile = this.profileService.getProfile(id);
    if (!profile) {
      throw new HttpException('Profile not found', HttpStatus.NOT_FOUND);
    }
    return profile;
  }

  @Delete(':id')
  deleteProfile(@Param('id') id: string): { success: boolean } {
    this.profileService.deleteProfile(id);
    return { success: true };
  }

  @Post(':id/duplicate')
  duplicateProfile(@Param('id') id: string, @Body() body: { name: string }): ProfileSummary {
    this.ensureProfile(id);
    if (!body.name?.trim()) {
      throw new HttpException('New profile name is required', HttpStatus.BAD_REQUEST);
    }
    return this.profileService.duplicateProfile(id, body.name.trim());
  }

  @Put(':id/rename')
  renameProfile(@Param('id') id: string, @Body() body: { name: string }): { success: boolean } {
    this.ensureProfile(id);
    if (!body.name?.trim()) {
      throw new HttpException('New name is required', HttpStatus.BAD_REQUEST);
    }
    this.profileService.renameProfile(id, body.name.trim());
    return { success: true };
  }

  // --- Onboarding ---

  @Post('onboard/init')
  initProfile(@Body() body: { name: string; seedKeywords: string[] }): { profileId: string } {
    if (!body.name?.trim()) {
      throw new HttpException('Profile name is required', HttpStatus.BAD_REQUEST);
    }
    if (!body.seedKeywords?.length) {
      throw new HttpException('At least one seed keyword is required', HttpStatus.BAD_REQUEST);
    }
    const result = this.onboardingService.initProfile(body.name.trim(), body.seedKeywords);
    return result;
  }

  @Post('onboard/:id/expand')
  async expandKeywords(@Param('id') id: string) {
    this.ensureProfile(id);
    return this.onboardingService.expandKeywords(id);
  }

  @Post('onboard/:id/derive')
  async deriveSubjects(@Param('id') id: string) {
    this.ensureProfile(id);
    return this.onboardingService.deriveSubjects(id);
  }

  @Post('onboard/:id/discover')
  async discoverSources(@Param('id') id: string) {
    this.ensureProfile(id);
    return this.onboardingService.discoverSources(id);
  }

  @Post('onboard/:id/finalize')
  finalizeProfile(@Param('id') id: string): { success: boolean } {
    this.ensureProfile(id);
    this.onboardingService.finalizeProfile(id);
    this.configService.reloadActiveProfile();
    return { success: true };
  }

  // --- Keywords ---

  @Get(':id/keywords')
  getKeywords(@Param('id') id: string) {
    this.ensureProfile(id);
    return this.profileService.getKeywords(id);
  }

  @Post(':id/keywords')
  addKeywords(@Param('id') id: string, @Body() body: { keywords: string[]; isSeed?: boolean }) {
    this.ensureProfile(id);
    this.profileService.addKeywords(id, body.keywords, body.isSeed ?? false);
    return this.profileService.getKeywords(id);
  }

  @Delete(':id/keywords/:keyword')
  removeKeyword(@Param('id') id: string, @Param('keyword') keyword: string) {
    this.ensureProfile(id);
    this.profileService.removeKeyword(id, decodeURIComponent(keyword));
    return { success: true };
  }

  // --- Sources ---

  @Get(':id/sources')
  getSources(@Param('id') id: string, @Query('platform') platform?: string) {
    this.ensureProfile(id);
    return this.profileService.getSources(id, platform);
  }

  @Post(':id/sources')
  addSource(@Param('id') id: string, @Body() body: NewProfileSource) {
    this.ensureProfile(id);
    this.profileService.addSource(id, body);
    this.configService.reloadActiveProfile();
    return this.profileService.getSources(id);
  }

  @Delete(':id/sources/:sourceId')
  removeSource(@Param('id') id: string, @Param('sourceId') sourceId: string) {
    this.ensureProfile(id);
    this.profileService.removeSource(id, parseInt(sourceId, 10));
    this.configService.reloadActiveProfile();
    return { success: true };
  }

  @Put(':id/sources/:sourceId/toggle')
  toggleSource(
    @Param('id') id: string,
    @Param('sourceId') sourceId: string,
    @Body() body: { enabled: boolean },
  ) {
    this.ensureProfile(id);
    this.profileService.toggleSource(id, parseInt(sourceId, 10), body.enabled);
    this.configService.reloadActiveProfile();
    return { success: true };
  }

  // --- Source Maintenance ---

  @Post(':id/sources/resolve-youtube')
  async resolveYouTubeSources(@Param('id') id: string) {
    this.ensureProfile(id);
    const sources = this.profileService.getSources(id, 'youtube');
    const unresolved = sources.filter((s) => !s.value.startsWith('UC'));

    if (unresolved.length === 0) {
      return { resolved: 0, failed: 0, results: [] };
    }

    const results: { name: string; oldValue: string; newValue?: string; error?: string }[] = [];
    let resolved = 0;
    let failed = 0;

    for (const source of unresolved) {
      const result = await this.sourceDiscovery.resolveYouTubeChannelId(source.value);
      if (result.valid && result.resolvedValue) {
        this.profileService.updateSourceValue(id, source.id, result.resolvedValue);
        results.push({ name: source.name, oldValue: source.value, newValue: result.resolvedValue });
        resolved++;
      } else {
        results.push({ name: source.name, oldValue: source.value, error: result.reason });
        failed++;
      }
      // Rate limit between YouTube searches
      await new Promise((r) => setTimeout(r, 1500));
    }

    if (resolved > 0) {
      this.configService.reloadActiveProfile();
    }

    return { resolved, failed, results };
  }

  // --- Subjects & Figures ---

  @Put(':id/subjects')
  updateSubjects(@Param('id') id: string, @Body() subjects: SubjectProfile[]) {
    this.ensureProfile(id);
    this.profileService.updateSubjects(id, subjects);
    return subjects;
  }

  @Put(':id/figures')
  updateFigures(@Param('id') id: string, @Body() figures: FigureProfile[]) {
    this.ensureProfile(id);
    this.profileService.updateFigures(id, figures);
    return figures;
  }

  // --- Helpers ---

  private ensureProfile(id: string): void {
    const profile = this.profileService.getProfile(id);
    if (!profile) {
      throw new HttpException('Profile not found', HttpStatus.NOT_FOUND);
    }
  }
}

// --- App Settings Controller (separate prefix) ---

@Controller('app-settings')
export class AppSettingsController {
  constructor(private readonly profileService: ProfileService) {}

  @Get('ai')
  getAISettings() {
    return this.profileService.getAISettings();
  }

  @Put('ai')
  updateAISettings(@Body() body: Record<string, string>) {
    this.profileService.updateAISettings(body);
    return this.profileService.getAISettings();
  }
}
