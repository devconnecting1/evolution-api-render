import '../helpers/setup';

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { runWithInstance } from '@api/repository/instance-db/instance-context';
import { InstanceDatabaseService } from '@api/repository/instance-db/instance-db.service';
import { NeonClient } from '@api/repository/instance-db/neon.client';
import { createRoutedRepository } from '@api/repository/instance-db/routing';
import { deriveKey } from '@api/repository/instance-db/secret-box';
import { PrismaClient } from '@prisma/client';

import { migrateTestDatabase, SKIP_INTEGRATION } from '../helpers/integration';

const ROOT = resolve(__dirname, '..', '..');

/** `prisma migrate deploy` contra qualquer URL, a partir de uma cópia temporária das migrations. */
function migrate(url: string) {
  const dir = mkdtempSync(join(tmpdir(), 'evolution-idb-prisma-'));
  try {
    cpSync(join(ROOT, 'prisma', 'postgresql-schema.prisma'), join(dir, 'schema.prisma'));
    cpSync(join(ROOT, 'prisma', 'postgresql-migrations'), join(dir, 'migrations'), { recursive: true });
    execFileSync(
      join(ROOT, 'node_modules', '.bin', 'prisma'),
      ['migrate', 'deploy', '--schema', join(dir, 'schema.prisma')],
      {
        cwd: ROOT,
        env: { ...process.env, DATABASE_CONNECTION_URI: url, CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1' },
        stdio: 'pipe',
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Banco próprio por instância num PostgreSQL real: o "Neon" falso cria um database novo no mesmo
 * servidor; as migrations reais rodam nele; o roteador manda cada consulta para o banco certo.
 */
describe('instance-db (integration)', { skip: SKIP_INTEGRATION }, () => {
  const baseUrl = process.env.TEST_DATABASE_URL!;
  const tenantDbName = `evolution_tenant_${process.pid}`;
  const tenantUrl = baseUrl.replace(/\/[^/?]+(\?|$)/, `/${tenantDbName}$1`);
  let control: PrismaClient;
  let svc: InstanceDatabaseService<any>;
  let routed: PrismaClient;
  const clients: PrismaClient[] = [];
  const deletedProjects: string[] = [];

  const SHARED = `shared-${process.pid}`;
  const OWN = `own-${process.pid}`;

  before(async () => {
    migrateTestDatabase();
    control = new PrismaClient({ datasourceUrl: baseUrl });
    await control.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${tenantDbName}"`);

    const neon = {
      createProject: async () => {
        await control.$executeRawUnsafe(`CREATE DATABASE "${tenantDbName}"`);
        return { projectId: 'fake-project', regionId: 'local', connectionUri: tenantUrl };
      },
      waitForOperations: async () => undefined,
      deleteProject: async (id: string) => {
        deletedProjects.push(id);
      },
    } as unknown as NeonClient;

    svc = new InstanceDatabaseService<any>(
      { enabled: true, deleteOnRemove: false, migrateOnBoot: true, connectionLimit: 2, projectPrefix: 'test' },
      {
        control: control as any,
        neon,
        encryptionKey: deriveKey('integration'),
        createClient: (url) => {
          const c = new PrismaClient({ datasourceUrl: url });
          clients.push(c);
          return c as any;
        },
        migrate: async (url) => migrate(url),
        logger: { info() {}, warn() {}, error() {} },
      },
    );
    routed = createRoutedRepository(control, svc);

    for (const [id, name] of [
      [SHARED, `Compartilhada ${process.pid}`],
      [OWN, `Própria ${process.pid}`],
    ]) {
      await control.instance.create({ data: { id, name, integration: 'WHATSAPP-BAILEYS', connectionStatus: 'open' } });
    }
  });

  after(async () => {
    await svc?.disconnectAll();
    await Promise.all(clients.map((c) => c.$disconnect().catch(() => undefined)));
    await control?.instanceDatabase.deleteMany({ where: { instanceId: { in: [SHARED, OWN] } } }).catch(() => undefined);
    await control?.instance.deleteMany({ where: { id: { in: [SHARED, OWN] } } }).catch(() => undefined);
    await control?.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${tenantDbName}" WITH (FORCE)`).catch(() => undefined);
    await control?.$disconnect();
  });

  const msg = (instanceId: string, id: string) => ({
    key: { id, remoteJid: '5521999999999@s.whatsapp.net', fromMe: false },
    pushName: 'Cliente',
    messageType: 'conversation',
    message: { conversation: 'oi' },
    messageTimestamp: Math.floor(Date.now() / 1000),
    instanceId,
    source: 'android' as any,
  });

  test('before provisioning, everything stays in the main database', async () => {
    assert.equal(svc.hasDedicated(), false);
    await routed.message.create({ data: msg(SHARED, `a-${process.pid}`) });
    assert.equal(await control.message.count({ where: { instanceId: SHARED } }), 1);
  });

  test('provision creates a migrated database with the instance mirrored and an encrypted mapping', async () => {
    await svc.provision(OWN, `Própria ${process.pid}`);
    assert.equal(svc.status(OWN), 'ready');

    const mapping = await control.instanceDatabase.findUnique({ where: { instanceId: OWN } });
    assert.equal(mapping?.status, 'ready');
    assert.ok(mapping?.connectionUri.startsWith('enc:v1:'));
    assert.ok(!mapping?.connectionUri.includes(tenantDbName), 'URL is not stored in clear text');

    const tenant = new PrismaClient({ datasourceUrl: tenantUrl });
    clients.push(tenant);
    const mirrored = await tenant.instance.findUnique({ where: { id: OWN } });
    assert.equal(mirrored?.name, `Própria ${process.pid}`);
  });

  test('queries with instanceId go to the right database; shared instances are untouched', async () => {
    const tenant = new PrismaClient({ datasourceUrl: tenantUrl });
    clients.push(tenant);

    await routed.message.create({ data: msg(OWN, `b-${process.pid}`) });
    await routed.message.create({ data: msg(SHARED, `c-${process.pid}`) });

    assert.equal(await control.message.count({ where: { instanceId: OWN } }), 0, 'nothing leaks to the main database');
    assert.equal(await tenant.message.count({ where: { instanceId: OWN } }), 1);
    assert.equal(await control.message.count({ where: { instanceId: SHARED } }), 2);
    assert.equal(await routed.message.count({ where: { instanceId: OWN } }), 1);

    // update by id only: the instance context picks the database
    const row = await tenant.message.findFirst({ where: { instanceId: OWN } });
    await runWithInstance(OWN, () => routed.message.update({ where: { id: row!.id }, data: { status: 'READ' } }));
    assert.equal((await tenant.message.findUnique({ where: { id: row!.id } }))?.status, 'READ');

    // raw SQL follows the context too
    const raw = await runWithInstance(
      OWN,
      () => routed.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM "Message" WHERE "instanceId" = ${OWN}`,
    );
    assert.equal(Number(raw[0].n), 1);

    // auth keys (sessionId) and a batch transaction under the context
    await runWithInstance(OWN, () =>
      routed.$transaction([
        routed.authStateKey.deleteMany({ where: { sessionId: OWN, key: { in: ['k1'] } } }),
        routed.authStateKey.createMany({ data: [{ sessionId: OWN, key: 'k1', value: '{}' }] }),
      ]),
    );
    assert.equal(await tenant.authStateKey.count({ where: { sessionId: OWN } }), 1);
    assert.equal(await control.authStateKey.count({ where: { sessionId: OWN } }), 0);
  });

  test('instance listing: status from the main database, counts/relations from each own database', async () => {
    await routed.setting.create({ data: { instanceId: OWN, rejectCall: true, groupsIgnore: true } as any });
    const rows = await routed.instance.findMany({
      where: { id: { in: [SHARED, OWN] } },
      include: { Setting: true, _count: { select: { Message: true } } },
    });
    const own = rows.find((r) => r.id === OWN)!;
    const shared = rows.find((r) => r.id === SHARED)!;
    assert.equal(own.connectionStatus, 'open');
    assert.equal(own._count.Message, 1);
    assert.equal(own.Setting?.rejectCall, true);
    assert.equal(shared._count.Message, 2);
  });

  test('a restart reloads the mapping and keeps routing', async () => {
    const svc2 = new InstanceDatabaseService<any>(
      { enabled: false, deleteOnRemove: false, migrateOnBoot: true, connectionLimit: 2, projectPrefix: 'test' },
      {
        control: control as any,
        neon: null,
        encryptionKey: deriveKey('integration'),
        createClient: (url) => {
          const c = new PrismaClient({ datasourceUrl: url });
          clients.push(c);
          return c as any;
        },
        migrate: async (url) => migrate(url),
        logger: { info() {}, warn() {}, error() {} },
      },
    );
    await svc2.init();
    const routed2 = createRoutedRepository(control, svc2);
    assert.equal(await routed2.message.count({ where: { instanceId: OWN } }), 1);
    await svc2.disconnectAll();
  });

  test('release removes the instance data (cascade) and keeps the project by default', async () => {
    const tenant = new PrismaClient({ datasourceUrl: tenantUrl });
    clients.push(tenant);
    await svc.release(OWN);
    assert.equal(await tenant.instance.count({ where: { id: OWN } }), 0);
    assert.equal(await tenant.message.count({ where: { instanceId: OWN } }), 0);
    assert.equal((await control.instanceDatabase.findUnique({ where: { instanceId: OWN } }))?.status, 'detached');
    assert.deepEqual(deletedProjects, []);
    assert.equal(svc.hasDedicated(), false);
  });
});
