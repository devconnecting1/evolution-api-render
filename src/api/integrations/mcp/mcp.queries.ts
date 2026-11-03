import { Prisma } from '@prisma/client';

/** Escapes the LIKE wildcards of a user search term (backslash is the default escape of Postgres and MySQL). */
export const escapeLike = (term: string) => term.replace(/[\\%_]/g, (char) => `\\${char}`);

const TEXT_PATHS = [
  ['conversation'],
  ['extendedTextMessage', 'text'],
  ['imageMessage', 'caption'],
  ['videoMessage', 'caption'],
  ['documentMessage', 'caption'],
  ['documentWithCaptionMessage', 'message', 'documentMessage', 'caption'],
  ['speechToText'],
];

export type SearchMessagesParams = {
  instanceId: string;
  term: string;
  remoteJids?: string[] | null;
  fromSeconds?: number | null;
  toSeconds?: number | null;
  limit: number;
};

/**
 * Text search over the stored messages of one instance: one bounded query (LIMIT), only over the text fields
 * (never the raw JSON, which holds media keys and base64). Case-insensitive on Postgres (ILIKE); on MySQL it
 * follows the column collation.
 */
export async function searchMessages(prisma: any, provider: string, params: SearchMessagesParams): Promise<any[]> {
  const mysql = provider === 'mysql';
  const pattern = `%${escapeLike(params.term)}%`;

  const field = (path: string[]) =>
    mysql
      ? Prisma.raw(`JSON_UNQUOTE(JSON_EXTRACT(\`message\`, '$.${path.join('.')}'))`)
      : Prisma.raw(`"message" #>> '{${path.join(',')}}'`);
  const like = mysql ? Prisma.raw('LIKE') : Prisma.raw('ILIKE');

  const textFilter = Prisma.join(
    TEXT_PATHS.map((path) => Prisma.sql`${field(path)} ${like} ${pattern}`),
    ' OR ',
  );

  const table = Prisma.raw(mysql ? '`Message`' : '"Message"');
  const col = (name: string) => Prisma.raw(mysql ? `\`${name}\`` : `"${name}"`);
  const remoteJid = Prisma.raw(mysql ? "JSON_UNQUOTE(JSON_EXTRACT(`key`, '$.remoteJid'))" : `"key"->>'remoteJid'`);

  const jidFilter = params.remoteJids?.length
    ? Prisma.sql`AND ${remoteJid} IN (${Prisma.join(params.remoteJids)})`
    : Prisma.empty;
  const fromFilter = params.fromSeconds
    ? Prisma.sql`AND ${col('messageTimestamp')} >= ${params.fromSeconds}`
    : Prisma.empty;
  const toFilter = params.toSeconds ? Prisma.sql`AND ${col('messageTimestamp')} <= ${params.toSeconds}` : Prisma.empty;

  return await prisma.$queryRaw`
    SELECT ${col('id')}, ${col('key')}, ${col('pushName')}, ${col('messageType')}, ${col('message')}, ${col('messageTimestamp')}
    FROM ${table}
    WHERE ${col('instanceId')} = ${params.instanceId}
      AND (${textFilter})
      ${jidFilter}
      ${fromFilter}
      ${toFilter}
    ORDER BY ${col('messageTimestamp')} DESC
    LIMIT ${params.limit}
  `;
}

/** One stored message by its WhatsApp id (`key.id`), scoped to the instance. */
export async function findMessageByKeyId(prisma: any, provider: string, instanceId: string, messageId: string) {
  return await prisma.message.findFirst({
    where: {
      instanceId,
      key: { path: provider === 'mysql' ? '$.id' : ['id'], equals: messageId },
    },
    select: { id: true, key: true, messageType: true, message: true, messageTimestamp: true },
  });
}
