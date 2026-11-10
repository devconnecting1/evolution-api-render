import { Logger } from '@config/logger.config';
import { PrismaClient } from '@prisma/client';

import {
  buildEncryptionKey,
  InstanceDatabaseService,
  prismaMigrateDeploy,
  readInstanceDbConfig,
} from './instance-db.service';
import { NeonClient } from './neon.client';

export { currentInstanceId, runWithInstance } from './instance-context';
export { InstanceDatabaseService } from './instance-db.service';
export { createRoutedRepository } from './routing';

let singleton: InstanceDatabaseService<any> | null = null;

/** Cria o serviço de banco por instância a partir das variáveis de ambiente. */
export function createInstanceDatabases(control: PrismaClient): InstanceDatabaseService<any> {
  const logger = new Logger('InstanceDB');
  const cfg = readInstanceDbConfig();
  const neon =
    cfg.enabled && cfg.neonApiKey
      ? new NeonClient({
          apiKey: cfg.neonApiKey,
          orgId: cfg.neonOrgId,
          regionId: cfg.neonRegionId,
          pgVersion: cfg.neonPgVersion,
          maxCu: cfg.neonMaxCu,
        })
      : null;

  if (process.env.DB_PER_INSTANCE_ENABLED === 'true' && !cfg.enabled) {
    logger.warn('instance-db: DB_PER_INSTANCE_ENABLED=true mas falta NEON_API_KEY ou o banco não é PostgreSQL');
  }
  if (cfg.enabled && !process.env.DB_PER_INSTANCE_SECRET) {
    logger.warn('instance-db: usando AUTHENTICATION_API_KEY para criptografar as URLs; defina DB_PER_INSTANCE_SECRET');
  }

  singleton = new InstanceDatabaseService<any>(cfg, {
    control: control as any,
    neon,
    encryptionKey: buildEncryptionKey(cfg.secret ?? 'unset'),
    createClient: (url: string) => new PrismaClient({ datasourceUrl: url }) as any,
    migrate: prismaMigrateDeploy(),
    logger: {
      info: (m) => logger.info(m),
      warn: (m) => logger.warn(m),
      error: (m) => logger.error(m),
    },
  });
  return singleton;
}

export function getInstanceDatabases(): InstanceDatabaseService<any> | null {
  return singleton;
}
