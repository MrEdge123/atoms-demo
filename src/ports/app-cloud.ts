import type { AppRecord, AppUser } from '../domain';

/**
 * Thrown when an authenticated user tries to modify or delete a record owned by another user.
 */
export class CloudRecordForbiddenError extends Error {
  constructor(message = 'Permission denied for this record') {
    super(message);
    this.name = 'CloudRecordForbiddenError';
  }
}

/**
 * Collection-based JSON document store scoped strictly by projectId.
 */
export interface AppDbPort {
  listCollections(
    projectId: string
  ): Promise<Array<{ name: string; count: number }>>;

  list(
    projectId: string,
    collection: string,
    filter?: { ownerUserId?: string; limit?: number; offset?: number }
  ): Promise<AppRecord[]>;

  getById(
    projectId: string,
    collection: string,
    id: string
  ): Promise<AppRecord | null>;

  create(
    projectId: string,
    collection: string,
    data: Record<string, unknown>,
    ownerUserId?: string
  ): Promise<AppRecord>;

  update(
    projectId: string,
    collection: string,
    id: string,
    patch: Record<string, unknown>,
    opts?: { expectedOwnerUserId?: string; allowUnownedPublic?: boolean }
  ): Promise<AppRecord>;

  remove(
    projectId: string,
    collection: string,
    id: string,
    opts?: { expectedOwnerUserId?: string; allowUnownedPublic?: boolean }
  ): Promise<void>;
}

/**
 * Per-project end-user authentication port isolated from the workbench session.
 */
export interface AppAuthPort {
  listUsers(projectId: string): Promise<AppUser[]>;

  register(
    projectId: string,
    email: string,
    password: string,
    name?: string
  ): Promise<{ user: AppUser; token: string }>;

  login(
    projectId: string,
    email: string,
    password: string
  ): Promise<{ user: AppUser; token: string }>;

  verifyToken(projectId: string, token: string): Promise<AppUser | null>;
}

/**
 * Plan and async checkout/webhook billing port (Mock in local MVP, replaceable by Creem Test/Live Mode).
 */
export interface AppBillingPort {
  getPlan(projectId: string, userId: string): Promise<{ plan: 'free' | 'pro' }>;

  setPlan(
    projectId: string,
    userId: string,
    plan: 'free' | 'pro'
  ): Promise<{ plan: 'free' | 'pro' }>;

  createCheckoutSession(input: {
    projectId: string;
    userId: string;
    plan: 'pro';
    returnUrl: string;
  }): Promise<{ checkoutUrl: string; sessionId: string }>;

  handleWebhook(input: {
    rawBody: string;
    signature: string | null;
  }): Promise<{
    projectId: string;
    userId: string;
    plan: 'free' | 'pro';
    orderId: string;
  } | null>;
}

/**
 * Route A+ extension slot enabling generated apps to invoke server-managed
 * AI completions without exposing API keys in client code.
 */
export interface AppAiProxyPort {
  complete(
    projectId: string,
    prompt: string,
    opts?: { maxTokens?: number; abortSignal?: AbortSignal }
  ): Promise<{ text: string }>;
}

/**
 * Port 3: Hosted BaaS runtime backing the @atoms/cloud virtual client SDK.
 */
export interface AppCloudRuntime {
  db: AppDbPort;
  auth: AppAuthPort;
  billing: AppBillingPort;
  ai?: AppAiProxyPort;
  purgeProject(projectId: string): Promise<void>;
}
