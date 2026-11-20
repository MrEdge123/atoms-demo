import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { streamObject, streamText, type LanguageModelV1 } from 'ai';
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

function sanitizeErrorMessage(err: unknown): string {
  const raw = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
  return raw
    .replace(/\bsk-[A-Za-z0-9_-]{6,}/g, 'sk-***')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1***')
    .replace(
      /((?:"|')?\b[A-Za-z0-9_-]*(?:key|token|secret|authorization)(?:"|')?\s*[:=]\s*(?:"|')?)[^\s'",;}\]]+/gi,
      '$1***'
    )
    .slice(0, 400);
}

function createStreamAbort(timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`LLM request timed out after ${timeoutMs}ms`)),
    timeoutMs
  );
  return {
    signal: controller.signal,
    cleanup(completed: boolean) {
      clearTimeout(timer);
      if (!completed && !controller.signal.aborted) {
        controller.abort(new Error('LLM stream aborted early'));
      }
    },
  };
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
        'kimi-k3.1-pro-highspeed',
        'kimi-k2.6',
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
    resolvedModelId: string;
    provider: string;
    temperature: number;
    maxTokens: number;
    model: LanguageModelV1;
  } {
    if (modelId && this.registry.has(modelId)) {
      const entry = this.registry.get(modelId)!;
      return {
        resolvedModelId: modelId,
        provider: entry.provider,
        temperature: entry.temperature,
        maxTokens: entry.maxTokens,
        model: entry.create(),
      };
    }
    if (this.defaultModelId && this.registry.has(this.defaultModelId)) {
      const entry = this.registry.get(this.defaultModelId)!;
      return {
        resolvedModelId: this.defaultModelId,
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
    const { resolvedModelId, provider, temperature, maxTokens, model } =
      this.resolveEntry(input.model);
    const zodSchema = input.schema as unknown as ZodType<T>;
    const started = Date.now();
    console.log(`[LLM] start provider=${provider} model=${resolvedModelId}`);

    try {
      const primaryAbort = createStreamAbort(120_000);
      let primaryCompleted = false;
      const res =
        provider === 'anthropic'
          ? streamObject({
              model,
              system: input.system,
              prompt: input.prompt,
              schema: zodSchema,
              maxTokens,
              maxRetries: 0,
              abortSignal: primaryAbort.signal,
              onError: () => {},
            })
          : streamObject({
              model,
              system: input.system,
              prompt: input.prompt,
              schema: zodSchema,
              mode: 'json',
              temperature,
              maxTokens,
              maxRetries: 0,
              abortSignal: primaryAbort.signal,
              onError: () => {},
            });

      // Vercel AI SDK v4 streamObject is pull-based; fullStream also surfaces transport/API errors
      // whereas textStream drops error chunks and leaves res.object hanging indefinitely.
      const reader = res.fullStream.getReader();
      let chunks = 0;
      let sawFinish = false;
      try {
        while (true) {
          const { done, value: part } = await reader.read();
          if (done) break;
          if (part.type === 'error') {
            throw part.error instanceof Error
              ? part.error
              : new Error(String(part.error));
          }
          if (part.type === 'text-delta') {
            chunks += 1;
          } else if (part.type === 'finish') {
            sawFinish = true;
          }
        }
        if (!sawFinish) {
          throw new Error('streamObject ended without finish event');
        }
        const obj = await res.object;
        primaryCompleted = true;
        console.log(
          `[LLM] ok provider=${provider} model=${resolvedModelId} mode=streamObject elapsed=${Date.now() - started}ms chunks=${chunks}`
        );
        return obj;
      } finally {
        primaryAbort.cleanup(primaryCompleted);
        if (!primaryCompleted) {
          await reader.cancel().catch(() => undefined);
        }
        try {
          reader.releaseLock();
        } catch {
          // Reader lock already released
        }
      }
    } catch (primaryErr) {
      const primaryMsg = sanitizeErrorMessage(primaryErr);
      console.warn(
        `[LLM] warn provider=${provider} model=${resolvedModelId} mode=streamObject failed (${Date.now() - started}ms): ${primaryMsg}; trying streamText JSON fallback`
      );
      // Resilient streaming fallback for domestic gateways that emit markdown fences
      // or occasionally fail strict schema validation mid-stream.
      const fallbackAbort = createStreamAbort(60_000);
      let fallbackCompleted = false;
      const fallback = streamText({
        model,
        system: `${input.system}\n\nIMPORTANT: Return ONLY a valid raw JSON object that conforms strictly to the requested structure. Do not include markdown fences or any prose outside JSON.`,
        prompt: input.prompt,
        temperature,
        maxTokens,
        maxRetries: 0,
        abortSignal: fallbackAbort.signal,
        onError: () => {},
      });

      const reader = fallback.fullStream.getReader();
      let fallbackText = '';
      let finishReason = 'unknown';
      try {
        while (true) {
          const { done, value: part } = await reader.read();
          if (done) break;
          if (part.type === 'error') {
            throw part.error instanceof Error
              ? part.error
              : new Error(String(part.error));
          }
          if (part.type === 'text-delta') {
            fallbackText += part.textDelta;
          } else if (part.type === 'finish') {
            finishReason = part.finishReason;
          }
        }
        const jsonText = extractJsonObjectText(fallbackText);
        const parsed = JSON.parse(jsonText);
        const validated = zodSchema.parse(parsed);
        fallbackCompleted = true;
        console.log(
          `[LLM] ok provider=${provider} model=${resolvedModelId} mode=streamText-fallback elapsed=${Date.now() - started}ms textLen=${fallbackText.length}`
        );
        return validated;
      } catch (fallbackErr) {
        const fallbackMsg = sanitizeErrorMessage(fallbackErr);
        console.warn(
          `[LLM] error provider=${provider} model=${resolvedModelId} mode=streamText-fallback failed (${Date.now() - started}ms): ${fallbackMsg} (finishReason=${finishReason}, textLen=${fallbackText.length})`
        );
        throw new Error(
          `Structured JSON generation failed for provider "${provider}": ${primaryMsg}`
        );
      } finally {
        fallbackAbort.cleanup(fallbackCompleted);
        if (!fallbackCompleted) {
          await reader.cancel().catch(() => undefined);
        }
        try {
          reader.releaseLock();
        } catch {
          // Reader lock already released
        }
      }
    }
  }

  async *streamText(input: {
    system: string;
    prompt: string;
    model?: string;
  }): AsyncIterable<string> {
    const { provider, temperature, model } = this.resolveEntry(input.model);
    const abort = createStreamAbort(120_000);
    let completed = false;
    const res = streamText({
      model,
      system: input.system,
      prompt: input.prompt,
      maxRetries: 0,
      abortSignal: abort.signal,
      onError: () => {},
      ...(provider === 'kimi' ? { temperature } : {}),
    });
    const reader = res.fullStream.getReader();
    try {
      while (true) {
        const { done, value: part } = await reader.read();
        if (done) break;
        if (part.type === 'error') {
          throw new Error(sanitizeErrorMessage(part.error));
        }
        if (part.type === 'text-delta') {
          yield part.textDelta;
        }
      }
      completed = true;
    } catch (err) {
      throw new Error(sanitizeErrorMessage(err));
    } finally {
      abort.cleanup(completed);
      if (!completed) {
        await reader.cancel().catch(() => undefined);
      }
      try {
        reader.releaseLock();
      } catch {
        // Reader lock already released
      }
    }
  }
}
