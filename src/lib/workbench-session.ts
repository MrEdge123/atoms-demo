export const ATOMS_SID_COOKIE = 'atoms_sid';
export const ATOMS_SID_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days
export const DEFAULT_DEV_AUTH_SECRET = 'dev-local-secret-change-in-production';

const SID_TOKEN_RE = /^(sid_[0-9a-f]{32})\.([0-9a-f]{64})$/;
const textEncoder = new TextEncoder();

export function resolveAuthSecret(override?: string): string {
  const candidate = override?.trim() || process.env.APP_AUTH_SECRET?.trim();
  return candidate || DEFAULT_DEV_AUTH_SECRET;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function hmacSha256Hex(secret: string, data: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await globalThis.crypto.subtle.sign(
    'HMAC',
    key,
    textEncoder.encode(data)
  );
  return bytesToHex(new Uint8Array(sig));
}

/**
 * Mints a fresh anonymous workbench session ID and signs it with HMAC-SHA256.
 * Format: `sid_<32 hex>.<64 hex hmac>`
 */
export async function mintSignedSessionToken(secret: string): Promise<{
  sid: string;
  cookieValue: string;
}> {
  const random = new Uint8Array(16);
  globalThis.crypto.getRandomValues(random);
  const sid = `sid_${bytesToHex(random)}`;
  const sig = await hmacSha256Hex(secret, sid);
  return { sid, cookieValue: `${sid}.${sig}` };
}

/**
 * Verifies an incoming `atoms_sid` cookie value and returns its `sid` if valid.
 */
export async function verifySignedSessionToken(
  cookieValue: string | null | undefined,
  secret: string
): Promise<string | null> {
  if (!cookieValue) return null;
  const match = SID_TOKEN_RE.exec(cookieValue.trim());
  if (!match) return null;
  const [, sid, sigHex] = match;
  const expected = await hmacSha256Hex(secret, sid);
  return constantTimeEqual(sigHex, expected) ? sid : null;
}

export function parseCookieHeader(
  cookieHeader: string | null | undefined,
  name: string
): string | null {
  if (!cookieHeader) return null;
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) continue;
    const key = pair.slice(0, eqIdx).trim();
    if (key === name) {
      const rawVal = pair.slice(eqIdx + 1).trim();
      try {
        return decodeURIComponent(rawVal);
      } catch {
        return rawVal;
      }
    }
  }
  return null;
}

export function shouldUseSecureCookie(req: Request): boolean {
  if (process.env.NODE_ENV !== 'production') {
    return false;
  }
  const forwardedProto = req.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim()
    .toLowerCase();
  if (forwardedProto === 'https') return true;
  if (forwardedProto === 'http') return false;
  if (req.url.startsWith('https://')) return true;
  const configuredBase = process.env.APP_BASE_URL?.trim() ?? '';
  if (configuredBase.startsWith('https://')) return true;
  return false;
}

export function buildSessionCookieHeader(
  cookieValue: string,
  secure: boolean
): string {
  return `${ATOMS_SID_COOKIE}=${cookieValue}; Path=/; Max-Age=${ATOMS_SID_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}
