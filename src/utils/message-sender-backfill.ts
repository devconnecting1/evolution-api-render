import { aiReplyIndex, deriveSender, MessageSender, ResolvedSender } from './message-sender';

export type BackfillOptions = {
  /** false (default): only counts; true: writes `sentBy` on the rows it can prove. */
  apply?: boolean;
  /** Only this instance (Instance.id). */
  instanceId?: string | null;
  batchSize?: number;
  log?: (line: string) => void;
};

export type BackfillResult = {
  scanned: number;
  counts: Record<ResolvedSender, number>;
  written: number;
};

const SESSIONS_PER_CONTACT = 5;

/**
 * Fills `Message.sentBy` on rows stored before the column existed. Only what can be proven: not fromMe is the
 * contact, a fromMe id that is not 3EB0... came from the phone, and a 3EB0... message whose text is exactly an
 * AI answer kept in the contact's bot sessions is the AI. Everything else stays empty ("nao_identificado").
 *
 * Reads in id order, `batchSize` rows at a time, with only the columns it needs; the bot sessions of a contact
 * are read once. Writes only with `apply`, and only on rows still empty.
 */
export async function backfillMessageSender(prisma: any, options: BackfillOptions = {}): Promise<BackfillResult> {
  const apply = !!options.apply;
  const batchSize = Math.max(1, Math.min(options.batchSize ?? 500, 5000));
  const log = options.log ?? (() => undefined);
  const counts: Record<ResolvedSender, number> = { ai: 0, panel: 0, api: 0, device: 0, contact: 0, unknown: 0 };
  const replies = new Map<string, Promise<Set<string>>>();
  let scanned = 0;
  let written = 0;
  let cursor: string | null = null;

  const repliesOf = (instanceId: string, key: any): Promise<Set<string>> => {
    const jids = [key?.remoteJid, key?.remoteJidAlt].filter((jid) => typeof jid === 'string' && jid);
    if (!jids.length) return Promise.resolve(new Set());
    const cacheKey = `${instanceId}|${jids[0]}`;
    let pending = replies.get(cacheKey);
    if (!pending) {
      pending = Promise.resolve(
        prisma.integrationSession.findMany({
          where: { instanceId, remoteJid: { in: jids } },
          orderBy: { updatedAt: 'desc' },
          take: SESSIONS_PER_CONTACT,
          select: { context: true },
        }),
      )
        .then((sessions: any[]) => aiReplyIndex(sessions))
        .catch(() => new Set<string>());
      replies.set(cacheKey, pending);
    }
    return pending;
  };

  for (;;) {
    const rows: any[] =
      (await prisma.message.findMany({
        where: {
          sentBy: null,
          ...(options.instanceId ? { instanceId: options.instanceId } : {}),
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: 'asc' },
        take: batchSize,
        select: { id: true, instanceId: true, key: true, message: true },
      })) ?? [];
    if (!rows.length) break;

    const byValue = new Map<MessageSender, string[]>();
    for (const row of rows) {
      let sender = deriveSender(row);
      if (sender === 'unknown') {
        sender = deriveSender(row, await repliesOf(row.instanceId, parseKey(row.key)));
      }
      counts[sender]++;
      if (sender !== 'unknown') {
        const ids = byValue.get(sender) ?? [];
        ids.push(row.id);
        byValue.set(sender, ids);
      }
    }

    if (apply) {
      for (const [sentBy, ids] of byValue) {
        const result = await prisma.message.updateMany({ where: { id: { in: ids }, sentBy: null }, data: { sentBy } });
        written += Number(result?.count ?? 0);
      }
    }

    scanned += rows.length;
    cursor = rows[rows.length - 1].id;
    log(`${scanned} mensagens lidas`);
    if (rows.length < batchSize) break;
  }

  return { scanned, counts, written };
}

function parseKey(key: unknown): any {
  if (typeof key !== 'string') return key;
  try {
    return JSON.parse(key);
  } catch {
    return null;
  }
}

export function formatBackfillReport(result: BackfillResult, apply: boolean): string {
  const line = (label: string, value: number) => `  ${label.padEnd(18)} ${value}`;
  return [
    apply ? 'Origem das mensagens: gravado.' : 'Origem das mensagens: simulação (nada foi gravado; use --apply).',
    `Mensagens sem origem lidas: ${result.scanned}`,
    line('contact (cliente)', result.counts.contact),
    line('device (celular)', result.counts.device),
    line('ai (IA)', result.counts.ai),
    line('panel', result.counts.panel),
    line('api', result.counts.api),
    line('sem prova (vazio)', result.counts.unknown),
    ...(apply ? [`Linhas gravadas: ${result.written}`] : []),
  ].join('\n');
}
