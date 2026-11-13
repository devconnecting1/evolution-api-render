import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaPg } from '@prisma/adapter-pg';

/** Conexao aceita pelo adapter do pg: URL, pool ou configuracao do driver. */
type PgConnection = ConstructorParameters<typeof PrismaPg>[0];
/** Conexao aceita pelo adapter do mariadb: URL, pool ou configuracao do driver. */
type MariaDbConnection = ConstructorParameters<typeof PrismaMariaDb>[0];

/** URL de conexao ou um pool/configuracao ja criado para o driver do banco. */
export type PrismaConnection = PgConnection | MariaDbConnection;

/**
 * No Prisma 7 o cliente usa driver adapters. O MySQL usa o adapter do mariadb (ele reescreve
 * `mysql://` para `mariadb://`); os demais provedores usam o pg.
 */
export function createPrismaAdapter(provider: string, connection: PrismaConnection) {
  if (provider === 'mysql') {
    return new PrismaMariaDb(connection as MariaDbConnection);
  }

  return createPgAdapter(connection as PgConnection);
}

/**
 * O pg nao entende `?schema=` nem `?pgbouncer=`: o schema vira opcao do adapter e os dois saem
 * da connection string (o bouncer fica so na URL de runtime).
 */
function createPgAdapter(connection: PgConnection) {
  if (typeof connection !== 'string') {
    return new PrismaPg(connection);
  }

  try {
    const url = new URL(connection);
    const schema = url.searchParams.get('schema') ?? undefined;
    url.searchParams.delete('schema');
    url.searchParams.delete('pgbouncer');

    return new PrismaPg({ connectionString: url.toString() }, schema ? { schema } : undefined);
  } catch {
    return new PrismaPg(connection);
  }
}
