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

  async generateText(prompt: string, config: AIProviderConfig, maxTokens = 4096): Promise<AIResponse> {
    switch (config.provider) {
      case 'claude':
        return this.generateWithClaude(prompt, config, maxTokens);
      case 'openai':
        return this.generateWithOpenAI(prompt, config, maxTokens);
      case 'ollama':
        return this.generateWithOllama(prompt, config, maxTokens);
      default:
        throw new Error(`Unsupported AI provider: ${config.provider}`);
    }
  }

  async testProvider(config: AIProviderConfig): Promise<{ success: boolean; error?: string }> {
    try {
      await this.generateText('Respond with just the word "OK".', config);
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  private async generateWithClaude(prompt: string, config: AIProviderConfig, maxTokens: number): Promise<AIResponse> {
    if (!config.apiKey) throw new Error('Claude API key is required');

    if (!this.anthropic || this.anthropic.apiKey !== config.apiKey) {
      this.anthropic = new Anthropic({ apiKey: config.apiKey });
    }

    const message = await this.anthropic.messages.create({
      model: config.model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });

    const textContent = message.content.find((block) => block.type === 'text');
    const text = textContent && 'text' in textContent ? textContent.text : '';
    const inputTokens = message.usage.input_tokens;
    const outputTokens = message.usage.output_tokens;

    this.logger.log(`Claude: ${inputTokens} in + ${outputTokens} out tokens`);

    return {
      text,
      tokensUsed: inputTokens + outputTokens,
      inputTokens,
      outputTokens,
      provider: 'claude',
      model: config.model,
    };
  }

  private async generateWithOpenAI(prompt: string, config: AIProviderConfig, maxTokens: number): Promise<AIResponse> {
    if (!config.apiKey) throw new Error('OpenAI API key is required');

    if (!this.openai || this.openai.apiKey !== config.apiKey) {
      this.openai = new OpenAI({ apiKey: config.apiKey });
    }

    const completion = await this.openai.chat.completions.create({
      model: config.model,
      messages: [{ role: 'user', content: prompt }],
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

  private async generateWithOllama(prompt: string, config: AIProviderConfig, maxTokens: number): Promise<AIResponse> {
    const endpoint = config.ollamaEndpoint || 'http://localhost:11434';

    // Pre-check: is Ollama reachable?
    try {
      const ping = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (!ping.ok) throw new Error(`status ${ping.status}`);
    } catch (err) {
      throw new Error(`Ollama is not reachable at ${endpoint} — is it running? (${(err as Error).message})`);
    }

    // Dynamic context window based on prompt size
    const estimatedTokens = Math.ceil(prompt.length / 4);
    const numCtx = Math.min(Math.ceil((estimatedTokens + maxTokens) / 4096) * 4096, 131072);

    this.logger.log(`Ollama: requesting ${config.model} (num_ctx: ${numCtx}, prompt ~${estimatedTokens} tokens)...`);

    const response = await fetch(`${endpoint}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        prompt,
        stream: false,
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
