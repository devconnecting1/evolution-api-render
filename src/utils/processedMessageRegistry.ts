import { CacheService } from '@api/services/cache.service';
import { CacheEngine } from '@cache/cacheengine';
import { configService } from '@config/env.config';
import { Logger } from '@config/logger.config';

/**
 * Idempotency of the chatbot fan-out per message id (#2737).
 *
 * WhatsApp redelivers the same message (same `key.id`) after reconnections, retries or a phone that resends,
 * and Meta redelivers webhooks. Without this every bot (OpenAI, Typebot, Dify...) would answer, bill and store
 * the same question twice. The id is claimed once, before the fan-out to the bots, so a second bot of the same
 * instance is not blocked by the first one.
 *
 * Stored in the configured cache (Redis or local, survives a restart with Redis) and always in process memory
 * (bounded) as fallback, like the bot message registry.
 */
const logger = new Logger('ProcessedMessageRegistry');

const TTL_SECONDS = 24 * 60 * 60;
const MAX_MEMORY_ENTRIES = 10000;

const cache = new CacheService(new CacheEngine(configService, 'processed_message_ids').getEngine());
const memory = new Map<string, number>();

const buildKey = (instanceId: string, keyId: string) => `${instanceId}:${keyId}`;

const pruneMemory = () => {
  const now = Date.now();
  for (const [key, expiresAt] of memory) {
    if (expiresAt <= now || memory.size > MAX_MEMORY_ENTRIES) memory.delete(key);
    else break;
  }
};

/**
 * Returns `true` the first time a message id of an instance is seen (and registers it), `false` for a
 * redelivery. Without an id there is nothing to deduplicate and it always returns `true`.
 */
export const claimMessageOnce = async (instanceId: string, keyId: string): Promise<boolean> => {
  if (!instanceId || !keyId) return true;

  const key = buildKey(instanceId, keyId);
  const now = Date.now();
  const expiresAt = memory.get(key);
  if (expiresAt && expiresAt > now) return false;

  // Registered in memory before any await: concurrent emits of the same id in this process see it at once
  memory.delete(key);
  memory.set(key, now + TTL_SECONDS * 1000);
  pruneMemory();

  try {
    if (await cache.get(key)) return false;
    await cache.set(key, true, TTL_SECONDS);
  } catch (error) {
    logger.error(`Error registering processed message id: ${error?.message}`);
  }

  return true;
};
