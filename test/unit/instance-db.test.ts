import '../helpers/setup';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { currentInstanceId, runWithInstance } from '@api/repository/instance-db/instance-context';
import {
  InstanceDatabaseService,
  projectName,
  readInstanceDbConfig,
  withConnectionLimit,
} from '@api/repository/instance-db/instance-db.service';
import { NeonClient } from '@api/repository/instance-db/neon.client';
import { createRoutedRepository, extractInstanceId } from '@api/repository/instance-db/routing';
import { deriveKey, open, redactUrl, seal } from '@api/repository/instance-db/secret-box';

/** Cliente Prisma falso: cada model registra as chamadas e devolve uma etiqueta do banco. */
function fakeClient(label: string, models = ['message', 'chat', 'session', 'authStateKey', 'isOnWhatsapp']) {
  const calls: { model: string; op: string; args: any }[] = [];
  const client: any = { label, calls, disconnected: false };
  for (const model of models) {
    client[model] = {};
    for (const op of ['findMany', 'findFirst', 'findUnique', 'create', 'update', 'deleteMany', 'upsert']) {
      client[model][op] = (args: any) => {
        calls.push({ model, op, args });
        return Promise.resolve({ db: label, model, op });
      };
    }
  }
  const rows = new Map<string, any>();
  client.instance = {
    findMany: async (args: any) => {
      calls.push({ model: 'instance', op: 'findMany', args });
      return [...rows.values()].map((r) => ({ ...r }));
    },
    findUnique: async (args: any) => {
      calls.push({ model: 'instance', op: 'findUnique', args });
      const r = rows.get(args.where.id);
      if (!r) return null;
      if (args.select) {
        const out: any = {};
        for (const k of Object.keys(args.select)) out[k] = r[k];
        return out;
      }
      return { ...r };
    },
    upsert: async (args: any) => {
      calls.push({ model: 'instance', op: 'upsert', args });
      rows.set(args.where.id, { ...args.create });
      return args.create;
    },
    deleteMany: async (args: any) => {
      calls.push({ model: 'instance', op: 'deleteMany', args });
      rows.delete(args.where.id);
      return { count: 1 };
    },
    delete: async (args: any) => ({ db: label, args }),
  };
  client.rows = rows;
  client.$queryRaw = (...args: any[]) => Promise.resolve({ db: label, raw: args.length });
  client.$transaction = (ops: any) => Promise.resolve({ db: label, tx: Array.isArray(ops) ? ops.length : 'fn' });
  client.$disconnect = async () => {
    client.disconnected = true;
  };
  return client;
}

function registryWith(map: Record<string, any>) {
  return {
    hasDedicated: () => Object.keys(map).length > 0,
    dedicatedClient: (id: string | null | undefined) => (id ? (map[id] ?? null) : null),
  };
}

describe('instance-db: secret box', () => {
  const key = deriveKey('segredo-de-teste');

  test('seal/open roundtrip and different ciphertexts each time', () => {
    const url = 'postgresql://user:pw@ep-x.us-east-2.aws.neon.tech/neondb?sslmode=require';
    const a = seal(url, key);
    const b = seal(url, key);
    assert.ok(a.startsWith('enc:v1:'));
    assert.notEqual(a, b);
    assert.equal(open(a, key), url);
    assert.ok(!a.includes('pw@'));
  });

  test('tampering or a wrong key is rejected', () => {
    const sealed = seal('postgresql://u:p@h/db', key);
    const raw = Buffer.from(sealed.slice(7), 'base64');
    raw[raw.length - 1] ^= 0xff;
    assert.throws(() => open('enc:v1:' + raw.toString('base64'), key));
    assert.throws(() => open(sealed, deriveKey('outra-chave')));
    assert.throws(() => open('postgresql://plain', key));
  });

  test('redactUrl hides the password', () => {
    assert.equal(redactUrl('postgresql://role:s3cr3t@host/db'), 'postgresql://role:***@host/db');
  });
});

describe('instance-db: config and helpers', () => {
  test('only enabled with flag + Neon key + PostgreSQL', () => {
    assert.equal(readInstanceDbConfig({ DB_PER_INSTANCE_ENABLED: 'true' }).enabled, false);
    assert.equal(readInstanceDbConfig({ DB_PER_INSTANCE_ENABLED: 'true', NEON_API_KEY: 'k' }).enabled, true);
    assert.equal(
      readInstanceDbConfig({ DB_PER_INSTANCE_ENABLED: 'true', NEON_API_KEY: 'k', DATABASE_PROVIDER: 'mysql' }).enabled,
      false,
    );
    const cfg = readInstanceDbConfig({ NEON_MAX_CU: '9', NEON_PG_VERSION: 'x' });
    assert.equal(cfg.neonMaxCu, 2);
    assert.equal(cfg.neonPgVersion, 16);
    assert.equal(cfg.neonRegionId, 'aws-us-east-2');
    assert.equal(cfg.deleteOnRemove, false);
  });

  test('project names are slugged and unique per instance', () => {
    assert.equal(projectName('whatsai', 'Renato Paixão', 'ec3b7572-7dad'), 'whatsai-renato-paixao-ec3b7572');
    assert.equal(projectName('whatsai', '!!!', 'abcdef123'), 'whatsai-instancia-abcdef12');
  });

  test('connection_limit is added once', () => {
    assert.match(withConnectionLimit('postgresql://u:p@h/db?sslmode=require', 3), /connection_limit=3/);
    assert.match(withConnectionLimit('postgresql://u:p@h/db?connection_limit=7', 3), /connection_limit=7/);
  });
});

describe('instance-db: extractInstanceId', () => {
  test('where, data, create, connect, AND and compound keys', () => {
    assert.equal(extractInstanceId('message', { where: { instanceId: 'A' } }), 'A');
    assert.equal(extractInstanceId('message', { where: { instanceId: { equals: 'A' } } }), 'A');
    assert.equal(extractInstanceId('message', { where: { instanceId: { in: ['A'] } } }), 'A');
    assert.equal(extractInstanceId('message', { where: { instanceId: { in: ['A', 'B'] } } }), undefined);
    assert.equal(extractInstanceId('message', { data: { instanceId: 'B' } }), 'B');
    assert.equal(extractInstanceId('message', { data: [{ instanceId: 'C' }] }), 'C');
    assert.equal(extractInstanceId('chat', { where: { id: 'x' }, create: { instanceId: 'D' } }), 'D');
    assert.equal(extractInstanceId('chat', { data: { Instance: { connect: { id: 'E' } } } }), 'E');
    assert.equal(extractInstanceId('chat', { where: { AND: [{ remoteJid: 'r' }, { instanceId: 'F' }] } }), 'F');
    assert.equal(
      extractInstanceId('usageCounter', {
        where: { instanceId_type_period_remoteJid: { instanceId: 'G', type: 'd' } },
      }),
      'G',
    );
    assert.equal(extractInstanceId('authStateKey', { where: { sessionId: 'H', key: { in: ['k'] } } }), 'H');
    assert.equal(extractInstanceId('session', { where: { instanceId: 'nope' } }), undefined);
    assert.equal(extractInstanceId('message', { where: { id: 'only-id' } }), undefined);
    assert.equal(extractInstanceId('message', undefined), undefined);
  });
});

describe('instance-db: routing proxy', () => {
  test('no dedicated instance: everything goes to the main database untouched', async () => {
    const control = fakeClient('control');
    const routed: any = createRoutedRepository(control, registryWith({}));
    assert.equal(routed.message, control.message);
    assert.deepEqual(await routed.message.findMany({ where: { instanceId: 'A' } }), {
      db: 'control',
      model: 'message',
      op: 'findMany',
    });
    assert.equal((await routed.$queryRaw(['select 1'])).db, 'control');
  });

  test('explicit instanceId, context and fallback', async () => {
    const control = fakeClient('control');
    const tenantA = fakeClient('A');
    const warnings: string[] = [];
    const routed: any = createRoutedRepository(control, registryWith({ A: tenantA }), {
      warn: (m) => warnings.push(m),
    });

    assert.equal((await routed.message.findMany({ where: { instanceId: 'A' } })).db, 'A');
    assert.equal((await routed.message.findMany({ where: { instanceId: 'B' } })).db, 'control');
    assert.equal((await routed.authStateKey.deleteMany({ where: { sessionId: 'A' } })).db, 'A');

    // by id only: needs the context
    assert.equal((await routed.message.update({ where: { id: 'm1' }, data: {} })).db, 'control');
    assert.equal(warnings.length, 1);
    await runWithInstance('A', async () => {
      assert.equal(currentInstanceId(), 'A');
      assert.equal((await routed.message.update({ where: { id: 'm1' }, data: {} })).db, 'A');
      assert.equal((await routed.$queryRaw(['select 1'])).db, 'A');
      assert.equal((await routed.$transaction([1, 2])).db, 'A');
      // explicit instanceId wins over the context
      assert.equal((await routed.message.findMany({ where: { instanceId: 'B' } })).db, 'control');
      // context survives timers
      await new Promise<void>((resolve) =>
        setTimeout(async () => {
          assert.equal((await routed.chat.findFirst({ where: { id: 'c' } })).db, 'A');
          resolve();
        }, 5),
      );
    });
    assert.equal(currentInstanceId(), undefined);

    // global tables always stay in the main database
    await runWithInstance('A', async () => {
      assert.equal((await routed.isOnWhatsapp.findMany({})).db, 'control');
    });
  });

  test('instance rows come from the main database with relations hydrated from the tenant', async () => {
    const control = fakeClient('control');
    const tenantA = fakeClient('A');
    control.rows.set('A', { id: 'A', name: 'Escritório', connectionStatus: 'open', Setting: null });
    control.rows.set('Z', { id: 'Z', name: 'Compartilhada', connectionStatus: 'close', Setting: { x: 1 } });
    tenantA.rows.set('A', {
      id: 'A',
      name: 'stale',
      connectionStatus: 'close',
      Setting: { rejectCall: true },
      _count: { Message: 7 },
    });
    const routed: any = createRoutedRepository(control, registryWith({ A: tenantA }));

    const rows = await routed.instance.findMany({ include: { Setting: true, _count: { select: { Message: true } } } });
    const a = rows.find((r: any) => r.id === 'A');
    const z = rows.find((r: any) => r.id === 'Z');
    assert.equal(a.connectionStatus, 'open', 'scalars come from the main database');
    assert.deepEqual(a.Setting, { rejectCall: true });
    assert.deepEqual(a._count, { Message: 7 });
    assert.deepEqual(z.Setting, { x: 1 });

    // without relations: plain passthrough
    const plain = await routed.instance.findMany({ where: {} });
    assert.equal(plain.find((r: any) => r.id === 'A').Setting, null);
  });
});

describe('instance-db: provisioning service', () => {
  const key = deriveKey('k');
  const cfg = {
    enabled: true,
    deleteOnRemove: false,
    migrateOnBoot: true,
    connectionLimit: 3,
    projectPrefix: 'whatsai',
  };

  function controlWithMappings() {
    const control = fakeClient('control');
    const mappings: any[] = [];
    control.instanceDatabase = {
      create: async ({ data }: any) => {
        const row = { id: `map-${mappings.length + 1}`, ...data };
        mappings.push(row);
        return row;
      },
      update: async ({ where, data }: any) =>
        Object.assign(
          mappings.find((m) => m.id === where.id),
          data,
        ),
      updateMany: async ({ where, data }: any) => {
        mappings.filter((m) => m.instanceId === where.instanceId).forEach((m) => Object.assign(m, data));
        return { count: 1 };
      },
      findMany: async ({ where }: any) => mappings.filter((m) => m.status === where.status),
    };
    control.rows.set('inst-1', { id: 'inst-1', name: 'Escritório' });
    return { control, mappings };
  }

  function fakeNeon(opts: { fail?: boolean } = {}) {
    const created: string[] = [];
    const deleted: string[] = [];
    const neon = {
      createProject: async (name: string) => {
        created.push(name);
        return { projectId: 'proj-1', regionId: 'aws-us-east-2', connectionUri: 'postgresql://r:pw@ep-1/neondb' };
      },
      waitForOperations: async () => {
        if (opts.fail) throw new Error('Neon: tempo esgotado');
      },
      deleteProject: async (id: string) => {
        deleted.push(id);
      },
    } as unknown as NeonClient;
    return { neon, created, deleted };
  }

  test('provision: creates the project, migrates, mirrors the instance and starts routing', async () => {
    const { control, mappings } = controlWithMappings();
    const { neon, created } = fakeNeon();
    const tenant = fakeClient('tenant');
    const migrated: string[] = [];
    const svc = new InstanceDatabaseService(cfg, {
      control,
      neon,
      encryptionKey: key,
      createClient: () => tenant,
      migrate: async (url) => {
        migrated.push(url);
      },
      logger: { info() {}, warn() {}, error() {} },
    });

    assert.equal(svc.hasDedicated(), false);
    await svc.provision('inst-1', 'Escritório');
    assert.deepEqual(created, ['whatsai-escritorio-inst-1']);
    assert.match(migrated[0], /connection_limit=3/);
    assert.equal(mappings[0].status, 'ready');
    assert.ok(mappings[0].connectionUri.startsWith('enc:v1:'), 'URL is stored encrypted');
    assert.equal(open(mappings[0].connectionUri, key), 'postgresql://r:pw@ep-1/neondb');
    assert.deepEqual(tenant.rows.get('inst-1'), { id: 'inst-1', name: 'Escritório' });
    assert.equal(svc.dedicatedClient('inst-1'), tenant);
    assert.equal(svc.status('inst-1'), 'ready');
    assert.equal(svc.status('other'), 'shared');

    // release: wipes the instance data (cascade) and keeps the project by default
    await svc.release('inst-1');
    assert.equal(tenant.rows.has('inst-1'), false);
    assert.equal(tenant.disconnected, true);
    assert.equal(mappings[0].status, 'detached');
    assert.equal(svc.hasDedicated(), false);
  });

  test('provision failure: deletes the half-created project, marks failed and throws', async () => {
    const { control, mappings } = controlWithMappings();
    const { neon, deleted } = fakeNeon({ fail: true });
    const svc = new InstanceDatabaseService(cfg, {
      control,
      neon,
      encryptionKey: key,
      createClient: () => fakeClient('tenant'),
      migrate: async () => {},
      logger: { info() {}, warn() {}, error() {} },
    });

    await assert.rejects(svc.provision('inst-1', 'Escritório'), /Não foi possível criar o banco próprio/);
    assert.deepEqual(deleted, ['proj-1']);
    assert.equal(mappings[0].status, 'failed');
    assert.equal(svc.hasDedicated(), false);
    assert.equal(svc.dedicatedClient('inst-1'), null);
  });

  test('disabled: provision is a no-op', async () => {
    const svc = new InstanceDatabaseService({ ...cfg, enabled: false }, null);
    await svc.provision('x', 'y');
    assert.equal(svc.enabled, false);
    assert.equal(svc.hasDedicated(), false);
  });

  test('init: loads ready mappings, migrates, never falls back on a bad key', async () => {
    const { control, mappings } = controlWithMappings();
    mappings.push(
      { id: 'm1', instanceId: 'A', status: 'ready', connectionUri: seal('postgresql://a:pw@h/a', key) },
      { id: 'm2', instanceId: 'B', status: 'ready', connectionUri: seal('postgresql://b:pw@h/b', deriveKey('outra')) },
    );
    const clients: string[] = [];
    const svc = new InstanceDatabaseService(cfg, {
      control,
      neon: null,
      encryptionKey: key,
      createClient: (url) => {
        clients.push(url);
        return fakeClient(url);
      },
      migrate: async () => {
        throw new Error('compute suspenso');
      },
      logger: { info() {}, warn() {}, error() {} },
    });
    await svc.init();
    assert.equal(clients.length, 1);
    assert.ok(svc.dedicatedClient('A'), 'A still routes to its own database even if migrations failed');
    assert.equal(svc.dedicatedClient('B'), null);
    assert.equal(svc.status('B'), 'failed');
  });

  test('quota: Neon project count, cached 1 min, "own" while there is room; Neon down -> estimate', async () => {
    const { control } = controlWithMappings();
    let calls = 0;
    let count = 3;
    let down = false;
    const neon = {
      countProjects: async () => {
        calls++;
        if (down) throw new Error('Neon: HTTP 503');
        return count;
      },
    } as unknown as NeonClient;
    const svc = new InstanceDatabaseService(
      { ...cfg, projectLimit: 100 },
      {
        control,
        neon,
        encryptionKey: key,
        createClient: () => fakeClient('t'),
        migrate: async () => undefined,
        logger: { info() {}, warn() {}, error() {} },
      },
    );

    const q = await svc.quota();
    assert.deepEqual(
      { used: q.used, remaining: q.remaining, limit: q.limit, mode: q.defaultMode, source: q.source },
      { used: 3, remaining: 97, limit: 100, mode: 'own', source: 'neon' },
    );
    await svc.quota();
    assert.equal(calls, 1, 'second read comes from the cache');

    count = 100;
    const full = await svc.quota(true);
    assert.equal(full.remaining, 0);
    assert.equal(full.defaultMode, 'shared');

    down = true;
    const est = await svc.quota(true);
    assert.equal(est.source, 'estimate');
    assert.equal(est.used, 1, 'no own instance yet: only the main project');
  });

  test('provision refuses before creating anything when the Neon project limit is reached', async () => {
    const { control, mappings } = controlWithMappings();
    const created: string[] = [];
    const neon = {
      countProjects: async () => 100,
      createProject: async (name: string) => {
        created.push(name);
        return { projectId: 'p', regionId: 'r', connectionUri: 'postgresql://x' };
      },
    } as unknown as NeonClient;
    const svc = new InstanceDatabaseService(
      { ...cfg, projectLimit: 100 },
      {
        control,
        neon,
        encryptionKey: key,
        createClient: () => fakeClient('t'),
        migrate: async () => undefined,
        logger: { info() {}, warn() {}, error() {} },
      },
    );
    await assert.rejects(svc.provision('inst-1', 'Escritório'), /limite de 100 projetos/);
    assert.deepEqual(created, []);
    assert.equal(mappings.length, 0);
    assert.equal(svc.status('inst-1'), 'shared');
  });

  test('quota when the feature is off: shared, no Neon call', async () => {
    const svc = new InstanceDatabaseService({ ...cfg, enabled: false }, null);
    const q = await svc.quota();
    assert.equal(q.enabled, false);
    assert.equal(q.defaultMode, 'shared');
    assert.equal(q.source, 'off');
  });
});

describe('instance-db: Neon client', () => {
  test('createProject sends region, pg version, CU cap and org; parses the URI', async () => {
    const posts: any[] = [];
    const http: any = {
      post: async (url: string, body: any) => {
        posts.push({ url, body });
        return {
          data: {
            project: { id: 'p-1', region_id: 'aws-us-east-2' },
            connection_uris: [{ connection_uri: 'postgresql://u:p@ep/neondb' }],
          },
        };
      },
      get: async () => ({ data: { operations: [{ status: 'finished' }, { status: 'skipped' }] } }),
      delete: async () => {
        const e: any = new Error('nf');
        e.response = { status: 404 };
        throw e;
      },
    };
    const client = new NeonClient(
      { apiKey: 'k', orgId: 'org-1', regionId: 'aws-us-east-2', pgVersion: 16, maxCu: 0.25 },
      http,
    );
    const p = await client.createProject('whatsai-x');
    assert.deepEqual(p, { projectId: 'p-1', regionId: 'aws-us-east-2', connectionUri: 'postgresql://u:p@ep/neondb' });
    assert.equal(posts[0].body.project.org_id, 'org-1');
    assert.equal(posts[0].body.project.pg_version, 16);
    assert.equal(posts[0].body.project.default_endpoint_settings.autoscaling_limit_max_cu, 0.25);
    await client.waitForOperations('p-1', 1000, 1);
    await client.deleteProject('p-1'); // 404 is fine
  });

  test('createProject surfaces API errors without the key', async () => {
    const http: any = {
      post: async () => {
        const e: any = new Error('boom');
        e.response = { status: 422, data: { message: 'projects limit exceeded' } };
        throw e;
      },
    };
    const client = new NeonClient({ apiKey: 'segredo', regionId: 'r', pgVersion: 16, maxCu: 0.25 }, http);
    await assert.rejects(client.createProject('x'), (e: Error) => {
      assert.match(e.message, /HTTP 422: projects limit exceeded/);
      assert.ok(!e.message.includes('segredo'));
      return true;
    });
  });
});
