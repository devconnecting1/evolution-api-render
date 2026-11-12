import '../helpers/setup';
import '@exceptions';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { authGuard, createAdminOnlyGuard } from '@api/guards/auth.guard';
import { UserSessionService } from '@api/services/user-session.service';
import { Auth, configService } from '@config/env.config';
import { generateSessionToken, hashSessionToken } from '@utils/google-login';

import { serverModuleOverrides } from '../helpers/chatbot-emit';
import { fakeTeamPrisma } from '../helpers/team';

const fakePrisma = fakeTeamPrisma;

const claims = { email: 'Dono@Exemplo.com', name: 'Dono Exemplo', picture: 'https://x/p.png' };

describe('equipe: user and session service', () => {
  test('findOrCreateUser: one person per e-mail, login recorded, no duplicate', async () => {
    let now = 1_000_000;
    const { prisma, users } = fakePrisma();
    const service = new UserSessionService({ prisma, now: () => now });
    const first = await service.findOrCreateUser(claims);
    assert.equal(first.email, 'dono@exemplo.com');
    assert.equal(first.name, 'Dono Exemplo');
    assert.equal(first.lastLoginAt, new Date(now).toISOString());

    now += 60_000;
    const again = await service.findOrCreateUser({ email: 'dono@exemplo.com' });
    assert.equal(again.id, first.id);
    assert.equal(users.length, 1);
    assert.equal(again.lastLoginAt, new Date(now).toISOString());
    assert.equal(again.name, 'Dono Exemplo', 'a login without name keeps the stored name');
  });

  test('createSession stores only the hash, with expiry; resolve returns the person', async () => {
    const { prisma, sessions } = fakePrisma();
    const service = new UserSessionService({ prisma, now: () => 1_000_000 });
    const user = await service.findOrCreateUser(claims);
    const created = await service.createSession(user.id, { userAgent: 'Mozilla/5.0', ip: '203.0.113.7' });

    assert.match(created.token, /^was_[A-Za-z0-9_-]{43}$/);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].tokenHash, hashSessionToken(created.token));
    assert.ok(!JSON.stringify(sessions).includes(created.token), 'the token itself is never stored');
    assert.equal(sessions[0].userAgent, 'Mozilla/5.0');
    assert.ok(+new Date(sessions[0].expiresAt) > 1_000_000);

    assert.deepEqual(await service.resolve(created.token), {
      userId: user.id,
      sessionId: sessions[0].id,
      email: 'dono@exemplo.com',
      name: 'Dono Exemplo',
      picture: 'https://x/p.png',
    });
    assert.equal(await service.resolve('was_' + 'a'.repeat(43)), null);
    assert.equal(await service.resolve('wac_' + 'a'.repeat(43)), null, 'client code is not a session');
  });

  test('expired and revoked sessions are refused at once', async () => {
    let now = 1_000_000;
    const { prisma } = fakePrisma();
    const service = new UserSessionService({ prisma, now: () => now, sessionTtlMs: 60_000 });
    const user = await service.findOrCreateUser(claims);
    const first = await service.createSession(user.id);
    assert.ok(await service.resolve(first.token));
    now += 60_001;
    assert.equal(await service.resolve(first.token), null, 'expired');

    now = 2_000_000;
    const second = await service.createSession(user.id);
    assert.ok(await service.resolve(second.token));
    assert.equal(await service.revokeSession(second.session.id), true);
    assert.equal(await service.resolve(second.token), null, 'revocation does not wait for the 30 s cache');
    assert.equal(await service.revokeSession(second.session.id), true, 'revoking twice is idempotent');
    assert.equal(await service.revokeSession('missing'), false);
  });

  test('resolve refuses a session when the feature is off or the e-mail left the allowlist (cache included)', async () => {
    let allow = true;
    const { prisma } = fakePrisma();
    const service = new UserSessionService({
      prisma,
      now: () => 1_000_000,
      authorized: (email) => allow && email === 'dono@exemplo.com',
    });
    const user = await service.findOrCreateUser(claims);
    const { token } = await service.createSession(user.id);
    assert.ok(await service.resolve(token), 'the allowlist still has the e-mail');

    allow = false;
    assert.equal(await service.resolve(token), null, 'the 30 s cache never skips the access policy');

    allow = true;
    assert.ok(await service.resolve(token), 'back in the allowlist: the session works again');

    const other = await service.findOrCreateUser({ email: 'fora@exemplo.com' });
    const otherSession = await service.createSession(other.id);
    assert.equal(await service.resolve(otherSession.token), null, 'e-mail that is not on the allowlist');
  });

  test('a resolved session is cached for 30 s', async () => {
    let now = 1_000_000;
    const { prisma } = fakePrisma();
    const service = new UserSessionService({ prisma, now: () => now });
    const user = await service.findOrCreateUser(claims);
    const { token } = await service.createSession(user.id);
    // createSession filled the cache: force a real read once
    const { prisma: coldPrisma } = fakePrisma();
    const cold = new UserSessionService({ prisma: coldPrisma, now: () => now });
    const coldUser = await cold.findOrCreateUser(claims);
    const coldSession = await cold.createSession(coldUser.id);
    const before = (coldPrisma as any).reads;
    await cold.resolve(coldSession.token);
    await cold.resolve(coldSession.token);
    assert.equal((coldPrisma as any).reads - before, 0, 'both reads served from the cache');
    now += 31_000;
    await cold.resolve(coldSession.token);
    assert.equal((coldPrisma as any).reads - before, 1);
    assert.ok(await service.resolve(token));
  });

  test('lastSeenAt is written at most once every 10 minutes', async () => {
    let now = 1_000_000;
    const { prisma, sessions } = fakePrisma();
    const service = new UserSessionService({ prisma, now: () => now, cacheTtlMs: 0 });
    const user = await service.findOrCreateUser(claims);
    const { token, session } = await service.createSession(user.id);
    const written = () => new Date(sessions.find((row) => row.id === session.id).lastSeenAt).getTime();
    assert.equal(written(), 1_000_000);

    await service.resolve(token);
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(written(), 1_000_000, 'the login just wrote lastSeenAt');

    now += 5 * 60_000;
    await service.resolve(token);
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(written(), 1_000_000, 'less than 10 minutes: no write');

    now += 6 * 60_000;
    await service.resolve(token);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(written(), 1_660_000, 'more than 10 minutes: written');
  });

  test('lists own sessions (current marked) and the allowlist overview', async () => {
    const { prisma } = fakePrisma();
    const service = new UserSessionService({ prisma, now: () => 1_000_000 });
    const user = await service.findOrCreateUser(claims);
    const first = await service.createSession(user.id, { userAgent: 'Celular' });
    const second = await service.createSession(user.id, { userAgent: 'Computador' });
    const own = await service.listSessions(user.id, second.session.id);
    assert.equal(own.length, 2);
    assert.equal(own.filter((row) => row.current).length, 1);
    assert.equal(own.find((row) => row.current)?.id, second.session.id);
    assert.ok(!JSON.stringify(own).includes(first.token));

    const other = await service.findOrCreateUser({ email: 'outra@exemplo.com' });
    await service.createSession(other.id);
    const overview = await service.overview(['dono@exemplo.com', 'nunca@exemplo.com']);
    assert.equal(overview.people.length, 2);
    assert.equal(overview.people[0].loggedIn, true);
    assert.equal(overview.people[0].activeSessions, 2);
    assert.equal(overview.people[1].loggedIn, false);
    assert.equal(overview.people[1].activeSessions, 0);
    assert.equal(overview.sessions.length, 3);
  });
});

describe('equipe: auth guard precedence', () => {
  const run = async (
    key: string | null,
    url = '/leads/GuardA',
    method = 'GET',
    params: any = { instanceName: 'GuardA' },
  ) => {
    const req: any = {
      get: (header: string) => (header.toLowerCase() === 'apikey' ? key : undefined),
      headers: {},
      originalUrl: url,
      method,
      params,
      body: {},
    };
    let passed = false;
    let error: any = null;
    try {
      await (authGuard.apikey as any)(req, {}, () => {
        passed = true;
      });
    } catch (caught) {
      error = caught;
    }
    return { passed, error, req };
  };

  test('global key > session > client code > instance token', async () => {
    const auth = configService.get<Auth>('AUTHENTICATION').API_KEY;
    const original = auth.KEY;
    const sessionToken = generateSessionToken().token;
    const clientKey = 'wac_' + 'c'.repeat(43);
    const instanceToken = 'INSTANCE-TOKEN-GUARD';
    let sessionCalls = 0;
    let clientCalls = 0;

    serverModuleOverrides.userSessionService = {
      resolve: async (token: string) => {
        sessionCalls++;
        return token === sessionToken
          ? { userId: 'u1', sessionId: 's1', email: 'dono@exemplo.com', name: 'Dono', picture: null }
          : null;
      },
    };
    serverModuleOverrides.clientAccessService = {
      resolve: async (token: string) => {
        clientCalls++;
        return token === clientKey ? { instanceId: 'i1', instanceName: 'GuardA', modules: ['leads'] } : null;
      },
    };
    const prisma = { instance: { findUnique: async ({ where }: any) => ({ name: where.name, token: instanceToken }) } };
    serverModuleOverrides.prismaRepository = prisma;

    try {
      // break-glass: a global key that even looks like a session token wins without asking the database
      auth.KEY = sessionToken;
      const global = await run(sessionToken);
      assert.equal(global.passed, true);
      assert.equal(sessionCalls, 0, 'global key is compared first');

      auth.KEY = original;
      const session = await run(sessionToken);
      assert.equal(session.passed, true);
      assert.equal(session.req.userSession.email, 'dono@exemplo.com');

      const client = await run(clientKey);
      assert.equal(client.passed, true);
      assert.equal(clientCalls, 1);

      const instance = await run(instanceToken);
      assert.equal(instance.passed, true);

      const revoked = await run('was_' + 'z'.repeat(43));
      assert.equal(revoked.passed, false);
      assert.equal(revoked.error?.status, 401);
      assert.match(String(revoked.error?.message), /sessão expirou/i);
    } finally {
      auth.KEY = original;
      delete serverModuleOverrides.userSessionService;
      delete serverModuleOverrides.clientAccessService;
      delete serverModuleOverrides.prismaRepository;
    }
  });

  test('admin-only routes accept the global key and a live session, never a revoked one', async () => {
    const call = (guard: any, key: string | null) =>
      new Promise<any>((resolve) => {
        const res: any = {
          code: 200,
          set() {
            return this;
          },
          status(code: number) {
            this.code = code;
            return this;
          },
          json(body: any) {
            resolve({ code: this.code, body });
            return this;
          },
        };
        try {
          const returned = guard({ get: () => key, headers: {} }, res, (error?: any) =>
            resolve({ next: !error, error }),
          );
          if (returned && typeof returned.catch === 'function')
            returned.catch((error: any) => resolve({ next: false, error }));
        } catch (error) {
          resolve({ next: false, error });
        }
      });

    const session = { userId: 'u1', sessionId: 's1', email: 'dono@exemplo.com', name: 'Dono', picture: null };
    const guard = createAdminOnlyGuard(
      () => 'global-key',
      async (token: string) => (token === 'was_' + 'a'.repeat(43) ? session : null),
    );
    assert.equal((await call(guard, 'global-key')).next, true);
    assert.equal((await call(guard, 'was_' + 'a'.repeat(43))).next, true);
    const revoked = await call(guard, 'was_' + 'b'.repeat(43));
    assert.equal(revoked.next, false);
    assert.equal(revoked.error?.status, 401);
    const wrong = await call(guard, 'wrong-key');
    assert.equal(wrong.next, false);
    const missing = await call(guard, null);
    assert.equal(missing.next, false);
  });
});
