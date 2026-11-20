export const DEFAULT_AI_RATE_LIMIT_IP_PER_MIN = 10;
export const DEFAULT_AI_RATE_LIMIT_PROJECT_PER_DAY = 200;
export const DEFAULT_AI_PROXY_MAX_INPUT_CHARS = 2000;
export const DEFAULT_AI_PROXY_MAX_TOKENS = 512;

const ONE_MINUTE_MS = 60_000;

interface ProjectDailyBucket {
  day: string;
  count: number;
}

interface AiRateLimitStore {
  ipHits: Map<string, number[]>;
  projectDailyHits: Map<string, ProjectDailyBucket>;
}

const g = globalThis as unknown as {
  __atomsAiRateLimitStore?: AiRateLimitStore;
};

function getStore(): AiRateLimitStore {
  if (!g.__atomsAiRateLimitStore) {
    g.__atomsAiRateLimitStore = {
      ipHits: new Map<string, number[]>(),
      projectDailyHits: new Map<string, ProjectDailyBucket>(),
    };
  }
  return g.__atomsAiRateLimitStore;
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function formatUtcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function secondsUntilNextUtcDay(nowMs: number): number {
  const now = new Date(nowMs);
  const nextMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0,
    0
  );
  return Math.max(1, Math.ceil((nextMidnight - nowMs) / 1000));
}

function pruneExpiredIpEntries(
  ipHits: Map<string, number[]>,
  cutoffMs: number
): void {
  for (const [key, timestamps] of ipHits.entries()) {
    const active = timestamps.filter((ts) => ts > cutoffMs);
    if (active.length === 0) {
      ipHits.delete(key);
    } else if (active.length !== timestamps.length) {
      ipHits.set(key, active);
    }
  }
}

export interface AiProxyLimits {
  ipPerMin: number;
  projectPerDay: number;
  maxInputChars: number;
  maxTokens: number;
}

export function getAiProxyLimits(): AiProxyLimits {
  return {
    ipPerMin: readPositiveIntEnv(
      'AI_RATE_LIMIT_IP_PER_MIN',
      DEFAULT_AI_RATE_LIMIT_IP_PER_MIN
    ),
    projectPerDay: readPositiveIntEnv(
      'AI_RATE_LIMIT_PROJECT_PER_DAY',
      DEFAULT_AI_RATE_LIMIT_PROJECT_PER_DAY
    ),
    maxInputChars: readPositiveIntEnv(
      'AI_PROXY_MAX_INPUT_CHARS',
      DEFAULT_AI_PROXY_MAX_INPUT_CHARS
    ),
    maxTokens: readPositiveIntEnv(
      'AI_PROXY_MAX_TOKENS',
      DEFAULT_AI_PROXY_MAX_TOKENS
    ),
  };
}

export type AiRateLimitDecision =
  | {
      allowed: true;
      ipCount: number;
      ipLimit: number;
      projectDayCount: number;
      projectDayLimit: number;
    }
  | {
      allowed: false;
      scope: 'ip' | 'project';
      retryAfterSec: number;
      ipCount: number;
      ipLimit: number;
      projectDayCount: number;
      projectDayLimit: number;
    };

/**
 * Checks per-IP/minute and per-project/day limits before incrementing either counter.
 */
export function consumeAiRateLimit(input: {
  ip: string;
  projectId: string;
  nowMs?: number;
}): AiRateLimitDecision {
  const nowMs = input.nowMs ?? Date.now();
  const cutoffMs = nowMs - ONE_MINUTE_MS;
  const day = formatUtcDay(nowMs);
  const limits = getAiProxyLimits();
  const store = getStore();

  if (store.ipHits.size > 1000) {
    pruneExpiredIpEntries(store.ipHits, cutoffMs);
  }
  if (store.projectDailyHits.size > 1000) {
    for (const [pid, bucket] of store.projectDailyHits.entries()) {
      if (bucket.day !== day) {
        store.projectDailyHits.delete(pid);
      }
    }
  }

  const rawIpTimestamps = store.ipHits.get(input.ip) ?? [];
  const activeIpTimestamps = rawIpTimestamps.filter((ts) => ts > cutoffMs);
  if (activeIpTimestamps.length === 0 && store.ipHits.has(input.ip)) {
    store.ipHits.delete(input.ip);
  } else if (activeIpTimestamps.length !== rawIpTimestamps.length) {
    store.ipHits.set(input.ip, activeIpTimestamps);
  }

  const existingProjectBucket = store.projectDailyHits.get(input.projectId);
  const currentProjectCount =
    existingProjectBucket && existingProjectBucket.day === day
      ? existingProjectBucket.count
      : 0;

  if (activeIpTimestamps.length >= limits.ipPerMin) {
    const oldestActive = activeIpTimestamps[0] ?? nowMs;
    const retryAfterSec = Math.max(
      1,
      Math.ceil((oldestActive + ONE_MINUTE_MS - nowMs) / 1000)
    );
    return {
      allowed: false,
      scope: 'ip',
      retryAfterSec,
      ipCount: activeIpTimestamps.length,
      ipLimit: limits.ipPerMin,
      projectDayCount: currentProjectCount,
      projectDayLimit: limits.projectPerDay,
    };
  }

  if (currentProjectCount >= limits.projectPerDay) {
    return {
      allowed: false,
      scope: 'project',
      retryAfterSec: secondsUntilNextUtcDay(nowMs),
      ipCount: activeIpTimestamps.length,
      ipLimit: limits.ipPerMin,
      projectDayCount: currentProjectCount,
      projectDayLimit: limits.projectPerDay,
    };
  }

  const nextIpTimestamps = [...activeIpTimestamps, nowMs];
  store.ipHits.set(input.ip, nextIpTimestamps);
  const nextProjectCount = currentProjectCount + 1;
  store.projectDailyHits.set(input.projectId, {
    day,
    count: nextProjectCount,
  });

  return {
    allowed: true,
    ipCount: nextIpTimestamps.length,
    ipLimit: limits.ipPerMin,
    projectDayCount: nextProjectCount,
    projectDayLimit: limits.projectPerDay,
  };
}

export function resetAiRateLimiterForTest(): void {
  const store = getStore();
  store.ipHits.clear();
  store.projectDailyHits.clear();
}
