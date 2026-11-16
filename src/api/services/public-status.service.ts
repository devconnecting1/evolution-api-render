import { prismaRepository } from '@api/server.module';

import { observabilityService } from './observability.service';
import { PublicStatusService, PublicStatusStore } from './public-status.core';

const STORE_KEY = 'public-status:v1';

/**
 * Public status page singleton.
 *
 * The history lives in GlobalSetting (control database) instead of a new table: no migration, and the same row
 * works on PostgreSQL, MySQL and the bouncer schema. It is read and written only when the five-minute cache expires.
 * If the database is unavailable, the service serves the current snapshot with an empty history and never exposes
 * the error.
 */
export const publicStatusService = new PublicStatusService({
  snapshot: () => observabilityService.collectSystem(),
  readStore: async () => {
    const repo = prismaRepository as any;
    const row = await repo.globalSetting.findUnique({ where: { key: STORE_KEY } });
    return row?.value ?? null;
  },
  writeStore: async (value: PublicStatusStore) => {
    const repo = prismaRepository as any;
    await repo.globalSetting.upsert({
      where: { key: STORE_KEY },
      create: { key: STORE_KEY, value },
      update: { value },
    });
  },
});
