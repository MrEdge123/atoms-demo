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
import type { SqlClient } from '../storage/sql-client';
import { type BillingStore, MockBillingAdapter } from './billing';
import {
  hashPassword,
  signAppToken,
  verifyAppToken,
  verifyPassword,
} from './crypto';
import { assertRecordAccess, resolveCloudDbPagination } from './db-utils';

const MAX_RECORD_BYTES = 50 * 1024;

interface UserRow {
  id: string;
  project_id: string;
  email: string;
  password_hash: string;
  name: string | null;
  role: string;
  plan: string;
  created_at: Date | string;
}

interface RecordRow {
  id: string;
  project_id: string;
  collection: string;
  owner_user_id: string | null;
  data_json: unknown;
  created_at: Date | string;
  updated_at: Date | string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    return JSON.parse(value) as Record<string, unknown>;
  }
  return (value ?? {}) as Record<string, unknown>;
}

function mapUserRow(row: UserRow): AppUser {
  return {
    id: row.id,
    projectId: row.project_id,
    email: row.email,
    name: row.name,
    role: row.role === 'admin' ? 'admin' : 'user',
    plan: row.plan === 'pro' ? 'pro' : 'free',
    createdAt: toIso(row.created_at),
  };
}

function mapRecordRow(row: RecordRow): AppRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    collection: row.collection,
    ownerUserId: row.owner_user_id,
    data: parseJsonObject(row.data_json),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
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
 * Standard PostgreSQL AppCloudRuntime backed by PGlite or node-pg.
 * Enforces strict projectId scoping across db, auth, and billing.
 */
export class PostgresAppCloudRuntime implements AppCloudRuntime {
  readonly db: AppDbPort;
  readonly auth: AppAuthPort;
  readonly billing: AppBillingPort;
  readonly ai?: AppAiProxyPort;
  private readonly sql: SqlClient;

  constructor(opts: {
    sql: SqlClient;
    authSecret: string;
    apiBaseUrl?: string;
    billingFactory?: (store: BillingStore) => AppBillingPort;
    llm?: LLMProvider;
  }) {
    const { sql, authSecret } = opts;
    this.sql = sql;

    const store: BillingStore = {
      getUserPlan: async (projectId, userId) => {
        const res = await sql.query<{ plan: string }>(
          'SELECT plan FROM app_users WHERE id = $1 AND project_id = $2 LIMIT 1',
          [userId, projectId]
        );
        return res.rows[0]?.plan === 'pro' ? 'pro' : 'free';
      },
      setUserPlan: async (projectId, userId, plan) => {
        const res = await sql.query<{ id: string }>(
          'UPDATE app_users SET plan = $3 WHERE id = $1 AND project_id = $2 RETURNING id',
          [userId, projectId, plan]
        );
        if (res.rows.length === 0) {
          throw new Error(`User "${userId}" not found in project "${projectId}"`);
        }
      },
      recordOrderIfNew: async (order) => {
        const res = await sql.query<{ order_id: string }>(
          `INSERT INTO billing_orders (order_id, project_id, user_id, plan, provider, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (order_id) DO NOTHING
           RETURNING order_id`,
          [
            order.orderId,
            order.projectId,
            order.userId,
            order.plan,
            order.provider,
            new Date().toISOString(),
          ]
        );
        return res.rows.length > 0;
      },
      recordOrderAndSetUserPlan: async (order) => {
        return sql.transaction(async (tx) => {
          const inserted = await tx.query<{ order_id: string }>(
            `INSERT INTO billing_orders (order_id, project_id, user_id, plan, provider, created_at)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (order_id) DO NOTHING
             RETURNING order_id`,
            [
              order.orderId,
              order.projectId,
              order.userId,
              order.plan,
              order.provider,
              new Date().toISOString(),
            ]
          );
          if (inserted.rows.length === 0) {
            return { applied: false };
          }
          const updated = await tx.query<{ id: string }>(
            'UPDATE app_users SET plan = $3 WHERE id = $1 AND project_id = $2 RETURNING id',
            [order.userId, order.projectId, order.plan]
          );
          if (updated.rows.length === 0) {
            throw new Error(
              `User "${order.userId}" not found in project "${order.projectId}"`
            );
          }
          return { applied: true };
        });
      },
    };

    this.billing = opts.billingFactory
      ? opts.billingFactory(store)
      : new MockBillingAdapter({
          apiBaseUrl: opts.apiBaseUrl ?? 'http://localhost:3000',
          webhookSecret: authSecret,
          store,
        });

    this.db = {
      listCollections: async (projectId) => {
        const res = await sql.query<{ name: string; count: string | number }>(
          `SELECT collection AS name, COUNT(*)::int AS count
           FROM app_records
           WHERE project_id = $1
           GROUP BY collection
           ORDER BY count DESC`,
          [projectId]
        );
        return res.rows.map((r) => ({
          name: r.name,
          count: Number(r.count),
        }));
      },

      list: async (projectId, collection, filter) => {
        const { limit, offset } = resolveCloudDbPagination(filter);
        const res = filter?.ownerUserId
          ? await sql.query<RecordRow>(
              `SELECT * FROM app_records
               WHERE project_id = $1 AND collection = $2 AND owner_user_id = $3
               ORDER BY created_at DESC
               LIMIT $4 OFFSET $5`,
              [projectId, collection, filter.ownerUserId, limit, offset]
            )
          : await sql.query<RecordRow>(
              `SELECT * FROM app_records
               WHERE project_id = $1 AND collection = $2
               ORDER BY created_at DESC
               LIMIT $3 OFFSET $4`,
              [projectId, collection, limit, offset]
            );
        return res.rows.map(mapRecordRow);
      },

      getById: async (projectId, collection, id) => {
        const res = await sql.query<RecordRow>(
          `SELECT * FROM app_records
           WHERE id = $1 AND project_id = $2 AND collection = $3
           LIMIT 1`,
          [id, projectId, collection]
        );
        return res.rows[0] ? mapRecordRow(res.rows[0]) : null;
      },

      create: async (projectId, collection, data, ownerUserId) => {
        assertRecordSize(data);
        const now = new Date().toISOString();
        const id = `rec_${crypto.randomUUID().slice(0, 12)}`;
        const res = await sql.query<RecordRow>(
          `INSERT INTO app_records (id, project_id, collection, owner_user_id, data_json, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $6)
           RETURNING *`,
          [id, projectId, collection, ownerUserId ?? null, JSON.stringify(data), now]
        );
        return mapRecordRow(res.rows[0]);
      },

      update: async (projectId, collection, id, patch, updateOpts) => {
        return sql.transaction(async (tx) => {
          const existing = await tx.query<RecordRow>(
            `SELECT * FROM app_records
             WHERE id = $1 AND project_id = $2 AND collection = $3
             LIMIT 1`,
            [id, projectId, collection]
          );
          if (!existing.rows[0]) {
            throw new Error(`Record "${id}" not found`);
          }
          assertRecordAccess(existing.rows[0].owner_user_id, updateOpts);
          const merged = {
            ...parseJsonObject(existing.rows[0].data_json),
            ...patch,
          };
          assertRecordSize(merged);
          const now = new Date().toISOString();
          const updated = await tx.query<RecordRow>(
            `UPDATE app_records
             SET data_json = $4::jsonb, updated_at = $5
             WHERE id = $1 AND project_id = $2 AND collection = $3
             RETURNING *`,
            [id, projectId, collection, JSON.stringify(merged), now]
          );
          return mapRecordRow(updated.rows[0]);
        });
      },

      remove: async (projectId, collection, id, removeOpts) => {
        await sql.transaction(async (tx) => {
          const existing = await tx.query<{ owner_user_id: string | null }>(
            `SELECT owner_user_id FROM app_records
             WHERE id = $1 AND project_id = $2 AND collection = $3
             LIMIT 1`,
            [id, projectId, collection]
          );
          if (!existing.rows[0]) {
            throw new Error(`Record "${id}" not found`);
          }
          assertRecordAccess(existing.rows[0].owner_user_id, removeOpts);
          await tx.query(
            `DELETE FROM app_records
             WHERE id = $1 AND project_id = $2 AND collection = $3`,
            [id, projectId, collection]
          );
        });
      },
    };

    this.auth = {
      listUsers: async (projectId) => {
        const res = await sql.query<UserRow>(
          `SELECT id, project_id, email, '' AS password_hash, name, role, plan, created_at
           FROM app_users
           WHERE project_id = $1
           ORDER BY created_at DESC`,
          [projectId]
        );
        return res.rows.map(mapUserRow);
      },

      register: async (projectId, email, password, name) => {
        const normalizedEmail = email.trim().toLowerCase();
        if (!normalizedEmail || !password || password.length < 4) {
          throw new Error('Valid email and password (min 4 chars) are required');
        }
        const existing = await sql.query<{ id: string }>(
          'SELECT id FROM app_users WHERE project_id = $1 AND email = $2 LIMIT 1',
          [projectId, normalizedEmail]
        );
        if (existing.rows.length > 0) {
          throw new Error('Email already registered for this app');
        }
        const id = `usr_${crypto.randomUUID().slice(0, 10)}`;
        const now = new Date().toISOString();
        const res = await sql.query<UserRow>(
          `INSERT INTO app_users (id, project_id, email, password_hash, name, role, plan, created_at)
           VALUES ($1, $2, $3, $4, $5, 'user', 'free', $6)
           RETURNING *`,
          [
            id,
            projectId,
            normalizedEmail,
            hashPassword(password),
            name?.trim() || null,
            now,
          ]
        );
        const user = mapUserRow(res.rows[0]);
        const token = signAppToken(
          { sub: user.id, projectId, email: user.email },
          authSecret
        );
        return { user, token };
      },

      login: async (projectId, email, password) => {
        const normalizedEmail = email.trim().toLowerCase();
        const res = await sql.query<UserRow>(
          'SELECT * FROM app_users WHERE project_id = $1 AND email = $2 LIMIT 1',
          [projectId, normalizedEmail]
        );
        const row = res.rows[0];
        if (!row || !verifyPassword(password, row.password_hash)) {
          throw new Error('Invalid email or password');
        }
        const user = mapUserRow(row);
        const token = signAppToken(
          { sub: user.id, projectId, email: user.email },
          authSecret
        );
        return { user, token };
      },

      verifyToken: async (projectId, token) => {
        const claims = verifyAppToken(token, projectId, authSecret);
        if (!claims) return null;
        const res = await sql.query<UserRow>(
          'SELECT * FROM app_users WHERE id = $1 AND project_id = $2 LIMIT 1',
          [claims.sub, projectId]
        );
        return res.rows[0] ? mapUserRow(res.rows[0]) : null;
      },
    };

    this.ai = {
      complete: async (_projectId, prompt, aiOpts) => {
        if (aiOpts?.abortSignal?.aborted) {
          throw (
            aiOpts.abortSignal.reason ?? new Error('AI request aborted')
          );
        }
        if (opts.llm) {
          let buf = '';
          for await (const chunk of opts.llm.streamText({
            system: 'You are a helpful AI assistant embedded inside an Atoms app.',
            prompt,
            maxTokens: aiOpts?.maxTokens,
            abortSignal: aiOpts?.abortSignal,
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
    await this.sql.query('DELETE FROM app_records WHERE project_id = $1', [
      projectId,
    ]);
    await this.sql.query('DELETE FROM app_users WHERE project_id = $1', [
      projectId,
    ]);
    await this.sql.query('DELETE FROM billing_orders WHERE project_id = $1', [
      projectId,
    ]);
  }
}
