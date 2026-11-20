/**
 * Minimal structural schema contract compatible with Zod's ZodType<T>.
 * Keeps the ports layer zero-dependency before installing third-party packages.
 */
export interface SchemaLike<T> {
  parse(input: unknown): T;
}

/**
 * Descriptor for a selectable LLM option exposed to the workbench model switcher.
 */
export interface ModelInfo {
  id: string;
  label: string;
  provider: string;
  available: boolean;
}

/**
 * Port 1: Unified LLM inference contract hiding provider differences
 * (Mock, OpenAI, Anthropic, DeepSeek, Qwen, etc.).
 */
export interface LLMProvider {
  listModels(): ModelInfo[];

  generateObject<T>(input: {
    system: string;
    prompt: string;
    schema: SchemaLike<T>;
    model?: string;
  }): Promise<T>;

  streamText(input: {
    system: string;
    prompt: string;
    model?: string;
  }): AsyncIterable<string>;
}
