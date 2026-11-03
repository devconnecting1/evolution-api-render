import '../helpers/setup';

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { after, afterEach, before, beforeEach, describe, test } from 'node:test';

import { PrismaRepository } from '@api/repository/repository.service';
import { CacheService } from '@api/services/cache.service';
import { CacheConf, configService } from '@config/env.config';
import { INSTANCE_DIR } from '@config/path.config';
import useMultiFileAuthStatePrisma, { flushAuthKeyWrites } from '@utils/use-multi-file-auth-state-prisma';
import { BufferJSON, proto } from 'baileys';

import { createFakeRedis, createRedisCacheService, FakeRedis } from '../helpers/fake-redis';
import { nextId } from '../helpers/fakes';
import { migrateTestDatabase, SKIP_INTEGRATION } from '../helpers/integration';

/**
 * The durable Signal keys on a real PostgreSQL (migration applied with `prisma migrate deploy`): the real Prisma
 * transaction, createMany/skipDuplicates, the unique (sessionId, key) and the cascade from Instance. Redis is faked.
 */
describe('Prisma auth state: AuthStateKey on PostgreSQL (integration)', { skip: SKIP_INTEGRATION }, () => {
  const prisma = new PrismaRepository(configService);
  const instanceIds: string[] = [];
  let sessionId: string;
  let redis: FakeRedis;
  let cache: CacheService;
  let redisWasEnabled: boolean;

  const open = () => useMultiFileAuthStatePrisma(sessionId, cache, { prisma });
  const rows = () => prisma.authStateKey.findMany({ where: { sessionId } });

  before(async () => {
    migrateTestDatabase();
    await prisma.$connect();
  });

  beforeEach(async () => {
    const instance = await prisma.instance.create({
      data: { name: `auth-${nextId()}`.toLowerCase(), integration: 'WHATSAPP-BAILEYS', connectionStatus: 'open' },
    });
    sessionId = instance.id;
    instanceIds.push(sessionId);
    redis = createFakeRedis();
    cache = createRedisCacheService(redis);
    redisWasEnabled = configService.get<CacheConf>('CACHE').REDIS.ENABLED;
    configService.get<CacheConf>('CACHE').REDIS.ENABLED = true;
  });

  afterEach(async () => {
    await flushAuthKeyWrites(sessionId);
    configService.get<CacheConf>('CACHE').REDIS.ENABLED = redisWasEnabled;
  });

  after(async () => {
    await prisma.instance.deleteMany({ where: { id: { in: instanceIds } } });
    await prisma.$disconnect();
    await Promise.all(instanceIds.map((id) => rm(join(INSTANCE_DIR, id), { recursive: true, force: true })));
  });

  test('writes, overwrites, deletes and restores after Redis is wiped', async () => {
    const { state, saveCreds } = await open();
    await saveCreds();
    const first = new Uint8Array(randomBytes(400));
    const second = new Uint8Array(randomBytes(400));
    const appState = proto.Message.AppStateSyncKeyData.create({
      keyData: randomBytes(32),
      fingerprint: { rawId: 1, currentIndex: 1, deviceIndexes: [0] },
      timestamp: 1700000000,
    });

    await state.keys.set({
      session: { 'a.0': first },
      'pre-key': { '1': { public: randomBytes(33), private: randomBytes(32) } },
    } as any);
    await state.keys.set({
      session: { 'a.0': second },
      'pre-key': { '1': null },
      'app-state-sync-key': { K1: appState },
    } as any);

    const stored = await rows();
    assert.deepEqual(stored.map((row) => row.key).sort(), ['app-state-sync-key-K1', 'session-a.0']);
    assert.equal(stored.find((row) => row.key === 'session-a.0').value, JSON.stringify(second, BufferJSON.replacer));

    redis.hashes.clear();
    const session = await state.keys.get('session', ['a.0', 'b.0']);
    assert.ok(Buffer.from(second).equals(session['a.0']));
    assert.equal(session['b.0'], null);
    const key = (await state.keys.get('app-state-sync-key', ['K1']))['K1'];
    assert.ok(key.keyData instanceof Uint8Array && key.keyData.length === 32);
    assert.ok(Buffer.from(key.keyData).equals(Buffer.from(appState.keyData)));
  });

  test('a batch of 812 pre-keys (first registration) is one transaction', async () => {
    const { state } = await open();
    const preKeys: Record<string, any> = {};
    for (let id = 1; id <= 812; id++) preKeys[id] = { public: randomBytes(33), private: randomBytes(32) };

    const started = Date.now();
    await state.keys.set({ 'pre-key': preKeys } as any);
    const elapsed = Date.now() - started;

    assert.equal(await prisma.authStateKey.count({ where: { sessionId } }), 812);
    assert.ok(elapsed < 5000, `took ${elapsed} ms`);
  });

  test('backfill copies the Redis hash of a paired session, once', async () => {
    const { saveCreds } = await open();
    await saveCreds();
    for (let id = 1; id <= 50; id++) await cache.hSet(sessionId, `session-${id}.0`, new Uint8Array(randomBytes(200)));
    await prisma.authStateKey.deleteMany({ where: { sessionId } });

    await open();
    assert.equal(await prisma.authStateKey.count({ where: { sessionId } }), 50);

    await cache.hSet(sessionId, 'session-extra.0', new Uint8Array(randomBytes(200)));
    await open();
    assert.equal(await prisma.authStateKey.count({ where: { sessionId } }), 50, 'not copied a second time');
  });

  test('deleting the instance deletes its keys (cascade)', async () => {
    const { state } = await open();
    await state.keys.set({ session: { 'z.0': new Uint8Array([1, 2, 3]) } } as any);
    assert.equal((await rows()).length, 1);

    await prisma.instance.delete({ where: { id: sessionId } });

    assert.equal((await rows()).length, 0);
  });
});
