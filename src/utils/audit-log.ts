/**
 * "Registro de ações": who did what, when and on which instance, for the requests that change something an
 * administrator cares about (pausing the AI for a contact, deleting, exporting, changing settings, keys and access).
 *
 * One central list instead of a call in every controller: `auditActionFor` recognizes a finished request by method
 * and path and gives it a label in plain Portuguese. Nothing from the request body is kept, except the few safe
 * fields named below (the AI status of a contact, the name of a new instance or team key); never message content,
 * prompts, keys or tokens. Pure functions; the writer lives in audit-log.service.ts.
 */

export const AUDIT_TYPES = [
  'instancia',
  'ia',
  'conversas',
  'leads',
  'agenda',
  'processos',
  'ajustes',
  'plano',
  'acesso',
  'credenciais',
  'retencao',
  'exportacao',
] as const;
export type AuditType = (typeof AUDIT_TYPES)[number];

export const AUDIT_TYPE_LABEL: Record<AuditType, string> = {
  instancia: 'Instância',
  ia: 'IA',
  conversas: 'Conversas',
  leads: 'Leads',
  agenda: 'Agenda',
  processos: 'Processos',
  ajustes: 'Ajustes',
  plano: 'Plano e limites',
  acesso: 'Acessos e equipe',
  credenciais: 'Credenciais',
  retencao: 'Retenção',
  exportacao: 'Exportação',
};

export type AuditAction = { type: AuditType; action: string; instanceName?: string | null; target?: string | null };

type Rule = {
  methods: string[];
  /** Matched against the decoded path, query string removed. Group "i" = instance name. */
  pattern: RegExp;
  type: AuditType;
  action: string | ((ctx: { method: string; body: any; m: RegExpExecArray }) => string | null);
  target?: (ctx: { method: string; body: any; m: RegExpExecArray }) => string | null;
  /** The instance is named in the body, not in the path (instance creation). */
  instanceFromBody?: (body: any) => string | null;
};

const I = '(?<i>[^/]+)';
const WRITE = ['POST', 'PUT', 'PATCH', 'DELETE'];
const BOTS = 'openai|typebot|dify|n8n|evoai|flowise|evolutionBot';
const BOT_LABEL: Record<string, string> = {
  openai: 'atendente IA',
  typebot: 'Typebot',
  dify: 'Dify',
  n8n: 'n8n',
  evoai: 'EvoAI',
  flowise: 'Flowise',
  evolutionBot: 'Evolution Bot',
};

/** "5521900000011@s.whatsapp.net" -> "+55 21 9****-0011": enough to tell contacts apart, not a full number. */
export function maskJid(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  if (value === 'all') return 'todos os contatos';
  const digits = value.split('@')[0].replace(/\D/g, '');
  if (digits.length < 8) return null;
  const cc = digits.slice(0, 2);
  const ddd = digits.slice(2, 4);
  const last = digits.slice(-4);
  const first = digits.slice(4, 5);
  return `+${cc} ${ddd} ${first}****-${last}`;
}

const short = (value: unknown, max = 80): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().replace(/\s+/g, ' ').slice(0, max) : null;

const RULES: Rule[] = [
  // instance
  {
    methods: ['POST'],
    pattern: /^\/instance\/create$/,
    type: 'instancia',
    action: 'Criou a instância',
    instanceFromBody: (body) => short(body?.instanceName, 120),
  },
  {
    methods: ['DELETE'],
    pattern: new RegExp(`^/instance/delete/${I}$`),
    type: 'instancia',
    action: 'Excluiu a instância',
  },
  {
    methods: ['DELETE'],
    pattern: new RegExp(`^/instance/logout/${I}$`),
    type: 'instancia',
    action: 'Desconectou o WhatsApp',
  },
  {
    methods: ['POST', 'PUT'],
    pattern: new RegExp(`^/instance/restart/${I}$`),
    type: 'instancia',
    action: 'Reiniciou a instância',
  },
  // AI per contact (the "IA ativa / pausada" switch)
  {
    methods: ['POST'],
    pattern: new RegExp(`^/(${BOTS})/changeStatus/${I}$`),
    type: 'ia',
    action: ({ body }) =>
      body?.status === 'paused'
        ? 'Pausou a IA'
        : body?.status === 'opened'
          ? 'Retomou a IA'
          : body?.status === 'closed'
            ? 'Encerrou a sessão da IA'
            : 'Mudou o estado da IA',
    target: ({ body }) => maskJid(body?.remoteJid),
  },
  // AI credentials
  {
    methods: WRITE,
    pattern: new RegExp(`^/openai/creds(/[^/]+)?/${I}$`),
    type: 'credenciais',
    action: ({ method }) => (method === 'DELETE' ? 'Removeu uma credencial da IA' : 'Alterou as credenciais da IA'),
  },
  // bots and their settings
  {
    methods: WRITE,
    pattern: new RegExp(`^/(?<bot>${BOTS})/(create|update|delete|settings|ignoreJid)(/[^/]+)?/${I}$`),
    type: 'ia',
    action: ({ m }) => `Alterou o ${BOT_LABEL[m.groups?.bot ?? ''] ?? 'robô'}`,
  },
  { methods: WRITE, pattern: new RegExp(`^/chatwoot/set/${I}$`), type: 'ajustes', action: 'Alterou o Chatwoot' },
  // messages
  {
    methods: ['DELETE'],
    pattern: new RegExp(`^/chat/deleteMessageForEveryone/${I}$`),
    type: 'conversas',
    action: 'Apagou uma mensagem para todos',
  },
  // settings and events
  { methods: WRITE, pattern: new RegExp(`^/settings/set/${I}$`), type: 'ajustes', action: 'Alterou o comportamento' },
  {
    methods: WRITE,
    pattern: new RegExp(`^/(?<ev>webhook|websocket|rabbitmq|sqs|nats|pusher|kafka)/set/${I}$`),
    type: 'ajustes',
    action: ({ m }) => `Alterou os eventos (${m.groups?.ev})`,
  },
  { methods: WRITE, pattern: new RegExp(`^/proxy/set/${I}$`), type: 'ajustes', action: 'Alterou o proxy' },
  // leads
  {
    methods: ['DELETE'],
    pattern: new RegExp(`^/leads/${I}/[^/]+$`),
    type: 'leads',
    action: 'Excluiu um lead',
  },
  { methods: ['PATCH', 'PUT'], pattern: new RegExp(`^/leads/${I}/[^/]+$`), type: 'leads', action: 'Editou um lead' },
  {
    methods: ['POST'],
    pattern: new RegExp(`^/leads/settings/${I}$`),
    type: 'leads',
    action: 'Alterou as configurações de leads',
  },
  {
    methods: ['POST'],
    pattern: new RegExp(`^/leads/backfill/${I}$`),
    type: 'leads',
    action: 'Analisou conversas anteriores',
  },
  {
    methods: ['GET'],
    pattern: new RegExp(`^/leads/${I}/export\\.(xlsx|json|csv)$`),
    type: 'exportacao',
    action: 'Exportou os leads',
  },
  // agenda
  {
    methods: ['POST'],
    pattern: new RegExp(`^/agenda/settings/${I}(/ics-token)?$`),
    type: 'agenda',
    action: 'Alterou as configurações da agenda',
  },
  {
    methods: ['DELETE'],
    pattern: new RegExp(`^/agenda/${I}/[^/]+$`),
    type: 'agenda',
    action: 'Cancelou um agendamento',
  },
  {
    methods: ['POST', 'DELETE'],
    pattern: new RegExp(`^/agenda/google/${I}(/connect)?$`),
    type: 'agenda',
    action: ({ method }) => (method === 'DELETE' ? 'Desconectou o Google Agenda' : 'Conectou o Google Agenda'),
  },
  {
    methods: ['GET'],
    pattern: new RegExp(`^/agenda/${I}/export\\.ics$`),
    type: 'exportacao',
    action: 'Exportou a agenda',
  },
  // processos
  {
    methods: WRITE,
    pattern: new RegExp(`^/processos/${I}/(settings|oab)(/[^/]+)?$`),
    type: 'processos',
    action: 'Alterou as configurações de processos',
  },
  {
    methods: ['DELETE'],
    pattern: new RegExp(`^/processos/${I}/[^/]+$`),
    type: 'processos',
    action: 'Removeu um processo',
  },
  {
    methods: ['GET'],
    pattern: new RegExp(`^/processos/${I}/export\\.csv$`),
    type: 'exportacao',
    action: 'Exportou os processos',
  },
  // plan, client access, team, credentials, retention
  {
    methods: WRITE,
    pattern: new RegExp(`^/usage/limits/${I}$`),
    type: 'plano',
    action: 'Alterou o plano e os limites',
  },
  {
    methods: ['POST'],
    pattern: new RegExp(`^/client-access/${I}$`),
    type: 'acesso',
    action: ({ body }) => (body?.newKey === true ? 'Gerou um novo código do cliente' : 'Alterou o acesso do cliente'),
  },
  {
    methods: ['DELETE'],
    pattern: new RegExp(`^/client-access/${I}$`),
    type: 'acesso',
    action: 'Removeu o acesso do cliente',
  },
  {
    methods: ['POST'],
    pattern: /^\/team$/,
    type: 'acesso',
    action: 'Criou uma chave de equipe',
    target: ({ body }) => short(body?.name),
  },
  { methods: ['DELETE'], pattern: /^\/team\/[^/]+$/, type: 'acesso', action: 'Revogou uma chave de equipe' },
  // "Chaves e credenciais" only reads; revealing a secret is worth recording (which one is not kept)
  {
    methods: ['POST'],
    pattern: /^\/admin\/credentials\/reveal$/,
    type: 'credenciais',
    action: 'Revelou uma credencial',
  },
  {
    methods: ['POST'],
    pattern: /^\/admin\/retention\/run$/,
    type: 'retencao',
    action: 'Apagou mensagens antigas agora',
  },
  { methods: ['POST', 'PUT'], pattern: /^\/admin\/retention$/, type: 'retencao', action: 'Alterou o prazo de guarda' },
  {
    methods: ['GET'],
    pattern: /^\/admin\/audit\/export\.csv$/,
    type: 'exportacao',
    action: 'Exportou o registro de ações',
  },
];

/** Decoded path without the query string and the trailing slash. */
export function auditPath(originalUrl: string): string {
  const path = (originalUrl || '').split('?')[0].replace(/\/+$/, '') || '/';
  return path
    .split('/')
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join('/');
}

/** The label of a finished request, or null when it is not one we record. */
export function auditActionFor(method: string, originalUrl: string, body?: unknown): AuditAction | null {
  const verb = (method || '').toUpperCase();
  const path = auditPath(originalUrl);
  for (const rule of RULES) {
    if (!rule.methods.includes(verb)) continue;
    const m = rule.pattern.exec(path);
    if (!m) continue;
    const ctx = { method: verb, body: body && typeof body === 'object' ? body : {}, m };
    const action = typeof rule.action === 'function' ? rule.action(ctx) : rule.action;
    if (!action) return null;
    const instanceName = m.groups?.i ?? (rule.instanceFromBody ? rule.instanceFromBody(ctx.body) : null);
    return {
      type: rule.type,
      action,
      instanceName: instanceName ?? null,
      target: rule.target ? rule.target(ctx) : null,
    };
  }
  return null;
}

/** "203.0.113.57" -> "203.0.113.0"; IPv6 keeps the first three groups. Enough to tell places apart. */
export function truncateIp(ip: unknown): string | null {
  if (typeof ip !== 'string' || !ip) return null;
  const clean = ip.replace(/^::ffff:/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(clean)) return clean.replace(/\.\d+$/, '.0');
  if (clean.includes(':')) return clean.split(':').slice(0, 3).join(':') + '::';
  return null;
}

/** One CSV cell: quoted, inner quotes doubled, and a leading = + - @ neutralized (formula injection). */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
