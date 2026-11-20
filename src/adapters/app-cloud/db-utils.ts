import { CloudRecordForbiddenError } from '../../ports';

export const DEFAULT_CLOUD_DB_LIMIT = 50;
export const DEFAULT_CLOUD_DB_MAX_LIMIT = 100;

export function resolveCloudDbPagination(filter?: {
  limit?: number;
  offset?: number;
}): { limit: number; offset: number } {
  const configuredMax = Number.parseInt(
    process.env.CLOUD_DB_MAX_LIMIT ?? '',
    10
  );
  const maxLimit =
    Number.isFinite(configuredMax) && configuredMax > 0
      ? configuredMax
      : DEFAULT_CLOUD_DB_MAX_LIMIT;

  const rawLimit = filter?.limit;
  const parsedLimit =
    typeof rawLimit === 'number' && Number.isFinite(rawLimit)
      ? Math.trunc(rawLimit)
      : Math.min(DEFAULT_CLOUD_DB_LIMIT, maxLimit);
  const limit = Math.max(1, Math.min(parsedLimit, maxLimit));

  const rawOffset = filter?.offset;
  const offset =
    typeof rawOffset === 'number' && Number.isFinite(rawOffset) && rawOffset >= 0
      ? Math.trunc(rawOffset)
      : 0;

  return { limit, offset };
}

export function assertRecordAccess(
  ownerUserId: string | null,
  opts?: { expectedOwnerUserId?: string; allowUnownedPublic?: boolean }
): void {
  if (opts?.expectedOwnerUserId === undefined) return;
  if (ownerUserId === opts.expectedOwnerUserId) return;
  if (opts.allowUnownedPublic === true && !ownerUserId) return;
  throw new CloudRecordForbiddenError(
    'Only the record owner can modify or delete this record'
  );
}
