import { z } from 'zod';

import { connectionStateOf, requireGlobal, resolveInstance, visibleInstancesWhere } from '../mcp.instance';
import { defineTool, instanceArg, READ_ONLY } from '../mcp.tool';
import { isoDate, jsonResult, maskSecret, maskUrl, scrubSecrets } from '../mcp.util';

const INSTANCE_FIELDS = {
  id: true,
  name: true,
  connectionStatus: true,
  ownerJid: true,
  profileName: true,
  integration: true,
  number: true,
  disconnectionReasonCode: true,
  disconnectionAt: true,
  createdAt: true,
  updatedAt: true,
};

const instanceView = (row: any, liveState: string | null, loaded: boolean) => ({
  name: row.name,
  id: row.id,
  integration: row.integration ?? null,
  connectionState: liveState ?? row.connectionStatus ?? null,
  storedConnectionStatus: row.connectionStatus ?? null,
  loaded,
  ownerJid: row.ownerJid ?? null,
  ownerNumber: typeof row.ownerJid === 'string' ? row.ownerJid.split('@')[0].split(':')[0] : null,
  profileName: row.profileName ?? null,
  businessNumberId: row.integration === 'WHATSAPP-BUSINESS' ? (row.number ?? null) : undefined,
  disconnection: row.disconnectionAt
    ? { at: isoDate(row.disconnectionAt), reasonCode: row.disconnectionReasonCode ?? null }
    : null,
  createdAt: isoDate(row.createdAt),
  updatedAt: isoDate(row.updatedAt),
});

export const listInstances = defineTool({
  name: 'list_instances',
  title: 'Listar instâncias',
  description:
    'Lista as instâncias (números de WhatsApp) do WhatsAI: nome, estado da conexão, número do dono, integração (Baileys ou Cloud API). Com token de instância, mostra só a própria. Use primeiro para descobrir o nome da instância.',
  input: {
    include_counts: z
      .boolean()
      .optional()
      .describe('Inclui a contagem de chats e contatos (uma consulta a mais). Padrão: false.'),
  },
  annotations: READ_ONLY,
  run: async ({ include_counts }, ctx) => {
    const rows = await ctx.deps.prisma.instance.findMany({
      where: visibleInstancesWhere(ctx),
      select: { ...INSTANCE_FIELDS, ...(include_counts ? { _count: { select: { Chat: true, Contact: true } } } : {}) },
      orderBy: { name: 'asc' },
      take: 100,
    });

    const instances = (rows ?? []).map((row: any) => {
      const channel = ctx.deps.waMonitor?.waInstances?.[row.name];
      return {
        ...instanceView(row, channel?.connectionStatus?.state ?? null, !!channel),
        counts: row._count ? { chats: row._count.Chat, contacts: row._count.Contact } : undefined,
      };
    });

    return jsonResult({ total: instances.length, scope: ctx.auth.scope, instances });
  },
});

export const getInstanceStatus = defineTool({
  name: 'get_instance_status',
  title: 'Estado da instância',
  description:
    'Mostra o estado de uma instância: conexão ao vivo (open, connecting, close), se está carregada no servidor, número do dono, perfil e a última desconexão.',
  input: { instance: instanceArg },
  annotations: READ_ONLY,
  run: async ({ instance }, ctx) => {
    const resolved = await resolveInstance(ctx, instance);
    const state = connectionStateOf(resolved);

    return jsonResult({
      ...instanceView(resolved.row, state, !!resolved.channel),
      hint:
        state === 'open'
          ? 'Conectada.'
          : 'Não está conectada: a reconexão é automática; se persistir, reconecte pelo painel (QR code ou Cloud API).',
    });
  },
});

export const getWebhookAndSettings = defineTool({
  name: 'get_webhook_and_settings',
  title: 'Webhook e configurações',
  description:
    'Mostra as configurações da instância (rejeitar chamadas, ignorar grupos, sempre online, ler mensagens etc.) e o webhook configurado (URL, eventos). Segredos, cabeçalhos e parâmetros da URL vêm mascarados.',
  input: { instance: instanceArg },
  annotations: READ_ONLY,
  run: async ({ instance }, ctx) => {
    const resolved = await resolveInstance(ctx, instance);

    const [settings, webhook] = await Promise.all([
      ctx.deps.prisma.setting.findUnique({ where: { instanceId: resolved.id } }),
      ctx.deps.prisma.webhook.findUnique({ where: { instanceId: resolved.id } }),
    ]);

    const settingsView = settings
      ? scrubSecrets({
          rejectCall: settings.rejectCall,
          msgCall: settings.msgCall,
          groupsIgnore: settings.groupsIgnore,
          alwaysOnline: settings.alwaysOnline,
          readMessages: settings.readMessages,
          readStatus: settings.readStatus,
          syncFullHistory: settings.syncFullHistory,
          wavoipToken: settings.wavoipToken,
          updatedAt: isoDate(settings.updatedAt),
        })
      : null;

    const headers =
      webhook?.headers && typeof webhook.headers === 'object' && !Array.isArray(webhook.headers)
        ? Object.fromEntries(
            Object.keys(webhook.headers).map((key) => [key, maskSecret(webhook.headers[key]) ?? '****']),
          )
        : null;

    const webhookView = webhook
      ? {
          enabled: webhook.enabled,
          url: maskUrl(webhook.url),
          events: Array.isArray(webhook.events) ? webhook.events : [],
          webhookByEvents: webhook.webhookByEvents,
          webhookBase64: webhook.webhookBase64,
          headers,
          updatedAt: isoDate(webhook.updatedAt),
        }
      : null;

    return jsonResult({ instance: resolved.name, settings: settingsView, webhook: webhookView });
  },
});

export const getObservability = defineTool({
  name: 'get_observability',
  title: 'Observabilidade',
  description:
    'Mostra o mesmo resumo da página Observabilidade do painel: consumo e limites de Neon, Render, Vercel e GitHub Actions, alertas e último deploy. Usa o cache de 60 s do servidor. Exige a chave global.',
  input: {
    refresh: z
      .boolean()
      .optional()
      .describe('Ignora o cache de 60 s e consulta os provedores de novo (mais lento). Padrão: false.'),
  },
  annotations: { ...READ_ONLY, openWorldHint: true },
  run: async ({ refresh }, ctx) => {
    requireGlobal(ctx, 'A observabilidade');

    const overview = await ctx.deps.observability.getOverview(!!refresh);
    return jsonResult(scrubSecrets(overview));
  },
});

export const instanceTools = [listInstances, getInstanceStatus, getWebhookAndSettings, getObservability];
