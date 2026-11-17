import fs from 'node:fs';

import { dbActivity } from '@api/repository/db-activity';
import { prismaRepository, waMonitor } from '@api/server.module';
import { redisClient } from '@cache/rediscache.client';
import { CacheConf, configService } from '@config/env.config';
import { getMessageStoreFailures } from '@utils/messageStoreFailures';
import { openaiHealthRegistry } from '@utils/openai-health';

import { createPersistence, PublicStatusService, RedisLike } from './public-status.core';
import type { StatusStore } from './status/history';
import type { FetchLike } from './status/signals';

const GLOBAL_SETTING_KEY = 'public-status:v2';
const DEFAULT_SITE_URL = 'https://whatsaibr.vercel.app/';

const env = (name: string): string | null => {
  const value = process.env[name]
    ?.replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .trim()
    .replace(/^(["'])(.*)\1$/, '$2')
    .trim();
  return value || null;
};

function packageVersion(): string | null {
  try {
    return JSON.parse(fs.readFileSync('./package.json', 'utf8'))?.version ?? null;
  } catch {
    return null;
  }
}

function lastQueryAt(): number | null {
  const at = dbActivity.snapshot(1).lastQueryAt;
  return at ? Date.parse(at) : null;
}

function redisEnabled(): boolean {
  const conf = configService.get<CacheConf>('CACHE')?.REDIS;
  return Boolean(conf?.ENABLED && conf?.URI);
}

/** Cliente Redis já conectado pela aplicação (nunca abre conexão nova só para o status). */
function readyRedis(): RedisLike | null {
  if (!redisEnabled()) return null;
  const client = redisClient.peek();
  return client && client.isReady ? (client as unknown as RedisLike) : null;
}

const keyValueId = (env('RENDER_SERVICE_IDS') ?? '')
  .split(',')
  .map((item) => item.trim())
  .find((item) => item.startsWith('red-'));
const renderServiceId = env('STATUS_RENDER_SERVICE_ID') ?? env('RENDER_SERVICE_ID');

/**
 * Status público: liga os sinais em memória da aplicação ao núcleo (public-status.core.ts).
 *
 * Provedores são opcionais e reaproveitam as chaves da Observabilidade (RENDER_API_KEY, NEON_API_KEY +
 * NEON_PROJECT_ID, VERCEL_TOKEN + VERCEL_PROJECT_ID); sem elas, o componente mostra só os sinais locais.
 */
export const publicStatusService = new PublicStatusService({
  version: packageVersion(),
  commit: env('RENDER_GIT_COMMIT')?.slice(0, 12) ?? null,
  bootAt: Date.now() - Math.round(process.uptime() * 1000),
  instances: () => waMonitor?.waInstances,
  openai: () => openaiHealthRegistry.list(),
  dbLastQueryAt: lastQueryAt,
  dbProbe: async () => {
    await (prismaRepository as any).$queryRawUnsafe('SELECT 1');
  },
  dbFailures: () => getMessageStoreFailures(),
  redis: () => {
    if (!redisEnabled()) return 'off';
    const client = redisClient.peek();
    if (!client) return 'down';
    return client.isReady ? 'ready' : client.isOpen ? 'connecting' : 'down';
  },
  fetcher: fetch as unknown as FetchLike,
  siteUrl: env('STATUS_SITE_URL') ?? DEFAULT_SITE_URL,
  render:
    env('RENDER_API_KEY') && renderServiceId
      ? { apiKey: env('RENDER_API_KEY') as string, serviceId: renderServiceId, keyValueId: keyValueId ?? null }
      : null,
  neon:
    env('NEON_API_KEY') && env('NEON_PROJECT_ID')
      ? { apiKey: env('NEON_API_KEY') as string, projectId: env('NEON_PROJECT_ID') as string }
      : null,
  vercel:
    env('VERCEL_TOKEN') && env('VERCEL_PROJECT_ID')
      ? {
          token: env('VERCEL_TOKEN') as string,
          projectId: env('VERCEL_PROJECT_ID') as string,
          teamId: env('VERCEL_TEAM_ID'),
        }
      : null,
  persistence: createPersistence({
    redisEnabled,
    redis: readyRedis,
    waitMs: 8_000,
    dbLastQueryAt: lastQueryAt,
    globalSetting: {
      read: async () => {
        const row = await (prismaRepository as any).globalSetting.findUnique({ where: { key: GLOBAL_SETTING_KEY } });
        return row?.value ?? null;
      },
      write: async (value: StatusStore) => {
        await (prismaRepository as any).globalSetting.upsert({
          where: { key: GLOBAL_SETTING_KEY },
          create: { key: GLOBAL_SETTING_KEY, value },
          update: { value },
        });
      },
    },
  }),
});
