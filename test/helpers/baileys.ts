/**
 * A BaileysStartupService with a mocked Prisma and a fake socket, to call its handlers (messages.upsert, call,
 * getMessage) without a database or a WhatsApp connection. Import after '../helpers/setup'.
 */
import { BaileysStartupService } from '@api/integrations/channel/whatsapp/whatsapp.baileys.service';
import { configService } from '@config/env.config';
import EventEmitter2 from 'eventemitter2';

import { chatbotEmitCalls } from './chatbot-emit';
import { nextId } from './fakes';

export const INSTANCE_ID = 'inst-baileys-unit';
const CONTACT = '5511987654321@s.whatsapp.net';

type Row = { id: string; key: any; message: any; [field: string]: any };

export function createBaileysService() {
  const rows: Row[] = [];
  const state = {
    rows,
    created: [] as any[],
    failCreateFor: new Set<string>(),
    /** Prisma code of the create failure, e.g. P1001 (database unreachable). */
    failCreateCode: undefined as string | undefined,
    failQuery: false,
    queries: 0,
    openaiSetting: null as any,
    errors: [] as string[],
    warnings: [] as string[],
    placeholderRequests: [] as any[],
    historyRequests: [] as any[],
    transcribed: [] as any[],
    sent: [] as any[],
    rejected: [] as any[],
    updates: [] as { model: string; args: any }[],
    webhooks: [] as { event: string; data: any }[],
  };

  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_target, op: string) => async (args: any) => {
          if (name === 'message' && op === 'create') {
            const id = args?.data?.key?.id;
            if (state.failCreateFor.has(id)) {
              throw Object.assign(new Error(`create failed for ${id}`), { code: state.failCreateCode });
            }
            const row = { id: `row-${nextId()}`, ...args.data };
            rows.push(row);
            state.created.push(args.data);
            return row;
          }
          if (op === 'update') state.updates.push({ model: name, args });
          if (name === 'openaiSetting' && op === 'findFirst') return state.openaiSetting;
          if (op === 'count') return 0;
          return null;
        },
      },
    );

  const prisma: any = new Proxy(
    {
      $queryRaw: async (strings: TemplateStringsArray, ...values: any[]) => {
        state.queries++;
        if (state.failQuery) throw new Error('P1001: database unreachable');
        const sql = strings.join('?');
        if (/FROM "Message"/.test(sql) && /"key"->>'id'/.test(sql)) {
          const [instanceId, keyId] = values;
          return rows.filter((row) => row.instanceId === instanceId && row.key?.id === keyId).slice(0, 1);
        }
        return [];
      },
      $executeRaw: async () => 0,
    },
    { get: (target: any, name: string) => (name in target ? target[name] : model(name)) },
  );

  const cache: any = {
    get: async () => null,
    set: async () => undefined,
    delete: async () => undefined,
    hSet: async () => undefined,
  };

  const service: any = new BaileysStartupService(
    configService,
    new EventEmitter2(),
    prisma,
    cache,
    cache,
    cache,
    {} as any,
  );
  service.setInstance({ instanceName: 'baileys-unit', instanceId: INSTANCE_ID, integration: 'WHATSAPP-BAILEYS' });
  Object.assign(service.localSettings, { readMessages: false, readStatus: false, groupsIgnore: false });
  service.localWebhook = { enabled: false };
  service.localChatwoot = { enabled: false };
  service.sendDataWebhook = async (event: string, data: any) => void state.webhooks.push({ event, data });
  service.logger.error = (value: any) => void state.errors.push(String(value));
  service.logger.warn = (value: any) => void state.warnings.push(String(value));
  service.openaiService = {
    speechToText: async (received: any) => {
      state.transcribed.push(received);
      return 'áudio transcrito';
    },
  };

  service.client = {
    user: { id: '5511900000000:1@s.whatsapp.net' },
    readMessages: async () => undefined,
    profilePictureUrl: async () => null,
    requestPlaceholderResend: async (key: any) => {
      state.placeholderRequests.push(key);
      // Baileys records the id it asks the phone to resend in the socket's placeholderResendCache
      await service.placeholderResendTracker.cache.set(key.id, true);
      return 'PDO-1';
    },
    fetchMessageHistory: async (...args: any[]) => {
      state.historyRequests.push(args);
      return 'HIST-1';
    },
    rejectCall: async (...args: any[]) => void state.rejected.push(args),
    sendMessage: async (jid: string, content: any, options: any) => {
      state.sent.push({ jid, content, options });
      return {
        key: { id: options?.messageId ?? nextId('3EB0'), remoteJid: jid, fromMe: true },
        message: { conversation: content.text },
        messageTimestamp: Math.floor(Date.now() / 1000),
      };
    },
    ev: { emit: () => undefined },
    signalRepository: { lidMapping: { getPNForLID: async (lid: string) => lid } },
  };

  const upsert = (messages: any[], extra: Record<string, any> = {}) =>
    service.messageHandle['messages.upsert']({ messages, type: 'notify', ...extra }, {});

  return { service, state, upsert };
}

export const incoming = (message: any, key: Record<string, any> = {}) => ({
  key: { id: nextId('3A'), remoteJid: CONTACT, fromMe: false, ...key },
  message,
  messageTimestamp: Math.floor(Date.now() / 1000),
  pushName: 'Cliente',
});

export const emitsFor = (id: string) => chatbotEmitCalls.filter((call) => call.msg?.key?.id === id);
