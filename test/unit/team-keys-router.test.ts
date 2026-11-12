import '../helpers/setup';
// Loads the routers graph in the same order as the app (see team-router.test.ts): importing a leaf router first hits
// the circular import through routes/index.router.
import '@exceptions';

import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';

import { TeamRouter } from '@api/routes/team.router';
import { TeamAccessValidationError } from '@api/services/team-access.service';
import { Auth, configService } from '@config/env.config';
import { authThrottle } from '@utils/auth-throttle';
import express from 'express';

import { serverModuleOverrides } from '../helpers/chatbot-emit';

const DONO_KEY = 'wat_' + 'd'.repeat(43);
const EQUIPE_KEY = 'wat_' + 'e'.repeat(43);
const globalKey = () => configService.get<Auth>('AUTHENTICATION').API_KEY.KEY;

const grants: Record<string, any> = {
  [DONO_KEY]: { id: 'k0', name: 'Dono Exemplo', role: 'dono', instanceNames: null, keyHint: 'wat_…dddd' },
  [EQUIPE_KEY]: { id: 'k1', name: 'Ana Exemplo', role: 'equipe', instanceNames: ['Loja'], keyHint: 'wat_…eeee' },
};

const listed = () => ({
  keys: [
    {
      id: 'k1',
      name: 'Ana Exemplo',
      role: 'equipe',
      instances: ['Loja'],
      keyHint: 'wat_…eeee',
      lastUsedAt: '2026-11-12T10:00:00.000Z',
      createdAt: '2026-11-10T10:00:00.000Z',
    },
  ],
  roles: [
    { id: 'dono', label: 'Dono', description: 'x' },
    { id: 'equipe', label: 'Equipe', description: 'y' },
    { id: 'leitura', label: 'Só leitura', description: 'z' },
  ],
});

const teamAccess = {
  resolve: async (key: string) => grants[key] ?? null,
  rolesCatalog: () => listed().roles,
  list: async () => listed(),
  create: async (input: any) => {
    if (!input.name) throw new TeamAccessValidationError(['Informe o nome da pessoa.']);
    return {
      id: 'k9',
      name: input.name,
      role: input.role,
      instances: input.instances ?? null,
      keyHint: 'wat_…nnnn',
      key: 'wat_' + 'n'.repeat(43),
    };
  },
  revoke: async (id: string) => ({ removed: id === 'k1' }),
};

const google = {
  allowlist: () => ['dono@exemplo.com'],
};

const users = {
  overview: async () => ({
    people: [{ email: 'dono@exemplo.com', name: 'Dono Exemplo', picture: null, sessions: 1, lastLoginAt: null }],
    sessions: [],
  }),
  listSessions: async () => [],
  revokeSession: async (id: string) => id === 's1',
};

let server: any;
let base = '';

before(async () => {
  serverModuleOverrides.teamAccessService = teamAccess;

  const app = express();
  app.use(express.json());
  app.use(
    '/team',
    new TeamRouter({ googleLogin: google as any, users: users as any, teamAccess: teamAccess as any }).router,
  );
  app.use((err: any, _req: any, res: any, _next: any) => {
    void _next;
    return res.status(err?.status || 500).json({
      status: err?.status || 500,
      error: err?.error || 'Internal Server Error',
      response: { message: err?.message || 'Internal Server Error' },
    });
  });
  server = await new Promise<any>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server?.close();
  delete serverModuleOverrides.teamAccessService;
});

const call = (path: string, init: any = {}, key?: string | null, ip?: string) =>
  fetch(base + path, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(key ? { apikey: key } : {}),
      ...(ip ? { 'cf-connecting-ip': ip } : {}),
    },
  });
const post = (path: string, body: any, key?: string | null, ip?: string) =>
  call(path, { method: 'POST', body: JSON.stringify(body) }, key, ip);

describe('team keys HTTP: who am I and sessions', () => {
  test('a team key sees its name, role and instances; a person session keeps the old shape', async () => {
    const equipe = await call('/team/me', {}, EQUIPE_KEY);
    assert.equal(equipe.status, 200);
    const body: any = await equipe.json();
    assert.equal(body.globalKey, false);
    assert.equal(body.team, true);
    assert.equal(body.name, 'Ana Exemplo');
    assert.equal(body.role, 'equipe');
    assert.deepEqual(body.instances, ['Loja']);
    assert.deepEqual(body.roles.map((r: any) => r.id), ['dono', 'equipe', 'leitura']);

    const global = await call('/team/me', {}, globalKey());
    assert.equal(global.status, 200);
    assert.deepEqual(await global.json(), { globalKey: true, user: null, session: null });
  });

  test('owner pages: dono key passes, equipe key gets 403 and never blocks the office IP', async () => {
    const sessions = await call('/team/sessions', {}, DONO_KEY);
    assert.equal(sessions.status, 200);
    const overview: any = await sessions.json();
    assert.equal(overview.globalKey, true);
    assert.deepEqual(overview.allowlist, ['dono@exemplo.com']);

    const ip = '198.51.100.123';
    for (let i = 0; i < 60; i++) {
      const denied = await call('/team/sessions', {}, EQUIPE_KEY, ip);
      assert.equal(denied.status, 403);
    }
    assert.equal(authThrottle.isBlocked(ip), false, 'a real team key never counts as a wrong key');

    const revokeDono = await post('/team/revoke', { id: 's1' }, DONO_KEY);
    assert.equal(revokeDono.status, 200);
    assert.deepEqual(await revokeDono.json(), { revoked: true, id: 's1' });
    assert.equal((await post('/team/revoke', {}, DONO_KEY)).status, 400);
    const missing = await post('/team/revoke', { id: 'missing' }, DONO_KEY);
    assert.equal(missing.status, 404);
  });
});

describe('team keys HTTP: /team/keys', () => {
  test('global key creates, lists and revokes; the key comes back only once', async () => {
    const list = await call('/team/keys', {}, globalKey());
    assert.equal(list.status, 200);
    const listedBody: any = await list.json();
    assert.equal(listedBody.keys[0].name, 'Ana Exemplo');
    assert.ok(!JSON.stringify(listedBody).includes('keyHash'));

    const created = await post('/team/keys', { name: 'Bruno Teste', role: 'leitura' }, globalKey());
    assert.equal(created.status, 201);
    const createdBody: any = await created.json();
    assert.match(createdBody.key, /^wat_/);
    assert.equal(createdBody.role, 'leitura');
    assert.equal(createdBody.keyHint, 'wat_…nnnn');

    assert.equal((await post('/team/keys', { role: 'equipe' }, globalKey())).status, 400);

    const revoked = await call('/team/keys/k1', { method: 'DELETE' }, globalKey());
    assert.equal(revoked.status, 200);
    assert.deepEqual(await revoked.json(), { removed: true });
    assert.equal((await call('/team/keys/missing', { method: 'DELETE' }, globalKey())).status, 404);
  });

  test('a dono key manages the team; an equipe key cannot, not even by calling the API directly', async () => {
    assert.equal((await call('/team/keys', {}, DONO_KEY)).status, 200);
    assert.equal((await post('/team/keys', { name: 'Carla', role: 'equipe' }, DONO_KEY)).status, 201);
    assert.equal((await call('/team/keys/k1', { method: 'DELETE' }, DONO_KEY)).status, 200);

    const denied = await call('/team/keys', {}, EQUIPE_KEY);
    assert.equal(denied.status, 403);
    const deniedCreate = await post('/team/keys', { name: 'X', role: 'dono' }, EQUIPE_KEY);
    assert.equal(deniedCreate.status, 403);
    assert.equal((await call('/team/keys/k1', { method: 'DELETE' }, EQUIPE_KEY)).status, 403);
  });

  test('no key gets 401; a wrong key gets 403', async () => {
    assert.equal((await call('/team/keys')).status, 401);
    assert.equal((await call('/team/keys', {}, 'wrong-key', '203.0.113.200')).status, 403);
  });
});
