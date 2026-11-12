import '../helpers/setup';
// Loads the routers graph in the same order as the app (see router-instance-scope.test.ts): importing a leaf router
// first hits the circular import through routes/index.router.
import '@exceptions';

import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';

import { authGuard, createAdminOnlyGuard } from '@api/guards/auth.guard';
import { socketKeyAllowed } from '@api/integrations/event/websocket/websocket.controller';
import { InstanceRouter } from '@api/routes/instance.router';
import { OverviewRouter } from '@api/routes/overview.router';
import { TeamRouter } from '@api/routes/team.router';
import { UsageRouter } from '@api/routes/usage.router';
import { Auth, configService } from '@config/env.config';
import { authThrottle, MAX_FAILURES } from '@utils/auth-throttle';
import { generateSessionToken } from '@utils/google-login';
import express from 'express';
import { Server } from 'http';

import { serverModuleOverrides } from '../helpers/chatbot-emit';

const globalKey = () => configService.get<Auth>('AUTHENTICATION').API_KEY.KEY;

/**
 * Scope of each kind of credential after the Google login hardening: a person session ("was_") reaches
 * /instance/fetchInstances like the global key; a client code ("wac_") and an instance token stay refused on
 * /usage/export, /overview and /team/*; a ZIP that fails mid-stream does not end as a truncated HTTP 200.
 */
describe('login security: session, client code and instance token scope', () => {
  const sessionToken = generateSessionToken().token;
  const session = { userId: 'u1', sessionId: 's1', email: 'dono@exemplo.com', name: 'Dono', picture: null };
  const clientKey = 'wac_' + 'c'.repeat(43);
  const instanceTokens: Record<string, string> = {
    'visao-qa': 'TOKEN-DA-VISAO-QA',
    'uso-qa': 'TOKEN-DO-USO-QA',
  };
  const fetchedKeys: string[] = [];
  let server: Server;
  let base = '';

  before(async () => {
    serverModuleOverrides.userSessionService = {
      resolve: async (token: string) => (token === sessionToken ? session : null),
    };
    serverModuleOverrides.clientAccessService = {
      resolve: async (token: string) =>
        token === clientKey ? { instanceId: 'i1', instanceName: 'visao-qa', modules: ['conversas'] } : null,
    };
    serverModuleOverrides.prismaRepository = {
      instance: {
        findUnique: async ({ where }: any) =>
          instanceTokens[where.name] ? { name: where.name, token: instanceTokens[where.name] } : null,
        findFirst: async ({ where }: any) =>
          Object.values(instanceTokens).includes(where.token) ? { name: 'x' } : null,
      },
    };
    serverModuleOverrides.instanceController = {
      fetchInstances: async (_instance: any, key: string) => {
        fetchedKeys.push(key);
        return [{ name: 'visao-qa' }];
      },
    };
    serverModuleOverrides.overviewController = { get: async () => ({ ok: true }) };
    serverModuleOverrides.exportController = {
      exportData: async () => ({ filename: 'dados.zip', stream: (async function* () {})() }),
    };

    const app = express();
    app.use(express.json());
    app.use('/instance', new InstanceRouter(configService, authGuard.apikey).router);
    app.use('/overview', new OverviewRouter(authGuard.apikey).router);
    app.use('/usage', new UsageRouter(authGuard.apikey).router);
    app.use('/team', new TeamRouter().router);
    app.use((error: any, _req: any, res: any, _next: any) => {
      void _next;
      return res.status(error?.status ?? 500).json({
        status: error?.status ?? 500,
        response: { message: error?.message },
      });
    });
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(() => {
    server?.close();
    delete serverModuleOverrides.userSessionService;
    delete serverModuleOverrides.clientAccessService;
    delete serverModuleOverrides.prismaRepository;
    delete serverModuleOverrides.instanceController;
    delete serverModuleOverrides.overviewController;
    delete serverModuleOverrides.exportController;
  });

  const get = (path: string, key: string) => fetch(base + path, { headers: { apikey: key } });

  test('fetchInstances: a person session counts as the global key and lists every instance', async () => {
    const response = await get('/instance/fetchInstances', sessionToken);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [{ name: 'visao-qa' }]);
    assert.equal(fetchedKeys.at(-1), globalKey(), 'the controller receives the global key, not the raw session token');
    assert.notEqual(fetchedKeys.at(-1), sessionToken);
  });

  test('a wac_ client code is refused on /usage/export, /overview and /team/*', async () => {
    for (const path of ['/usage/export/visao-qa', '/overview/visao-qa', '/team/me', '/team/sessions']) {
      assert.equal((await get(path, clientKey)).status, 403, path);
    }
    const revoke = await fetch(base + '/team/revoke', {
      method: 'POST',
      headers: { apikey: clientKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 's1' }),
    });
    assert.equal(revoke.status, 403);
  });

  test('the token of another instance is refused on /usage/export, /overview and /team/*', async () => {
    assert.equal((await get('/overview/visao-qa', instanceTokens['uso-qa'])).status, 401);
    assert.equal((await get('/usage/export/uso-qa', instanceTokens['visao-qa'])).status, 401);
    assert.equal((await get('/team/me', instanceTokens['visao-qa'])).status, 401);
    assert.equal((await get('/team/sessions', instanceTokens['visao-qa'])).status, 401);
    assert.equal((await get('/team/me', generateSessionToken().token)).status, 401, 'unknown session');
  });

  test('a ZIP that fails mid-stream destroys the response instead of ending a truncated 200', async () => {
    serverModuleOverrides.exportController = {
      exportData: async () => ({
        filename: 'dados.zip',
        stream: (async function* () {
          yield Buffer.from('PK\u0003\u0004completo');
        })(),
      }),
    };
    const ok = await get('/usage/export/visao-qa', globalKey());
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-type'), 'application/zip');
    assert.equal(Buffer.from(await ok.arrayBuffer()).toString(), 'PK\u0003\u0004completo');

    serverModuleOverrides.exportController = {
      exportData: async () => ({
        filename: 'dados.zip',
        stream: (async function* () {
          yield Buffer.from('PK\u0003\u0004primeira parte');
          throw new Error('a leitura falhou no meio');
        })(),
      }),
    };
    // The client sees either a destroyed connection (fetch rejects) or a body that ends abruptly; what it never
    // sees is a complete body, which would make a truncated ZIP look valid.
    const outcome = await (async () => {
      try {
        const response = await get('/usage/export/visao-qa', globalKey());
        try {
          await response.arrayBuffer();
          return 'complete';
        } catch {
          return 'cut';
        }
      } catch {
        return 'closed';
      }
    })();
    assert.notEqual(outcome, 'complete', 'a truncated ZIP must not be delivered as a complete 200');
  });
});

describe('login security: blocked IP before the session lookup', () => {
  const call = (guard: any, key: string, headers: Record<string, string>) =>
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
        const returned = guard({ get: () => key, headers }, res, (error?: any) => resolve({ next: !error, error }));
        if (returned && typeof returned.catch === 'function')
          returned.catch((error: any) => resolve({ next: false, error }));
      } catch (error) {
        resolve({ next: false, error });
      }
    });

  test('admin guard answers 429 without resolving the session in the database', async () => {
    const ip = '203.0.113.77';
    for (let i = 0; i < MAX_FAILURES; i++) authThrottle.recordFailure(ip);
    assert.equal(authThrottle.isBlocked(ip), true);

    let resolved = 0;
    const guard = createAdminOnlyGuard(
      () => 'global-qa-key',
      async () => {
        resolved++;
        return { userId: 'u1' };
      },
    );
    const blocked = await call(guard, generateSessionToken().token, { 'cf-connecting-ip': ip });
    assert.equal(blocked.code, 429);
    assert.equal(blocked.body?.status, 429);
    assert.equal(resolved, 0, 'a blocked IP never reaches userSession.findUnique');

    const open = await call(guard, generateSessionToken().token, { 'cf-connecting-ip': '203.0.113.78' });
    assert.equal(open.next, true, 'another IP still resolves the session normally');
    assert.equal(resolved, 1);
  });
});

describe('login security: WebSocket key', () => {
  const sessionToken = generateSessionToken().token;
  const instanceToken = 'INSTANCE-TOKEN-QA';

  const makeDeps = () => {
    const calls = { instances: 0 };
    return {
      calls,
      deps: {
        findInstanceByToken: async (token: string) => {
          calls.instances++;
          return token === instanceToken ? { name: 'visao-qa' } : null;
        },
        globalToken: () => 'GLOBAL-QA',
        resolveSession: async (token: string) => (token === sessionToken ? { email: 'dono@exemplo.com' } : null),
      },
    };
  };

  test('accepts the global key, an instance token and a live person session', async () => {
    const { deps, calls } = makeDeps();
    assert.equal(await socketKeyAllowed('GLOBAL-QA', deps), true);
    assert.equal(calls.instances, 0, 'the global key never queries the database');
    assert.equal(await socketKeyAllowed(instanceToken, deps), true);
    assert.equal(await socketKeyAllowed(sessionToken, deps), true);
    assert.equal(calls.instances, 1, 'the person session is not looked up as an instance token');
  });

  test('refuses an invalid session, a wac_ code, an empty key and a failing resolver', async () => {
    const { deps } = makeDeps();
    assert.equal(await socketKeyAllowed('was_' + 'z'.repeat(43), deps), false);
    assert.equal(await socketKeyAllowed('wac_' + 'c'.repeat(43), deps), false);
    assert.equal(await socketKeyAllowed('', deps), false);
    assert.equal(await socketKeyAllowed(undefined, deps), false);
    assert.equal(await socketKeyAllowed(sessionToken, { ...deps, resolveSession: undefined }), false);
    assert.equal(
      await socketKeyAllowed(sessionToken, {
        ...deps,
        resolveSession: async () => {
          throw new Error('database indisponível');
        },
      }),
      false,
    );
  });
});
