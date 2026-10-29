import { CacheService } from '@api/services/cache.service';
import { CacheEngine } from '@cache/cacheengine';
import { configService } from '@config/env.config';
import { Logger } from '@config/logger.config';

/**
 * Registry of message ids sent by the API itself (chatbots/integrations).
 *
 * A fromMe message reaching the chatbot emit may be an echo of something the API sent (the
 * automatic call reply, the Chatwoot path, `emitOwnEvents`, another linked session) or a human
 * typing on the phone or WhatsApp Web/Desktop. The id prefix (3EB0...) and `source=web` are the
 * same for the API and WhatsApp Web, so they cannot tell them apart. Ids are registered *before*
 * sending, so an echo can never arrive first, and checked in the chatbot emit to decide whether a
 * fromMe message was written by a human.
 *
 * Stored in the configured cache (Redis or local) and always in process memory as fallback,
 * because the cache may be disabled.
 */
const logger = new Logger('BotMessageRegistry');

const TTL_SECONDS = 10 * 60;
const MAX_MEMORY_ENTRIES = 10000;

const cache = new CacheService(new CacheEngine(configService, 'bot_message_ids').getEngine());
const memory = new Map<string, number>();

const buildKey = (instanceId: string, messageId: string) => `${instanceId}:${messageId}`;

const pruneMemory = () => {
  const now = Date.now();
  for (const [key, expiresAt] of memory) {
    if (expiresAt <= now || memory.size > MAX_MEMORY_ENTRIES) memory.delete(key);
    else break;
  }
};

export const registerBotMessageId = async (instanceId: string, messageId: string) => {
  if (!instanceId || !messageId) return;

  const key = buildKey(instanceId, messageId);
  memory.set(key, Date.now() + TTL_SECONDS * 1000);
  pruneMemory();

  try {
    await cache.set(key, true, TTL_SECONDS);
  } catch (error) {
    logger.error(`Error registering bot message id: ${error?.message}`);
  }
};

export const isBotMessageId = async (instanceId: string, messageId: string): Promise<boolean> => {
  if (!instanceId || !messageId) return false;

  const key = buildKey(instanceId, messageId);
  const expiresAt = memory.get(key);
  if (expiresAt && expiresAt > Date.now()) return true;

  try {
    return !!(await cache.get(key));
  } catch (error) {
    logger.error(`Error reading bot message id: ${error?.message}`);
    return false;
  }
};
