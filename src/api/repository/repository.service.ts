import { ConfigService, Database } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { PrismaClient } from '@prisma/client';

import { dbActivity } from './db-activity';
import { createPrismaAdapter } from './prisma-adapter';

export class Query<T> {
  where?: T;
  sort?: 'asc' | 'desc';
  page?: number;
  offset?: number;
  /** findMessages/findChats: join a chat split between its `@lid` and its phone JID (default true). */
  mergeLid?: boolean;
}

/** O CLI usa a URL direta; no runtime o psql_bouncer pode passar pelo bouncer. */
function resolveDatabaseUrl(configService: ConfigService): string {
  const database = configService.get<Database>('DATABASE');
  if (database.PROVIDER === 'psql_bouncer') {
    return database.CONNECTION.BOUNCER_URI || database.CONNECTION.URI;
  }
  return database.CONNECTION.URI;
}

export class PrismaRepository extends PrismaClient {
  constructor(private readonly configService: ConfigService) {
    // Eventos de consulta (sem imprimir nada) para o registro de acordadas do banco (db-activity.ts).
    super({
      adapter: createPrismaAdapter(configService.get<Database>('DATABASE').PROVIDER, resolveDatabaseUrl(configService)),
      log: [{ emit: 'event', level: 'query' }],
    });
    (this as unknown as { $on(event: 'query', cb: (e: { query: string }) => void): void }).$on('query', (e) =>
      dbActivity.record(e.query),
    );
  }

  private readonly logger = new Logger('PrismaRepository');

  public async onModuleInit() {
    await this.$connect();
    this.logger.info('Repository:Prisma - ON');
  }

  public async onModuleDestroy() {
    await this.$disconnect();
    this.logger.warn('Repository:Prisma - OFF');
  }
}
