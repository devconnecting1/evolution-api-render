import '../helpers/setup';
// Loads the routers graph in the same order as the app (see router-instance-scope.test.ts): importing a leaf router
// first hits the circular import through routes/index.router.
import '@exceptions';

import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';

import { authGuard } from '@api/guards/auth.guard';
import { AuthRouter } from '@api/routes/auth.router';
import { TeamRouter } from '@api/routes/team.router';
import { GoogleLoginService } from '@api/services/google-login.service';
import { UserSessionService } from '@api/services/user-session.service';
import { Auth, configService } from '@config/env.config';
import { hashSessionToken } from '@utils/google-login';
import express from 'express';

import { serverModuleOverrides } from '../helpers/chatbot-emit';
import { fakeTeamPrisma } from '../helpers/team';

const { prisma, sessions } = fakeTeamPrisma();
const users = new UserSessionService({ prisma });

const idToken = (claims: Record<string, unknown>) =>
  ['header', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'signature'].join('.');

const googleFetch = (claims: Record<string, unknown>) => async () => ({
  ok: true,
  status: 200,
  json: async () => ({ id_token: idToken(claims), scope: 'openid email profile' }),
});

const owner = new GoogleLoginService({
  clientId: 'login.apps.googleusercontent.com',
  clientSecret: 'client-secret',
  redirectUri: 'https://api.exemplo.com/auth/google/callback',
  returnUrl: 'https://painel.exemplo.com/manager/login',
  allowlist: ['Dono@Exemplo.com'],
  secret: 'state-secret',
  fetchImpl: googleFetch({ email: 'Dono@Exemplo.com', email_verified: true, name: 'Dono Exemplo' }),
});
const disabled = new GoogleLoginService({ secret: 'state-secret' });

let server: any;
let base = '';

before(async () => {
  serverModuleOverrides.userSessionService = users;
  serverModuleOverrides.clientAccessService = { resolve: async () => null };
  serverModuleOverrides.prismaRepository = { instance: { findUnique: async () => null, findFirst: async () => null } };

  const app = express();
  app.use(express.json());
  app.use('/auth', new AuthRouter({ googleLogin: owner, users }).router);
  app.use('/team', new TeamRouter({ googleLogin: owner, users }).router);
  app.get('/disabled/status', (_req, res) => res.json(disabled.status()));
  app.get('/admin-only', authGuard.adminOnly, (_req, res) => res.json({ ok: true }));
  app.use((err: any, _req: any, res: any, _next: any) =>
    res.status(err?.status || 500).json({
      status: err?.status || 500,
      error: err?.error || 'Internal Server Error',
      response: { message: err?.message || 'Internal Server Error' },
    }),
  );
  server = await new Promise<any>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server?.close();
  delete serverModuleOverrides.userSessionService;
  delete serverModuleOverrides.clientAccessService;
  delete serverModuleOverrides.prismaRepository;
});

const call = (path: string, init: any = {}) => fetch(base + path, { redirect: 'manual', ...init });
const json = (path: string, body: any, key?: string | null) =>
  call(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { apikey: key } : {}) },
    body: JSON.stringify(body),
  });

const cookieOf = (res: any) => {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie')];
  return String(list.find((value: string) => value?.includes('wa_gl_state=')) ?? '').split(';')[0];
};

describe('equipe HTTP: login with Google', () => {
  test('feature off: status says so, start gives 503, exchange gives 401', async () => {
    const status = await call('/disabled/status');
    assert.equal(status.status, 200);
    assert.deepEqual(await status.json(), { enabled: false });

    const app = express();
    app.use('/auth', new AuthRouter({ googleLogin: disabled, users }).router);
    app.use((err: any, _req: any, res: any, _next: any) => res.status(err?.status || 500).json({ message: err?.message }));
    const local = await new Promise<any>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const address = `http://127.0.0.1:${(local.address() as AddressInfo).port}`;
    try {
      const start = await fetch(`${address}/auth/google`, { redirect: 'manual' });
      assert.equal(start.status, 503);
      assert.match((await start.json()).response.message[0], /não está configurado/);
      const exchange = await fetch(`${address}/auth/google/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'x' }),
      });
      assert.equal(exchange.status, 401);
    } finally {
      local.close();
    }
  });

  test('start: Google consent screen, signed state and HttpOnly/Lax cookie nonce', async () => {
    const res = await call('/auth/google');
    assert.equal(res.status, 302);
    const location = new URL(res.headers.get('location')!);
    assert.equal(location.origin + location.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(location.searchParams.get('scope'), 'openid email profile');
    assert.equal(location.searchParams.get('client_id'), 'login.apps.googleusercontent.com');
    const cookie = cookieOf(res);
    assert.match(cookie, /^wa_gl_state=[A-Za-z0-9_-]+$/);
    const setCookie = String(res.headers.get('set-cookie'));
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    assert.match(setCookie, /Path=\/auth\/google/);
    assert.doesNotMatch(setCookie, /Secure/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });

  test('callback and exchange: one-time code becomes a session token, stored only as a hash', async () => {
    const start = await call('/auth/google');
    const location = new URL(start.headers.get('location')!);
    const cookie = cookieOf(start);

    const callback = await call(
      `/auth/google/callback?code=auth-code&state=${encodeURIComponent(location.searchParams.get('state')!)}`,
      { headers: { cookie } },
    );
    assert.equal(callback.status, 302);
    const target = new URL(callback.headers.get('location')!);
    assert.equal(target.origin + target.pathname, 'https://painel.exemplo.com/manager/login');
    const code = target.searchParams.get('google_code');
    assert.ok(code);
    assert.match(String(callback.headers.get('set-cookie')), /Max-Age=0/, 'the state cookie is cleared');
    assert.ok(!target.toString().includes('state-secret'));

    const exchange = await json('/auth/google/exchange', { code });
    assert.equal(exchange.status, 200);
    const body = await exchange.json();
    assert.match(body.token, /^was_[A-Za-z0-9_-]{43}$/);
    assert.equal(body.user.email, 'dono@exemplo.com');
    assert.equal(sessions[0].tokenHash, hashSessionToken(body.token));
    assert.ok(!JSON.stringify(sessions).includes(body.token));

    assert.equal((await json('/auth/google/exchange', { code })).status, 401, 'the code never works twice');

    const me = await call('/team/me', { headers: { apikey: body.token } });
    assert.equal(me.status, 200);
    const person = await me.json();
    assert.equal(person.globalKey, false);
    assert.equal(person.user.email, 'dono@exemplo.com');
  });

  test('callback: a refused login redirects with a PT-BR message and no code', async () => {
    const start = await call('/auth/google');
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const callback = await call(`/auth/google/callback?error=access_denied&state=${encodeURIComponent(state)}`, {
      headers: { cookie: cookieOf(start) },
    });
    assert.equal(callback.status, 302);
    const target = new URL(callback.headers.get('location')!);
    assert.equal(target.origin + target.pathname, 'https://painel.exemplo.com/manager/login');
    assert.equal(target.searchParams.get('google_code'), null);
    assert.match(target.searchParams.get('google_error')!, /cancelado/);
  });
});

describe('equipe HTTP: sessions and revocation', () => {
  const globalKey = () => configService.get<Auth>('AUTHENTICATION').API_KEY.KEY;

  test('401 without a key, 403 for another kind of credential, person sees only their sessions', async () => {
    const noKey = await call('/team/me');
    assert.equal(noKey.status, 401);

    const clientCode = 'wac_' + 'c'.repeat(43);
    const wrongKind = await call('/admin-only', { headers: { apikey: clientCode, 'cf-connecting-ip': '203.0.113.41' } });
    assert.equal(wrongKind.status, 403);

    const user = await users.findOrCreateUser({ email: 'dono@exemplo.com', name: 'Dono Exemplo' });
    const session = await users.createSession(user.id, { userAgent: 'Celular' });
    const own = await call('/team/sessions', { headers: { apikey: session.token } });
    assert.equal(own.status, 200);
    const body = await own.json();
    assert.equal(body.globalKey, false);
    assert.equal(body.sessions.length, 2, 'the session from the login above plus this one');
    assert.equal(body.sessions.find((row: any) => row.id === session.session.id)?.current, true);
    assert.equal(body.sessions.filter((row: any) => row.current).length, 1);
    assert.ok(!JSON.stringify(body).includes(session.token));

    const admin = await call('/team/sessions', { headers: { apikey: globalKey() } });
    assert.equal(admin.status, 200);
    const overview = await admin.json();
    assert.equal(overview.globalKey, true);
    assert.deepEqual(overview.allowlist, ['dono@exemplo.com']);
    assert.equal(overview.people[0].email, 'dono@exemplo.com');
  });

  test('revoking from the Equipe page ends the session immediately; a person cannot revoke another', async () => {
    const dono = await users.findOrCreateUser({ email: 'dono@exemplo.com', name: 'Dono Exemplo' });
    const equipe = await users.findOrCreateUser({ email: 'equipe@exemplo.com', name: 'Equipe Exemplo' });
    const donoSession = await users.createSession(dono.id, { userAgent: 'Computador' });
    const equipeSession = await users.createSession(equipe.id, { userAgent: 'Celular' });

    assert.equal((await call('/team/me', { headers: { apikey: equipeSession.token } })).status, 200);

    const notAllowed = await json('/team/revoke', { id: donoSession.session.id }, equipeSession.token);
    assert.equal(notAllowed.status, 404, 'a person only revokes their own sessions');

    const revoked = await json('/team/revoke', { id: equipeSession.session.id }, globalKey());
    assert.equal(revoked.status, 200);
    assert.deepEqual(await revoked.json(), { revoked: true, id: equipeSession.session.id });

    assert.equal((await call('/team/me', { headers: { apikey: equipeSession.token } })).status, 401);
    assert.equal((await call('/team/me', { headers: { apikey: donoSession.token } })).status, 200);
    assert.equal((await json('/team/revoke', {}, globalKey())).status, 400);
    assert.equal((await json('/team/revoke', { id: 'missing' }, globalKey())).status, 404);
  });

  test('logout revokes the session of the request; the global key is not a session', async () => {
    const user = await users.findOrCreateUser({ email: 'dono@exemplo.com' });
    const session = await users.createSession(user.id, { userAgent: 'Celular' });
    const logout = await json('/auth/logout', {}, session.token);
    assert.equal(logout.status, 200);
    assert.deepEqual(await logout.json(), { ok: true, revoked: true });
    assert.equal((await call('/team/me', { headers: { apikey: session.token } })).status, 401);

    const global = await json('/auth/logout', {}, globalKey());
    assert.equal(global.status, 200);
    assert.deepEqual(await global.json(), { ok: true, revoked: false });

    assert.equal((await call('/auth/logout', { method: 'POST' })).status, 401);
  });
});
