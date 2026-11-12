import '../helpers/setup';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { GoogleLoginError, GoogleLoginService } from '@api/services/google-login.service';
import {
  claimsFromIdToken,
  generateSessionToken,
  hashSessionToken,
  isSessionToken,
  LOGIN_CODE_TTL_MS,
  LOGIN_SESSION_PREFIX,
  LOGIN_STATE_COOKIE,
  parseAllowlist,
  readCookie,
  sameSecret,
  signLoginState,
  stateCookie,
  verifyLoginState,
} from '@utils/google-login';

const NOW = 1_800_000_000_000;

const options = (over: Record<string, unknown> = {}) => ({
  clientId: 'login.apps.googleusercontent.com',
  clientSecret: 'client-secret',
  redirectUri: 'https://api.exemplo.com/auth/google/callback',
  returnUrl: 'https://painel.exemplo.com/manager/login',
  allowlist: ['Dono@Exemplo.com'],
  secret: 'state-secret',
  now: () => NOW,
  ...over,
});

const idToken = (claims: Record<string, unknown>) =>
  ['header', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'signature'].join('.');

const googleFetch = (claims: Record<string, unknown>, calls: any[] = []) =>
  async (url: string, init: any) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ id_token: idToken(claims), scope: 'openid email profile' }) };
  };

const verified = { email: 'Dono@Exemplo.com', email_verified: true, name: 'Dono Exemplo', picture: 'https://x/p.png' };

describe('equipe: session tokens', () => {
  test('was_ + 32 random bytes; only the SHA-256 is stored and looked up', () => {
    const first = generateSessionToken();
    const second = generateSessionToken();
    assert.match(first.token, new RegExp(`^${LOGIN_SESSION_PREFIX}[A-Za-z0-9_-]{43}$`));
    assert.notEqual(first.token, second.token);
    assert.equal(first.hash, hashSessionToken(first.token));
    assert.equal(first.hash.length, 64);
    assert.ok(isSessionToken(first.token));
    assert.ok(!isSessionToken('was_short'));
    assert.ok(!isSessionToken('wac_' + 'a'.repeat(43)));
    assert.ok(!isSessionToken('B6D711FCDE4D4FD5936544120E713976'));
    assert.ok(!isSessionToken(undefined));
    assert.ok(sameSecret(first.token, first.token));
    assert.ok(!sameSecret(first.token, second.token));
  });
});

describe('equipe: OAuth state and cookie', () => {
  test('the state is signed, expires in 10 minutes and carries the nonce of the cookie', () => {
    const { state, nonce } = signLoginState('state-secret', NOW);
    assert.deepEqual(verifyLoginState(state, 'state-secret', NOW + 1000), { nonce });
    assert.equal(verifyLoginState(state, 'other-secret', NOW), null);
    assert.equal(verifyLoginState(state, 'state-secret', NOW + 10 * 60_000 + 1), null);
    assert.equal(verifyLoginState(`${state}x`, 'state-secret', NOW), null);
    assert.equal(verifyLoginState('', 'state-secret', NOW), null);
    const [payload, mac] = state.split('.');
    const tampered = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), n: 'outro' }),
    ).toString('base64url');
    assert.equal(verifyLoginState(`${tampered}.${mac}`, 'state-secret', NOW), null);
  });

  test('cookie is HttpOnly, SameSite=Lax, scoped to /auth/google and Secure only over https', () => {
    const plain = stateCookie('abc', false);
    assert.ok(plain.startsWith(`${LOGIN_STATE_COOKIE}=abc`));
    assert.match(plain, /Path=\/auth\/google/);
    assert.match(plain, /HttpOnly/);
    assert.match(plain, /SameSite=Lax/);
    assert.doesNotMatch(plain, /Secure/);
    assert.match(stateCookie('abc', true), /Secure/);
    assert.match(stateCookie('abc', false, 0), /Max-Age=0/);
    assert.equal(readCookie(`a=1; ${LOGIN_STATE_COOKIE}=xyz; b=2`, LOGIN_STATE_COOKIE), 'xyz');
    assert.equal(readCookie('a=1', LOGIN_STATE_COOKIE), null);
    assert.equal(readCookie(undefined, LOGIN_STATE_COOKIE), null);
  });

  test('allowlist: lower case, trimmed, deduplicated, without garbage', () => {
    assert.deepEqual(parseAllowlist(' Dono@Exemplo.com, equipe@exemplo.com\nDONO@exemplo.com, x, a@b '), [
      'dono@exemplo.com',
      'equipe@exemplo.com',
      'a@b',
    ]);
    assert.deepEqual(parseAllowlist(undefined), []);
  });

  test('id_token claims: email_verified, audience and issuer are required', () => {
    const clientId = 'login.apps.googleusercontent.com';
    const good = claimsFromIdToken(
      idToken({ email: 'Dono@Exemplo.com', email_verified: true, name: 'Dono', aud: clientId }),
      clientId,
    );
    assert.deepEqual(good, { email: 'dono@exemplo.com', emailVerified: true, name: 'Dono', picture: null });
    assert.equal(
      claimsFromIdToken(idToken({ email: 'x@y.com', email_verified: false, aud: clientId }), clientId)?.emailVerified,
      false,
    );
    assert.equal(claimsFromIdToken(idToken({ email: 'x@y.com', aud: 'other' }), clientId), null);
    assert.equal(claimsFromIdToken(idToken({ email: 'x@y.com', iss: 'https://evil.example' }), clientId), null);
    assert.equal(claimsFromIdToken('not-a-token'), null);
  });
});

describe('equipe: google login service', () => {
  test('without client id/secret or allowlist the feature is off and nothing is exposed', () => {
    for (const over of [
      { clientId: '' },
      { clientSecret: '' },
      { redirectUri: '' },
      { allowlist: [] },
      { returnUrl: 'not a url' },
    ]) {
      const service = new GoogleLoginService(options(over) as any);
      assert.equal(service.available(), false);
      assert.deepEqual(service.status(), { enabled: false });
      assert.throws(() => service.connect(), GoogleLoginError);
    }
    assert.deepEqual(new GoogleLoginService(options() as any).status(), { enabled: true });
  });

  test('connect: consent screen with only openid/email/profile, state and cookie nonce', () => {
    const service = new GoogleLoginService(options() as any);
    const connect = service.connect();
    const url = new URL(connect.url);
    assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(url.searchParams.get('client_id'), 'login.apps.googleusercontent.com');
    assert.equal(url.searchParams.get('redirect_uri'), 'https://api.exemplo.com/auth/google/callback');
    assert.equal(url.searchParams.get('scope'), 'openid email profile');
    assert.equal(url.searchParams.get('state'), connect.state);
    assert.deepEqual(verifyLoginState(connect.state, 'state-secret', NOW), { nonce: connect.nonce });
  });

  test('finish: exchanges the code, requires email_verified and the allowlist', async () => {
    const calls: any[] = [];
    const service = new GoogleLoginService(options({ fetchImpl: googleFetch(verified, calls) }) as any);
    const { state, nonce } = signLoginState('state-secret', NOW);
    const claims = await service.finish({ code: 'auth-code', state, cookieNonce: nonce });
    assert.deepEqual(claims, {
      email: 'dono@exemplo.com',
      emailVerified: true,
      name: 'Dono Exemplo',
      picture: 'https://x/p.png',
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://oauth2.googleapis.com/token');
    const body = String(calls[0].init.body);
    assert.match(body, /grant_type=authorization_code/);
    assert.match(body, /client_secret=client-secret/);

    for (const [claimsOver, message] of [
      [{ ...verified, email_verified: false }, /e-mail verificado/],
      [{ ...verified, email: 'intruso@exemplo.com' }, /não está liberada/],
    ] as const) {
      const other = new GoogleLoginService(options({ fetchImpl: googleFetch(claimsOver) }) as any);
      await assert.rejects(other.finish({ code: 'auth-code', state, cookieNonce: nonce }), message);
    }
  });

  test('finish: state, cookie nonce, cancelled consent and a refused exchange are rejected', async () => {
    const service = new GoogleLoginService(options({ fetchImpl: googleFetch(verified) }) as any);
    const { state, nonce } = signLoginState('state-secret', NOW);
    await assert.rejects(service.finish({ code: 'c', state, cookieNonce: 'other' }), /neste navegador/);
    await assert.rejects(service.finish({ code: 'c', state: 'bad', cookieNonce: nonce }), /expirou/);
    const expired = signLoginState('state-secret', NOW - 11 * 60_000);
    await assert.rejects(
      service.finish({ code: 'c', state: expired.state, cookieNonce: expired.nonce }),
      /expirou/,
    );
    await assert.rejects(service.finish({ code: 'c', state, cookieNonce: nonce, error: 'access_denied' }), /cancelado/);
    const refused = new GoogleLoginService(
      options({ fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) }) }) as any,
    );
    await assert.rejects(refused.finish({ code: 'c', state, cookieNonce: nonce }), /recusou/);
  });

  test('one-time code: 60 seconds, single use, never the session token', () => {
    let now = NOW;
    const service = new GoogleLoginService(options({ now: () => now }) as any);
    const claims = {
      email: 'dono@exemplo.com',
      emailVerified: true,
      name: null,
      picture: null,
    };
    const code = service.issueCode(claims);
    assert.match(code, /^[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(service.consumeCode(code), claims);
    assert.equal(service.consumeCode(code), null, 'a code never works twice');

    const late = service.issueCode(claims);
    now += LOGIN_CODE_TTL_MS + 1;
    assert.equal(service.consumeCode(late), null);
    assert.equal(service.consumeCode('curto'), null);
  });

  test('redirects only to the fixed return URL, with the code or a PT-BR message', () => {
    const service = new GoogleLoginService(options() as any);
    const ok = new URL(service.successRedirect('the-code'));
    assert.equal(ok.origin + ok.pathname, 'https://painel.exemplo.com/manager/login');
    assert.equal(ok.searchParams.get('google_code'), 'the-code');
    const error = new URL(service.errorRedirect('Não foi possível entrar.'));
    assert.equal(error.origin + error.pathname, 'https://painel.exemplo.com/manager/login');
    assert.equal(error.searchParams.get('google_error'), 'Não foi possível entrar.');
  });
});
