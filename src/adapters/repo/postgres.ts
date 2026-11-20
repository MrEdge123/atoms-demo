import crypto from 'node:crypto';
import type {
  AgentEvent,
  CloudCapability,
  ProductPlan,
  Project,
  ProjectStatus,
  RaceBranch,
  VirtualFS,
} from '../../domain';
import type { ProjectRepository } from '../../ports';
import type { SqlClient } from '../storage/sql-client';

interface ProjectRow {
  id: string;
  slug: string;
  title: string;
  status: string;
  capabilities_json: unknown;
  plan_json: unknown;
  draft_files_json: unknown;
  race_branches_json: unknown;
  published_files_json: unknown;
  published_html: string | null;
  published_version: number;
  created_at: Date | string;
  updated_at: Date | string;
}

interface EventRow {
  seq: number;
  role: string;
  branch_id: string | null;
  type: string;
  payload_json: unknown;
  created_at: Date | string;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapProjectRow(row: ProjectRow): Project {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    status: row.status as ProjectStatus,
    capabilities: parseJson<CloudCapability[]>(row.capabilities_json, ['db']),
    plan: parseJson<ProductPlan | null>(row.plan_json, null),
    draftFiles: parseJson<VirtualFS>(row.draft_files_json, {}),
    raceBranches: parseJson<RaceBranch[]>(row.race_branches_json, []),
    publishedFiles: parseJson<VirtualFS | null>(row.published_files_json, null),
    publishedHtml: row.published_html,
    publishedVersion: Number(row.published_version ?? 0),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

/**
 * Standard PostgreSQL ProjectRepository running identically on PGlite and node-pg.
 */
export class PostgresProjectRepository implements ProjectRepository {
  constructor(private readonly sql: SqlClient) {}

  async create(input: { title: string; slug: string }): Promise<Project> {
    const now = new Date().toISOString();
    const id = `proj_${crypto.randomUUID().slice(0, 8)}`;
    const baseSlug =
      input.slug
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '') || id;

    let slug = baseSlug;
    const collision = await this.sql.query<{ id: string }>(
      'SELECT id FROM projects WHERE slug = $1 LIMIT 1',
      [slug]
    );
    if (collision.rows.length > 0) {
      slug = `${baseSlug}-${crypto.randomUUID().slice(0, 4)}`;
    }

    const title = input.title.trim() || 'Untitled App';
    const res = await this.sql.query<ProjectRow>(
      `INSERT INTO projects (
        id, slug, title, status, capabilities_json, plan_json,
        draft_files_json, race_branches_json, published_files_json,
        published_html, published_version, created_at, updated_at
      ) VALUES ($1, $2, $3, 'idle', $4::jsonb, NULL, '{}'::jsonb, '[]'::jsonb, NULL, NULL, 0, $5, $5)
      RETURNING *`,
      [id, slug, title, JSON.stringify(['db']), now]
    );

    return mapProjectRow(res.rows[0]);
  }

  async listAll(): Promise<Project[]> {
    const res = await this.sql.query<ProjectRow>(
      'SELECT * FROM projects ORDER BY updated_at DESC'
    );
    return res.rows.map(mapProjectRow);
  }

  async getById(id: string): Promise<Project | null> {
    const res = await this.sql.query<ProjectRow>(
      'SELECT * FROM projects WHERE id = $1 LIMIT 1',
      [id]
    );
    return res.rows[0] ? mapProjectRow(res.rows[0]) : null;
  }

  async getBySlug(slug: string): Promise<Project | null> {
    const res = await this.sql.query<ProjectRow>(
      'SELECT * FROM projects WHERE slug = $1 LIMIT 1',
      [slug]
    );
    return res.rows[0] ? mapProjectRow(res.rows[0]) : null;
  }

  async updatePlan(id: string, plan: ProductPlan): Promise<void> {
    const now = new Date().toISOString();
    await this.sql.query(
      `UPDATE projects
       SET plan_json = $2::jsonb,
           capabilities_json = $3::jsonb,
           title = COALESCE(NULLIF($4, ''), title),
           updated_at = $5
       WHERE id = $1`,
      [
        id,
        JSON.stringify(plan),
        JSON.stringify(plan.capabilities),
        plan.appName,
        now,
      ]
    );
  }

  async saveDraft(
    id: string,
    files: VirtualFS,
    status: ProjectStatus
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.sql.query(
      `UPDATE projects
       SET draft_files_json = $2::jsonb,
           status = $3,
           updated_at = $4
       WHERE id = $1`,
      [id, JSON.stringify(files), status, now]
    );
  }

  async saveRaceBranches(id: string, branches: RaceBranch[]): Promise<void> {
    const now = new Date().toISOString();
    await this.sql.query(
      `UPDATE projects
       SET race_branches_json = $2::jsonb,
           updated_at = $3
       WHERE id = $1`,
      [id, JSON.stringify(branches), now]
    );
  }

  async savePublished(
    id: string,
    files: VirtualFS,
    html: string
  ): Promise<{ version: number }> {
    const now = new Date().toISOString();
    const res = await this.sql.query<{ published_version: number }>(
      `UPDATE projects
       SET published_files_json = $2::jsonb,
           published_html = $3,
           published_version = published_version + 1,
           status = 'published',
           updated_at = $4
       WHERE id = $1
       RETURNING published_version`,
      [id, JSON.stringify(files), html, now]
    );
    if (!res.rows[0]) {
      throw new Error(`Project "${id}" not found`);
    }
    return { version: Number(res.rows[0].published_version) };
  }

  async appendEvent(id: string, event: AgentEvent): Promise<void> {
    const evId = `evt_${crypto.randomUUID()}`;
    await this.sql.query(
      `INSERT INTO project_events (id, project_id, seq, role, branch_id, type, payload_json, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
      [
        evId,
        id,
        event.seq,
        event.role,
        event.branchId ?? null,
        event.type,
        JSON.stringify(event.payload ?? null),
        event.timestamp,
      ]
    );
  }

  async listEvents(id: string): Promise<AgentEvent[]> {
    const res = await this.sql.query<EventRow>(
      `SELECT seq, role, branch_id, type, payload_json, created_at
       FROM project_events
       WHERE project_id = $1
       ORDER BY seq ASC`,
      [id]
    );
    return res.rows.map((row) => ({
      seq: Number(row.seq),
      role: row.role as AgentEvent['role'],
      branchId: row.branch_id ?? undefined,
      type: row.type as AgentEvent['type'],
      payload: parseJson(row.payload_json, null),
      timestamp: toIso(row.created_at),
    }));
  }

  async rename(id: string, title: string): Promise<Project> {
    const trimmed = title.trim();
    if (!trimmed || trimmed.length > 80) {
      throw new Error('Project title must be 1 to 80 characters');
    }
    const now = new Date().toISOString();
    const res = await this.sql.query<ProjectRow>(
      `UPDATE projects
       SET title = $2, updated_at = $3
       WHERE id = $1
       RETURNING *`,
      [id, trimmed, now]
    );
    if (!res.rows[0]) {
      throw new Error(`Project "${id}" not found`);
    }
    return mapProjectRow(res.rows[0]);
  }

  async remove(id: string): Promise<boolean> {
    await this.sql.query('DELETE FROM project_events WHERE project_id = $1', [id]);
    const res = await this.sql.query<{ id: string }>(
      'DELETE FROM projects WHERE id = $1 RETURNING id',
      [id]
    );
    return res.rows.length > 0;
  }
}
