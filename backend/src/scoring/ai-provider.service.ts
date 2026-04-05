import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

export interface AIProviderConfig {
  provider: 'ollama' | 'claude' | 'openai';
  model: string;
  apiKey?: string;
  ollamaEndpoint?: string;
}

export interface AIResponse {
  text: string;
  tokensUsed?: number;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCost?: number;
  provider: string;
  model: string;
}

@Injectable()
export class AIProviderService {
  private readonly logger = new Logger(AIProviderService.name);
  private anthropic: Anthropic | null = null;
  private openai: OpenAI | null = null;

  // Ollama session state — lock in a consistent num_ctx to avoid model reloads
  private ollamaLoadedModel: string | null = null;
  private ollamaLoadedCtx: number = 0;

  async generateText(
    prompt: string,
    config: AIProviderConfig,
    maxTokens = 4096,
    system?: string,
  ): Promise<AIResponse> {
    switch (config.provider) {
      case 'claude':
        return this.generateWithClaude(prompt, config, maxTokens, system);
      case 'openai':
        return this.generateWithOpenAI(prompt, config, maxTokens, system);
      case 'ollama':
        return this.generateWithOllama(prompt, config, maxTokens, system);
      default:
        throw new Error(`Unsupported AI provider: ${config.provider}`);
    }
  }

  /**
   * Pre-load an Ollama model with a specific context size.
   * Call this before a scoring run to avoid reloads between batches.
   */
  async preloadOllamaModel(config: AIProviderConfig, numCtx: number): Promise<void> {
    const endpoint = config.ollamaEndpoint || 'http://localhost:11434';

    // Ping first
    try {
      const ping = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (!ping.ok) throw new Error(`status ${ping.status}`);
    } catch (err) {
      throw new Error(`Ollama is not reachable at ${endpoint} — is it running? (${(err as Error).message})`);
    }

    this.logger.log(`Pre-loading ${config.model} with num_ctx: ${numCtx}...`);

    const response = await fetch(`${endpoint}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        prompt: 'Hi',
        stream: false,
        keep_alive: '30m',
        options: { num_ctx: numCtx },
      }),
      signal: AbortSignal.timeout(300000),
    });

    if (!response.ok) {
      throw new Error(`Ollama preload returned status ${response.status}`);
    }

    await response.json();
    this.ollamaLoadedModel = config.model;
    this.ollamaLoadedCtx = numCtx;
    this.logger.log(`Pre-loaded ${config.model} with num_ctx: ${numCtx}`);
  }

  async testProvider(config: AIProviderConfig): Promise<{ success: boolean; error?: string }> {
    try {
      await this.generateText('Respond with just the word "OK".', config);
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  private async generateWithClaude(prompt: string, config: AIProviderConfig, maxTokens: number, system?: string): Promise<AIResponse> {
    if (!config.apiKey) throw new Error('Claude API key is required');

    if (!this.anthropic || this.anthropic.apiKey !== config.apiKey) {
      this.anthropic = new Anthropic({ apiKey: config.apiKey });
    }

    // Use streaming to avoid SDK's 10-minute non-streaming guard rail
    const stream = this.anthropic.messages.stream({
      model: config.model,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages: [{ role: 'user', content: prompt }],
    });

    const message = await stream.finalMessage();

    const textContent = message.content.find((block) => block.type === 'text');
    const text = textContent && 'text' in textContent ? textContent.text : '';
    const inputTokens = message.usage.input_tokens;
    const outputTokens = message.usage.output_tokens;

    this.logger.log(`Claude ${config.model}: ${inputTokens} in + ${outputTokens} out tokens (stop: ${message.stop_reason}, max_tokens: ${maxTokens}, chars: ${text.length})`);

    return {
      text,
      tokensUsed: inputTokens + outputTokens,
      inputTokens,
      outputTokens,
      provider: 'claude',
      model: config.model,
    };
  }

  private async generateWithOpenAI(prompt: string, config: AIProviderConfig, maxTokens: number, system?: string): Promise<AIResponse> {
    if (!config.apiKey) throw new Error('OpenAI API key is required');

    if (!this.openai || this.openai.apiKey !== config.apiKey) {
      this.openai = new OpenAI({ apiKey: config.apiKey });
    }

    const messages: { role: 'system' | 'user'; content: string }[] = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: prompt });

    const completion = await this.openai.chat.completions.create({
      model: config.model,
      messages,
      max_tokens: maxTokens,
    });

    const text = completion.choices[0]?.message?.content || '';
    const inputTokens = completion.usage?.prompt_tokens || 0;
    const outputTokens = completion.usage?.completion_tokens || 0;

    this.logger.log(`OpenAI: ${inputTokens} in + ${outputTokens} out tokens`);

    return {
      text,
      tokensUsed: inputTokens + outputTokens,
      inputTokens,
      outputTokens,
      provider: 'openai',
      model: config.model,
    };
  }

  private async generateWithOllama(prompt: string, config: AIProviderConfig, maxTokens: number, system?: string): Promise<AIResponse> {
    const endpoint = config.ollamaEndpoint || 'http://localhost:11434';

    // Pre-check: is Ollama reachable?
    try {
      const ping = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (!ping.ok) throw new Error(`status ${ping.status}`);
    } catch (err) {
      throw new Error(`Ollama is not reachable at ${endpoint} — is it running? (${(err as Error).message})`);
    }

    // If model was pre-loaded with a locked context, reuse that size.
    // Otherwise compute dynamically (standalone / test calls).
    let numCtx: number;
    if (this.ollamaLoadedModel === config.model && this.ollamaLoadedCtx > 0) {
      numCtx = this.ollamaLoadedCtx;
    } else {
      const estimatedTokens = Math.ceil(prompt.length / 4);
      numCtx = Math.min(Math.ceil((estimatedTokens + maxTokens) / 4096) * 4096, 131072);
    }

    this.logger.log(`Ollama: requesting ${config.model} (num_ctx: ${numCtx}, prompt ~${Math.ceil(prompt.length / 4)} tokens)...`);

    const response = await fetch(`${endpoint}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        prompt,
        stream: false,
        keep_alive: '30m',
        ...(system ? { system } : {}),
        options: { num_ctx: numCtx },
      }),
      signal: AbortSignal.timeout(900000), // 15 minute timeout for large models
    });

    if (!response.ok) {
      throw new Error(`Ollama returned status ${response.status}`);
    }

    const data = await response.json();
    const inputTokens = data.prompt_eval_count || 0;
    const outputTokens = data.eval_count || 0;

    this.logger.log(`Ollama: ${inputTokens} in + ${outputTokens} out tokens`);

    return {
      text: data.response,
      tokensUsed: inputTokens + outputTokens,
      inputTokens,
      outputTokens,
      estimatedCost: 0,
      provider: 'ollama',
      model: config.model,
    };
  }
}
