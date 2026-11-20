import type { CloudCapability } from '../domain';

/**
 * TypeScript module source exposed as the virtual "@atoms/cloud" package inside
 * EsbuildStaticBuilder-compiled applications.
 */
export const ATOMS_CLOUD_SDK_SOURCE = `
interface AtomsGlobalConfig {
  projectId: string;
  apiBaseUrl: string;
  capabilities: string[];
  mode: 'preview' | 'production';
}

export interface CloudUser {
  id: string;
  projectId: string;
  email: string;
  name: string | null;
  role: 'user' | 'admin';
  plan: 'free' | 'pro';
  createdAt: string;
}

export interface CloudRecord<T = Record<string, unknown>> {
  id: string;
  projectId: string;
  collection: string;
  ownerUserId: string | null;
  data: T;
  createdAt: string;
  updatedAt: string;
}

let memoryToken: string | null = null;

function getConfig(): AtomsGlobalConfig {
  const cfg = (globalThis as { __ATOMS_CONFIG__?: AtomsGlobalConfig }).__ATOMS_CONFIG__;
  if (!cfg) {
    throw new Error('@atoms/cloud runtime config is missing');
  }
  return cfg;
}

function getBaseUrl(): string {
  const cfg = getConfig();
  if (typeof window !== 'undefined' && window.location && window.location.origin && window.location.origin !== 'null') {
    return window.location.origin;
  }
  return (cfg.apiBaseUrl || '').replace(/\\/$/, '');
}

function storageKey(): string {
  return 'atoms_cloud_token_' + getConfig().projectId;
}

function readToken(): string | null {
  if (memoryToken) return memoryToken;
  try {
    const saved = window.localStorage.getItem(storageKey());
    if (saved) {
      memoryToken = saved;
      return saved;
    }
  } catch {
    // Sandboxed iframes without allow-same-origin disallow localStorage.
  }
  return null;
}

function writeToken(token: string | null): void {
  memoryToken = token;
  try {
    if (token) {
      window.localStorage.setItem(storageKey(), token);
    } else {
      window.localStorage.removeItem(storageKey());
    }
  } catch {
    // Ignore storage errors inside restricted preview sandboxes.
  }
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  const token = readToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', 'Bearer ' + token);
  }
  const res = await fetch(getBaseUrl() + path, {
    ...init,
    headers,
  });
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { error: text };
    }
  }
  if (!res.ok) {
    const errMsg =
      parsed && typeof parsed === 'object' && 'error' in parsed && typeof (parsed as { error?: unknown }).error === 'string'
        ? (parsed as { error: string }).error
        : 'Request failed with status ' + res.status;
    throw new Error(errMsg);
  }
  return parsed as T;
}

export const db = {
  async list<T = Record<string, unknown>>(collection: string, filter?: { mine?: boolean }): Promise<CloudRecord<T>[]> {
    if (filter?.mine && !readToken()) {
      return [];
    }
    const pid = encodeURIComponent(getConfig().projectId);
    const col = encodeURIComponent(collection);
    const qs = filter?.mine ? '?mine=1' : '';
    const res = await requestJson<{ records: CloudRecord<T>[] }>('/api/cloud/' + pid + '/db/' + col + qs);
    return res.records;
  },

  async get<T = Record<string, unknown>>(collection: string, id: string): Promise<CloudRecord<T> | null> {
    const items = await db.list<T>(collection);
    return items.find((item) => item.id === id) ?? null;
  },

  async create<T = Record<string, unknown>>(collection: string, data: T): Promise<CloudRecord<T>> {
    const pid = encodeURIComponent(getConfig().projectId);
    const col = encodeURIComponent(collection);
    const res = await requestJson<{ record: CloudRecord<T> }>('/api/cloud/' + pid + '/db/' + col, {
      method: 'POST',
      body: JSON.stringify({ data }),
    });
    return res.record;
  },

  async update<T = Record<string, unknown>>(collection: string, id: string, patch: Partial<T>): Promise<CloudRecord<T>> {
    const pid = encodeURIComponent(getConfig().projectId);
    const col = encodeURIComponent(collection);
    const rid = encodeURIComponent(id);
    const res = await requestJson<{ record: CloudRecord<T> }>('/api/cloud/' + pid + '/db/' + col + '/' + rid, {
      method: 'PATCH',
      body: JSON.stringify({ patch }),
    });
    return res.record;
  },

  async remove(collection: string, id: string): Promise<void> {
    const pid = encodeURIComponent(getConfig().projectId);
    const col = encodeURIComponent(collection);
    const rid = encodeURIComponent(id);
    await requestJson<{ ok: true }>('/api/cloud/' + pid + '/db/' + col + '/' + rid, {
      method: 'DELETE',
    });
  },
};

export const auth = {
  getToken(): string | null {
    return readToken();
  },

  logout(): void {
    writeToken(null);
  },

  async register(email: string, password: string, name?: string): Promise<{ user: CloudUser; token: string }> {
    const pid = encodeURIComponent(getConfig().projectId);
    const res = await requestJson<{ user: CloudUser; token: string }>('/api/cloud/' + pid + '/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    });
    writeToken(res.token);
    return res;
  },

  async login(email: string, password: string): Promise<{ user: CloudUser; token: string }> {
    const pid = encodeURIComponent(getConfig().projectId);
    const res = await requestJson<{ user: CloudUser; token: string }>('/api/cloud/' + pid + '/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    writeToken(res.token);
    return res;
  },

  async me(): Promise<CloudUser | null> {
    if (!readToken()) return null;
    try {
      const pid = encodeURIComponent(getConfig().projectId);
      const res = await requestJson<{ user: CloudUser | null }>('/api/cloud/' + pid + '/auth/me');
      return res.user;
    } catch {
      return null;
    }
  },
};

export const billing = {
  async getPlan(): Promise<{ plan: 'free' | 'pro' }> {
    const pid = encodeURIComponent(getConfig().projectId);
    return requestJson<{ plan: 'free' | 'pro' }>('/api/cloud/' + pid + '/billing/plan');
  },

  async checkout(plan: 'pro' = 'pro'): Promise<{ checkoutUrl: string; sessionId: string }> {
    const cfg = getConfig();
    const pid = encodeURIComponent(cfg.projectId);
    const returnUrl =
      typeof window !== 'undefined' && window.location && window.location.href && !window.location.href.startsWith('about:')
        ? window.location.href
        : getBaseUrl() + '/';
    const session = await requestJson<{ checkoutUrl: string; sessionId: string }>(
      '/api/cloud/' + pid + '/billing/checkout',
      {
        method: 'POST',
        body: JSON.stringify({ plan, returnUrl }),
      }
    );
    if (typeof window !== 'undefined') {
      if (cfg.mode === 'preview') {
        window.open(session.checkoutUrl, '_blank', 'noopener');
      } else {
        window.location.href = session.checkoutUrl;
      }
    }
    return session;
  },
};

export const ai = {
  async complete(prompt: string): Promise<{ text: string }> {
    const pid = encodeURIComponent(getConfig().projectId);
    return requestJson<{ text: string }>('/api/cloud/' + pid + '/ai', {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    });
  },
};
`;

/**
 * Generates concise @atoms/cloud SDK usage documentation injected into Alex's system prompt
 * based on the project's declared capabilities.
 */
export function getCloudSdkPromptDocs(capabilities: CloudCapability[]): string {
  const hasAuth = capabilities.includes('auth');
  const sections: string[] = [
    `Import capabilities strictly from '@atoms/cloud':`,
    `import { ${capabilities.join(', ')} } from '@atoms/cloud';`,
  ];

  if (capabilities.includes('db')) {
    if (hasAuth) {
      sections.push(
        `db API:
- db.list<T>(collection, { mine?: boolean }) -> Promise<Array<{ id, data: T, ownerUserId, createdAt }>> (Note: { mine: true } requires a logged-in user and returns [] before login; public views such as leaderboards or landing feeds MUST call db.list(collection) without { mine: true })
- db.create<T>(collection, data: T) -> Promise<CloudRecord<T>> (associates ownerUserId when logged in, or null for guest writes)
- db.update<T>(collection, id, patch: Partial<T>) -> Promise<CloudRecord<T>> (requires a logged-in user token and record ownership; throws HTTP 401 when unauthenticated or HTTP 403 for non-owners)
- db.remove(collection, id) -> Promise<void> (requires a logged-in user token and record ownership; throws HTTP 401 when unauthenticated or HTTP 403 for non-owners)`
      );
    } else {
      sections.push(
        `db API (DB-only guest mode — "auth" is NOT enabled in this plan):
- db.list<T>(collection) -> Promise<Array<{ id, data: T, ownerUserId, createdAt }>> (DO NOT pass { mine: true } when "auth" is disabled)
- db.create<T>(collection, data: T) -> Promise<CloudRecord<T>> (persists public/guest records such as leaderboard scores or submissions)
- IMPORTANT: db.update() and db.remove() require a logged-in auth token (HTTP 401 without "auth"). For guest-only local settings or personal bests when "auth" is disabled, store them in React state or try/catch localStorage rather than calling db.list(..., { mine: true }) or db.update().`
      );
    }
  }

  if (capabilities.includes('auth')) {
    sections.push(
      `auth API:
- auth.register(email, password, name?) -> Promise<{ user, token }>
- auth.login(email, password) -> Promise<{ user, token }>
- auth.me() -> Promise<CloudUser | null>
- auth.logout() -> void`
    );
  }

  if (capabilities.includes('billing')) {
    sections.push(
      `billing API (requires authenticated user):
- billing.getPlan() -> Promise<{ plan: 'free' | 'pro' }>
- billing.checkout('pro') -> Promise<{ checkoutUrl, sessionId }>`
    );
  }

  if (capabilities.includes('ai')) {
    sections.push(
      `ai API:
- ai.complete(prompt) -> Promise<{ text }>`
    );
  }

  return sections.join('\n\n');
}
