import { runWithInstance } from '@api/repository/instance-db/instance-context';
import { prismaRepository } from '@api/server.module';
import { CacheService } from '@api/services/cache.service';
import { CacheConf, configService } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { INSTANCE_DIR } from '@config/path.config';
import { PrismaClient } from '@prisma/client';
import { AuthenticationState, BufferJSON, initAuthCreds, WAProto as proto } from 'baileys';
import fs from 'fs/promises';
import path from 'path';

/**
 * Auth state of a Baileys instance when DATABASE_SAVE_DATA_INSTANCE is on.
 *
 * - `creds` live in the `Session` table; a save whose bytes are the same as the last one written is skipped.
 * - Every other Signal key (pre-keys, sessions, sender-keys, app-state-sync-keys, lid-mappings...) is kept in a fast
 *   layer, Redis (CACHE_REDIS_ENABLED) or local files, AND written through to the `AuthStateKey` table. Redis may lose
 *   them (no persistence, LRU eviction, restart): a read that misses the fast layer falls back to the table and puts
 *   the key back in the fast layer, so losing Redis no longer loses the WhatsApp session ("Bad MAC", "No session").
 * - The table holds the exact `JSON.stringify(value, BufferJSON.replacer)` string, read back with
 *   `BufferJSON.reviver`, so Buffers round-trip byte for byte.
 * - A failing database never throws into Baileys: it is logged and the fast-layer write still happens. Writes for one
 *   session go through a queue, so they reach the table in the order Baileys made them, even after a timeout.
 */

/** The Prisma models this auth state uses: the application's repository, or a fake in the tests. */
export type AuthStatePrisma = Pick<PrismaClient, 'session' | 'authStateKey' | '$transaction'>;

export interface AuthStatePrismaOptions {
  prisma?: AuthStatePrisma;
  /** Longest a key read/write waits for the database before Baileys carries on (a write keeps going behind). */
  dbTimeoutMs?: number;
}

export const AUTH_KEYS_DB_TIMEOUT_MS = 8000;
/** How long a key found in neither Redis nor the table is remembered as absent (writes forget it at once). */
export const ABSENT_KEY_TTL_MS = 6 * 60 * 60 * 1000;
/** Upper bound of that memory per session (cleared when full). */
export const ABSENT_KEY_MAX = 20_000;

/** Rows per statement: well under the bind-parameter limits of PostgreSQL and MySQL. */
const DB_CHUNK_SIZE = 500;

const TIMED_OUT = Symbol('timed-out');

const logger = new Logger('useMultiFileAuthStatePrisma');

const fixFileName = (file: string): string | undefined => {
  if (!file) {
    return undefined;
  }
  const replacedSlash = file.replace(/\//g, '__');
  const replacedColon = replacedSlash.replace(/:/g, '-');
  return replacedColon;
};

export async function keyExists(sessionId: string, prisma: AuthStatePrisma = prismaRepository): Promise<any> {
  try {
    const key = await prisma.session.findUnique({ where: { sessionId: sessionId } });
    return !!key;
  } catch {
    return false;
  }
}

/** Writes the creds row; true when it reached the database (errors are swallowed: Baileys must not crash). */
export async function saveKey(
  sessionId: string,
  keyJson: any,
  prisma: AuthStatePrisma = prismaRepository,
): Promise<boolean> {
  const exists = await keyExists(sessionId, prisma);
  try {
    if (!exists) {
      await prisma.session.create({
        data: {
          sessionId: sessionId,
          creds: JSON.stringify(keyJson),
        },
      });
      return true;
    }
    await prisma.session.update({
      where: { sessionId: sessionId },
      data: { creds: JSON.stringify(keyJson) },
    });
    return true;
  } catch {
    return false;
  }
}

export async function getAuthKey(sessionId: string, prisma: AuthStatePrisma = prismaRepository): Promise<any> {
  try {
    const register = await keyExists(sessionId, prisma);
    if (!register) return null;
    const auth = await prisma.session.findUnique({ where: { sessionId: sessionId } });
    return JSON.parse(auth?.creds);
  } catch {
    return null;
  }
}

async function deleteAuthKey(sessionId: string, prisma: AuthStatePrisma): Promise<any> {
  try {
    const register = await keyExists(sessionId, prisma);
    if (!register) return;
    await prisma.session.delete({ where: { sessionId: sessionId } });
  } catch {
    return;
  }
}

async function fileExists(file: string): Promise<any> {
  try {
    const stat = await fs.stat(file);
    if (stat.isFile()) return true;
  } catch {
    return;
  }
}

function chunk<T>(items: T[], size = DB_CHUNK_SIZE): T[][] {
  const parts: T[][] = [];
  for (let i = 0; i < items.length; i += size) parts.push(items.slice(i, i + size));
  return parts;
}

const errorMessage = (error: any) => error?.message ?? String(error);

/** Database work of each session, in order: a write that timed out still lands before the next one starts. */
const dbQueues = new Map<string, Promise<unknown>>();

function enqueue<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
  const previous = dbQueues.get(sessionId) ?? Promise.resolve();
  const run = previous.then(task);
  const tail = run.catch(() => undefined);
  dbQueues.set(sessionId, tail);
  tail.then(() => {
    if (dbQueues.get(sessionId) === tail) dbQueues.delete(sessionId);
  });
  return run;
}

/** Resolves when every queued database write of the session has finished (tests, shutdown). */
export async function flushAuthKeyWrites(sessionId: string): Promise<void> {
  while (dbQueues.has(sessionId)) {
    await dbQueues.get(sessionId);
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export default async function useMultiFileAuthStatePrisma(
  sessionId: string,
  cache: CacheService,
  options: AuthStatePrismaOptions = {},
): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  removeCreds: () => Promise<void>;
}> {
  const prisma = options.prisma ?? prismaRepository;
  const dbTimeoutMs = options.dbTimeoutMs ?? AUTH_KEYS_DB_TIMEOUT_MS;

  const localFolder = path.join(INSTANCE_DIR, sessionId);
  const localFile = (key: string) => path.join(localFolder, fixFileName(key) + '.json');
  await fs.mkdir(localFolder, { recursive: true });

  const redisEnabled = () => !!configService.get<CacheConf>('CACHE')?.REDIS?.ENABLED;

  // ---- Fast layer: Redis (or local files), as before ---------------------------------------------------------------

  async function fastRead(key: string): Promise<any> {
    try {
      if (redisEnabled()) {
        return (await cache.hGet(sessionId, key)) ?? null;
      }
      if (!(await fileExists(localFile(key)))) return null;
      const rawData = await fs.readFile(localFile(key), { encoding: 'utf-8' });
      return JSON.parse(rawData, BufferJSON.reviver);
    } catch {
      return null;
    }
  }

  /** Same contract as before: Redis errors are swallowed by CacheService, a file error is thrown. */
  async function fastWrite(key: string, value: any, dataString: string): Promise<void> {
    if (redisEnabled()) {
      await cache.hSet(sessionId, key, value);
      return;
    }
    await fs.writeFile(localFile(key), dataString ?? JSON.stringify(value, BufferJSON.replacer));
  }

  async function fastRemove(key: string): Promise<void> {
    try {
      if (redisEnabled()) {
        await cache.hDelete(sessionId, key);
      } else {
        await fs.unlink(localFile(key));
      }
    } catch {
      return;
    }
  }

  // ---- Durable layer: AuthStateKey table --------------------------------------------------------------------------

  /** Upserts (value) and deletes (null) one batch atomically. Never throws. */
  async function dbWrite(entries: { key: string; value: string | null }[]): Promise<void> {
    if (!entries.length) return;

    const keys = entries.map((entry) => entry.key);
    const rows = entries
      .filter((entry) => entry.value !== null)
      .map((entry) => ({ sessionId, key: entry.key, value: entry.value }));

    // delete + insert: two statements per chunk whatever the batch size, the same on PostgreSQL and MySQL
    const run = enqueue(sessionId, () =>
      runWithInstance(sessionId, () =>
        prisma.$transaction([
          ...chunk(keys).map((part) => prisma.authStateKey.deleteMany({ where: { sessionId, key: { in: part } } })),
          ...chunk(rows).map((part) => prisma.authStateKey.createMany({ data: part })),
        ]),
      ),
    ).then(
      () => true,
      (error) => {
        logger.error({
          action: 'auth.keys.db.write',
          sessionId,
          keys: keys.length,
          sample: keys.slice(0, 3),
          error: errorMessage(error),
        });
        return false;
      },
    );

    if ((await withTimeout(run, dbTimeoutMs)) === TIMED_OUT) {
      logger.warn({ action: 'auth.keys.db.write.slow', sessionId, keys: keys.length, timeoutMs: dbTimeoutMs });
    }
  }

  /**
   * Decoded values of the keys found in the table. Never throws: an error or a timeout reads as "not found".
   * `checked` lists the keys whose lookup really ran (no error, no timeout): only those may be remembered as absent.
   */
  async function dbRead(keys: string[], checked?: Set<string>): Promise<Record<string, any>> {
    const found: Record<string, any> = {};
    for (const part of chunk(keys)) {
      try {
        const rows = await withTimeout(
          prisma.authStateKey.findMany({
            where: { sessionId, key: { in: part } },
            select: { key: true, value: true },
          }),
          dbTimeoutMs,
        );
        if (rows === TIMED_OUT) {
          logger.warn({ action: 'auth.keys.db.read.slow', sessionId, keys: part.length, timeoutMs: dbTimeoutMs });
          continue;
        }
        part.forEach((key) => checked?.add(key));
        for (const row of rows) {
          try {
            found[row.key] = JSON.parse(row.value, BufferJSON.reviver);
          } catch (error) {
            logger.error({ action: 'auth.keys.db.decode', sessionId, key: row.key, error: errorMessage(error) });
          }
        }
      } catch (error) {
        logger.error({ action: 'auth.keys.db.read', sessionId, keys: part.length, error: errorMessage(error) });
      }
    }
    return found;
  }

  /**
   * One-time copy of the Redis hash into the table, for a session paired before the table existed: runs when the
   * table has no row for the session. Never throws.
   */
  async function backfillFromRedis(): Promise<void> {
    if (!redisEnabled()) return;
    try {
      await enqueue(sessionId, async () => {
        const existing = await prisma.authStateKey.count({ where: { sessionId } });
        if (existing > 0) {
          logger.info({ action: 'auth.keys.backfill', sessionId, status: 'skipped', dbKeys: existing });
          return;
        }

        const hash = (await cache.hGetAll(sessionId)) ?? {};
        const rows = [];
        for (const [key, value] of Object.entries(hash)) {
          if (key === 'creds' || value === null || value === undefined) continue;
          try {
            rows.push({ sessionId, key, value: JSON.stringify(value, BufferJSON.replacer) });
          } catch (error) {
            logger.error({ action: 'auth.keys.backfill.encode', sessionId, key, error: errorMessage(error) });
          }
        }

        if (!rows.length) {
          logger.warn({ action: 'auth.keys.backfill', sessionId, status: 'nothing-to-copy', redisKeys: 0 });
          return;
        }

        let copied = 0;
        for (const part of chunk(rows)) {
          const result = await prisma.authStateKey.createMany({ data: part, skipDuplicates: true });
          copied += result?.count ?? 0;
        }

        logger.info({ action: 'auth.keys.backfill', sessionId, status: 'done', redisKeys: rows.length, copied });
      });
    } catch (error) {
      logger.error({ action: 'auth.keys.backfill', sessionId, status: 'failed', error: errorMessage(error) });
    }
  }

  // ---- Keys known to exist nowhere (neither Redis nor the table) -----------------------------------------------------
  // Baileys asks again and again for keys that were never stored (sessions of devices it has not met, sender keys of
  // ignored groups...). Without this memory every such ask is a table read, and on Neon each read after 5 idle minutes
  // wakes the database. Only this process writes the session's keys, so `set` (and `removeCreds`) keep it exact.
  const absent = new Map<string, number>();
  /** Bumped by every `set`: a read that overlapped a write never marks keys absent (it may have missed the write). */
  let writeSeq = 0;

  function isKnownAbsent(key: string): boolean {
    const at = absent.get(key);
    if (at === undefined) return false;
    if (Date.now() - at > ABSENT_KEY_TTL_MS) {
      absent.delete(key);
      return false;
    }
    return true;
  }

  function rememberAbsent(key: string): void {
    if (absent.size >= ABSENT_KEY_MAX) absent.clear();
    absent.set(key, Date.now());
  }

  // ---- creds (Session table) ---------------------------------------------------------------------------------------
  // Baileys fires creds.update even when nothing in the creds changed (measured on 11/11/2026: every 10 minutes, all
  // night, the same bytes). Each save was a SELECT + UPDATE that woke the Neon compute (free plan: CU-hours). The last
  // string that reached the table is kept in memory and an identical save is skipped; any real change is written as
  // before, and a failed write is retried on the next save.
  let savedCreds: string | null = null;

  async function readCreds(): Promise<any> {
    try {
      const rawData = await getAuthKey(sessionId, prisma);
      const parsed = JSON.parse(rawData, BufferJSON.reviver);
      savedCreds = typeof rawData === 'string' ? rawData : null;
      return parsed;
    } catch {
      return null;
    }
  }

  async function writeCreds(data: any): Promise<void> {
    const serialized = JSON.stringify(data, BufferJSON.replacer);
    if (serialized === savedCreds) return;
    if (await saveKey(sessionId, serialized, prisma)) savedCreds = serialized;
  }

  async function removeCreds(): Promise<any> {
    absent.clear();
    savedCreds = null;
    try {
      await enqueue(sessionId, () => prisma.authStateKey.deleteMany({ where: { sessionId } }));
      logger.info({ action: 'auth.keys.db.delete', sessionId });
    } catch (err) {
      logger.warn({ action: 'auth.keys.db.delete', sessionId, error: errorMessage(err) });
    }

    const cacheConfig = configService.get<CacheConf>('CACHE');

    // Redis
    try {
      if (cacheConfig.REDIS.ENABLED) {
        await cache.delete(sessionId);
        logger.info({ action: 'redis.delete', sessionId });

        return;
      }
    } catch (err) {
      logger.warn({ action: 'redis.delete', sessionId, err });
    }

    logger.info({ action: 'auth.key.delete', sessionId });

    await deleteAuthKey(sessionId, prisma);
  }

  let creds = await readCreds();
  if (!creds) {
    creds = initAuthCreds();
    await writeCreds(creds);
  } else {
    // Only an already paired session has keys worth keeping: new creds never reuse what is left in Redis
    await backfillFromRedis();
  }

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data: { [id: string]: any } = {};
          const missing: string[] = [];

          await Promise.all(
            ids.map(async (id) => {
              const value = await fastRead(`${type}-${id}`);
              if (value === null || value === undefined) {
                missing.push(id);
              }
              data[id] = value ?? null;
            }),
          );

          const toRead = missing.filter((id) => !isKnownAbsent(`${type}-${id}`));
          if (toRead.length) {
            const checked = new Set<string>();
            const seqBefore = writeSeq;
            const found = await dbRead(
              toRead.map((id) => `${type}-${id}`),
              checked,
            );
            const restored = toRead.filter((id) => found[`${type}-${id}`] !== undefined);
            for (const id of toRead) {
              const key = `${type}-${id}`;
              if (found[key] === undefined && checked.has(key) && writeSeq === seqBefore) rememberAbsent(key);
            }

            await Promise.all(
              restored.map(async (id) => {
                const key = `${type}-${id}`;
                data[id] = found[key];
                try {
                  await fastWrite(key, found[key], null);
                } catch (error) {
                  logger.warn({ action: 'auth.keys.repopulate', sessionId, key, error: errorMessage(error) });
                }
              }),
            );

            if (restored.length) {
              logger.warn({ action: 'auth.keys.restored-from-db', sessionId, type, count: restored.length });
            }
          }

          if (type === 'app-state-sync-key') {
            for (const id of ids) {
              // fromObject, not create: the stored keyData is a base64 string (protobuf toJSON) and must become bytes
              if (data[id]) data[id] = proto.Message.AppStateSyncKeyData.fromObject(data[id]);
            }
          }

          return data;
        },
        set: async (data) => {
          writeSeq++;
          const entries: { key: string; value: string | null }[] = [];
          const fastTasks: Promise<void>[] = [];

          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              absent.delete(key);

              if (value) {
                let dataString: string = null;
                try {
                  dataString = JSON.stringify(value, BufferJSON.replacer);
                  entries.push({ key, value: dataString });
                } catch (error) {
                  logger.error({ action: 'auth.keys.encode', sessionId, key, error: errorMessage(error) });
                }
                fastTasks.push(fastWrite(key, value, dataString));
              } else {
                entries.push({ key, value: null });
                fastTasks.push(fastRemove(key));
              }
            }
          }

          const [fastResults] = await Promise.all([Promise.allSettled(fastTasks), dbWrite(entries)]);
          const failed = fastResults.find((result) => result.status === 'rejected') as PromiseRejectedResult;
          if (failed) throw failed.reason;
        },
      },
    },
    saveCreds: () => {
      return writeCreds(creds);
    },

    removeCreds,
  };
}
