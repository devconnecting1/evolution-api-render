/**
 * "Acesso do cliente": a separate access code per instance, so the client opens the panel with only the modules the
 * administrator chose (e.g. Conversas and Leads), while bot, prompt, integrations and every other setting stay with
 * the administrator.
 *
 * The code is NOT the instance token: it is a random `wac_...` string, stored only as a SHA-256 hash, and every
 * request made with it goes through `clientRouteAllowed` (server side, so hiding a screen is never the only barrier).
 * Pure functions here; the lookup and the cache live in client-access.service.ts.
 */
import { createHash, randomBytes } from 'crypto';

export const CLIENT_KEY_PREFIX = 'wac_';

export const CLIENT_MODULES = ['conversas', 'leads', 'agenda', 'processos', 'plano', 'conexao'] as const;
export type ClientModule = (typeof CLIENT_MODULES)[number];

/** Labels and what each module gives the client (shown in the panel and in the API answers). */
export const CLIENT_MODULE_INFO: Record<ClientModule, { label: string; description: string }> = {
  conversas: { label: 'Conversas', description: 'Ler e responder as conversas, pausar ou retomar a IA em um contato' },
  leads: { label: 'Leads', description: 'Triagem dos atendimentos, planilha e reanálise (sem mudar as configurações)' },
  agenda: {
    label: 'Agenda',
    description: 'Ver, marcar, remarcar e cancelar agendamentos (sem mudar horários e regras)',
  },
  processos: { label: 'Processos', description: 'Andamentos e intimações (sem mudar OAB e configurações)' },
  plano: { label: 'Plano e uso', description: 'Respostas da IA usadas no mês e a franquia do plano' },
  conexao: { label: 'Conexão', description: 'Ver se o WhatsApp está conectado e ler o QR code para reconectar' },
};

/** Recommended set when the administrator turns the access on without choosing. */
export const DEFAULT_CLIENT_MODULES: ClientModule[] = ['conversas', 'leads', 'conexao'];

export const isClientKey = (key: unknown): key is string =>
  typeof key === 'string' && key.startsWith(CLIENT_KEY_PREFIX) && key.length >= 30 && key.length <= 80;

export const hashClientKey = (key: string): string => createHash('sha256').update(key, 'utf8').digest('hex');

/** New code: `wac_` + 32 random bytes in base64url (43 characters). Shown once; only the hash is stored. */
export function generateClientKey(): { key: string; hash: string; hint: string } {
  const key = CLIENT_KEY_PREFIX + randomBytes(32).toString('base64url');
  return { key, hash: hashClientKey(key), hint: `${CLIENT_KEY_PREFIX}…${key.slice(-4)}` };
}

/** Keeps the known modules, in the canonical order, without repetition. */
export function normalizeModules(input: unknown): ClientModule[] {
  const list = Array.isArray(input) ? input : [];
  return CLIENT_MODULES.filter((module) => list.includes(module));
}

export function validateModulesInput(input: unknown): string[] {
  if (!Array.isArray(input)) return ['"modules" deve ser uma lista.'];
  const unknown = input.filter((item) => !(CLIENT_MODULES as readonly unknown[]).includes(item));
  if (unknown.length) return [`Módulos desconhecidos: ${unknown.join(', ')}. Use: ${CLIENT_MODULES.join(', ')}.`];
  if (!input.length) return ['Escolha pelo menos um módulo.'];
  return [];
}

type Rule = {
  methods: string[];
  /** Path with the instance name replaced by ":i" (query string removed). */
  pattern: RegExp;
  /** Extra check on the request body (e.g. pausing the bot only for one contact). */
  body?: (body: any) => boolean;
};

const ANY = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/** Allowed with any module: who am I, the instance itself and the small header widgets. */
const BASE_RULES: Rule[] = [
  { methods: ['GET'], pattern: /^\/client-access\/me$/ },
  { methods: ['GET'], pattern: /^\/instance\/fetchInstances$/ },
  { methods: ['GET'], pattern: /^\/instance\/connectionState\/:i$/ },
  { methods: ['GET'], pattern: /^\/usage\/summary\/:i$/ },
  { methods: ['GET'], pattern: /^\/processos\/:i\/badge$/ },
  { methods: ['POST'], pattern: /^\/verify-creds$/ },
];

const CHAT_ACTIONS =
  'findChats|findMessages|findContacts|findChatByRemoteJid|findStatusMessage|fetchProfilePictureUrl|' +
  'getBase64FromMediaMessage|markMessageAsRead|markChatUnread|archiveChat';
const SEND_ACTIONS = 'sendText|sendMedia|sendWhatsAppAudio|sendReaction|sendContact|sendLocation|sendSticker';

const MODULE_RULES: Record<ClientModule, Rule[]> = {
  conversas: [
    { methods: ['POST'], pattern: new RegExp(`^/chat/(${CHAT_ACTIONS})/:i$`) },
    { methods: ['POST'], pattern: new RegExp(`^/message/(${SEND_ACTIONS})/:i$`) },
    // bot state per contact (the "IA ativa / pausada" switch of the chat)
    { methods: ['GET'], pattern: /^\/openai\/fetchSessions\/[^/]+\/:i$/ },
    {
      methods: ['POST'],
      pattern: /^\/openai\/changeStatus\/:i$/,
      body: (body) => typeof body?.remoteJid === 'string' && body.remoteJid.length > 0 && body.remoteJid !== 'all',
    },
  ],
  leads: [
    { methods: ANY, pattern: /^\/leads\/:i(\/[^/]+)?$/ },
    { methods: ['POST'], pattern: /^\/leads\/:i\/(analyze|refresh-waiting)$/ },
    { methods: ['GET', 'POST'], pattern: /^\/leads\/backfill\/:i$/ },
    { methods: ['GET'], pattern: /^\/leads\/settings\/:i$/ },
  ],
  agenda: [
    { methods: ['GET', 'POST'], pattern: /^\/agenda\/:i$/ },
    { methods: ['GET'], pattern: /^\/agenda\/:i\/(slots|export\.ics)$/ },
    { methods: ['PATCH', 'DELETE'], pattern: /^\/agenda\/:i\/[^/]+$/ },
    { methods: ['GET'], pattern: /^\/agenda\/settings\/:i$/ },
    // the office connects its own Google Agenda (status, connect, disconnect)
    { methods: ['GET', 'DELETE'], pattern: /^\/agenda\/google\/:i$/ },
    { methods: ['POST'], pattern: /^\/agenda\/google\/:i\/connect$/ },
  ],
  processos: [
    { methods: ['GET', 'POST'], pattern: /^\/processos\/:i$/ },
    { methods: ['GET'], pattern: /^\/processos\/:i\/(export\.csv|settings|oab|publicacoes)$/ },
    { methods: ['POST'], pattern: /^\/processos\/:i\/(publicacoes\/seen|bulk)$/ },
    { methods: ['GET', 'PUT', 'DELETE'], pattern: /^\/processos\/:i\/[^/]+$/ },
    { methods: ['POST'], pattern: /^\/processos\/:i\/[^/]+\/(sync|seen)$/ },
  ],
  plano: [{ methods: ['GET'], pattern: /^\/usage\/limits\/:i$/ }],
  conexao: [{ methods: ['GET'], pattern: /^\/instance\/connect\/:i$/ }],
};

/** Writes that stay with the administrator even inside an allowed module. */
const DENIED: Rule[] = [
  { methods: ['POST', 'PUT', 'PATCH', 'DELETE'], pattern: /^\/processos\/:i\/(settings|oab)(\/[^/]+)?$/ },
];

/**
 * Path of the request with the instance name replaced by ":i". `originalUrl` keeps the name URL-encoded, so each
 * segment is decoded before the comparison ("Renato%20Paix%C3%A3o" -> "Renato Paixão").
 */
export function normalizeClientPath(originalUrl: string, instanceName?: string | null): string {
  const path = (originalUrl || '').split('?')[0].replace(/\/+$/, '') || '/';
  const segments = path.split('/').map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  });
  if (instanceName) {
    for (let i = 0; i < segments.length; i++) if (segments[i] === instanceName) segments[i] = ':i';
  }
  return segments.join('/');
}

export function clientRouteAllowed(
  method: string,
  normalizedPath: string,
  modules: readonly ClientModule[],
  body?: unknown,
): boolean {
  const verb = (method || '').toUpperCase();
  const match = (rule: Rule) =>
    rule.methods.includes(verb) && rule.pattern.test(normalizedPath) && (!rule.body || rule.body(body));
  if (DENIED.some(match)) return false;
  if (BASE_RULES.some(match)) return true;
  return modules.some((module) => (MODULE_RULES[module] ?? []).some(match));
}

/** The instance as the client sees it: no instance token, no integration secrets; `token` is the client's own code. */
export function clientInstanceView(info: any, clientKey: string) {
  if (!info || typeof info !== 'object') return info;
  const keep = [
    'id',
    'name',
    'connectionStatus',
    'ownerJid',
    'profileName',
    'profilePicUrl',
    'integration',
    'number',
    'clientName',
    'createdAt',
    'updatedAt',
    '_count',
  ];
  const view: Record<string, unknown> = {};
  for (const key of keep) if (key in info) view[key] = info[key];
  view.token = clientKey;
  return view;
}
