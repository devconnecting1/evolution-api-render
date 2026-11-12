/**
 * "Entrar com Google" (proposta V, etapa 1): pure helpers (no I/O), used by
 * src/api/services/google-login.service.ts and src/api/services/user-session.service.ts, and tested in
 * test/unit/google-login.test.ts.
 *
 * - Session tokens: "was_" + 32 random bytes (base64url). Only the SHA-256 of the token is stored (UserSession
 *   .tokenHash); the token itself never touches the database and never appears in a URL.
 * - OAuth state: "<payload>.<hmac>" (base64url JSON {n: nonce, e: expiry ms} + HMAC-SHA256), valid for 10 minutes.
 *   The nonce is also kept in an HttpOnly cookie, so a state generated for someone else's browser does not work.
 * - The id_token comes straight from Google's token endpoint over TLS (same reasoning as the Agenda integration):
 *   there is no need to check the signature, but audience, issuer, expiry and email_verified are checked.
 * - One-time code: random 32 bytes, 60 seconds, exchanged by the panel for the session token. Never the token
 *   itself in the redirect URL.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

export const LOGIN_SESSION_PREFIX = 'was_';
export const LOGIN_STATE_TTL_MS = 10 * 60_000;
export const LOGIN_CODE_TTL_MS = 60_000;
export const LOGIN_SCOPES = ['openid', 'email', 'profile'];
export const GOOGLE_LOGIN_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_LOGIN_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const LOGIN_STATE_COOKIE = 'wa_gl_state';

const b64url = (buf: Buffer) => buf.toString('base64url');

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/** Constant-time comparison of two strings (length differences are not leaked over the hash). */
export function sameSecret(received: unknown, expected: unknown): boolean {
  if (typeof received !== 'string' || typeof expected !== 'string') return false;
  if (!received || !expected) return false;
  return timingSafeEqual(digest(received), digest(expected));
}

// ----------------------------------------------------------------------------------------------- session token

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(String(token)).digest('hex');
}

export function generateSessionToken(): { token: string; hash: string } {
  const token = LOGIN_SESSION_PREFIX + b64url(randomBytes(32));
  return { token, hash: hashSessionToken(token) };
}

export function isSessionToken(value: unknown): boolean {
  const text = String(value ?? '');
  return text.startsWith(LOGIN_SESSION_PREFIX) && /^[A-Za-z0-9_-]{43}$/.test(text.slice(LOGIN_SESSION_PREFIX.length));
}

/** What the panel shows about a session: never the token or its hash. */
export type PublicSession = {
  id: string;
  createdAt: string | null;
  lastSeenAt: string | null;
  expiresAt: string | null;
  userAgent: string | null;
  revokedAt: string | null;
  current: boolean;
};

// ------------------------------------------------------------------------------------------------ OAuth state

function stateKey(secret: string): Buffer {
  return createHash('sha256').update(`whatsai-glogin:state:${secret}`).digest();
}

/** Signed state with the nonce that also goes to the HttpOnly cookie. */
export function signLoginState(
  secret: string,
  now: number,
  nonce = b64url(randomBytes(24)),
): { state: string; nonce: string } {
  const payload = b64url(Buffer.from(JSON.stringify({ n: nonce, e: now + LOGIN_STATE_TTL_MS })));
  const mac = b64url(createHmac('sha256', stateKey(secret)).update(payload).digest());
  return { state: `${payload}.${mac}`, nonce };
}

/** The nonce of a valid, unexpired state; null otherwise. */
export function verifyLoginState(state: unknown, secret: string, now: number): { nonce: string } | null {
  const text = String(state ?? '');
  if (text.length > 600) return null;
  const [payload, mac, extra] = text.split('.');
  if (!payload || !mac || extra !== undefined) return null;
  const expected = createHmac('sha256', stateKey(secret)).update(payload).digest();
  let given: Buffer;
  try {
    given = Buffer.from(mac, 'base64url');
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof data?.n !== 'string' || !data.n || typeof data?.e !== 'number' || data.e < now) return null;
    return { nonce: data.n };
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------------------------- cookie helpers

export function readCookie(header: unknown, name: string): string | null {
  for (const part of String(header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function stateCookie(value: string, secure: boolean, maxAgeSeconds = LOGIN_STATE_TTL_MS / 1000): string {
  return [
    `${LOGIN_STATE_COOKIE}=${encodeURIComponent(value)}`,
    'Path=/auth/google',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : null,
  ]
    .filter(Boolean)
    .join('; ');
}

// ---------------------------------------------------------------------------------------------- allowlist/claims

/** GOOGLE_LOGIN_OWNER_EMAILS: comma (or space) separated, lower case, no duplicates. */
export function parseAllowlist(value: unknown): string[] {
  const seen = new Set<string>();
  for (const item of String(value ?? '').split(/[\s,]+/)) {
    const email = item.trim().toLowerCase();
    if (!email || email.length > 320 || !email.includes('@')) continue;
    seen.add(email);
  }
  return [...seen];
}

export type GoogleLoginClaims = {
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
};

/**
 * E-mail, name and picture from the id_token of the token response. null when it is not a usable Google token.
 * Audience, issuer and expiry are required (an absent claim is a refusal, never "nothing to check").
 */
export function claimsFromIdToken(
  idToken: unknown,
  clientId?: string,
  now: number = Date.now(),
): GoogleLoginClaims | null {
  const part = String(idToken ?? '').split('.')[1];
  if (!part) return null;
  try {
    const data = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    if (typeof data?.email !== 'string') return null;
    if (typeof data?.aud !== 'string' || !data.aud) return null;
    if (clientId && data.aud !== clientId) return null;
    if (data?.iss !== 'https://accounts.google.com' && data.iss !== 'accounts.google.com') return null;
    if (typeof data?.exp !== 'number' || !Number.isFinite(data.exp) || data.exp * 1000 <= now) return null;
    const verified = data?.email_verified === true || data?.email_verified === 'true';
    const email = data.email.trim().toLowerCase();
    if (!email || email.length > 320 || !email.includes('@')) return null;
    return {
      email,
      emailVerified: verified,
      name: typeof data?.name === 'string' ? data.name.slice(0, 200) : null,
      picture: typeof data?.picture === 'string' ? data.picture.slice(0, 500) : null,
    };
  } catch {
    return null;
  }
}

export function loginAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  loginHint?: string | null;
}): string {
  const query = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: 'code',
    scope: LOGIN_SCOPES.join(' '),
    access_type: 'online',
    prompt: 'select_account',
    state: params.state,
  });
  if (params.loginHint) query.set('login_hint', params.loginHint);
  return `${GOOGLE_LOGIN_AUTH_URL}?${query}`;
}
