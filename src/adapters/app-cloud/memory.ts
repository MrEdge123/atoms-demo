import crypto from 'node:crypto';
import type { AppRecord, AppUser } from '../../domain';
import type {
  AppAiProxyPort,
  AppAuthPort,
  AppBillingPort,
  AppCloudRuntime,
  AppDbPort,
  LLMProvider,
} from '../../ports';
import { type BillingStore, MockBillingAdapter } from './billing';
import {
  hashPassword,
  signAppToken,
  verifyAppToken,
  verifyPassword,
} from './crypto';

const MAX_RECORD_BYTES = 50 * 1024;

interface StoredUser extends AppUser {
  passwordHash: string;
}

function assertRecordSize(data: Record<string, unknown>): void {
  const bytes = Buffer.byteLength(JSON.stringify(data), 'utf8');
  if (bytes > MAX_RECORD_BYTES) {
    throw new Error(
      `Record payload exceeds 50KB limit (${bytes} bytes > ${MAX_RECORD_BYTES})`
    );
  }
}

/**
 * In-memory AppCloudRuntime with strict projectId isolation for L1 testing.
 */
export class InMemoryAppCloudRuntime implements AppCloudRuntime {
  private readonly records = new Map<string, AppRecord>();
  private readonly users = new Map<string, StoredUser>();
  private readonly orders = new Map<string, string>();
  private readonly authSecret: string;

  readonly db: AppDbPort;
  readonly auth: AppAuthPort;
  readonly billing: AppBillingPort;
  readonly ai?: AppAiProxyPort;

  constructor(opts: {
    authSecret: string;
    apiBaseUrl?: string;
    billingFactory?: (store: BillingStore) => AppBillingPort;
    llm?: LLMProvider;
  }) {
    this.authSecret = opts.authSecret;

    const store: BillingStore = {
      getUserPlan: async (projectId, userId) => {
        const user = this.users.get(userId);
        if (!user || user.projectId !== projectId) return 'free';
        return user.plan;
      },
      setUserPlan: async (projectId, userId, plan) => {
        const user = this.users.get(userId);
        if (!user || user.projectId !== projectId) {
          throw new Error(`User "${userId}" not found in project "${projectId}"`);
        }
        user.plan = plan;
      },
      recordOrderIfNew: async (order) => {
        if (this.orders.has(order.orderId)) return false;
        this.orders.set(order.orderId, order.projectId);
        return true;
      },
    };

    this.billing = opts.billingFactory
      ? opts.billingFactory(store)
      : new MockBillingAdapter({
          apiBaseUrl: opts.apiBaseUrl ?? 'http://localhost:3000',
          webhookSecret: opts.authSecret,
          store,
        });

    this.db = {
      listCollections: async (projectId) => {
        const counts = new Map<string, number>();
        for (const rec of this.records.values()) {
          if (rec.projectId === projectId) {
            counts.set(rec.collection, (counts.get(rec.collection) ?? 0) + 1);
          }
        }
        return Array.from(counts.entries())
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count);
      },

      list: async (projectId, collection, filter) => {
        const out: AppRecord[] = [];
        for (const rec of this.records.values()) {
          if (rec.projectId !== projectId || rec.collection !== collection) {
            continue;
          }
          if (filter?.ownerUserId && rec.ownerUserId !== filter.ownerUserId) {
            continue;
          }
          out.push(structuredClone(rec));
        }
        return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      },

      create: async (projectId, collection, data, ownerUserId) => {
        assertRecordSize(data);
        const now = new Date().toISOString();
        const record: AppRecord = {
          id: `rec_${crypto.randomUUID().slice(0, 12)}`,
          projectId,
          collection,
          ownerUserId: ownerUserId ?? null,
          data: structuredClone(data),
          createdAt: now,
          updatedAt: now,
        };
        this.records.set(record.id, structuredClone(record));
        return structuredClone(record);
      },

      update: async (projectId, collection, id, patch) => {
        const rec = this.records.get(id);
        if (!rec || rec.projectId !== projectId || rec.collection !== collection) {
          throw new Error(`Record "${id}" not found`);
        }
        const merged = { ...rec.data, ...patch };
        assertRecordSize(merged);
        rec.data = merged;
        rec.updatedAt = new Date().toISOString();
        return structuredClone(rec);
      },

      remove: async (projectId, collection, id) => {
        const rec = this.records.get(id);
        if (!rec || rec.projectId !== projectId || rec.collection !== collection) {
          throw new Error(`Record "${id}" not found`);
        }
        this.records.delete(id);
      },
    };

    this.auth = {
      listUsers: async (projectId) => {
        return Array.from(this.users.values())
          .filter((u) => u.projectId === projectId)
          .map(({ passwordHash: _ignored, ...pub }) => structuredClone(pub));
      },

      register: async (projectId, email, password, name) => {
        const normalizedEmail = email.trim().toLowerCase();
        if (!normalizedEmail || !password || password.length < 4) {
          throw new Error('Valid email and password (min 4 chars) are required');
        }
        for (const existing of this.users.values()) {
          if (
            existing.projectId === projectId &&
            existing.email === normalizedEmail
          ) {
            throw new Error('Email already registered for this app');
          }
        }
        const user: StoredUser = {
          id: `usr_${crypto.randomUUID().slice(0, 10)}`,
          projectId,
          email: normalizedEmail,
          name: name?.trim() || null,
          role: 'user',
          plan: 'free',
          createdAt: new Date().toISOString(),
          passwordHash: hashPassword(password),
        };
        this.users.set(user.id, user);
        const token = signAppToken(
          { sub: user.id, projectId, email: user.email },
          this.authSecret
        );
        const { passwordHash: _ignored, ...pub } = user;
        return { user: structuredClone(pub), token };
      },

      login: async (projectId, email, password) => {
        const normalizedEmail = email.trim().toLowerCase();
        let matched: StoredUser | null = null;
        for (const u of this.users.values()) {
          if (u.projectId === projectId && u.email === normalizedEmail) {
            matched = u;
            break;
          }
        }
        if (!matched || !verifyPassword(password, matched.passwordHash)) {
          throw new Error('Invalid email or password');
        }
        const token = signAppToken(
          { sub: matched.id, projectId, email: matched.email },
          this.authSecret
        );
        const { passwordHash: _ignored, ...pub } = matched;
        return { user: structuredClone(pub), token };
      },

      verifyToken: async (projectId, token) => {
        const claims = verifyAppToken(token, projectId, this.authSecret);
        if (!claims) return null;
        const user = this.users.get(claims.sub);
        if (!user || user.projectId !== projectId) return null;
        const { passwordHash: _ignored, ...pub } = user;
        return structuredClone(pub);
      },
    };

    this.ai = {
      complete: async (_projectId, prompt) => {
        if (opts.llm) {
          let buf = '';
          for await (const chunk of opts.llm.streamText({
            system: 'You are a helpful AI assistant embedded inside an Atoms app.',
            prompt,
          })) {
            buf += chunk;
          }
          return { text: buf };
        }
        return {
          text: `AI 助手响应（本地代理）：已收到请求 "${prompt.slice(0, 80)}"。接入真实模型 Key 后可返回实时推理结果。`,
        };
      },
    };
  }

  async purgeProject(projectId: string): Promise<void> {
    for (const [id, rec] of this.records.entries()) {
      if (rec.projectId === projectId) {
        this.records.delete(id);
      }
    }
    for (const [id, user] of this.users.entries()) {
      if (user.projectId === projectId) {
        this.users.delete(id);
      }
    }
    for (const [orderId, pid] of this.orders.entries()) {
      if (pid === projectId) {
        this.orders.delete(orderId);
      }
    }
  }
}
