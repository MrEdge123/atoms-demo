import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';

/**
 * Unified PostgreSQL query interface shared across local PGlite and remote/node-pg.
 */
export type SqlExecutor = Pick<SqlClient, 'query' | 'exec'>;

export interface SqlClient {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  owner_sid TEXT,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  capabilities_json JSONB NOT NULL DEFAULT '["db"]',
  plan_json JSONB,
  draft_files_json JSONB NOT NULL DEFAULT '{}',
  race_branches_json JSONB NOT NULL DEFAULT '[]',
  published_files_json JSONB,
  published_html TEXT,
  published_version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_sid TEXT;

CREATE INDEX IF NOT EXISTS idx_projects_owner_sid_updated
  ON projects (owner_sid, updated_at DESC);

CREATE TABLE IF NOT EXISTS project_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL,
  branch_id TEXT,
  type TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_project_events_pid_seq
  ON project_events (project_id, seq ASC);

CREATE TABLE IF NOT EXISTS app_users (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  plan TEXT NOT NULL DEFAULT 'free',
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (project_id, email)
);

CREATE TABLE IF NOT EXISTS app_records (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  collection TEXT NOT NULL,
  owner_user_id TEXT,
  data_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_app_records_proj_col_created
  ON app_records (project_id, collection, created_at DESC);

CREATE TABLE IF NOT EXISTS billing_orders (
  order_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  plan TEXT NOT NULL,
  provider TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
`;

/**
 * Local embedded PostgreSQL implementation backed by @electric-sql/pglite.
 * Persists data cleanly on disk when dataDir is provided.
 */
export class PGliteSqlClient implements SqlClient {
  private readonly db: PGlite;
  private readonly ready: Promise<void>;

  constructor(dataDir?: string) {
    if (dataDir) {
      const resolved = path.resolve(dataDir);
      fs.mkdirSync(resolved, { recursive: true });
      this.db = new PGlite(resolved);
    } else {
      this.db = new PGlite();
    }
    this.ready = this.db.waitReady
      .then(() => this.db.exec(SCHEMA_SQL))
      .then(() => undefined);
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<{ rows: T[] }> {
    await this.ready;
    const res = await this.db.query<T>(sql, params);
    return { rows: res.rows };
  }

  async exec(sql: string): Promise<void> {
    await this.ready;
    await this.db.exec(sql);
  }

  async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    await this.ready;
    return this.db.transaction((tx) =>
      fn({
        query: async <R = Record<string, unknown>>(
          sql: string,
          params: unknown[] = []
        ): Promise<{ rows: R[] }> => {
          const res = await tx.query<R>(sql, params);
          return { rows: res.rows };
        },
        exec: async (sql: string): Promise<void> => {
          await tx.exec(sql);
        },
      })
    );
  }

  async close(): Promise<void> {
    await this.ready;
    await this.db.close();
  }
}

/**
 * Standard PostgreSQL Pool client compatible with Neon, Supabase, or self-hosted Postgres.
 */
export class NodePgSqlClient implements SqlClient {
  private readonly pool: Pool;
  private readyPromise: Promise<void> | null = null;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
    this.pool.on('error', (err) => {
      console.warn('[Postgres] idle pool client error:', err.message);
    });
  }

  private ensureReady(): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = this.pool
        .query(SCHEMA_SQL)
        .then(() => undefined)
        .catch((err) => {
          this.readyPromise = null;
          throw err;
        });
    }
    return this.readyPromise;
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<{ rows: T[] }> {
    await this.ensureReady();
    const res = await this.pool.query(sql, params);
    return { rows: res.rows as T[] };
  }

  async exec(sql: string): Promise<void> {
    await this.ensureReady();
    await this.pool.query(sql);
  }

  async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    await this.ensureReady();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn({
        query: async <R = Record<string, unknown>>(
          sql: string,
          params: unknown[] = []
        ): Promise<{ rows: R[] }> => {
          const res = await client.query(sql, params);
          return { rows: res.rows as R[] };
        },
        exec: async (sql: string): Promise<void> => {
          await client.query(sql);
        },
      });
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    if (this.readyPromise) {
      await this.readyPromise.catch(() => undefined);
    }
    await this.pool.end();
  }
}
