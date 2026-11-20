import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { generateObject, generateText, streamText, type LanguageModelV1 } from 'ai';
import type { ZodType } from 'zod';
import type { LLMProvider, ModelInfo, SchemaLike } from '../../ports';

export interface VercelAIEnvConfig {
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  openaiModel?: string;
  anthropicApiKey?: string;
  anthropicModel?: string;
  deepseekApiKey?: string;
  deepseekBaseUrl?: string;
  deepseekModel?: string;
  kimiApiKey?: string;
  kimiBaseUrl?: string;
  kimiModel?: string;
  defaultModel?: string;
}

function extractJsonObjectText(raw: string): string {
  let cleaned = raw.trim();
  const fenceMatch = cleaned.match(/^```(?:json)?\s*([\s\S]*)\s*```$/i);
  if (fenceMatch?.[1]) {
    cleaned = fenceMatch[1].trim();
  }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return cleaned.slice(firstBrace, lastBrace + 1);
  }
  return cleaned;
}

function parseModelList(raw: string | undefined, fallback: string[]): string[] {
  const items = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const source = items.length > 0 ? items : fallback;
  return Array.from(new Set(source));
}

function createNoThinkingFetch(): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init && typeof init.body === 'string') {
      try {
        const parsed = JSON.parse(init.body) as Record<string, unknown>;
        parsed.thinking = { type: 'disabled' };
        return fetch(input, { ...init, body: JSON.stringify(parsed) });
      } catch {
        // Forward non-JSON request bodies untouched
      }
    }
    return fetch(input, init);
  }) as typeof fetch;
}

interface RegisteredModelEntry {
  provider: string;
  temperature: number;
  maxTokens: number;
  create: () => LanguageModelV1;
}

/**
 * Multi-provider LLM adapter backed by Vercel AI SDK.
 * Exposes models whose API keys are configured in environment variables
 * and hardens structured JSON output parsing across domestic/OpenAI-compatible providers.
 */
export class VercelAISDKProvider implements LLMProvider {
  private readonly models: ModelInfo[] = [];
  private readonly registry = new Map<string, RegisteredModelEntry>();
  private readonly defaultModelId: string | null = null;

  constructor(env: VercelAIEnvConfig) {
    if (env.openaiApiKey) {
      const modelId = env.openaiModel || 'gpt-4o-mini';
      const provider = createOpenAI({
        apiKey: env.openaiApiKey,
        baseURL: env.openaiBaseUrl || undefined,
      });
      this.models.push({
        id: `openai:${modelId}`,
        label: `OpenAI (${modelId})`,
        provider: 'openai',
        available: true,
      });
      this.registry.set(`openai:${modelId}`, {
        provider: 'openai',
        temperature: 0.2,
        maxTokens: 16384,
        create: () => provider(modelId),
      });
      if (!this.defaultModelId) this.defaultModelId = `openai:${modelId}`;
    }

    if (env.anthropicApiKey) {
      const modelId = env.anthropicModel || 'claude-3-7-sonnet-latest';
      const provider = createAnthropic({
        apiKey: env.anthropicApiKey,
      });
      this.models.push({
        id: `anthropic:${modelId}`,
        label: `Claude (${modelId})`,
        provider: 'anthropic',
        available: true,
      });
      this.registry.set(`anthropic:${modelId}`, {
        provider: 'anthropic',
        temperature: 0.2,
        maxTokens: 16384,
        create: () => provider(modelId),
      });
      if (!this.defaultModelId) this.defaultModelId = `anthropic:${modelId}`;
    }

    if (env.deepseekApiKey) {
      const modelIds = parseModelList(env.deepseekModel, [
        'deepseek-flash',
        'deepseek-v4-pro',
      ]);
      const provider = createOpenAI({
        apiKey: env.deepseekApiKey,
        baseURL: env.deepseekBaseUrl || 'https://api.deepseek.com/v1',
        compatibility: 'compatible',
        fetch: createNoThinkingFetch(),
      });
      for (const modelId of modelIds) {
        this.models.push({
          id: `deepseek:${modelId}`,
          label: `DeepSeek (${modelId})`,
          provider: 'deepseek',
          available: true,
        });
        this.registry.set(`deepseek:${modelId}`, {
          provider: 'deepseek',
          temperature: 0.2,
          maxTokens: 16384,
          create: () => provider(modelId),
        });
        if (!this.defaultModelId) this.defaultModelId = `deepseek:${modelId}`;
      }
    }

    if (env.kimiApiKey) {
      const modelIds = parseModelList(env.kimiModel, [
        'kimi-k2.6',
        'kimi-k3.1-pro-highspeed',
        'kimi-k2.7-code-highspeed',
      ]);
      const kimiBaseUrl = env.kimiBaseUrl || 'https://api.moonshot.cn/v1';
      const fastProvider = createOpenAI({
        apiKey: env.kimiApiKey,
        baseURL: kimiBaseUrl,
        compatibility: 'compatible',
        fetch: createNoThinkingFetch(),
      });
      const reasoningProvider = createOpenAI({
        apiKey: env.kimiApiKey,
        baseURL: kimiBaseUrl,
        compatibility: 'compatible',
      });
      for (const modelId of modelIds) {
        const isK27 = modelId.includes('k2.7');
        this.models.push({
          id: `kimi:${modelId}`,
          label: `Kimi (${modelId})`,
          provider: 'kimi',
          available: true,
        });
        this.registry.set(`kimi:${modelId}`, {
          provider: 'kimi',
          temperature: isK27 ? 1 : 0.6,
          maxTokens: isK27 ? 32768 : 16384,
          create: () => (isK27 ? reasoningProvider : fastProvider)(modelId),
        });
        if (!this.defaultModelId) this.defaultModelId = `kimi:${modelId}`;
      }
    }

    if (env.defaultModel && this.registry.has(env.defaultModel)) {
      this.defaultModelId = env.defaultModel;
    }
  }

  listModels(): ModelInfo[] {
    return [...this.models];
  }

  hasAvailableModels(): boolean {
    return this.models.length > 0;
  }

  private resolveEntry(modelId?: string): {
    provider: string;
    temperature: number;
    maxTokens: number;
    model: LanguageModelV1;
  } {
    if (modelId && this.registry.has(modelId)) {
      const entry = this.registry.get(modelId)!;
      return {
        provider: entry.provider,
        temperature: entry.temperature,
        maxTokens: entry.maxTokens,
        model: entry.create(),
      };
    }
    if (this.defaultModelId && this.registry.has(this.defaultModelId)) {
      const entry = this.registry.get(this.defaultModelId)!;
      return {
        provider: entry.provider,
        temperature: entry.temperature,
        maxTokens: entry.maxTokens,
        model: entry.create(),
      };
    }
    throw new Error(
      'No real LLM API keys configured (OPENAI_API_KEY / ANTHROPIC_API_KEY / DEEPSEEK_API_KEY / KIMI_API_KEY)'
    );
  }

  async generateObject<T>(input: {
    system: string;
    prompt: string;
    schema: SchemaLike<T>;
    model?: string;
  }): Promise<T> {
    const { provider, temperature, maxTokens, model } = this.resolveEntry(
      input.model
    );
    const zodSchema = input.schema as unknown as ZodType<T>;

    try {
      const res =
        provider === 'anthropic'
          ? await generateObject({
              model,
              system: input.system,
              prompt: input.prompt,
              schema: zodSchema,
              maxTokens,
              abortSignal: AbortSignal.timeout(150_000),
            })
          : await generateObject({
              model,
              system: input.system,
              prompt: input.prompt,
              schema: zodSchema,
              mode: 'json',
              temperature,
              maxTokens,
              abortSignal: AbortSignal.timeout(150_000),
            });
      return res.object;
    } catch (primaryErr) {
      const primaryMsg =
        primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
      console.warn(
        `[VercelAISDKProvider] generateObject primary failed for "${provider}" (${input.model || this.defaultModelId}): ${primaryMsg}; trying generateText JSON fallback`
      );
      // Resilient single-shot fallback for domestic OpenAI-compatible gateways
      // that occasionally emit markdown fences around JSON payloads.
      const fallback = await generateText({
        model,
        system: `${input.system}\n\nIMPORTANT: Return ONLY a valid raw JSON object that conforms strictly to the requested structure. Do not include markdown fences or any prose outside JSON.`,
        prompt: input.prompt,
        temperature,
        maxTokens,
        abortSignal: AbortSignal.timeout(120_000),
      });

      const jsonText = extractJsonObjectText(fallback.text);
      try {
        const parsed = JSON.parse(jsonText);
        return zodSchema.parse(parsed);
      } catch (fallbackErr) {
        const fallbackMsg =
          fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        console.warn(
          `[VercelAISDKProvider] generateText fallback failed for "${provider}": ${fallbackMsg} (finishReason=${fallback.finishReason}, textLen=${fallback.text.length})`
        );
        throw new Error(
          `Structured JSON generation failed for provider "${provider}": ${primaryMsg}`
        );
      }
    }
  }

  async *streamText(input: {
    system: string;
    prompt: string;
    model?: string;
  }): AsyncIterable<string> {
    const { provider, temperature, model } = this.resolveEntry(input.model);
    const res = streamText({
      model,
      system: input.system,
      prompt: input.prompt,
      ...(provider === 'kimi' ? { temperature } : {}),
    });
    for await (const chunk of res.textStream) {
      yield chunk;
    }
  }
}
