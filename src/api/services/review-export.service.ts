import {
  conversationJid,
  conversationJsonl,
  conversationMarkdown,
  maskedRef,
  messageContent,
  redactText,
  ReviewConversation,
  ReviewEntry,
  reviewIsoDay,
  ReviewPeriod,
} from '@utils/conversation-review';
import { aiReplyIndex, deriveSender, messageBodyText } from '@utils/message-sender';
import { ZipEntrySource, zipFromEntries } from '@utils/zipStream';

export type ReviewFormat = 'md' | 'jsonl';

export const REVIEW_FORMATS: ReviewFormat[] = ['md', 'jsonl'];

/** Above this the export stops and says it is partial: a busy instance should export a shorter period. */
export const MAX_REVIEW_MESSAGES = 100_000;
const PAGE = 500;
const SESSIONS_PER_CONTACT = 5;

export type ReviewCollection = {
  conversations: ReviewConversation[];
  messages: number;
  partial: boolean;
};

type Pending = { entry: ReviewEntry; row: any };

/**
 * "Exportar conversas para revisão": the conversations of one instance in a period, ready to be read by a person or
 * by Claude to find the problems of the AI. Read-only.
 *
 * One range query on Message (instanceId, messageTimestamp), keyset paginated, with only the columns it needs; the
 * conversations are grouped in memory (the period is at most 31 days and the export stops at 100 thousand messages).
 * Older rows without `sentBy` are resolved like the MCP does: the key, then an exact match with the AI answers kept
 * in the bot sessions of that contact (read once, only for conversations that need it).
 */
export class ReviewExportService {
  constructor(
    private readonly prisma: any,
    private readonly maxMessages = MAX_REVIEW_MESSAGES,
  ) {}

  public fileName(instanceName: string, period: ReviewPeriod): string {
    const safe = String(instanceName || 'instancia').replace(/[^\w.-]+/g, '-');
    return `revisao-${safe}-${period.from}_a_${period.to}.zip`;
  }

  public async collect(instanceId: string, period: ReviewPeriod): Promise<ReviewCollection> {
    const groups = new Map<string, { jids: Set<string>; entries: ReviewEntry[]; unknown: Pending[] }>();
    let cursor: { at: number; id: string } | null = null;
    let messages = 0;
    let partial = false;

    for (;;) {
      const rows: any[] =
        (await this.prisma.message.findMany({
          where: {
            instanceId,
            messageTimestamp: { gte: period.fromSeconds, lte: period.toSeconds },
            ...(cursor
              ? {
                  OR: [{ messageTimestamp: { gt: cursor.at } }, { messageTimestamp: cursor.at, id: { gt: cursor.id } }],
                }
              : {}),
          },
          orderBy: [{ messageTimestamp: 'asc' }, { id: 'asc' }],
          take: PAGE,
          select: { id: true, key: true, messageType: true, message: true, messageTimestamp: true, sentBy: true },
        })) ?? [];

      for (const row of rows) {
        const key = typeof row.key === 'string' ? safeJson(row.key) : row.key;
        const jid = conversationJid(key);
        if (!jid) continue;
        const content = messageContent(row.message, row.messageType);
        if (content === null) continue;

        let group = groups.get(jid);
        if (!group) {
          group = { jids: new Set([jid]), entries: [], unknown: [] };
          groups.set(jid, group);
        }
        if (typeof key?.remoteJid === 'string') group.jids.add(key.remoteJid);

        const entry: ReviewEntry = {
          messageId: typeof key?.id === 'string' ? key.id : null,
          at: Number(row.messageTimestamp) || 0,
          sender: deriveSender({ ...row, key }),
          type: String(row.messageType ?? ''),
          text: redactText(content),
        };
        group.entries.push(entry);
        if (entry.sender === 'unknown') group.unknown.push({ entry, row: { key, message: row.message } });
        messages++;
      }

      if (messages >= this.maxMessages) {
        partial = true;
        break;
      }
      if (rows.length < PAGE) break;
      const last = rows[rows.length - 1];
      cursor = { at: Number(last.messageTimestamp), id: last.id };
    }

    for (const group of groups.values()) {
      if (!group.unknown.length) continue;
      const replies = await this.aiReplies(instanceId, [...group.jids]);
      if (!replies.size) continue;
      for (const { entry, row } of group.unknown) {
        if (messageBodyText(row.message)) entry.sender = deriveSender(row, replies);
      }
    }

    const conversations = [...groups.entries()]
      .map(([jid, group]) => ({ ref: maskedRef(jid), entries: group.entries }))
      .filter((conversation) => conversation.entries.length)
      .sort((a, b) => a.entries[0].at - b.entries[0].at);

    return { conversations, messages, partial };
  }

  private async aiReplies(instanceId: string, jids: string[]): Promise<Set<string>> {
    try {
      const sessions = await this.prisma.integrationSession.findMany({
        where: { instanceId, remoteJid: { in: jids } },
        orderBy: { updatedAt: 'desc' },
        take: SESSIONS_PER_CONTACT,
        select: { context: true },
      });
      return aiReplyIndex(sessions ?? []);
    } catch {
      return new Set();
    }
  }

  /** The ZIP: LEIAME.txt, one Markdown file per conversation (format "md") and conversas.jsonl. */
  public streamZip(
    instanceName: string,
    period: ReviewPeriod,
    format: ReviewFormat,
    collection: ReviewCollection,
  ): AsyncGenerator<Buffer> {
    return zipFromEntries(this.entries(instanceName, period, format, collection)) as AsyncGenerator<Buffer>;
  }

  private async *entries(
    instanceName: string,
    period: ReviewPeriod,
    format: ReviewFormat,
    collection: ReviewCollection,
  ): AsyncGenerator<ZipEntrySource> {
    yield { name: 'LEIAME.txt', data: once(readme(instanceName, period, collection)) };
    if (format === 'md') {
      const used = new Map<string, number>();
      for (const conversation of collection.conversations) {
        const base = `conversas/${reviewIsoDay(conversation.entries[0].at)}-final-${conversation.ref.slice(-4)}`;
        const n = (used.get(base) ?? 0) + 1;
        used.set(base, n);
        yield { name: `${base}${n > 1 ? `-${n}` : ''}.md`, data: once(conversationMarkdown(conversation)) };
      }
    }
    yield { name: 'conversas.jsonl', data: jsonl(collection.conversations) };
  }
}

function readme(instanceName: string, period: ReviewPeriod, collection: ReviewCollection): string {
  return [
    `Conversas para revisão da IA - ${instanceName}`,
    `Período: ${period.from} a ${period.to} (horário de Brasília)`,
    `${collection.conversations.length} conversas, ${collection.messages} mensagens.`,
    collection.partial
      ? `ATENÇÃO: exportação parcial (limite de ${MAX_REVIEW_MESSAGES} mensagens). Exporte um período menor para ver tudo.`
      : '',
    '',
    'Quem escreveu: Cliente, IA (respostas automáticas), Equipe (painel), Equipe (celular, WhatsApp Web), API e',
    'Número (não identificado: mensagens antigas do número sem a origem gravada).',
    '',
    'Privacidade (LGPD): os números aparecem só com os 4 últimos dígitos, os nomes não são exportados e e-mails,',
    'CPF, CNPJ e sequências longas de números dentro das mensagens foram ocultados. Ainda assim o arquivo tem',
    'conversas de clientes: guarde com cuidado e apague quando terminar a revisão.',
    '',
  ]
    .filter((line, index, all) => line !== '' || all[index - 1] !== '')
    .join('\n');
}

async function* once(text: string): AsyncGenerator<string> {
  yield text;
}

async function* jsonl(conversations: ReviewConversation[]): AsyncGenerator<string> {
  for (const conversation of conversations) yield conversationJsonl(conversation);
}

function safeJson(value: string): any {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
