import type { LLMProvider, ModelInfo, SchemaLike } from '../../ports';
import { MockLLMProvider } from './mock';
import { VercelAISDKProvider } from './vercel-ai';

/**
 * Combines Mock models with any configured real Vercel AI SDK models,
 * routing each call by model ID without changing caller code.
 */
export class CompositeLLMProvider implements LLMProvider {
  constructor(
    private readonly mock: MockLLMProvider,
    private readonly real: VercelAISDKProvider,
    private readonly preferRealByDefault: boolean
  ) {}

  listModels(): ModelInfo[] {
    const realModels = this.real.listModels();
    const mockModels = this.mock.listModels();
    return this.preferRealByDefault
      ? [...realModels, ...mockModels]
      : [...mockModels, ...realModels];
  }

  private pickProvider(model?: string): LLMProvider {
    if (model && model.startsWith('mock-')) {
      return this.mock;
    }
    if (model && this.real.listModels().some((m) => m.id === model)) {
      return this.real;
    }
    if (this.preferRealByDefault && this.real.hasAvailableModels()) {
      return this.real;
    }
    return this.mock;
  }

  generateObject<T>(input: {
    system: string;
    prompt: string;
    schema: SchemaLike<T>;
    model?: string;
    abortSignal?: AbortSignal;
  }): Promise<T> {
    return this.pickProvider(input.model).generateObject(input);
  }

  streamText(input: {
    system: string;
    prompt: string;
    model?: string;
    maxTokens?: number;
    abortSignal?: AbortSignal;
  }): AsyncIterable<string> {
    return this.pickProvider(input.model).streamText(input);
  }
}
