import '../helpers/setup';

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { PrismaRepository } from '@api/repository/repository.service';
import { SystemProbe } from '@api/services/observability.system';
import { configService } from '@config/env.config';

import { nextId } from '../helpers/fakes';
import { migrateTestDatabase, SKIP_INTEGRATION } from '../helpers/integration';

/**
 * The "Sistema" card on a real PostgreSQL: the raw SQL (pg_database_size, JSON ->> filters) and the Prisma
 * groupBy/count calls must work against the real schema. Other suites write to the same database in parallel,
 * so everything runs in one REPEATABLE READ transaction (a fixed snapshot plus our own writes) that is rolled
 * back at the end: the before/after deltas are exact and nothing is left behind.
 */
const ROLLBACK = new Error('rollback');

describe('observability: Sistema on a real database (integration)', { skip: SKIP_INTEGRATION }, () => {
  const prisma = new PrismaRepository(configService);
  const probe = (client: any) =>
    new SystemProbe({ prisma: client, waInstances: () => ({}), databaseProvider: 'postgresql' });

  before(async () => {
    migrateTestDatabase();
    await prisma.$connect();
  });

  after(async () => {
    await prisma.$disconnect();
  });

  test('counts instances, messages of the last 24h and chatbot sessions (human and manual pauses)', async () => {
    try {
      await prisma.$transaction(
        async (tx) => {
          await check(tx);
          throw ROLLBACK;
        },
        { isolationLevel: 'RepeatableRead', timeout: 30_000 },
      );
      assert.fail('the transaction must be rolled back');
    } catch (error) {
      if (error !== ROLLBACK) throw error;
    }
  });

  async function check(tx: any) {
    const value = (view: any, id: string) => view.metrics.find((item: any) => item.id === id).used;
    const before = await probe(tx).collect();
    assert.equal(before.resources.find((item) => item.id === 'database').status, 'conectado');
    assert.ok(value(before, 'database_size') > 0);

    const instance = await tx.instance.create({
      data: { name: `obs-${nextId()}`.toLowerCase(), integration: 'WHATSAPP-BAILEYS', connectionStatus: 'close' },
    });
    const instanceId = instance.id;
    const now = Math.floor(Date.now() / 1000);
    await tx.message.createMany({
      data: [now - 60, now - 2 * 24 * 3600].map((timestamp) => ({
        key: { id: nextId() },
        messageType: 'conversation',
        message: { conversation: 'x' },
        source: 'unknown' as const,
        messageTimestamp: timestamp,
        instanceId,
      })),
    });
    const session = (status: 'opened' | 'paused' | 'closed', parameters: any = null) => ({
      sessionId: nextId(),
      remoteJid: `${nextId()}@s.whatsapp.net`,
      status,
      instanceId,
      parameters,
    });
    await tx.integrationSession.createMany({
      data: [
        session('opened'),
        session('paused', { humanLastMessageAt: new Date().toISOString() }),
        session('opened', { humanLastMessageAt: new Date().toISOString() }),
        session('paused', { manualPause: true }),
        session('closed', { humanLastMessageAt: new Date().toISOString() }),
      ],
    });

    const afterView = await probe(tx).collect();
    const delta = (id: string) => value(afterView, id) - value(before, id);

    assert.deepEqual(
      afterView.notes.filter((note) => /Não foi possível/.test(note)),
      [],
    );
    assert.equal(delta('messages_24h'), 1);
    assert.equal(delta('chatbot_sessions'), 4);
    assert.equal(delta('human_paused'), 2);
    const instances = afterView.metrics.find((item) => item.id === 'instances');
    assert.equal(instances.limit - (before.metrics.find((item) => item.id === 'instances').limit ?? 0), 1);
    assert.equal(instances.status, 'warning');
    assert.equal(afterView.status, 'partial');
    assert.match(afterView.metrics.find((item) => item.id === 'human_paused').detail, /pausa\(s\) manual/);

    // WhatsApp card: the select/orderBy of the per-instance list run on the real schema
    await tx.instance.update({
      where: { id: instanceId },
      data: { disconnectionReasonCode: 401, disconnectionAt: new Date() },
    });
    const whatsapp = await probe(tx).collectWhatsapp();
    const row = whatsapp.resources.find((item) => item.name === instance.name);
    assert.equal(row.status, 'desconectada');
    assert.equal(row.url, `/manager/instance/${instanceId}/dashboard`);
    assert.match(row.detail, /sessão encerrada no celular/);
    assert.equal(whatsapp.status, 'partial');
  }
});
