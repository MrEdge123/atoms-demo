import type {
  AppBillingPort,
  AppBuilder,
  AppCloudRuntime,
  LLMProvider,
  ProjectRepository,
  SitePublisher,
  WorkflowEngine,
} from './ports';
import { AtomsWorkflowEngine } from './core';
import {
  type BillingStore,
  CreemBillingAdapter,
  MockBillingAdapter,
} from './adapters/app-cloud/billing';
import { InMemoryAppCloudRuntime } from './adapters/app-cloud/memory';
import { PostgresAppCloudRuntime } from './adapters/app-cloud/postgres';
import { EsbuildStaticBuilder } from './adapters/builder/esbuild-static';
import { MockAppBuilder } from './adapters/builder/mock';
import { CompositeLLMProvider } from './adapters/llm/composite';
import { MockLLMProvider } from './adapters/llm/mock';
import { VercelAISDKProvider } from './adapters/llm/vercel-ai';
import { MemorySitePublisher } from './adapters/publisher/memory';
import { SameOriginSitePublisher } from './adapters/publisher/same-origin';
import { MemoryProjectRepository } from './adapters/repo/memory';
import { PostgresProjectRepository } from './adapters/repo/postgres';
import {
  NodePgSqlClient,
  PGliteSqlClient,
  type SqlClient,
} from './adapters/storage/sql-client';

export interface AppContainer {
  apiBaseUrl: string;
  authSecret: string;
  llm: LLMProvider;
  builder: AppBuilder;
  repo: ProjectRepository;
  appCloud: AppCloudRuntime;
  publisher: SitePublisher;
  workflow: WorkflowEngine;
  close(): Promise<void>;
}

export interface ContainerOverrides {
  apiBaseUrl?: string;
  authSecret?: string;
  llmAdapter?: 'mock' | 'vercel-ai';
  builderAdapter?: 'mock' | 'esbuild';
  storageAdapter?: 'memory' | 'pglite' | 'postgres';
  pgliteDataDir?: string;
  databaseUrl?: string;
  publisherAdapter?: 'memory' | 'same-origin';
  billingAdapter?: 'mock' | 'creem';
  scriptedErrorsBeforeFix?: number;
}

/**
 * Constructs a fully wired dependency container controlled by environment variables
 * or explicit test overrides.
 */
export async function createContainer(
  overrides: ContainerOverrides = {}
): Promise<AppContainer> {
  const vercelUrl = process.env.VERCEL_URL?.trim();
  const apiBaseUrl = (
    overrides.apiBaseUrl ??
    (process.env.APP_BASE_URL?.trim() ||
      (vercelUrl ? `https://${vercelUrl}` : 'http://localhost:3000'))
  ).replace(/\/$/, '');

  const authSecret =
    overrides.authSecret ??
    process.env.APP_AUTH_SECRET ??
    'dev-local-secret-change-in-production';

  const llmAdapter =
    overrides.llmAdapter ??
    (process.env.LLM_ADAPTER === 'vercel-ai' ? 'vercel-ai' : 'mock');

  const builderAdapter =
    overrides.builderAdapter ??
    (process.env.BUILDER_ADAPTER === 'mock' ? 'mock' : 'esbuild');

  const storageAdapter =
    overrides.storageAdapter ??
    (process.env.STORAGE_ADAPTER === 'memory'
      ? 'memory'
      : process.env.STORAGE_ADAPTER === 'postgres'
        ? 'postgres'
        : 'pglite');

  const publisherAdapter =
    overrides.publisherAdapter ??
    (process.env.PUBLISHER_ADAPTER === 'memory' ? 'memory' : 'same-origin');

  const billingAdapter =
    overrides.billingAdapter ??
    (process.env.BILLING_ADAPTER === 'creem' ? 'creem' : 'mock');

  const mockLlm = new MockLLMProvider({
    scriptedErrorsBeforeFix: overrides.scriptedErrorsBeforeFix,
  });
  const realLlm = new VercelAISDKProvider({
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiBaseUrl: process.env.OPENAI_BASE_URL,
    openaiModel: process.env.OPENAI_MODEL,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    anthropicModel: process.env.ANTHROPIC_MODEL,
    deepseekApiKey: process.env.DEEPSEEK_API_KEY,
    deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL,
    deepseekModel: process.env.DEEPSEEK_MODEL,
    kimiApiKey: process.env.KIMI_API_KEY,
    kimiBaseUrl: process.env.KIMI_BASE_URL,
    kimiModel: process.env.KIMI_MODEL,
    defaultModel: process.env.DEFAULT_LLM_MODEL,
  });

  const llm: LLMProvider = new CompositeLLMProvider(
    mockLlm,
    realLlm,
    llmAdapter === 'vercel-ai'
  );

  const builder: AppBuilder =
    builderAdapter === 'mock'
      ? new MockAppBuilder()
      : new EsbuildStaticBuilder();

  const billingFactory = (store: BillingStore): AppBillingPort => {
    if (billingAdapter === 'creem') {
      return new CreemBillingAdapter({
        apiKey: process.env.CREEM_API_KEY ?? '',
        webhookSecret: process.env.CREEM_WEBHOOK_SECRET ?? authSecret,
        productId: process.env.CREEM_PRODUCT_ID ?? '',
        apiBaseUrl: process.env.CREEM_API_BASE_URL,
        store,
      });
    }
    return new MockBillingAdapter({
      apiBaseUrl,
      webhookSecret: authSecret,
      store,
    });
  };

  let sql: SqlClient | null = null;
  let repo: ProjectRepository;
  let appCloud: AppCloudRuntime;

  if (storageAdapter === 'memory') {
    repo = new MemoryProjectRepository();
    appCloud = new InMemoryAppCloudRuntime({
      authSecret,
      apiBaseUrl,
      billingFactory,
      llm,
    });
  } else {
    if (storageAdapter === 'postgres') {
      const dbUrl = overrides.databaseUrl ?? process.env.DATABASE_URL;
      if (!dbUrl) {
        throw new Error(
          'DATABASE_URL must be set when STORAGE_ADAPTER=postgres'
        );
      }
      sql = new NodePgSqlClient(dbUrl);
    } else {
      const dataDir =
        overrides.pgliteDataDir ??
        process.env.PGLITE_DATA_DIR ??
        '.data/pglite';
      sql = new PGliteSqlClient(dataDir);
    }
    repo = new PostgresProjectRepository(sql);
    appCloud = new PostgresAppCloudRuntime({
      sql,
      authSecret,
      apiBaseUrl,
      billingFactory,
      llm,
    });
  }

  const publisher: SitePublisher =
    publisherAdapter === 'memory'
      ? new MemorySitePublisher(repo)
      : new SameOriginSitePublisher(repo, apiBaseUrl);

  const workflow = new AtomsWorkflowEngine({
    llm,
    builder,
    repo,
    publisher,
    apiBaseUrl,
    maxAutoFixRounds: 2,
  });

  return {
    apiBaseUrl,
    authSecret,
    llm,
    builder,
    repo,
    appCloud,
    publisher,
    workflow,
    close: async () => {
      if (sql) {
        await sql.close();
      }
    },
  };
}

declare global {
  var __atomsContainerPromise: Promise<AppContainer> | undefined;
}

/**
 * Returns the singleton AppContainer cached across Next.js route invocations
 * so PGlite holds a single directory lock per process.
 */
export function getContainer(): Promise<AppContainer> {
  if (!globalThis.__atomsContainerPromise) {
    globalThis.__atomsContainerPromise = createContainer();
  }
  return globalThis.__atomsContainerPromise;
}
