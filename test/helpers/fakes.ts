/**
 * Fakes shared by the unit and integration tests: a WhatsApp channel instance (what `waMonitor.waInstances[name]`
 * holds), an OpenAI client and message builders. No network is ever used.
 */
import { registerBotMessageId } from '@utils/botMessageRegistry';
import OpenAI from 'openai';

let sequence = 0;
export const nextId = (prefix = 'ID') =>
  `${prefix}${Date.now().toString(36)}${(++sequence).toString(36)}`.toUpperCase();

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls `predicate` until it is truthy (returns its value) or fails after `timeoutMs`. */
export async function waitFor<T>(predicate: () => T | Promise<T>, timeoutMs = 10000, label = 'condition'): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T;
  while (Date.now() < deadline) {
    last = await predicate();
    if (last) return last;
    await sleep(25);
  }
  throw new Error(`Timed out after ${timeoutMs} ms waiting for ${label}`);
}

export type SentMessage = { kind: 'text' | 'media' | 'audio'; data: any; fromChatbot: boolean; id: string; at: number };

/**
 * Fake channel instance. Every send is recorded; like the real channels, a send flagged `fromChatbot` registers its
 * message id before returning (Baileys pre-generates it, the Cloud API registers the returned wamid).
 */
export function createFakeWaInstance(instanceName: string, instanceId: string, integration = 'WHATSAPP-BAILEYS') {
  const sent: SentMessage[] = [];
  const webhooks: { event: string; data: any }[] = [];
  const presence: { state: string; jid: string }[] = [];

  const record = async (kind: SentMessage['kind'], data: any, fromChatbot: boolean) => {
    const id = nextId('3EB0');
    if (fromChatbot) await registerBotMessageId(instanceId, id);
    sent.push({ kind, data, fromChatbot, id, at: Date.now() });
    return { key: { id, remoteJid: `${data.number}@s.whatsapp.net`, fromMe: true } };
  };

  const instance: any = {
    instanceName,
    instanceId,
    integration,
    sent,
    webhooks,
    presence,
    /** Set to make getBase64FromMediaMessage return media (or throw when it is an Error). */
    media: null as null | Error | { base64: string; mimetype: string },
    client: {
      presenceSubscribe: async () => undefined,
      sendPresenceUpdate: async (state: string, jid: string) => void presence.push({ state, jid }),
    },
    // Same signatures as the channels: textMessage(data, isIntegration, fromChatbot),
    // mediaMessage / audioWhatsapp(data, file, isIntegration, fromChatbot)
    textMessage: (data: any, ...args: any[]) => record('text', data, args[1] === true),
    mediaMessage: (data: any, ...args: any[]) => record('media', data, args[2] === true),
    audioWhatsapp: (data: any, ...args: any[]) => record('audio', data, args[2] === true),
    sendDataWebhook: async (event: string, data: any) => void webhooks.push({ event, data }),
    getBase64FromMediaMessage: async () => {
      if (instance.media instanceof Error) throw instance.media;
      return instance.media;
    },
  };

  return instance;
}

export type FakeWaInstance = ReturnType<typeof createFakeWaInstance>;

export const texts = (instance: FakeWaInstance) =>
  instance.sent.filter((s) => s.kind === 'text').map((s) => s.data.text);

type CompletionHandler = (params: any, call: number) => any;

/**
 * Fake OpenAI client. `reply` queues answers (string, Error to throw, or a function); without queued answers it
 * answers `resposta <n>`. Every request is kept in `requests`.
 */
export function createFakeOpenai() {
  const requests: any[] = [];
  const queue: (string | Error | object | CompletionHandler)[] = [];

  const completion = (content: string | null, finishReason = 'stop') => ({
    id: nextId('chatcmpl-'),
    object: 'chat.completion',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finishReason }],
  });

  const client: any = {
    requests,
    completion,
    reset() {
      requests.length = 0;
      queue.length = 0;
      return client;
    },
    reply(...answers: (string | Error | object | CompletionHandler)[]) {
      queue.push(...answers);
      return client;
    },
    chat: {
      completions: {
        create: async (params: any) => {
          // Deep copy: the service keeps mutating its arrays after the call
          requests.push(JSON.parse(JSON.stringify(params)));
          const answer = queue.shift();
          if (typeof answer === 'function') return answer(params, requests.length);
          // Errors (or error-like objects, e.g. axios errors) are thrown
          if (answer && typeof answer === 'object') throw answer;
          return completion((answer as string | undefined) ?? `resposta ${requests.length}`);
        },
      },
    },
    files: { create: async () => ({ id: nextId('file-') }) },
    beta: {
      threads: {
        create: async () => ({ id: nextId('thread_') }),
        messages: { create: async () => ({}), list: async () => ({ data: [] }) },
        runs: { create: async () => ({ id: nextId('run_') }), retrieve: async () => ({ status: 'completed' }) },
      },
    },
  };

  return client;
}

export type FakeOpenai = ReturnType<typeof createFakeOpenai>;

/** Makes an OpenaiService use `fake` instead of a real client. */
export const useFakeOpenai = (service: any, fake: FakeOpenai) => {
  service.initClient = () => fake;
};

/** 400 "Unsupported parameter" exactly as the OpenAI SDK builds it. */
export const unsupportedParamError = (param: 'max_tokens' | 'max_completion_tokens') => {
  const other = param === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens';
  const message = `Unsupported parameter: '${param}' is not supported with this model. Use '${other}' instead.`;
  return OpenAI.APIError.generate(
    400,
    { error: { message, type: 'invalid_request_error', param, code: 'unsupported_parameter' } },
    undefined,
    {} as any,
  );
};

export const apiError = (status: number, message: string) =>
  OpenAI.APIError.generate(
    status,
    { error: { message, type: 'server_error', param: null, code: null } },
    undefined,
    {} as any,
  );

/** Baileys-like message as handed to the chatbot emit. */
export function textMsg(
  remoteJid: string,
  text: string,
  options: { fromMe?: boolean; id?: string; timestamp?: number; pushName?: string } = {},
) {
  return {
    key: { id: options.id ?? nextId('MSG'), remoteJid, fromMe: !!options.fromMe },
    pushName: options.pushName ?? (options.fromMe ? 'Dono' : 'Cliente'),
    message: { conversation: text },
    messageType: 'conversation',
    messageTimestamp: options.timestamp ?? Math.floor(Date.now() / 1000),
  };
}

export function imageMsg(remoteJid: string, options: { caption?: string; base64?: string; mimetype?: string } = {}) {
  const id = nextId('IMG');
  return {
    key: { id, remoteJid, fromMe: false },
    pushName: 'Cliente',
    message: {
      imageMessage: {
        mimetype: options.mimetype ?? 'image/jpeg',
        ...(options.caption ? { caption: options.caption } : {}),
      },
      ...(options.base64 ? { base64: options.base64 } : {}),
    },
    messageType: 'imageMessage',
    messageTimestamp: Math.floor(Date.now() / 1000),
  };
}
