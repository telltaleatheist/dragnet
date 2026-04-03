import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DEFAULT_CONFIG } from './default-config';

// Re-export the config type from shared types
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
  private configPath!: string;

  onModuleInit() {
    this.configPath = this.getConfigPath();
    this.config = this.loadConfig();
    this.logger.log(`Config loaded from: ${this.configPath}`);
  }

  getConfig(): DragnetConfig {
    return this.config;
  }

  updateConfig(partial: Partial<DragnetConfig>): DragnetConfig {
    // Deep merge for nested objects so partial updates don't wipe sibling fields
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
    this.saveConfig();
    return this.config;
  }

  getSubjects(): SubjectProfile[] {
    return this.config.subjects;
  }

  updateSubjects(subjects: SubjectProfile[]): SubjectProfile[] {
    this.config.subjects = subjects;
    this.saveConfig();
    return this.config.subjects;
  }

  getFigures(): FigureProfile[] {
    return this.config.figures;
  }

  updateFigures(figures: FigureProfile[]): FigureProfile[] {
    this.config.figures = figures;
    this.saveConfig();
    return this.config.figures;
  }

  updateScoringKeys(keys: { claudeApiKey?: string; openaiApiKey?: string }): void {
    if (keys.claudeApiKey !== undefined) {
      this.config.scoring.claudeApiKey = keys.claudeApiKey;
    }
    if (keys.openaiApiKey !== undefined) {
      this.config.scoring.openaiApiKey = keys.openaiApiKey;
    }
    this.saveConfig();
  }

  private getConfigDir(): string {
    if (process.platform === 'darwin') {
      return path.join(os.homedir(), 'Library', 'Application Support', 'dragnet');
    }
    return path.join(os.homedir(), '.dragnet');
  }

  private getConfigPath(): string {
    const dir = this.getConfigDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return path.join(dir, 'dragnet.config.json');
  }

  private loadConfig(): DragnetConfig {
    if (fs.existsSync(this.configPath)) {
      try {
        const raw = fs.readFileSync(this.configPath, 'utf-8');
        const loaded = JSON.parse(raw) as Partial<DragnetConfig>;
        // Merge with defaults to pick up any new fields
        return this.mergeWithDefaults(loaded);
      } catch (err) {
        this.logger.warn(`Failed to parse config, using defaults: ${(err as Error).message}`);
      }
    }

    // First run — write defaults
    this.logger.log('No config file found, creating default config');
    const config = { ...DEFAULT_CONFIG };
    this.config = config;
    this.saveConfig();
    return config;
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

  private saveConfig(): void {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch (err) {
      this.logger.error(`Failed to save config: ${(err as Error).message}`);
    }
  }
}
