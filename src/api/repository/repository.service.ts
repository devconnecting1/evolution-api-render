import { ConfigService } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { PrismaClient } from '@prisma/client';

import { dbActivity } from './db-activity';

export class Query<T> {
  where?: T;
  sort?: 'asc' | 'desc';
  page?: number;
  offset?: number;
  /** findMessages/findChats: join a chat split between its `@lid` and its phone JID (default true). */
  mergeLid?: boolean;
}

export class PrismaRepository extends PrismaClient {
  constructor(private readonly configService: ConfigService) {
    // Eventos de consulta (sem imprimir nada) para o registro de acordadas do banco (db-activity.ts).
    super({ log: [{ emit: 'event', level: 'query' }] });
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
