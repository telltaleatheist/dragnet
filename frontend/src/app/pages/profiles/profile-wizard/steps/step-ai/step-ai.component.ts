import { Component, EventEmitter, Output, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../../../services/api.service';
import { DesktopButtonComponent } from '../../../../../creamsicle-desktop';

type AIProvider = 'ollama' | 'claude' | 'openai';

interface ProviderOption {
  id: AIProvider;
  name: string;
  description: string;
  icon: string;
  requiresKey: boolean;
}

@Component({
  selector: 'step-ai',
  standalone: true,
  imports: [CommonModule, FormsModule, DesktopButtonComponent],
  templateUrl: './step-ai.component.html',
  styleUrl: './step-ai.component.scss',
})
export class StepAiComponent implements OnInit {
  @Output() complete = new EventEmitter<void>();
  @Output() back = new EventEmitter<void>();

  private api = inject(ApiService);

  providers: ProviderOption[] = [
    {
      id: 'ollama',
      name: 'Ollama (Local)',
      description: 'Free, runs locally. Requires Ollama installed with a model pulled.',
      icon: '🦙',
      requiresKey: false,
    },
    {
      id: 'claude',
      name: 'Claude (Anthropic)',
      description: 'High quality reasoning. Requires an API key from Anthropic.',
      icon: '🧠',
      requiresKey: true,
    },
    {
      id: 'openai',
      name: 'ChatGPT (OpenAI)',
      description: 'GPT-4o and variants. Requires an API key from OpenAI.',
      icon: '💬',
      requiresKey: true,
    },
  ];

  availableModels = signal<string[]>([]);
  loadingModels = signal(false);

  selectedProvider = signal<AIProvider>('ollama');
  selectedModel = signal('');
  ollamaEndpoint = signal('http://localhost:11434');
  claudeApiKey = signal('');
  openaiApiKey = signal('');

  testing = signal(false);
  testPassed = signal(false);
  testResult = signal<{ success: boolean; error?: string } | null>(null);
  saving = signal(false);

  ngOnInit() {
    this.api.getConfig().subscribe({
      next: (config: any) => {
        if (config?.scoring) {
          this.selectedProvider.set(config.scoring.aiProvider || 'ollama');
          this.selectedModel.set(config.scoring.aiModel || '');
          this.ollamaEndpoint.set(config.scoring.ollamaEndpoint || 'http://localhost:11434');
          this.claudeApiKey.set(config.scoring.claudeApiKey || '');
          this.openaiApiKey.set(config.scoring.openaiApiKey || '');
        }
        this.loadModels();
      },
      error: () => this.loadModels(),
    });
  }

  get currentProviderOption(): ProviderOption {
    return this.providers.find((p) => p.id === this.selectedProvider())!;
  }

  loadModels() {
    this.loadingModels.set(true);
    const provider = this.selectedProvider();

    if (provider === 'ollama') {
      this.api.getOllamaModels().subscribe({
        next: (models) => {
          this.availableModels.set(models.length > 0 ? models : ['(no models found)']);
          this.loadingModels.set(false);
        },
        error: () => {
          this.availableModels.set(['(Ollama not reachable)']);
          this.loadingModels.set(false);
        },
      });
    } else if (provider === 'claude') {
      this.api.getClaudeModels(this.claudeApiKey() || undefined).subscribe({
        next: (models) => {
          this.availableModels.set(models.length > 0 ? models : ['(enter API key to load models)']);
          this.loadingModels.set(false);
        },
        error: () => {
          this.availableModels.set(['(failed to load models)']);
          this.loadingModels.set(false);
        },
      });
    } else if (provider === 'openai') {
      this.api.getOpenAIModels(this.openaiApiKey() || undefined).subscribe({
        next: (models) => {
          this.availableModels.set(models.length > 0 ? models : ['(enter API key to load models)']);
          this.loadingModels.set(false);
        },
        error: () => {
          this.availableModels.set(['(failed to load models)']);
          this.loadingModels.set(false);
        },
      });
    }
  }

  onProviderChange(provider: AIProvider) {
    this.selectedProvider.set(provider);
    this.testResult.set(null);
    this.testPassed.set(false);
    this.selectedModel.set('');
    this.loadModels();
  }

  onApiKeyChange(key: string) {
    if (this.selectedProvider() === 'claude') {
      this.claudeApiKey.set(key);
    } else if (this.selectedProvider() === 'openai') {
      this.openaiApiKey.set(key);
    }
    this.testPassed.set(false);
    if (key.length > 10) {
      this.loadModels();
    }
  }

  testConnection() {
    this.testing.set(true);
    this.testResult.set(null);

    const testConfig: any = {
      provider: this.selectedProvider(),
      model: this.selectedModel(),
    };

    if (this.selectedProvider() === 'ollama') {
      testConfig.ollamaEndpoint = this.ollamaEndpoint();
    } else if (this.selectedProvider() === 'claude') {
      testConfig.apiKey = this.claudeApiKey();
    } else if (this.selectedProvider() === 'openai') {
      testConfig.apiKey = this.openaiApiKey();
    }

    this.api.testAiProvider(testConfig).subscribe({
      next: (result) => {
        this.testResult.set(result);
        this.testPassed.set(result.success);
        this.testing.set(false);
      },
      error: (err) => {
        this.testResult.set({ success: false, error: err.message || 'Connection failed' });
        this.testPassed.set(false);
        this.testing.set(false);
      },
    });
  }

  proceed() {
    if (!this.testPassed()) return;
    this.saving.set(true);

    const scoring: any = {
      aiProvider: this.selectedProvider(),
      aiModel: this.selectedModel(),
      ollamaEndpoint: this.ollamaEndpoint(),
    };

    if (this.claudeApiKey()) scoring.claudeApiKey = this.claudeApiKey();
    if (this.openaiApiKey()) scoring.openaiApiKey = this.openaiApiKey();

    this.api.updateConfig({ scoring }).subscribe({
      next: () => {
        this.saving.set(false);
        this.complete.emit();
      },
      error: () => {
        this.saving.set(false);
      },
    });
  }
}
