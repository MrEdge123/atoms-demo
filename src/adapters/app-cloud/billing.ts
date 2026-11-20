import crypto from 'node:crypto';
import type { AppBillingPort } from '../../ports';
import { verifyHmacSha256 } from './crypto';

export interface BillingStore {
  getUserPlan(projectId: string, userId: string): Promise<'free' | 'pro'>;
  setUserPlan(
    projectId: string,
    userId: string,
    plan: 'free' | 'pro'
  ): Promise<void>;
  recordOrderIfNew(order: {
    orderId: string;
    projectId: string;
    userId: string;
    plan: 'free' | 'pro';
    provider: string;
  }): Promise<boolean>;
  /** Atomically record an order and upgrade user plan inside one transaction when supported. */
  recordOrderAndSetUserPlan?(order: {
    orderId: string;
    projectId: string;
    userId: string;
    plan: 'free' | 'pro';
    provider: string;
  }): Promise<{ applied: boolean }>;
}

/**
 * Local Mock checkout + HMAC-signed webhook adapter allowing zero-config end-to-end
 * verification of the full asynchronous payment callback loop.
 */
export class MockBillingAdapter implements AppBillingPort {
  private readonly apiBaseUrl: string;
  private readonly webhookSecret: string;
  private readonly store: BillingStore;

  constructor(opts: {
    apiBaseUrl: string;
    webhookSecret: string;
    store: BillingStore;
  }) {
    this.apiBaseUrl = opts.apiBaseUrl.replace(/\/$/, '');
    this.webhookSecret = opts.webhookSecret;
    this.store = opts.store;
  }

  async getPlan(
    projectId: string,
    userId: string
  ): Promise<{ plan: 'free' | 'pro' }> {
    const plan = await this.store.getUserPlan(projectId, userId);
    return { plan };
  }

  async setPlan(
    projectId: string,
    userId: string,
    plan: 'free' | 'pro'
  ): Promise<{ plan: 'free' | 'pro' }> {
    await this.store.setUserPlan(projectId, userId, plan);
    return { plan };
  }

  async createCheckoutSession(input: {
    projectId: string;
    userId: string;
    plan: 'pro';
    returnUrl: string;
  }): Promise<{ checkoutUrl: string; sessionId: string }> {
    const sessionId = `mock_sess_${crypto.randomUUID()}`;
    const url = new URL(`${this.apiBaseUrl}/checkout/mock`);
    url.searchParams.set('sessionId', sessionId);
    url.searchParams.set('projectId', input.projectId);
    url.searchParams.set('userId', input.userId);
    url.searchParams.set('plan', input.plan);
    url.searchParams.set('returnUrl', input.returnUrl);

    return {
      sessionId,
      checkoutUrl: url.toString(),
    };
  }

  async handleWebhook(input: {
    rawBody: string;
    signature: string | null;
  }): Promise<{
    projectId: string;
    userId: string;
    plan: 'free' | 'pro';
    orderId: string;
  } | null> {
    if (!verifyHmacSha256(input.rawBody, input.signature, this.webhookSecret)) {
      return null;
    }

    const body = JSON.parse(input.rawBody) as {
      orderId?: string;
      projectId?: string;
      userId?: string;
      plan?: 'free' | 'pro';
    };

    if (!body.orderId || !body.projectId || !body.userId) {
      return null;
    }

    const plan: 'free' | 'pro' = body.plan === 'free' ? 'free' : 'pro';
    // NOTE: Mock billing adapter for local/demo simulation only — no real money movement.
    if (this.store.recordOrderAndSetUserPlan) {
      await this.store.recordOrderAndSetUserPlan({
        orderId: body.orderId,
        projectId: body.projectId,
        userId: body.userId,
        plan,
        provider: 'mock',
      });
    } else {
      const isNew = await this.store.recordOrderIfNew({
        orderId: body.orderId,
        projectId: body.projectId,
        userId: body.userId,
        plan,
        provider: 'mock',
      });

      if (isNew) {
        await this.store.setUserPlan(body.projectId, body.userId, plan);
      }
    }

    return {
      orderId: body.orderId,
      projectId: body.projectId,
      userId: body.userId,
      plan,
    };
  }
}

/**
 * Creem Test/Live Mode Merchant-of-Record adapter supporting external hosted checkout
 * and HMAC-SHA256 verified webhooks ("creem-signature" header).
 */
export class CreemBillingAdapter implements AppBillingPort {
  private readonly apiKey: string;
  private readonly webhookSecret: string;
  private readonly productId: string;
  private readonly apiBaseUrl: string;
  private readonly store: BillingStore;
  private readonly fetchFn: typeof fetch;

  constructor(opts: {
    apiKey: string;
    webhookSecret: string;
    productId: string;
    apiBaseUrl?: string;
    store: BillingStore;
    fetchFn?: typeof fetch;
  }) {
    this.apiKey = opts.apiKey;
    this.webhookSecret = opts.webhookSecret;
    this.productId = opts.productId;
    this.apiBaseUrl = (opts.apiBaseUrl ?? 'https://test-api.creem.io/v1').replace(
      /\/$/,
      ''
    );
    this.store = opts.store;
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  async getPlan(
    projectId: string,
    userId: string
  ): Promise<{ plan: 'free' | 'pro' }> {
    const plan = await this.store.getUserPlan(projectId, userId);
    return { plan };
  }

  async setPlan(
    projectId: string,
    userId: string,
    plan: 'free' | 'pro'
  ): Promise<{ plan: 'free' | 'pro' }> {
    await this.store.setUserPlan(projectId, userId, plan);
    return { plan };
  }

  async createCheckoutSession(input: {
    projectId: string;
    userId: string;
    plan: 'pro';
    returnUrl: string;
  }): Promise<{ checkoutUrl: string; sessionId: string }> {
    if (!this.apiKey || !this.productId) {
      throw new Error(
        'Creem billing requires CREEM_API_KEY and CREEM_PRODUCT_ID'
      );
    }

    const requestId = `creem_req_${crypto.randomUUID()}`;
    const res = await this.fetchFn(`${this.apiBaseUrl}/checkouts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
      },
      body: JSON.stringify({
        product_id: this.productId,
        request_id: requestId,
        success_url: input.returnUrl,
        metadata: {
          projectId: input.projectId,
          userId: input.userId,
          plan: input.plan,
        },
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Creem checkout creation failed (${res.status}): ${errBody}`);
    }

    const data = (await res.json()) as {
      id?: string;
      checkout_url?: string;
      url?: string;
    };

    const checkoutUrl = data.checkout_url ?? data.url;
    if (!checkoutUrl) {
      throw new Error('Creem checkout response missing checkout_url');
    }

    return {
      sessionId: data.id ?? requestId,
      checkoutUrl,
    };
  }

  async handleWebhook(input: {
    rawBody: string;
    signature: string | null;
  }): Promise<{
    projectId: string;
    userId: string;
    plan: 'free' | 'pro';
    orderId: string;
  } | null> {
    if (!verifyHmacSha256(input.rawBody, input.signature, this.webhookSecret)) {
      return null;
    }

    const event = JSON.parse(input.rawBody) as {
      id?: string;
      eventType?: string;
      type?: string;
      object?: {
        id?: string;
        order?: { id?: string };
        metadata?: { projectId?: string; userId?: string; plan?: string };
      };
      metadata?: { projectId?: string; userId?: string; plan?: string };
    };

    const eventType = event.eventType ?? event.type ?? '';
    if (
      eventType &&
      eventType !== 'checkout.completed' &&
      eventType !== 'subscription.paid' &&
      eventType !== 'subscription.active'
    ) {
      return null;
    }

    const meta = event.object?.metadata ?? event.metadata;
    if (!meta?.projectId || !meta?.userId) {
      return null;
    }

    const orderId =
      event.object?.order?.id ?? event.object?.id ?? event.id ?? '';
    if (!orderId) {
      return null;
    }

    const plan: 'free' | 'pro' = meta.plan === 'free' ? 'free' : 'pro';
    if (this.store.recordOrderAndSetUserPlan) {
      await this.store.recordOrderAndSetUserPlan({
        orderId,
        projectId: meta.projectId,
        userId: meta.userId,
        plan,
        provider: 'creem',
      });
    } else {
      const isNew = await this.store.recordOrderIfNew({
        orderId,
        projectId: meta.projectId,
        userId: meta.userId,
        plan,
        provider: 'creem',
      });

      if (isNew) {
        await this.store.setUserPlan(meta.projectId, meta.userId, plan);
      }
    }

    return {
      orderId,
      projectId: meta.projectId,
      userId: meta.userId,
      plan,
    };
  }
}
