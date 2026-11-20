import crypto from 'node:crypto';

export interface AppTokenClaims {
  sub: string;
  projectId: string;
  email: string;
  iat: number;
  exp: number;
}

/**
 * Hashes a user password with per-record random salt using Node's scrypt.
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

/**
 * Verifies a plaintext password against a stored "salt:hash" digest in constant time.
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, hexHash] = parts;
  if (!salt || !hexHash) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hexHash, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

/**
 * Signs a project-scoped HS256 JWT token for end-users of generated apps.
 */
export function signAppToken(
  payload: { sub: string; projectId: string; email: string },
  secret: string,
  ttlSeconds = 7 * 24 * 3600
): string {
  const now = Math.floor(Date.now() / 1000);
  const claims: AppTokenClaims = {
    sub: payload.sub,
    projectId: payload.projectId,
    email: payload.email,
    iat: now,
    exp: now + ttlSeconds,
  };
  const headerB64 = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' })
  ).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64url');
  return `${signingInput}.${sig}`;
}

/**
 * Verifies a project-scoped token and rejects tokens minted for any other projectId.
 */
export function verifyAppToken(
  token: string,
  expectedProjectId: string,
  secret: string
): AppTokenClaims | null {
  const segments = token.split('.');
  if (segments.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = segments;
  if (!headerB64 || !payloadB64 || !sigB64) return null;

  const signingInput = `${headerB64}.${payloadB64}`;
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest();

  let actualSig: Buffer;
  try {
    actualSig = Buffer.from(sigB64, 'base64url');
  } catch {
    return null;
  }

  if (actualSig.length !== expectedSig.length) return null;
  if (!crypto.timingSafeEqual(actualSig, expectedSig)) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8')
    ) as Partial<AppTokenClaims>;

    if (
      !parsed.sub ||
      !parsed.projectId ||
      !parsed.email ||
      typeof parsed.exp !== 'number'
    ) {
      return null;
    }

    if (parsed.projectId !== expectedProjectId) {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    if (parsed.exp < now) {
      return null;
    }

    return parsed as AppTokenClaims;
  } catch {
    return null;
  }
}

/**
 * Generates a hex HMAC-SHA256 signature for webhook payloads.
 */
export function signHmacSha256(rawBody: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

/**
 * Constant-time HMAC-SHA256 verification supporting raw hex or "sha256=<hex>".
 */
export function verifyHmacSha256(
  rawBody: string,
  signature: string | null,
  secret: string
): boolean {
  if (!signature || !secret) return false;
  const cleaned = signature.trim().replace(/^sha256=/i, '').toLowerCase();
  if (!/^[0-9a-f]+$/.test(cleaned)) return false;

  const expectedHex = signHmacSha256(rawBody, secret);
  const actualBuf = Buffer.from(cleaned, 'hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  if (actualBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}
