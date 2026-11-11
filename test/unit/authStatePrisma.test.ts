import '../helpers/setup';

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { after, afterEach, beforeEach, describe, test } from 'node:test';

import { CacheService } from '@api/services/cache.service';
import { WAMonitoringService } from '@api/services/monitor.service';
import { CacheConf, configService, Database } from '@config/env.config';
import { INSTANCE_DIR } from '@config/path.config';
import useMultiFileAuthStatePrisma, { flushAuthKeyWrites } from '@utils/use-multi-file-auth-state-prisma';
import { useMultiFileAuthStateRedisDb } from '@utils/use-multi-file-auth-state-redis-db';
import { BufferJSON, initAuthCreds, proto } from 'baileys';
import EventEmitter2 from 'eventemitter2';

import { createFakeRedis, createRedisCacheService as createCache, FakeRedis } from '../helpers/fake-redis';
import { nextId, sleep } from '../helpers/fakes';

/**
 * Durable Signal keys of the Prisma auth state: every key but `creds` lives in Redis AND in the AuthStateKey table,
 * so a Redis restart or an LRU eviction no longer loses the WhatsApp session. Real CacheService + RedisCache over a
 * fake Redis client (same double encoding as production), fake Prisma, no network.
 */

/** A Prisma result that, like the real one, only runs when awaited (so $transaction controls the order). */
function lazy<T>(fn: () => Promise<T> | T) {
  let promise: Promise<T>;
  return { then: (resolve: any, reject: any) => (promise ??= Promise.resolve().then(fn)).then(resolve, reject) };
}

function createPrisma() {
  const sessions = new Map<string, { sessionId: string; creds: string }>();
  const keys = new Map<string, { sessionId: string; key: string; value: string; updatedAt: Date }>();
  const calls: Record<string, number> = {};
  const state = { failWrites: false, failReads: false, delayMs: 0 };
  const id = (sessionId: string, key: string) => `${sessionId}\u0000${key}`;

  const op = <T>(name: string, kind: 'read' | 'write', fn: () => T) =>
    lazy(async () => {
      calls[name] = (calls[name] ?? 0) + 1;
      if (state.delayMs) await sleep(state.delayMs);
      if (kind === 'write' && state.failWrites) throw new Error('database down (write)');
      if (kind === 'read' && state.failReads) throw new Error('database down (read)');
      return fn();
    });

  const prisma: any = {
    sessions,
    keys,
    calls,
    state,
    session: {
      findUnique: ({ where }: any) => op('session.findUnique', 'read', () => sessions.get(where.sessionId) ?? null),
      create: ({ data }: any) => op('session.create', 'write', () => (sessions.set(data.sessionId, data), data)),
      update: ({ where, data }: any) =>
        op('session.update', 'write', () => Object.assign(sessions.get(where.sessionId), data)),
      delete: ({ where }: any) => op('session.delete', 'write', () => sessions.delete(where.sessionId)),
    },
    authStateKey: {
      count: ({ where }: any) =>
        op(
          'authStateKey.count',
          'read',
          () => [...keys.values()].filter((r) => r.sessionId === where.sessionId).length,
        ),
      findMany: ({ where }: any) =>
        op('authStateKey.findMany', 'read', () =>
          (where.key.in as string[])
            .map((key) => keys.get(id(where.sessionId, key)))
            .filter(Boolean)
            .map(({ key, value }) => ({ key, value })),
        ),
      deleteMany: ({ where }: any) =>
        op('authStateKey.deleteMany', 'write', () => {
          let count = 0;
          for (const [k, row] of keys) {
            if (row.sessionId === where.sessionId && (!where.key || where.key.in.includes(row.key))) {
              keys.delete(k);
              count++;
            }
          }
          return { count };
        }),
      createMany: ({ data, skipDuplicates }: any) =>
        op('authStateKey.createMany', 'write', () => {
          let count = 0;
          for (const row of data) {
            if (keys.has(id(row.sessionId, row.key))) {
              if (skipDuplicates) continue;
              throw new Error('Unique constraint failed on the fields: (`sessionId`,`key`)');
            }
            keys.set(id(row.sessionId, row.key), { ...row, updatedAt: new Date() });
            count++;
          }
          return { count };
        }),
    },
    // Sequential and atomic, like a database transaction
    $transaction: async (ops: any[]) => {
      const snapshot = new Map(keys);
      try {
        const results = [];
        for (const operation of ops) results.push(await operation);
        return results;
      } catch (error) {
        keys.clear();
        for (const [k, v] of snapshot) keys.set(k, v);
        throw error;
      }
    },
    rowValue: (sessionId: string, key: string) => keys.get(id(sessionId, key))?.value,
    rowCount: (sessionId: string) => [...keys.values()].filter((r) => r.sessionId === sessionId).length,
  };
  return prisma;
}

/** A session already paired: creds in the Session table, stored the way saveKey stores them. */
function pairedSession(prisma: any, sessionId: string) {
  const creds = initAuthCreds();
  prisma.sessions.set(sessionId, { sessionId, creds: JSON.stringify(JSON.stringify(creds, BufferJSON.replacer)) });
  return creds;
}

/** Baileys-like key values of every kind, with Buffers and Uint8Arrays. */
function sampleKeys() {
  return {
    'pre-key': { '17': { public: randomBytes(33), private: randomBytes(32) } },
    session: { '5511988887777.0': new Uint8Array(randomBytes(420)) },
    'sender-key': { '120363000000000000@g.us::5511988887777::0': new Uint8Array(randomBytes(160)) },
    'lid-mapping': { '5511988887777': '123456789012345' },
    'device-list': { '5511988887777': ['0', '12'] },
    tctoken: { '5511988887777@s.whatsapp.net': { token: randomBytes(24), timestamp: '1700000000' } },
  };
}

const redisConf = () => configService.get<CacheConf>('CACHE').REDIS;
const createdDirs: string[] = [];

describe('Prisma auth state: durable Signal keys', () => {
  let sessionId: string;
  let redis: FakeRedis;
  let cache: CacheService;
  let prisma: any;
  let redisWasEnabled: boolean;

  const hashKey = () => `evolution:instance:${sessionId}`;
  const open = (opts: Record<string, any> = {}) => useMultiFileAuthStatePrisma(sessionId, cache, { prisma, ...opts });

  beforeEach(() => {
    sessionId = nextId('inst');
    createdDirs.push(join(INSTANCE_DIR, sessionId));
    redis = createFakeRedis();
    cache = createCache(redis);
    prisma = createPrisma();
    redisWasEnabled = redisConf().ENABLED;
    redisConf().ENABLED = true;
  });

  afterEach(async () => {
    await flushAuthKeyWrites(sessionId);
    redisConf().ENABLED = redisWasEnabled;
  });

  after(async () => {
    await Promise.all(createdDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  test('a write goes to Redis and to the table, as the exact BufferJSON string', async () => {
    pairedSession(prisma, sessionId);
    const { state } = await open();
    const data = sampleKeys();

    await state.keys.set(data as any);

    for (const [type, values] of Object.entries(data)) {
      for (const [id, value] of Object.entries(values)) {
        const key = `${type}-${id}`;
        assert.ok(redis.hashes.get(hashKey())?.has(key), `${key} in Redis`);
        assert.equal(prisma.rowValue(sessionId, key), JSON.stringify(value, BufferJSON.replacer), `${key} in DB`);
      }
    }
    // One transaction per batch: one delete + one insert, whatever the number of keys
    assert.equal(prisma.calls['authStateKey.deleteMany'], 1);
    assert.equal(prisma.calls['authStateKey.createMany'], 1);
  });

  test('a read is served by Redis without touching the table', async () => {
    pairedSession(prisma, sessionId);
    const { state } = await open();
    const value = { public: randomBytes(33), private: randomBytes(32) };
    await state.keys.set({ 'pre-key': { '1': value } } as any);

    const result = await state.keys.get('pre-key', ['1']);

    assert.ok(Buffer.from(result['1'].public).equals(value.public));
    assert.equal(prisma.calls['authStateKey.findMany'] ?? 0, 0);
  });

  test('Redis lost the key: read from the table, put back in Redis (one query for the whole batch)', async () => {
    pairedSession(prisma, sessionId);
    const { state } = await open();
    const a = new Uint8Array(randomBytes(300));
    const b = new Uint8Array(randomBytes(300));
    await state.keys.set({ session: { 'a.0': a, 'b.0': b } } as any);

    redis.hashes.clear(); // Redis restarted without persistence / LRU eviction

    const result = await state.keys.get('session', ['a.0', 'b.0', 'unknown.0']);

    assert.ok(Buffer.from(a).equals(result['a.0']));
    assert.ok(Buffer.from(b).equals(result['b.0']));
    assert.equal(result['unknown.0'], null);
    assert.equal(prisma.calls['authStateKey.findMany'], 1);
    assert.ok(redis.hashes.get(hashKey()).has('session-a.0'), 'repopulated in Redis');
    assert.ok(redis.hashes.get(hashKey()).has('session-b.0'), 'repopulated in Redis');

    // The next read is served by Redis again
    await state.keys.get('session', ['a.0']);
    assert.equal(prisma.calls['authStateKey.findMany'], 1);
  });

  test('a key found nowhere is asked to the table once, until a write creates it (Neon stays asleep)', async () => {
    pairedSession(prisma, sessionId);
    const { state } = await open();

    for (let i = 0; i < 5; i++) {
      const result = await state.keys.get('session', ['never-seen.0']);
      assert.equal(result['never-seen.0'], null);
    }
    assert.equal(prisma.calls['authStateKey.findMany'], 1, 'only the first miss reads the table');

    // Baileys stores it: the memory is dropped and the value is served (by Redis)
    const value = new Uint8Array(randomBytes(64));
    await state.keys.set({ session: { 'never-seen.0': value } } as any);
    const after = await state.keys.get('session', ['never-seen.0']);
    assert.ok(Buffer.from(value).equals(after['never-seen.0']));

    // Redis loses it: the table is asked again (the memory was cleared by the write)
    redis.hashes.clear();
    const restored = await state.keys.get('session', ['never-seen.0']);
    assert.ok(Buffer.from(value).equals(restored['never-seen.0']));
    assert.equal(prisma.calls['authStateKey.findMany'], 2);
  });

  test('a failed table read is not remembered as "absent": the next ask tries the table again', async () => {
    pairedSession(prisma, sessionId);
    const { state } = await open();
    prisma.state.failReads = true;
    await state.keys.get('sender-key', ['group@g.us::x::0']);
    prisma.state.failReads = false;
    await state.keys.get('sender-key', ['group@g.us::x::0']);
    assert.equal(prisma.calls['authStateKey.findMany'], 2);
  });

  test('Redis down: reads and writes still work through the table', async () => {
    pairedSession(prisma, sessionId);
    const { state } = await open();
    redis.state.down = true;
    const value = new Uint8Array(randomBytes(64));

    await state.keys.set({ 'sender-key': { 'g::u::0': value } } as any);
    const result = await state.keys.get('sender-key', ['g::u::0']);

    assert.ok(Buffer.from(value).equals(result['g::u::0']));
  });

  test('a database failure on write never throws into Baileys and Redis is still written', async () => {
    pairedSession(prisma, sessionId);
    const { state } = await open();
    prisma.state.failWrites = true;
    const value = new Uint8Array(randomBytes(64));

    await assert.doesNotReject(async () => state.keys.set({ session: { 'x.0': value } } as any));

    assert.ok(redis.hashes.get(hashKey()).has('session-x.0'));
    assert.equal(prisma.rowCount(sessionId), 0);
    const result = await state.keys.get('session', ['x.0']);
    assert.ok(Buffer.from(value).equals(result['x.0']));
  });

  test('a database failure on read is a miss, not an exception', async () => {
    pairedSession(prisma, sessionId);
    const { state } = await open();
    prisma.state.failReads = true;

    const result = await state.keys.get('session', ['nobody.0']);

    assert.deepEqual(result, { 'nobody.0': null });
  });

  test('a slow database does not hold Baileys past the timeout, and the write still lands, in order', async () => {
    pairedSession(prisma, sessionId);
    const { state } = await open({ dbTimeoutMs: 20 });
    prisma.state.delayMs = 150;

    const started = Date.now();
    await state.keys.set({ session: { 'k.0': new Uint8Array([1, 1, 1]) } } as any);
    await state.keys.set({ session: { 'k.0': new Uint8Array([2, 2, 2]) } } as any);
    assert.ok(Date.now() - started < 250, `set waited ${Date.now() - started} ms`);

    await flushAuthKeyWrites(sessionId);
    assert.equal(
      prisma.rowValue(sessionId, 'session-k.0'),
      JSON.stringify(new Uint8Array([2, 2, 2]), BufferJSON.replacer),
      'the last write wins',
    );
  });

  test('a null value deletes the key from Redis and from the table', async () => {
    pairedSession(prisma, sessionId);
    const { state } = await open();
    await state.keys.set({ 'pre-key': { '5': { public: randomBytes(33), private: randomBytes(32) } } } as any);

    await state.keys.set({ 'pre-key': { '5': null } } as any);

    assert.equal(redis.hashes.get(hashKey()).has('pre-key-5'), false);
    assert.equal(prisma.rowCount(sessionId), 0);
    assert.deepEqual(await state.keys.get('pre-key', ['5']), { '5': null });
  });

  test('Buffers round-trip identically after Redis is wiped (every Baileys key kind)', async () => {
    pairedSession(prisma, sessionId);
    const { state } = await open();
    const data = sampleKeys();
    await state.keys.set(data as any);

    redis.hashes.clear();

    for (const [type, values] of Object.entries(data)) {
      const result = await state.keys.get(type as any, Object.keys(values));
      for (const [id, original] of Object.entries(values)) {
        const restored = result[id];
        // Same bytes and same shape: what Baileys gets back is what it stored
        assert.equal(
          JSON.stringify(restored, BufferJSON.replacer),
          JSON.stringify(original, BufferJSON.replacer),
          `${type}-${id}`,
        );
        if (original instanceof Uint8Array)
          assert.ok(Buffer.isBuffer(restored) && Buffer.from(original).equals(restored));
      }
    }
    const preKey = (await state.keys.get('pre-key', ['17']))['17'];
    assert.ok(Buffer.isBuffer(preKey.public) && preKey.public.equals(data['pre-key']['17'].public));
    assert.ok(Buffer.isBuffer(preKey.private) && preKey.private.equals(data['pre-key']['17'].private));
  });

  test('backfill: a paired session with keys only in Redis gets them copied to the table on start', async () => {
    pairedSession(prisma, sessionId);
    const data = sampleKeys();
    for (const [type, values] of Object.entries(data)) {
      for (const [id, value] of Object.entries(values)) await cache.hSet(sessionId, `${type}-${id}`, value);
    }
    const fields = redis.hashes.get(hashKey()).size;

    const { state } = await open();

    assert.equal(prisma.rowCount(sessionId), fields);
    for (const [type, values] of Object.entries(data)) {
      for (const [id, value] of Object.entries(values)) {
        assert.equal(prisma.rowValue(sessionId, `${type}-${id}`), JSON.stringify(value, BufferJSON.replacer));
      }
    }

    // And they survive losing Redis
    redis.hashes.clear();
    const result = await state.keys.get('session', ['5511988887777.0']);
    assert.ok(Buffer.from(data.session['5511988887777.0']).equals(result['5511988887777.0']));
  });

  test('backfill runs once: a table that already has rows is left alone', async () => {
    pairedSession(prisma, sessionId);
    const { state } = await open();
    await state.keys.set({ 'pre-key': { '1': { public: randomBytes(33), private: randomBytes(32) } } } as any);
    await cache.hSet(sessionId, 'pre-key-2', { public: randomBytes(33), private: randomBytes(32) });

    await open();

    assert.equal(prisma.rowCount(sessionId), 1);
    assert.equal(prisma.calls['authStateKey.createMany'], 1);
  });

  test('no backfill for new creds: keys left in Redis by an old pairing are not made durable', async () => {
    await cache.hSet(sessionId, 'session-old.0', new Uint8Array(randomBytes(32)));

    await open();

    assert.ok(prisma.sessions.has(sessionId), 'fresh creds saved');
    assert.equal(prisma.rowCount(sessionId), 0);
  });

  test('backfill failure does not prevent the instance from starting', async () => {
    pairedSession(prisma, sessionId);
    await cache.hSet(sessionId, 'session-a.0', new Uint8Array(randomBytes(32)));
    prisma.state.failWrites = true;

    const { state } = await open();

    assert.ok(state.creds);
    assert.equal(prisma.rowCount(sessionId), 0);
  });

  test('removeCreds deletes the durable keys too', async () => {
    pairedSession(prisma, sessionId);
    const { state, removeCreds } = await open();
    await state.keys.set(sampleKeys() as any);
    assert.ok(prisma.rowCount(sessionId) > 0);

    await removeCreds();

    assert.equal(prisma.rowCount(sessionId), 0);
    assert.equal(redis.hashes.has(hashKey()), false);
  });

  test('creds stay in the Session table, never in AuthStateKey', async () => {
    const { state, saveCreds } = await open();
    (state.creds as any).registrationId = 4242;

    await saveCreds();

    const stored = JSON.parse(JSON.parse(prisma.sessions.get(sessionId).creds), BufferJSON.reviver);
    assert.equal(stored.registrationId, 4242);
    assert.ok(Buffer.isBuffer(stored.noiseKey.private));
    assert.equal(prisma.rowCount(sessionId), 0);
  });

  test('creds.update with nothing changed does not touch the database (Neon stays asleep)', async () => {
    pairedSession(prisma, sessionId);
    const { state, saveCreds } = await open();
    const writes = () => (prisma.calls['session.update'] ?? 0) + (prisma.calls['session.create'] ?? 0);
    const reads = () => prisma.calls['session.findUnique'] ?? 0;
    const readsAfterOpen = reads();

    await saveCreds();
    await saveCreds();
    assert.equal(writes(), 0, 'same bytes as the row: skipped');
    assert.equal(reads(), readsAfterOpen, 'not even the existence check');

    (state.creds as any).routingInfo = Buffer.from([1, 2, 3]);
    await saveCreds();
    assert.equal(writes(), 1, 'a real change is written');
    await saveCreds();
    assert.equal(writes(), 1, 'and only once');
  });

  test('a failed creds write is retried on the next save, even with the same bytes', async () => {
    const { state, saveCreds } = await open();
    const updates = () => prisma.calls['session.update'] ?? 0;
    (state.creds as any).registrationId = 7;
    prisma.state.failWrites = true;
    await saveCreds();
    prisma.state.failWrites = false;
    const before = updates();
    await saveCreds();
    assert.equal(updates(), before + 1);
    const stored = JSON.parse(JSON.parse(prisma.sessions.get(sessionId).creds), BufferJSON.reviver);
    assert.equal(stored.registrationId, 7);
  });

  test('without Redis (local files) the keys are written through and restored from the table too', async () => {
    redisConf().ENABLED = false;
    pairedSession(prisma, sessionId);
    const { state } = await open();
    const value = new Uint8Array(randomBytes(48));
    await state.keys.set({ session: { 'f.0': value } } as any);
    assert.equal(prisma.rowValue(sessionId, 'session-f.0'), JSON.stringify(value, BufferJSON.replacer));

    await rm(join(INSTANCE_DIR, sessionId), { recursive: true, force: true }); // ephemeral disk wiped by a deploy
    const reopened = await open();
    const result = await reopened.state.keys.get('session', ['f.0']);

    assert.ok(Buffer.from(value).equals(result['f.0']));
  });
});

describe('app-state-sync-key is rebuilt with fromObject (#2576)', () => {
  let redisWasEnabled: boolean;
  beforeEach(() => {
    redisWasEnabled = redisConf().ENABLED;
    redisConf().ENABLED = true;
  });
  afterEach(() => {
    redisConf().ENABLED = redisWasEnabled;
  });

  const appStateKey = () =>
    proto.Message.AppStateSyncKeyData.create({
      keyData: randomBytes(32),
      fingerprint: { rawId: 7, currentIndex: 3, deviceIndexes: [0, 1] },
      timestamp: 1700000000,
    });

  const assertKeyData = (value: any, original: proto.Message.IAppStateSyncKeyData) => {
    assert.ok(value instanceof proto.Message.AppStateSyncKeyData);
    assert.ok(value.keyData instanceof Uint8Array, `keyData is ${typeof value.keyData}`);
    assert.equal(value.keyData.length, 32);
    assert.ok(Buffer.from(value.keyData).equals(Buffer.from(original.keyData)));
    assert.equal(value.fingerprint.rawId, 7);
    assert.deepEqual(value.fingerprint.deviceIndexes, [0, 1]);
  };

  test('the stored form is the protobuf JSON (base64 keyData): create() would keep a string', () => {
    const stored = JSON.parse(JSON.stringify(appStateKey(), BufferJSON.replacer), BufferJSON.reviver);
    assert.equal(typeof stored.keyData, 'string');
    assert.equal(typeof proto.Message.AppStateSyncKeyData.create(stored).keyData, 'string');
  });

  test('Prisma auth state: 32-byte keyData from Redis and from the table', async () => {
    const sessionId = nextId('inst');
    createdDirs.push(join(INSTANCE_DIR, sessionId));
    const redis = createFakeRedis();
    const cache = createCache(redis);
    const prisma = createPrisma();
    pairedSession(prisma, sessionId);
    const { state } = await useMultiFileAuthStatePrisma(sessionId, cache, { prisma });
    const original = appStateKey();

    await state.keys.set({ 'app-state-sync-key': { AAAAAQ: original } } as any);
    assertKeyData((await state.keys.get('app-state-sync-key', ['AAAAAQ']))['AAAAAQ'], original);

    redis.hashes.clear();
    assertKeyData((await state.keys.get('app-state-sync-key', ['AAAAAQ']))['AAAAAQ'], original);
  });

  test('Redis auth state (CACHE_REDIS_SAVE_INSTANCES): 32-byte keyData', async () => {
    const cache = createCache(createFakeRedis());
    const { state } = await useMultiFileAuthStateRedisDb(nextId('inst'), cache);
    const original = appStateKey();

    await state.keys.set({ 'app-state-sync-key': { AAAAAg: original } } as any);

    assertKeyData((await state.keys.get('app-state-sync-key', ['AAAAAg']))['AAAAAg'], original);
  });
});

describe('logout clean-up removes the durable keys', () => {
  test('cleaningUp deletes AuthStateKey rows and the Redis hash with the creds', async () => {
    const cacheConf = configService.get<CacheConf>('CACHE').REDIS;
    const saveData = configService.get<Database>('DATABASE').SAVE_DATA;
    const previous = { redis: cacheConf.ENABLED, save: cacheConf.SAVE_INSTANCES, instance: saveData.INSTANCE };
    cacheConf.ENABLED = true;
    cacheConf.SAVE_INSTANCES = false;
    saveData.INSTANCE = true;
    try {
      const instanceId = nextId('inst');
      const redis = createFakeRedis();
      const cache = createCache(redis);
      await cache.hSet(instanceId, 'session-a.0', new Uint8Array([1]));
      const deleted: string[] = [];
      const prisma: any = {
        instance: {
          findFirst: async () => ({ id: instanceId }),
          update: async () => ({ id: instanceId }),
        },
        session: { deleteMany: async ({ where }: any) => deleted.push(`session:${where.sessionId}`) },
        authStateKey: { deleteMany: async ({ where }: any) => deleted.push(`authStateKey:${where.sessionId}`) },
      };
      const monitor = new WAMonitoringService(new EventEmitter2(), configService, prisma, null, cache, null, null);

      await monitor.cleaningUp('law-office');

      assert.deepEqual(deleted, [`session:${instanceId}`, `authStateKey:${instanceId}`]);
      assert.equal(redis.hashes.has(`evolution:instance:${instanceId}`), false);
    } finally {
      cacheConf.ENABLED = previous.redis;
      cacheConf.SAVE_INSTANCES = previous.save;
      saveData.INSTANCE = previous.instance;
    }
  });
});
