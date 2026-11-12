import '../helpers/setup';
import '@exceptions';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { authGuard, createAdminOnlyGuard } from '@api/guards/auth.guard';
import { TeamAccessService, TeamAccessValidationError } from '@api/services/team-access.service';
import { Auth, configService } from '@config/env.config';
import { authThrottle } from '@utils/auth-throttle';
import { normalizeClientPath } from '@utils/client-access';
import {
  generateTeamKey,
  hashTeamKey,
  isTeamKey,
  teamInstanceView,
  TeamRole,
  teamRouteAllowed,
} from '@utils/team-access';

import { serverModuleOverrides } from '../helpers/chatbot-emit';

const NAME = 'Renato Paixão';
const enc = encodeURIComponent(NAME);
const allowed = (method: string, url: string, role: TeamRole, hasInstance = true) =>
  teamRouteAllowed(method, normalizeClientPath(url, NAME), role, hasInstance);

describe('team keys: format and hash', () => {
  test('a new key is wat_ + 43 characters, hashed with SHA-256, shown only by its last 4 characters', () => {
    const { key, hash, hint } = generateTeamKey();
    assert.match(key, /^wat_[A-Za-z0-9_-]{43}$/);
    assert.equal(hash, hashTeamKey(key));
    assert.equal(hash.length, 64);
    assert.equal(hint, `wat_…${key.slice(-4)}`);
    assert.ok(isTeamKey(key));
    assert.ok(!isTeamKey('wat_short'));
    assert.ok(!isTeamKey('wac_' + 'a'.repeat(43)), 'a client code is not a team key');
    assert.ok(!isTeamKey('429683C4C977415CAAFCCE10F7D57E11'));
    assert.notEqual(generateTeamKey().key, key);
  });
});

describe('team keys: role rules (server side)', () => {
  test('dono: same reach as the global key, admin routes included', () => {
    for (const [m, u, hasInstance] of [
      ['POST', '/instance/create', false],
      ['DELETE', `/instance/delete/${enc}`, true],
      ['DELETE', `/instance/logout/${enc}`, true],
      ['GET', `/openai/creds/${enc}`, true],
      ['POST', `/openai/creds/${enc}`, true],
      ['GET', '/admin/credentials', false],
      ['GET', '/admin/audit', false],
      ['GET', '/team/sessions', false],
      ['POST', '/team/keys', false],
      ['POST', `/client-access/${enc}`, true],
      ['POST', `/message/sendText/${enc}`, true],
    ] as [string, string, boolean][]) {
      assert.equal(allowed(m, u, 'dono', hasInstance), true, `dono ${m} ${u}`);
    }
  });

  test('equipe and leitura: never instance create/delete/logout, AI credentials, plan changes, admin, team or access', () => {
    for (const role of ['equipe', 'leitura'] as TeamRole[]) {
      for (const [m, u, hasInstance] of [
        ['POST', '/instance/create', false],
        ['DELETE', `/instance/delete/${enc}`, true],
        ['DELETE', `/instance/logout/${enc}`, true],
        ['GET', `/openai/creds/${enc}`, true],
        ['POST', `/openai/creds/${enc}`, true],
        ['DELETE', `/openai/creds/abc/${enc}`, true],
        ['POST', `/usage/limits/${enc}`, true],
        ['GET', '/admin/retention', false],
        ['GET', '/admin/credentials', false],
        ['POST', '/team/keys', false],
        ['POST', `/client-access/${enc}`, true],
        ['GET', '/observability', false],
        ['POST', '/agenda/tick', false],
      ] as [string, string, boolean][]) {
        assert.equal(allowed(m, u, role, hasInstance), false, `${role} ${m} ${u}`);
      }
    }
  });

  test('equipe and leitura: the short list of routes without an instance', () => {
    for (const role of ['equipe', 'leitura'] as TeamRole[]) {
      for (const [m, u] of [
        ['GET', '/instance/fetchInstances?instanceName=x'],
        ['POST', '/verify-creds'],
        ['GET', '/client-access/me'],
        ['GET', '/team/me'],
      ]) {
        assert.equal(allowed(m, u, role, false), true, `${role} ${m} ${u}`);
      }
      assert.equal(allowed('POST', '/instance/fetchInstances', role, false), false);
    }
  });

  test('equipe: works inside the instance (send, pause, settings, bot, agenda, processos, leads, QR)', () => {
    for (const [m, u] of [
      ['POST', `/message/sendText/${enc}`],
      ['POST', `/openai/changeStatus/${enc}`],
      ['POST', `/settings/set/${enc}`],
      ['PUT', `/openai/update/bot1/${enc}`],
      ['POST', `/agenda/settings/${enc}`],
      ['DELETE', `/processos/${enc}/p1`],
      ['PATCH', `/leads/${enc}/l1`],
      ['GET', `/instance/connect/${enc}`],
      ['POST', `/instance/restart/${enc}`],
      ['GET', `/usage/limits/${enc}`],
      ['POST', `/webhook/set/${enc}`],
    ]) {
      assert.equal(allowed(m, u, 'equipe'), true, `${m} ${u}`);
    }
  });

  test('equipe: exportar é do dono; a leitura continua vendo e exportando', () => {
    for (const [m, u] of [
      ['GET', `/leads/${enc}/export.xlsx`],
      ['GET', `/leads/${enc}/export.csv`],
      ['GET', `/agenda/${enc}/export.ics`],
      ['GET', `/processos/${enc}/export.csv`],
      ['GET', `/usage/export/${enc}`],
    ]) {
      assert.equal(allowed(m, u, 'equipe'), false, `equipe ${m} ${u}`);
      assert.equal(allowed(m, u, 'leitura'), true, `leitura ${m} ${u}`);
    }
  });

  test('leitura: reads only (GET and the POST reads of the chat), never sends, pauses, edits or pairs', () => {
    for (const [m, u] of [
      ['GET', `/leads/${enc}`],
      ['GET', `/leads/${enc}/export.xlsx`],
      ['GET', `/agenda/${enc}`],
      ['POST', `/chat/findChats/${enc}`],
      ['POST', `/chat/findMessages/${enc}`],
      ['POST', `/chat/getBase64FromMediaMessage/${enc}`],
      ['GET', `/openai/fetchSessions/bot1/${enc}`],
    ]) {
      assert.equal(allowed(m, u, 'leitura'), true, `${m} ${u}`);
    }
    for (const [m, u] of [
      ['POST', `/message/sendText/${enc}`],
      ['POST', `/openai/changeStatus/${enc}`],
      ['POST', `/chat/markMessageAsRead/${enc}`],
      ['DELETE', `/chat/deleteMessageForEveryone/${enc}`],
      ['PATCH', `/leads/${enc}/l1`],
      ['POST', `/settings/set/${enc}`],
      ['GET', `/instance/connect/${enc}`],
      ['POST', `/instance/restart/${enc}`],
    ]) {
      assert.equal(allowed(m, u, 'leitura'), false, `${m} ${u}`);
    }
  });

  test('an invalid role never passes', () => {
    assert.equal(allowed('GET', `/leads/${enc}`, 'chefe' as TeamRole), false);
  });

  test('the instance view never carries the instance token nor integration secrets: token is the team key', () => {
    const view: any = teamInstanceView(
      {
        id: 'i1',
        name: NAME,
        token: 'INSTANCE-TOKEN',
        connectionStatus: 'open',
        Chatwoot: { token: 'cw-secret' },
        Proxy: { password: 'px' },
        Webhook: { headers: { authorization: 'x' } },
        Setting: { rejectCall: false },
        _count: { Message: 3 },
      },
      'wat_' + 'k'.repeat(43),
    );
    assert.equal(view.token, 'wat_' + 'k'.repeat(43));
    const json = JSON.stringify(view);
    for (const secret of ['INSTANCE-TOKEN', 'cw-secret', 'px', 'authorization'])
      assert.ok(!json.includes(secret), secret);
    assert.deepEqual(view.Setting, { rejectCall: false });
  });
});

/** In-memory stand-in for the two Prisma models the service uses. */
function fakePrisma() {
  const keys: any[] = [];
  const instances = [
    { id: 'i1', name: NAME },
    { id: 'i2', name: 'Clínica Modelo' },
  ];
  let seq = 0;
  return {
    keys,
    teamKey: {
      findUnique: async ({ where }: any) => keys.find((k) => k.keyHash === where.keyHash) ?? null,
      findMany: async () => [...keys].reverse(),
      count: async () => keys.length,
      create: async ({ data }: any) => {
        const row = { id: 'k' + ++seq, createdAt: new Date(), lastUsedAt: null, instances: null, ...data };
        keys.push(row);
        return row;
      },
      update: async ({ where, data }: any) => Object.assign(keys.find((k) => k.id === where.id) ?? {}, data),
      deleteMany: async ({ where }: any) => {
        const i = keys.findIndex((k) => k.id === where.id);
        if (i < 0) return { count: 0 };
        keys.splice(i, 1);
        return { count: 1 };
      },
    },
    instance: {
      findMany: async ({ where }: any) =>
        instances.filter((r) => (where.id ? where.id.in.includes(r.id) : where.name.in.includes(r.name))),
    },
  };
}

describe('team keys: service', () => {
  test('create shows the key once, keeps only the hash; resolve finds it with role and instances; revoke ends it', async () => {
    const prisma = fakePrisma();
    const service = new TeamAccessService({ prisma, cacheTtlMs: 0 });
    const created = await service.create({ name: '  Ana   Exemplo ', role: 'equipe', instances: [NAME] });
    assert.ok(isTeamKey(created.key));
    assert.equal(created.name, 'Ana Exemplo');
    assert.ok(!JSON.stringify(prisma.keys).includes(created.key), 'the key itself is never stored');
    assert.equal(prisma.keys[0].keyHash, hashTeamKey(created.key));
    assert.deepEqual(prisma.keys[0].instances, ['i1']);

    const grant = await service.resolve(created.key);
    assert.deepEqual(
      { name: grant?.name, role: grant?.role, instanceNames: grant?.instanceNames },
      { name: 'Ana Exemplo', role: 'equipe', instanceNames: [NAME] },
    );

    const all = await service.create({ name: 'Bruno', role: 'leitura' });
    assert.equal((await service.resolve(all.key))?.instanceNames, null, 'no list = every instance');
    assert.equal(prisma.keys[1].instances, null);

    const dono = await service.create({ name: 'Carla', role: 'dono' });
    assert.equal((await service.resolve(dono.key))?.role, 'dono');
    assert.equal(prisma.keys[2].role, 'dono');

    const listed = await service.list();
    assert.equal(listed.keys.length, 3);
    assert.ok(!JSON.stringify(listed).includes('keyHash'));
    assert.ok(!JSON.stringify(listed).includes(created.key));
    assert.deepEqual(
      listed.roles.map((r) => r.id),
      ['dono', 'equipe', 'leitura'],
    );

    assert.deepEqual(await service.revoke(prisma.keys[0].id), { removed: true });
    assert.equal(await service.resolve(created.key), null);
    assert.equal(await service.resolve('wat_' + 'z'.repeat(43)), null);
  });

  test('invalid input is rejected with readable messages', async () => {
    const service = new TeamAccessService({ prisma: fakePrisma() });
    await assert.rejects(service.create({ name: '', role: 'chefe' }), (e: any) => {
      assert.ok(e instanceof TeamAccessValidationError);
      assert.equal(e.errors.length, 2);
      return true;
    });
    await assert.rejects(service.create({ name: 'Ana', role: 'equipe', instances: ['Não existe'] }), /não encontrada/);
    await assert.rejects(service.create({ name: 'Ana', role: 'equipe', instances: [] }), /pelo menos uma/);
    await assert.rejects(service.create({ name: 'A'.repeat(81), role: 'equipe' }), /até 80/);
  });
});

describe('team keys: auth guard', () => {
  const run = async (guard: any, req: any) => {
    let passed = false;
    let error: any = null;
    try {
      await guard(req, { set() {}, status: () => ({ json: () => undefined }) }, (err?: any) => {
        // a guard that answers through next(error) refused the request; only next() without an error lets it pass
        if (err) error = err;
        else passed = true;
      });
    } catch (e) {
      error = e;
    }
    return { passed, error };
  };
  const req = (key: string, method: string, url: string, params: any = {}, headers: any = {}) => ({
    get: (h: string) => (h.toLowerCase() === 'apikey' ? key : undefined),
    method,
    originalUrl: url,
    params,
    body: {},
    headers,
  });
  const donoKey = 'wat_' + 'd'.repeat(43);
  const equipeKey = 'wat_' + 'e'.repeat(43);
  const leituraKey = 'wat_' + 'l'.repeat(43);
  const withTeam = async (fn: () => Promise<void>) => {
    serverModuleOverrides.teamAccessService = {
      resolve: async (k: string) =>
        k === donoKey
          ? { id: 'k0', name: 'Dono Exemplo', role: 'dono', instanceNames: null, keyHint: 'wat_…dddd' }
          : k === equipeKey
            ? { id: 'k1', name: 'Ana', role: 'equipe', instanceNames: [NAME], keyHint: 'wat_…eeee' }
            : k === leituraKey
              ? { id: 'k2', name: 'Bruno', role: 'leitura', instanceNames: null, keyHint: 'wat_…llll' }
              : null,
    };
    try {
      await fn();
    } finally {
      delete serverModuleOverrides.teamAccessService;
    }
  };

  test('a team key passes only on its instances and within its role', async () => {
    await withTeam(async () => {
      const send = req(equipeKey, 'POST', `/message/sendText/${enc}`, { instanceName: NAME });
      const ok = await run(authGuard.apikey, send);
      assert.equal(ok.passed, true);
      assert.equal((send as any).teamAccess.name, 'Ana');

      const other = await run(authGuard.apikey, req(equipeKey, 'GET', '/leads/Outra', { instanceName: 'Outra' }));
      assert.equal(other.passed, false);
      assert.match(String(other.error?.message ?? other.error), /instância|Forbidden/i);

      const ownerOnly = await run(
        authGuard.apikey,
        req(equipeKey, 'DELETE', `/instance/delete/${enc}`, { instanceName: NAME }),
      );
      assert.equal(ownerOnly.passed, false);

      const global = await run(authGuard.apikey, req(equipeKey, 'GET', '/observability'));
      assert.equal(global.passed, false, 'routes without an instance are closed except the short list');

      const fetch = await run(authGuard.apikey, req(equipeKey, 'GET', '/instance/fetchInstances'));
      assert.equal(fetch.passed, true);

      const readSend = await run(
        authGuard.apikey,
        req(leituraKey, 'POST', `/message/sendText/Outra`, { instanceName: 'Outra' }),
      );
      assert.equal(readSend.passed, false, 'read-only never sends, even on an instance it may see');
      const readChats = await run(
        authGuard.apikey,
        req(leituraKey, 'POST', `/chat/findChats/Outra`, { instanceName: 'Outra' }),
      );
      assert.equal(readChats.passed, true);

      const donoAdmin = await run(authGuard.apikey, req(donoKey, 'GET', '/admin/audit'));
      assert.equal(donoAdmin.passed, true, 'dono reaches the admin routes through the apikey guard');

      const unknown = await run(
        authGuard.apikey,
        req('wat_' + 'u'.repeat(43), 'GET', `/leads/${enc}`, { instanceName: NAME }),
      );
      assert.equal(unknown.passed, false);
      assert.equal(unknown.error?.status, 401);
    });
  });

  test('dono scoped to instances: the admin routes pass but another instance does not', async () => {
    serverModuleOverrides.teamAccessService = {
      resolve: async () => ({ id: 'k0', name: 'Dono', role: 'dono', instanceNames: [NAME], keyHint: 'wat_…dddd' }),
    };
    try {
      const own = await run(authGuard.apikey, req(donoKey, 'GET', `/leads/${enc}`, { instanceName: NAME }));
      assert.equal(own.passed, true);
      const other = await run(authGuard.apikey, req(donoKey, 'GET', '/leads/Outra', { instanceName: 'Outra' }));
      assert.equal(other.passed, false);
    } finally {
      delete serverModuleOverrides.teamAccessService;
    }
  });

  test('the global key is unchanged (owner): passes everywhere, team guard never consulted', async () => {
    const global = configService.get<Auth>('AUTHENTICATION').API_KEY.KEY;
    serverModuleOverrides.teamAccessService = {
      resolve: async () => {
        throw new Error('must not be called for the global key');
      },
    };
    try {
      for (const [m, u, p] of [
        ['DELETE', `/instance/delete/${enc}`, { instanceName: NAME }],
        ['POST', '/instance/create', {}],
        ['GET', '/observability', {}],
      ] as [string, string, any][]) {
        assert.equal((await run(authGuard.apikey, req(global, m, u, p))).passed, true, `${m} ${u}`);
      }
    } finally {
      delete serverModuleOverrides.teamAccessService;
    }
  });

  test('instance token and client codes keep their own paths', async () => {
    serverModuleOverrides.teamAccessService = {
      resolve: async () => {
        throw new Error('must not be called');
      },
    };
    serverModuleOverrides.prismaRepository = {
      instance: {
        findUnique: async ({ where }: any) => (where.name === 'tok-inst' ? { token: 'TOKEN-OF-INSTANCE-1' } : null),
      },
    };
    serverModuleOverrides.clientAccessService = {
      resolve: async (k: string) =>
        k === 'wac_' + 'c'.repeat(43) ? { instanceId: 'i1', instanceName: NAME, modules: ['leads'] } : null,
    };
    try {
      const token = await run(
        authGuard.apikey,
        req('TOKEN-OF-INSTANCE-1', 'POST', '/message/sendText/tok-inst', { instanceName: 'tok-inst' }),
      );
      assert.equal(token.passed, true);
      const client = await run(
        authGuard.apikey,
        req('wac_' + 'c'.repeat(43), 'GET', `/leads/${enc}`, { instanceName: NAME }),
      );
      assert.equal(client.passed, true);
    } finally {
      delete serverModuleOverrides.teamAccessService;
      delete serverModuleOverrides.prismaRepository;
      delete serverModuleOverrides.clientAccessService;
    }
  });
});

describe('team keys: admin-only guard', () => {
  const run = async (guard: any, req: any) => {
    let passed = false;
    let error: any = null;
    try {
      await guard(req, { set() {}, status: () => ({ json: () => undefined }) }, (err?: any) => {
        // a guard that answers through next(error) refused the request; only next() without an error lets it pass
        if (err) error = err;
        else passed = true;
      });
    } catch (e) {
      error = e;
    }
    return { passed, error };
  };
  const req = (key: string, headers: any = {}) => ({
    get: (h: string) => (h.toLowerCase() === 'apikey' ? key : undefined),
    method: 'GET',
    originalUrl: '/team/keys',
    params: {},
    body: {},
    headers,
  });
  const GLOBAL = 'GLOBAL-KEY-FOR-THE-TEST-000000000';

  test('a dono team key passes; equipe and leitura get 403 without counting as a wrong key', async () => {
    const resolveTeam = async (key: string) =>
      key === 'wat_' + 'd'.repeat(43)
        ? { id: 'k0', name: 'Dono', role: 'dono', instanceNames: null, keyHint: 'wat_…dddd' }
        : key === 'wat_' + 'e'.repeat(43)
          ? { id: 'k1', name: 'Ana', role: 'equipe', instanceNames: null, keyHint: 'wat_…eeee' }
          : { id: 'k2', name: 'Leitura', role: 'leitura', instanceNames: null, keyHint: 'wat_…llll' };
    const guard = createAdminOnlyGuard(
      () => GLOBAL,
      async () => null,
      resolveTeam as any,
    );
    const dono = req('wat_' + 'd'.repeat(43), { 'cf-connecting-ip': '198.51.100.91' });
    assert.equal((await run(guard, dono)).passed, true);
    assert.equal((dono as any).teamAccess.role, 'dono');

    const otherIp = { 'cf-connecting-ip': '198.51.100.92' };
    for (let i = 0; i < 60; i++) {
      const r = await run(guard, req('wat_' + 'e'.repeat(43), otherIp));
      assert.equal(r.passed, false);
      assert.match(String(r.error?.message ?? r.error), /dono/i);
    }
    assert.equal(authThrottle.isBlocked('198.51.100.92'), false, 'a real team key never blocks the office IP');

    const leitura = await run(guard, req('wat_' + 'l'.repeat(43), otherIp));
    assert.equal(leitura.passed, false);
    assert.equal(authThrottle.isBlocked('198.51.100.92'), false);
  });

  test('wrong keys through the apikey guard are counted by the throttle (team keys included)', async () => {
    serverModuleOverrides.prismaRepository = { instance: { findUnique: async () => null } };
    serverModuleOverrides.teamAccessService = { resolve: async () => null };
    const headers = { 'cf-connecting-ip': '203.0.113.19' };
    try {
      for (let i = 0; i < 45; i++) {
        await run(authGuard.apikey, {
          get: (h: string) =>
            h.toLowerCase() === 'apikey' ? (i % 2 ? 'WRONG-KEY' : 'wat_' + 'w'.repeat(43)) : undefined,
          method: 'GET',
          originalUrl: '/leads/a',
          params: { instanceName: 'a' },
          body: {},
          headers,
        });
      }
      assert.equal(authThrottle.isBlocked('203.0.113.19'), true);
    } finally {
      delete serverModuleOverrides.prismaRepository;
      delete serverModuleOverrides.teamAccessService;
    }
  });
});
