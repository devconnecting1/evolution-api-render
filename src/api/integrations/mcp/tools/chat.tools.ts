import { z } from 'zod';

import { connectionStateOf, resolveInstance, resolveLoadedInstance } from '../mcp.instance';
import { findMessageByKeyId, searchMessages } from '../mcp.queries';
import { contactArg, defineTool, instanceArg, READ_ONLY } from '../mcp.tool';
import { McpContext } from '../mcp.types';
import {
  isoDate,
  isoFromSeconds,
  jsonResult,
  logMessage,
  McpToolError,
  mediaInfo,
  messageText,
  normalizeContactJid,
  normalizeRecipient,
  phoneOf,
  toNumber,
  ToolContent,
} from '../mcp.util';

/** The registry of bot message ids keeps each id for 10 minutes: older messages cannot be told apart. */
const BOT_REGISTRY_WINDOW_SECONDS = 10 * 60;

export const IMAGE_INLINE_MAX_BYTES = 1.5 * 1024 * 1024;
export const BASE64_MAX_BYTES = 2 * 1024 * 1024;

const SENDER_NOTE =
  'sender: "contact" = o contato; "bot" = enviada pela IA (só detectável nos últimos 10 min); "me" = enviada pelo número da instância (pessoa da equipe, API ou IA: o banco não guarda a origem).';

async function senderOf(ctx: McpContext, instanceId: string, key: any, timestamp: number | null): Promise<string> {
  if (!key?.fromMe) return 'contact';

  const recent = timestamp && Date.now() / 1000 - timestamp <= BOT_REGISTRY_WINDOW_SECONDS + 60;
  if (recent && key.id) {
    try {
      if (await ctx.deps.isBotMessageId(instanceId, key.id)) return 'bot';
    } catch {
      // informative only
    }
  }

  return 'me';
}

export async function messageView(ctx: McpContext, instanceId: string, record: any) {
  const key = record?.key ?? {};
  const timestamp = toNumber(record?.messageTimestamp);
  const media = mediaInfo(record?.message);
  const updates = Array.isArray(record?.MessageUpdate) ? record.MessageUpdate : [];

  return {
    messageId: key.id ?? null,
    remoteJid: key.remoteJid ?? null,
    fromMe: !!key.fromMe,
    sender: await senderOf(ctx, instanceId, key, timestamp),
    senderName: key.fromMe ? null : (record?.pushName ?? null),
    participant: key.participant || undefined,
    timestamp: isoFromSeconds(timestamp),
    type: record?.messageType ?? null,
    text: messageText(record?.message),
    hasMedia: !!media,
    media: media
      ? {
          kind: media.kind,
          mimetype: media.mimetype,
          fileName: media.fileName,
          sizeBytes: media.sizeBytes,
          seconds: media.seconds,
          voiceNote: media.voiceNote || undefined,
        }
      : undefined,
    status: updates.length ? (updates[updates.length - 1]?.status ?? null) : undefined,
  };
}

export const listChats = defineTool({
  name: 'list_chats',
  title: 'Listar conversas',
  description:
    'Lista as conversas da instância, da mais recente para a mais antiga, com a última mensagem e as não lidas. Um contato dividido entre LID e telefone aparece uma vez só (telefone em remoteJid, LID em alternateJid). Filtros: texto (nome ou número), só não lidas, sem grupos.',
  input: {
    instance: instanceArg,
    search: z.string().max(100).optional().describe('Filtra por nome ou parte do número.'),
    unread_only: z.boolean().optional().describe('Só conversas com mensagens não lidas.'),
    exclude_groups: z.boolean().optional().describe('Esconde os grupos.'),
    limit: z.number().int().min(1).max(100).optional().describe('Quantidade por página (1 a 100). Padrão: 20.'),
    offset: z.number().int().min(0).max(100000).optional().describe('Quantas pular (paginação). Padrão: 0.'),
  },
  annotations: READ_ONLY,
  run: async ({ instance, search, unread_only, exclude_groups, limit = 20, offset = 0 }, ctx) => {
    const resolved = await resolveLoadedInstance(ctx, instance);

    // Same path as POST /chat/findChats (mergeLid on): one query plus the LID/phone pairs of the page
    const chats: any[] = (await resolved.channel.fetchChats({ where: {}, mergeLid: true })) ?? [];

    const term = search?.trim().toLowerCase();
    const termDigits = term?.replace(/\D/g, '');

    const filtered = chats.filter((chat) => {
      if (unread_only && !(Number(chat.unreadCount) > 0)) return false;
      if (exclude_groups && String(chat.remoteJid).endsWith('@g.us')) return false;
      if (!term) return true;

      const name = String(chat.pushName ?? '').toLowerCase();
      const jids = `${chat.remoteJid ?? ''} ${chat.remoteJidAlt ?? ''}`;
      return name.includes(term) || (!!termDigits && termDigits.length >= 3 && jids.includes(termDigits));
    });

    const page = filtered.slice(offset, offset + limit).map((chat) => {
      const last = chat.lastMessage;
      return {
        remoteJid: chat.remoteJid,
        alternateJid: chat.remoteJidAlt ?? undefined,
        phone: phoneOf(chat.remoteJid),
        name: chat.pushName ?? null,
        isGroup: String(chat.remoteJid).endsWith('@g.us'),
        unreadCount: Number(chat.unreadCount) || 0,
        updatedAt: isoDate(chat.updatedAt),
        lastMessage: last
          ? {
              messageId: last.key?.id ?? null,
              fromMe: !!last.key?.fromMe,
              type: last.messageType ?? null,
              text: messageText(last.message, 200),
              timestamp: isoFromSeconds(last.messageTimestamp),
            }
          : null,
      };
    });

    return jsonResult({
      instance: resolved.name,
      total: filtered.length,
      offset,
      limit,
      hasMore: offset + limit < filtered.length,
      chats: page,
    });
  },
});

export const getMessages = defineTool({
  name: 'get_messages',
  title: 'Mensagens de um contato',
  description:
    'Lê as mensagens de uma conversa, da mais nova para a mais antiga (página 1 = mais recentes), como o findMessages: texto, quem enviou (contato, IA ou número da instância), data, tipo, se tem mídia e o messageId (use em get_media). Junta LID e telefone do mesmo contato.',
  input: {
    instance: instanceArg,
    contact: contactArg,
    page: z.number().int().min(1).max(10000).optional().describe('Página (1 = mais recentes). Padrão: 1.'),
    page_size: z.number().int().min(1).max(100).optional().describe('Mensagens por página (1 a 100). Padrão: 20.'),
  },
  annotations: READ_ONLY,
  run: async ({ instance, contact, page = 1, page_size = 20 }, ctx) => {
    const resolved = await resolveLoadedInstance(ctx, instance);
    const remoteJid = normalizeContactJid(contact);

    const result = await resolved.channel.fetchMessages({
      where: { key: { remoteJid } },
      page,
      offset: page_size,
      mergeLid: true,
    });

    const box = result?.messages ?? {};
    const records: any[] = Array.isArray(box.records) ? box.records : [];
    const messages = [];
    for (const record of records) messages.push(await messageView(ctx, resolved.id, record));

    return jsonResult({
      instance: resolved.name,
      contact: remoteJid,
      total: box.total ?? messages.length,
      pages: box.pages ?? 1,
      page: box.currentPage ?? page,
      pageSize: page_size,
      order: 'mais novas primeiro',
      note: SENDER_NOTE,
      messages,
    });
  },
});

const parseDate = (value: string | undefined, field: string, endOfDay = false): number | null => {
  if (!value) return null;

  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const time = new Date(dateOnly ? `${value}T${endOfDay ? '23:59:59' : '00:00:00'}-03:00` : value).getTime();
  if (!Number.isFinite(time)) throw new McpToolError(`${field} inválida: use AAAA-MM-DD ou data ISO 8601.`);

  return Math.floor(time / 1000);
};

export const searchMessagesTool = defineTool({
  name: 'search_messages',
  title: 'Buscar mensagens',
  description:
    'Busca mensagens pelo texto (conteúdo, legenda ou transcrição), opcionalmente de um contato e num intervalo de datas. Retorna no máximo 50, das mais novas para as mais antigas. Datas AAAA-MM-DD são do horário de Brasília.',
  input: {
    instance: instanceArg,
    text: z.string().min(2).max(200).describe('Trecho a procurar (mínimo 2 caracteres).'),
    contact: contactArg.optional(),
    from_date: z.string().max(40).optional().describe('Início (AAAA-MM-DD ou ISO 8601).'),
    to_date: z.string().max(40).optional().describe('Fim (AAAA-MM-DD ou ISO 8601), inclusive.'),
    limit: z.number().int().min(1).max(50).optional().describe('Máximo de resultados (1 a 50). Padrão: 20.'),
  },
  annotations: READ_ONLY,
  run: async ({ instance, text, contact, from_date, to_date, limit = 20 }, ctx) => {
    const resolved = await resolveInstance(ctx, instance);

    let remoteJids: string[] | null = null;
    if (contact) {
      const jid = normalizeContactJid(contact);
      remoteJids = resolved.channel?.resolveEquivalentJids ? await resolved.channel.resolveEquivalentJids(jid) : [jid];
    }

    const fromSeconds = parseDate(from_date, 'from_date');
    const toSeconds = parseDate(to_date, 'to_date', true);
    if (fromSeconds && toSeconds && fromSeconds > toSeconds) {
      throw new McpToolError('from_date é depois de to_date.');
    }

    const rows = await searchMessages(ctx.deps.prisma, ctx.deps.config.dbProvider, {
      instanceId: resolved.id,
      term: text.trim(),
      remoteJids,
      fromSeconds,
      toSeconds,
      limit,
    });

    const messages = [];
    for (const row of rows ?? []) messages.push(await messageView(ctx, resolved.id, row));

    return jsonResult({
      instance: resolved.name,
      query: text.trim(),
      contact: remoteJids ?? undefined,
      count: messages.length,
      limitReached: messages.length >= limit,
      note: SENDER_NOTE,
      messages,
    });
  },
});

export const getMedia = defineTool({
  name: 'get_media',
  title: 'Baixar mídia de uma mensagem',
  description:
    'Baixa a mídia de uma mensagem pelo messageId (o mesmo caminho do POST /chat/getBase64FromMediaMessage). Imagens de até 1,5 MB voltam como imagem; áudio, vídeo e documento voltam só com os metadados, e o conteúdo em base64 apenas com include_base64=true e até 2 MB. Arquivos maiores nunca são baixados.',
  input: {
    instance: instanceArg,
    message_id: z.string().min(4).max(128).describe('messageId da mensagem (campo messageId de get_messages).'),
    include_base64: z
      .boolean()
      .optional()
      .describe('Para áudio, vídeo e documento: inclui o arquivo em base64 (até 2 MB). Padrão: false.'),
  },
  annotations: { ...READ_ONLY, openWorldHint: true },
  run: async ({ instance, message_id, include_base64 }, ctx) => {
    const resolved = await resolveLoadedInstance(ctx, instance);

    // Metadata first, from the stored message: decides whether downloading is worth it (memory stays low)
    const stored = await findMessageByKeyId(ctx.deps.prisma, ctx.deps.config.dbProvider, resolved.id, message_id);
    if (!stored) throw new McpToolError(`mensagem "${message_id}" não encontrada nesta instância.`);

    const info = mediaInfo(stored.message);
    if (!info) throw new McpToolError('esta mensagem não tem mídia (texto, reação, localização etc.).');

    const isImage = info.kind === 'image' || info.kind === 'sticker';
    const maxBytes = isImage ? IMAGE_INLINE_MAX_BYTES : BASE64_MAX_BYTES;
    const metadata = {
      instance: resolved.name,
      messageId: message_id,
      remoteJid: stored.key?.remoteJid ?? null,
      fromMe: !!stored.key?.fromMe,
      timestamp: isoFromSeconds(stored.messageTimestamp),
      ...info,
      mediaUrl: typeof stored.message?.mediaUrl === 'string' ? stored.message.mediaUrl : undefined,
    };

    const wanted = isImage || !!include_base64;
    if (!wanted) {
      return jsonResult({
        ...metadata,
        included: false,
        note: 'Use include_base64=true para receber o arquivo (até 2 MB).',
      });
    }

    if (info.sizeBytes !== null && info.sizeBytes > maxBytes) {
      return jsonResult({
        ...metadata,
        included: false,
        note: `Arquivo de ${(info.sizeBytes / 1024 / 1024).toFixed(1)} MB: acima do limite de ${(maxBytes / 1024 / 1024).toFixed(1)} MB do MCP, não foi baixado.`,
      });
    }

    let media: any;
    try {
      media = await resolved.channel.getBase64FromMediaMessage({ message: { key: { id: message_id } } });
    } catch (error) {
      ctx.deps.logger.warn(`MCP get_media download failed: ${logMessage(error)}`);
      throw new McpToolError(
        'não foi possível baixar a mídia do WhatsApp (ela pode ter expirado no servidor do WhatsApp ou a instância está reconectando).',
      );
    }

    const base64: string | undefined = typeof media?.base64 === 'string' ? media.base64 : undefined;
    if (!base64) throw new McpToolError('o WhatsApp não devolveu o conteúdo desta mídia.');

    const bytes = Math.floor((base64.length * 3) / 4);
    const mimeType = media?.mimetype || info.mimetype || 'application/octet-stream';

    if (bytes > maxBytes) {
      return jsonResult({ ...metadata, sizeBytes: bytes, included: false, note: 'Arquivo acima do limite do MCP.' });
    }

    let extra: ToolContent;
    if (isImage) extra = { type: 'image', data: base64, mimeType };
    else if (info.kind === 'audio') extra = { type: 'audio', data: base64, mimeType };
    else {
      extra = {
        type: 'resource',
        resource: {
          uri: `whatsai://media/${encodeURIComponent(resolved.name)}/${encodeURIComponent(message_id)}`,
          mimeType,
          blob: base64,
        },
      };
    }

    return jsonResult({ ...metadata, mimetype: mimeType, sizeBytes: bytes, included: true }, [extra]);
  },
});

export const sendTextMessage = defineTool({
  name: 'send_text_message',
  title: 'Enviar mensagem de texto',
  description:
    'ENVIA uma mensagem de texto pelo WhatsApp da instância para um número (sai para o cliente de verdade). Confirme o texto e o destinatário com o usuário antes. Não envia para grupos. A mensagem não é marcada como da IA: se for assumir a conversa, pause o bot do contato antes (pause_bot_for_contact).',
  input: {
    instance: instanceArg,
    number: z
      .string()
      .min(8)
      .max(60)
      .describe('Destinatário: DDI + DDD + número, só dígitos (ex.: 5511999998888) ou JID …@s.whatsapp.net.'),
    text: z.string().min(1).max(4096).describe('Texto da mensagem (até 4096 caracteres).'),
    delay_ms: z
      .number()
      .int()
      .min(0)
      .max(10000)
      .optional()
      .describe('Espera com "digitando..." antes de enviar, em ms (0 a 10000).'),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  run: async ({ instance, number, text, delay_ms }, ctx) => {
    const recipient = normalizeRecipient(number);
    const resolved = await resolveLoadedInstance(ctx, instance);

    const state = connectionStateOf(resolved);
    if (state !== 'open') {
      throw new McpToolError(`a instância "${resolved.name}" não está conectada (estado: ${state ?? 'desconhecido'}).`);
    }

    const sent = await ctx.deps.sendMessageController.sendText(
      { instanceName: resolved.name },
      { number: recipient, text, delay: delay_ms },
    );

    return jsonResult({
      sent: true,
      instance: resolved.name,
      to: sent?.key?.remoteJid ?? recipient,
      messageId: sent?.key?.id ?? null,
      status: sent?.status ?? null,
      timestamp: isoFromSeconds(sent?.messageTimestamp),
    });
  },
});

export const chatTools = [listChats, getMessages, searchMessagesTool, getMedia, sendTextMessage];
