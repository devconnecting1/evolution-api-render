/**
 * "Entrar com Google" por pessoa (proposta V, etapa 1). Only the e-mails of GOOGLE_LOGIN_OWNER_EMAILS get in;
 * there are no invites or roles yet. The global API key keeps working as break-glass (see auth.guard.ts).
 *
 * - GET /auth/google: signed state + nonce in an HttpOnly/SameSite=Lax cookie, then the Google consent screen
 *   (openid, e-mail and profile only; no calendar and no offline access).
 * - GET /auth/google/callback: checks the state and the cookie nonce, exchanges the code, requires
 *   email_verified and the allowlist, and redirects back to the fixed GOOGLE_LOGIN_RETURN_URL with a one-time
 *   code. Never to a URL taken from the query or the state.
 * - POST /auth/google/exchange: the panel trades the one-time code for the session token (shown only once, stored
 *   as a hash by UserSessionService).
 *
 * Environment (Render): GOOGLE_LOGIN_CLIENT_ID/GOOGLE_LOGIN_CLIENT_SECRET (or the GOOGLE_CLIENT_ID/SECRET of the
 * Agenda), optional GOOGLE_LOGIN_REDIRECT_URI (default <SERVER_URL>/auth/google/callback), GOOGLE_LOGIN_RETURN_URL
 * (default https://whatsaibr.vercel.app/manager/login), GOOGLE_LOGIN_OWNER_EMAILS (comma separated) and optional
 * GOOGLE_LOGIN_STATE_SECRET (default derived from GOOGLE_TOKEN_KEY or the global key). Without client id/secret or
 * without the allowlist, the feature is off and the status endpoint says so.
 */
import { randomBytes } from 'crypto';

import {
  claimsFromIdToken,
  GoogleLoginClaims,
  GOOGLE_LOGIN_TOKEN_URL,
  LOGIN_CODE_TTL_MS,
  loginAuthUrl,
  parseAllowlist,
  sameSecret,
  signLoginState,
  verifyLoginState,
} from '@utils/google-login';

export type GoogleLoginFetch = (
  url: string,
  init?: any,
) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

export type GoogleLoginOptions = {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  /** Fixed origin/page of the panel that receives the one-time code. Never taken from the request. */
  returnUrl?: string;
  allowlist?: string[];
  /** Secret of the state HMAC. */
  secret: string;
  fetchImpl?: GoogleLoginFetch;
  now?: () => number;
  timeoutMs?: number;
  log?: (level: 'log' | 'warn' | 'error', message: string) => void;
};

export class GoogleLoginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleLoginError';
  }
}

const DEFAULT_RETURN_URL = 'https://whatsaibr.vercel.app/manager/login';
const MAX_CODES = 200;

export class GoogleLoginService {
  private readonly codes = new Map<string, { claims: GoogleLoginClaims; until: number }>();

  constructor(private readonly options: GoogleLoginOptions) {}

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private log(level: 'log' | 'warn' | 'error', message: string) {
    this.options.log?.(level, message);
  }

  public allowlist(): string[] {
    return parseAllowlist((this.options.allowlist ?? []).join(','));
  }

  private returnUrl(): string | null {
    const text = (this.options.returnUrl || DEFAULT_RETURN_URL).trim();
    try {
      const url = new URL(text);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
    } catch {
      return null;
    }
  }

  /** Client id + secret + redirect URI + allowlist + a valid return URL. Without all of them, the feature is off. */
  public available(): boolean {
    return !!(
      this.options.clientId &&
      this.options.clientSecret &&
      this.options.redirectUri &&
      this.allowlist().length &&
      this.returnUrl()
    );
  }

  public status() {
    return { enabled: this.available() };
  }

  /** URL of the Google consent screen plus the nonce for the HttpOnly cookie. */
  public connect(): { url: string; state: string; nonce: string } {
    if (!this.available())
      throw new GoogleLoginError('O login com Google não está configurado no servidor. Use a chave de acesso.');
    const { state, nonce } = signLoginState(this.options.secret, this.now());
    return {
      url: loginAuthUrl({
        clientId: this.options.clientId!,
        redirectUri: this.options.redirectUri!,
        state,
      }),
      state,
      nonce,
    };
  }

  private fetch(url: string, init: any = {}) {
    const impl: GoogleLoginFetch = this.options.fetchImpl ?? (globalThis.fetch as any);
    return impl(url, { ...init, signal: AbortSignal.timeout(this.options.timeoutMs ?? 8_000) });
  }

  /**
   * Validates the callback (state, cookie nonce, code), asks Google for the tokens and returns the verified
   * claims. Throws GoogleLoginError with a PT-BR message.
   */
  public async finish(input: {
    code: unknown;
    state: unknown;
    cookieNonce: unknown;
    error?: unknown;
  }): Promise<GoogleLoginClaims> {
    if (!this.available())
      throw new GoogleLoginError('O login com Google não está configurado no servidor. Use a chave de acesso.');
    if (input.error) throw new GoogleLoginError('O login pelo Google foi cancelado.');
    const payload = verifyLoginState(input.state, this.options.secret, this.now());
    if (!payload) throw new GoogleLoginError('O login expirou. Clique em "Entrar com Google" de novo.');
    if (!sameSecret(payload.nonce, input.cookieNonce)) {
      throw new GoogleLoginError('Não foi possível confirmar este login neste navegador. Tente de novo.');
    }
    const code = String(input.code ?? '');
    if (!code || code.length > 2048) throw new GoogleLoginError('O Google não devolveu a autorização.');

    const response = await this.fetch(GOOGLE_LOGIN_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.options.clientId!,
        client_secret: this.options.clientSecret!,
        redirect_uri: this.options.redirectUri!,
        grant_type: 'authorization_code',
      }).toString(),
    }).catch(() => null);
    const data: any = response ? await response.json().catch(() => ({})) : {};
    if (!response?.ok || !data?.id_token) {
      this.log('warn', `Google login token exchange failed: HTTP ${response?.status ?? 'sem resposta'} ${data?.error ?? ''}`);
      throw new GoogleLoginError('O Google recusou o login. Tente de novo.');
    }
    const claims = claimsFromIdToken(data.id_token, this.options.clientId);
    if (!claims) throw new GoogleLoginError('Não foi possível ler os dados da conta Google.');
    if (!claims.emailVerified) {
      throw new GoogleLoginError('A conta do Google precisa ter o e-mail verificado para entrar.');
    }
    if (!this.allowlist().includes(claims.email)) {
      throw new GoogleLoginError('Esta conta do Google não está liberada para entrar no WhatsAI.');
    }
    return claims;
  }

  /** One-time code handed to the fixed return URL (60 s, single use). */
  public issueCode(claims: GoogleLoginClaims): string {
    const now = this.now();
    if (this.codes.size >= MAX_CODES) {
      for (const [code, entry] of this.codes) if (entry.until < now) this.codes.delete(code);
      if (this.codes.size >= MAX_CODES) {
        const oldest = this.codes.keys().next().value;
        if (oldest) this.codes.delete(oldest);
      }
    }
    const code = randomBytes(32).toString('base64url');
    this.codes.set(code, { claims, until: now + LOGIN_CODE_TTL_MS });
    return code;
  }

  /** The claims of a still valid, unused code; null otherwise. A code never works twice. */
  public consumeCode(code: unknown): GoogleLoginClaims | null {
    const text = String(code ?? '');
    if (!/^[A-Za-z0-9_-]{43}$/.test(text)) return null;
    const entry = this.codes.get(text);
    if (!entry) return null;
    this.codes.delete(text);
    return entry.until >= this.now() ? entry.claims : null;
  }

  /** Fixed destination after the callback: only a code or a PT-BR message, never tokens. */
  public successRedirect(code: string): string {
    return this.withParam('google_code', code);
  }

  public errorRedirect(message: string): string {
    return this.withParam('google_error', String(message).slice(0, 200));
  }

  private withParam(name: string, value: string): string {
    const url = new URL(this.returnUrl() || DEFAULT_RETURN_URL);
    url.searchParams.set(name, value);
    return url.toString();
  }
}
