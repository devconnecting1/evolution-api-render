import { ICache } from '@api/abstract/abstract.cache';
import { Logger } from '@config/logger.config';
import { BufferJSON } from 'baileys';

export class CacheService {
  private readonly logger = new Logger('CacheService');

  constructor(private readonly cache: ICache) {
    if (cache) {
      this.logger.verbose(`cacheservice created using cache engine: ${cache.constructor?.name}`);
    } else {
      this.logger.verbose(`cacheservice disabled`);
    }
  }

  async get(key: string): Promise<any> {
    if (!this.cache) {
      return;
    }
    return this.cache.get(key);
  }

  public async hGet(key: string, field: string) {
    if (!this.cache) {
      return null;
    }
    try {
      const data = await this.cache.hGet(key, field);

      if (data) {
        return JSON.parse(data, BufferJSON.reviver);
      }

      return null;
    } catch (error) {
      this.logger.error(error);
      return null;
    }
  }

  /**
   * Every field of a hash written with `hSet`, decoded the same way as `hGet` (Buffers revived). Fields that cannot be
   * decoded are skipped. null when the cache is off, the hash does not exist or it cannot be read.
   */
  public async hGetAll(key: string): Promise<Record<string, any> | null> {
    if (!this.cache) {
      return null;
    }
    try {
      const hash = await this.cache.hGetAll(key);
      if (!hash) {
        return null;
      }

      const result: Record<string, any> = {};
      for (const [field, data] of Object.entries(hash)) {
        if (!data) continue;
        try {
          result[field] = typeof data === 'string' ? JSON.parse(data, BufferJSON.reviver) : data;
        } catch (error) {
          this.logger.error({ action: 'cache.hGetAll.decode', key, field, error: error?.message ?? error });
        }
      }

      return result;
    } catch (error) {
      this.logger.error(error);
      return null;
    }
  }

  async set(key: string, value: any, ttl?: number) {
    if (!this.cache) {
      return;
    }
    this.cache.set(key, value, ttl);
  }

  public async hSet(key: string, field: string, value: any) {
    if (!this.cache) {
      return;
    }
    try {
      const json = JSON.stringify(value, BufferJSON.replacer);

      await this.cache.hSet(key, field, json);
    } catch (error) {
      this.logger.error(error);
    }
  }

  async has(key: string) {
    if (!this.cache) {
      return;
    }
    return this.cache.has(key);
  }

  async delete(key: string) {
    if (!this.cache) {
      return;
    }
    return this.cache.delete(key);
  }

  async hDelete(key: string, field: string) {
    if (!this.cache) {
      return false;
    }
    try {
      await this.cache.hDelete(key, field);
      return true;
    } catch (error) {
      this.logger.error(error);
      return false;
    }
  }

  async deleteAll(appendCriteria?: string) {
    if (!this.cache) {
      return;
    }
    return this.cache.deleteAll(appendCriteria);
  }

  async keys(appendCriteria?: string) {
    if (!this.cache) {
      return;
    }
    return this.cache.keys(appendCriteria);
  }
}
