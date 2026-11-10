import '../helpers/setup';
import '@exceptions';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { authGuard } from '@api/guards/auth.guard';
import { ClientAccessService, ClientAccessValidationError } from '@api/services/client-access.service';
import {
  clientInstanceView,
  ClientModule,
  clientRouteAllowed,
  generateClientKey,
  hashClientKey,
  isClientKey,
  normalizeClientPath,
  normalizeModules,
} from '@utils/client-access';

import { serverModuleOverrides } from '../helpers/chatbot-emit';

const NAME = 'Renato Paixão';
const enc = encodeURIComponent(NAME);
const allowed = (method: string, url: string, modules: ClientModule[], body?: unknown) =>
  clientRouteAllowed(method, normalizeClientPath(url, NAME), modules, body);

describe('client access: codes', () => {
  test('a new code is wac_ + 43 characters, hashed with SHA-256 and shown only by its last 4 characters', () => {
    const { key, hash, hint } = generateClientKey();
    assert.match(key, /^wac_[A-Za-z0-9_-]{43}$/);
    assert.equal(hash, hashClientKey(key));
    assert.equal(hash.length, 64);
    assert.equal(hint, `wac_…${key.slice(-4)}`);
    assert.ok(isClientKey(key));
    assert.ok(!isClientKey('wac_short'));
    assert.ok(!isClientKey('B6D711FCDE4D4FD5936544120E713976'));
    assert.notEqual(generateClientKey().key, key);
  });

  test('modules: only the known ones, canonical order, no repetition', () => {
    assert.deepEqual(normalizeModules(['leads', 'x', 'conversas', 'leads']), ['conversas', 'leads']);
    assert.deepEqual(normalizeModules(null), []);
  });
});

describe('client access: route rules (server side)', () => {
  test('the instance name in the path is decoded and replaced, query string ignored', () => {
    assert.equal(normalizeClientPath(`/leads/${enc}/export.xlsx?x=1`, NAME), '/leads/:i/export.xlsx');
    assert.equal(normalizeClientPath(`/chat/findChats/${enc}/`, NAME), '/chat/findChats/:i');
  });

  test('base routes work with any module', () => {
    for (const [m, u] of [
      ['GET', '/instance/fetchInstances?instanceName=x'],
      ['GET', `/instance/connectionState/${enc}`],
      ['GET', `/usage/summary/${enc}`],
      ['GET', '/client-access/me'],
      ['POST', '/verify-creds'],
    ]) {
      assert.ok(allowed(m, u, ['leads']), `${m} ${u}`);
    }
  });

  test('conversas: read and send, pause the bot for one contact; never for everybody, never profile or blocking', () => {
    const mods: ClientModule[] = ['conversas'];
    assert.ok(allowed('POST', `/chat/findChats/${enc}`, mods));
    assert.ok(allowed('POST', `/chat/getBase64FromMediaMessage/${enc}`, mods));
    assert.ok(allowed('POST', `/message/sendText/${enc}`, mods));
    assert.ok(allowed('GET', `/openai/fetchSessions/bot123/${enc}`, mods));
    assert.ok(
      allowed('POST', `/openai/changeStatus/${enc}`, mods, { remoteJid: '5521@s.whatsapp.net', status: 'paused' }),
    );
    assert.ok(!allowed('POST', `/openai/changeStatus/${enc}`, mods, { remoteJid: 'all', status: 'closed' }));
    assert.ok(!allowed('POST', `/openai/changeStatus/${enc}`, mods, {}));
    assert.ok(!allowed('POST', `/chat/updateProfileName/${enc}`, mods));
    assert.ok(!allowed('POST', `/chat/updateBlockStatus/${enc}`, mods));
    assert.ok(!allowed('POST', `/chat/deleteMessageForEveryone/${enc}`, mods));
    assert.ok(!allowed('POST', `/message/sendStatus/${enc}`, mods));
    assert.ok(!allowed('POST', `/chat/whatsappNumbers/${enc}`, mods), 'no number checking in bulk (ban risk)');
    assert.ok(!allowed('POST', `/chat/findChats/${enc}`, ['leads']), 'needs the conversas module');
  });

  test('admin-only things stay closed whatever the modules', () => {
    const all: ClientModule[] = ['conversas', 'leads', 'agenda', 'processos', 'plano', 'conexao'];
    for (const [m, u] of [
      ['GET', `/openai/find/${enc}`],
      ['POST', `/openai/settings/${enc}`],
      ['GET', `/openai/creds/${enc}`],
      ['PUT', `/openai/update/bot1/${enc}`],
      ['POST', `/settings/set/${enc}`],
      ['GET', `/settings/find/${enc}`],
      ['POST', `/webhook/set/${enc}`],
      ['DELETE', `/instance/logout/${enc}`],
      ['DELETE', `/instance/delete/${enc}`],
      ['POST', `/instance/restart/${enc}`],
      ['POST', `/leads/settings/${enc}`],
      ['POST', `/agenda/settings/${enc}`],
      ['POST', `/agenda/settings/${enc}/ics-token`],
      ['POST', `/processos/${enc}/settings`],
      ['POST', `/processos/${enc}/oab`],
      ['DELETE', `/processos/${enc}/oab/o1`],
      ['POST', `/usage/limits/${enc}`],
      ['GET', '/admin/credentials'],
      ['GET', '/observability'],
      ['POST', '/instance/create'],
    ]) {
      assert.ok(!allowed(m, u, all), `${m} ${u} must stay closed`);
    }
  });

  test('leads, agenda, processos, plano and conexao open their own screens', () => {
    assert.ok(allowed('GET', `/leads/${enc}`, ['leads']));
    assert.ok(allowed('PATCH', `/leads/${enc}/lead1`, ['leads']));
    assert.ok(allowed('GET', `/leads/${enc}/export.xlsx`, ['leads']));
    assert.ok(allowed('POST', `/leads/${enc}/refresh-waiting`, ['leads']));
    assert.ok(allowed('POST', `/leads/backfill/${enc}`, ['leads']));
    assert.ok(allowed('GET', `/leads/settings/${enc}`, ['leads']));
    assert.ok(allowed('POST', `/agenda/${enc}`, ['agenda']));
    assert.ok(allowed('PATCH', `/agenda/${enc}/ap1`, ['agenda']));
    assert.ok(allowed('GET', `/agenda/${enc}/slots`, ['agenda']));
    assert.ok(allowed('GET', `/processos/${enc}`, ['processos']));
    assert.ok(allowed('POST', `/processos/${enc}/p1/sync`, ['processos']));
    assert.ok(allowed('GET', `/usage/limits/${enc}`, ['plano']));
    assert.ok(!allowed('GET', `/usage/limits/${enc}`, ['leads']));
    assert.ok(allowed('GET', `/instance/connect/${enc}`, ['conexao']));
    assert.ok(!allowed('GET', `/instance/connect/${enc}`, ['conversas']));
  });

  test('the instance view never carries the instance token: token is the client code', () => {
    const view: any = clientInstanceView(
      {
        id: 'i1',
        name: NAME,
        token: 'INSTANCE-TOKEN',
        Setting: { wavoipToken: 'x' },
        Chatwoot: { token: 'y' },
        _count: { Chat: 3 },
      },
      'wac_code',
    );
    assert.equal(view.token, 'wac_code');
    assert.equal(view.Setting, undefined);
    assert.equal(view.Chatwoot, undefined);
    assert.deepEqual(view._count, { Chat: 3 });
    assert.doesNotMatch(JSON.stringify(view), /INSTANCE-TOKEN/);
  });
});

function fakePrisma() {
  const rows: any[] = [];
  const instances = [{ id: 'i1', name: NAME }];
  let reads = 0;
  return {
    rows,
    get reads() {
      return reads;
    },
    clientAccess: {
      findUnique: async ({ where, include }: any) => {
        reads++;
        const row = rows.find((r) => (where.keyHash ? r.keyHash === where.keyHash : r.instanceId === where.instanceId));
        if (!row) return null;
        return include ? { ...row, Instance: instances.find((i) => i.id === row.instanceId) } : { ...row };
      },
      create: async ({ data }: any) => {
        rows.push({ id: 'ca' + rows.length, ...data });
      },
      update: async ({ where, data }: any) => {
        const row = rows.find((r) => (where.id ? r.id === where.id : r.instanceId === where.instanceId));
        Object.assign(row, data);
        return row;
      },
      deleteMany: async ({ where }: any) => {
        const i = rows.findIndex((r) => r.instanceId === where.instanceId);
        if (i >= 0) rows.splice(i, 1);
      },
    },
  };
}

describe('client access: service', () => {
  test('first save creates a code (shown once), default modules; resolve finds it; new code invalidates the old', async () => {
    const prisma = fakePrisma();
    const service = new ClientAccessService({ prisma, cacheTtlMs: 0 });

    const first: any = await service.save('i1', NAME, {});
    assert.ok(isClientKey(first.key));
    assert.deepEqual(first.modules, ['conversas', 'leads', 'conexao']);
    assert.equal(first.enabled, true);
    assert.equal(prisma.rows[0].keyHash, hashClientKey(first.key));
    assert.ok(!JSON.stringify(prisma.rows).includes(first.key), 'the code itself is never stored');

    assert.deepEqual(await service.resolve(first.key), {
      instanceId: 'i1',
      instanceName: NAME,
      modules: ['conversas', 'leads', 'conexao'],
    });

    const changed: any = await service.save('i1', NAME, { modules: ['leads'] });
    assert.equal(changed.key, undefined, 'changing modules keeps the code');
    assert.deepEqual((await service.resolve(first.key))?.modules, ['leads']);

    const rotated: any = await service.save('i1', NAME, { newKey: true });
    assert.ok(isClientKey(rotated.key));
    assert.equal(await service.resolve(first.key), null);
    assert.ok(await service.resolve(rotated.key));

    await service.save('i1', NAME, { enabled: false });
    assert.equal(await service.resolve(rotated.key), null, 'turned off: the code stops working');

    await service.save('i1', NAME, { enabled: true });
    await service.revoke('i1', NAME);
    assert.equal(await service.resolve(rotated.key), null);
    assert.equal((await service.view('i1', NAME)).configured, false);
  });

  test('invalid input is rejected with readable messages', async () => {
    const service = new ClientAccessService({ prisma: fakePrisma() });
    await assert.rejects(service.save('i1', NAME, { modules: ['tudo'] }), (error: any) => {
      assert.ok(error instanceof ClientAccessValidationError);
      assert.match(error.errors[0], /Módulos desconhecidos: tudo/);
      return true;
    });
    await assert.rejects(service.save('i1', NAME, { modules: [] }), /pelo menos um módulo/);
    await assert.rejects(service.save('i1', NAME, { enabled: 'sim' }), /"enabled" deve ser true ou false/);
  });

  test('a resolved code is cached for a while (no database read per request)', async () => {
    const prisma = fakePrisma();
    let now = 1_000_000;
    const service = new ClientAccessService({ prisma, cacheTtlMs: 30_000, now: () => now });
    const { key } = (await service.save('i1', NAME, {})) as any;
    const before = prisma.reads;
    await service.resolve(key);
    await service.resolve(key);
    assert.equal(prisma.reads - before, 1);
    now += 31_000;
    await service.resolve(key);
    assert.equal(prisma.reads - before, 2);
  });
});

describe('client access: auth guard', () => {
  const run = async (req: any) => {
    let passed = false;
    let error: any = null;
    try {
      await (authGuard.apikey as any)(req, {}, () => {
        passed = true;
      });
    } catch (e) {
      error = e;
    }
    return { passed, error };
  };
  const req = (key: string, method: string, url: string, params: any = {}, body: any = {}) => ({
    get: (h: string) => (h.toLowerCase() === 'apikey' ? key : undefined),
    method,
    originalUrl: url,
    params,
    body,
  });

  test('a client code passes only on its instance and its modules', async () => {
    const key = 'wac_' + 'a'.repeat(43);
    serverModuleOverrides.clientAccessService = {
      resolve: async (k: string) => (k === key ? { instanceId: 'i1', instanceName: NAME, modules: ['leads'] } : null),
    };
    try {
      const ok = await run(req(key, 'GET', `/leads/${enc}`, { instanceName: NAME }));
      assert.equal(ok.passed, true);

      const otherInstance = await run(req(key, 'GET', '/leads/Outra', { instanceName: 'Outra' }));
      assert.equal(otherInstance.passed, false);
      assert.match(String(otherInstance.error?.message ?? otherInstance.error), /outra instância|Forbidden/i);

      const notInModules = await run(req(key, 'POST', `/chat/findChats/${enc}`, { instanceName: NAME }));
      assert.equal(notInModules.passed, false);

      const adminThing = await run(req(key, 'GET', `/openai/find/${enc}`, { instanceName: NAME }));
      assert.equal(adminThing.passed, false);

      const unknown = await run(req('wac_' + 'b'.repeat(43), 'GET', `/leads/${enc}`, { instanceName: NAME }));
      assert.equal(unknown.passed, false);
    } finally {
      delete serverModuleOverrides.clientAccessService;
    }
  });
});
