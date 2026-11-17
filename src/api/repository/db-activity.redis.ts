import { redisClient } from '@cache/rediscache.client';
import { CacheConf, configService } from '@config/env.config';

import type { DbActivityDailyStore } from './db-activity';

/**
 * Resumo diário das acordadas do banco no Redis (Render Key Value): um hash por dia com TTL de 35 dias, para o
 * GET /admin/db-activity não zerar a cada deploy. Usa só o cliente que a aplicação já conectou; sem Redis
 * habilitado devolve null e o registro fica só em memória, como antes.
 */
export function redisDailyStore(): DbActivityDailyStore | null {
  const conf = configService.get<CacheConf>('CACHE')?.REDIS;
  if (!conf?.ENABLED || !conf?.URI) return null;
  const ready = () => {
    const client = redisClient.peek();
    if (!client || !client.isReady) throw new Error('Redis indisponível');
    return client;
  };
  return {
    increment: async (key, fields, ttlSeconds) => {
      const multi = ready().multi();
      for (const field of fields) multi.hIncrBy(key, field, 1);
      multi.expire(key, ttlSeconds);
      await multi.exec();
    },
    read: async (key) => ready().hGetAll(key),
  };
}
