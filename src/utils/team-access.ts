/**
 * "Equipe": uma chave por pessoa, criada pelo dono (a chave global ou uma chave de papel "dono"), com um papel e,
 * opcionalmente, uma lista de instâncias. A chave global continua sendo o dono e funciona como antes.
 *
 * Como os códigos de cliente (src/utils/client-access.ts), a chave de equipe é uma string aleatória `wat_...` guardada
 * apenas como hash SHA-256, e toda requisição feita com ela passa por `teamRouteAllowed` no servidor; o painel só
 * esconde o que o papel não pode fazer. Funções puras aqui; a busca e o cache ficam em team-access.service.ts.
 *
 * Papéis:
 * - "dono": igual à chave global, inclusive nas rotas de administrador (/admin, códigos de cliente, equipe, plano,
 *   credenciais). Se a chave tiver instâncias marcadas, continua limitada a elas.
 * - "equipe": tudo dentro das instâncias liberadas (conversas, IA ligada/desligada por contato, robô, agenda,
 *   processos, leads, ajustes, webhooks), menos o que fica com o dono: criar ou excluir instância, desconectar o
 *   WhatsApp, credenciais da IA, plano e limites, acesso do cliente, chaves de equipe, exportações, retenção e toda
 *   rota /admin.
 * - "leitura": só leitura. Rotas GET e as poucas leituras que a Evolution expõe como POST (findChats, findMessages…).
 *   Nunca envia, pausa, edita, apaga ou pareia um aparelho.
 */
import { createHash, randomBytes } from 'crypto';

export const TEAM_KEY_PREFIX = 'wat_';

export const TEAM_ROLES = ['dono', 'equipe', 'leitura'] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export const TEAM_ROLE_INFO: Record<TeamRole, { label: string; description: string }> = {
  dono: {
    label: 'Dono',
    description:
      'Acesso igual à chave global: administra instâncias, equipe, acessos, plano e credenciais. Se a chave tiver ' +
      'instâncias marcadas, continua limitada a elas.',
  },
  equipe: {
    label: 'Equipe',
    description:
      'Atende e configura as instâncias liberadas: conversas, IA, agenda, processos, leads e ajustes. ' +
      'Não cria nem exclui instâncias, não desconecta o WhatsApp, não exporta e não mexe em credenciais, plano, ' +
      'acesso do cliente e equipe.',
  },
  leitura: {
    label: 'Só leitura',
    description:
      'Vê conversas, leads, agenda, processos e relatórios. Não envia, não pausa, não edita e não apaga nada.',
  },
};

export const isTeamKey = (key: unknown): key is string =>
  typeof key === 'string' && key.startsWith(TEAM_KEY_PREFIX) && key.length >= 30 && key.length <= 80;

export const hashTeamKey = (key: string): string => createHash('sha256').update(key, 'utf8').digest('hex');

/** Chave nova: `wat_` + 32 bytes aleatórios em base64url (43 caracteres). Mostrada uma vez; só o hash é guardado. */
export function generateTeamKey(): { key: string; hash: string; hint: string } {
  const key = TEAM_KEY_PREFIX + randomBytes(32).toString('base64url');
  return { key, hash: hashTeamKey(key), hint: `${TEAM_KEY_PREFIX}…${key.slice(-4)}` };
}

export const isTeamRole = (role: unknown): role is TeamRole => (TEAM_ROLES as readonly unknown[]).includes(role);

type Rule = { methods: string[]; pattern: RegExp };

const ANY = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const WRITE = ['POST', 'PUT', 'PATCH', 'DELETE'];

/** As únicas rotas sem instância no caminho que uma chave que não é dona pode chamar. */
const NO_INSTANCE_RULES: Rule[] = [
  { methods: ['GET'], pattern: /^\/instance\/fetchInstances$/ },
  { methods: ['POST'], pattern: /^\/verify-creds$/ },
  { methods: ['GET'], pattern: /^\/client-access\/me$/ },
  { methods: ['GET'], pattern: /^\/team\/me$/ },
];

/** Fechadas para toda chave que não é dona. Caminhos normalizados: o nome da instância vira ":i". */
const OWNER_ONLY: Rule[] = [
  { methods: ANY, pattern: /^\/instance\/(create|delete\/:i|logout\/:i)$/ },
  // credenciais (chaves de API) da IA da instância: ler ou gravar
  { methods: ANY, pattern: /^\/openai\/creds(\/.*)?$/ },
  // plano e limites: ler pode (tela de uso), mudar é do dono
  { methods: WRITE, pattern: /^\/usage\/limits\/:i$/ },
  { methods: ANY, pattern: /^\/(client-access|team|admin)(\/.*)?$/ },
];

/** Exportações: a Equipe atende e configura, mas não leva os dados embora (o Dono e a chave global levam). */
const EQUIPE_DENIED: Rule[] = [
  { methods: ['GET'], pattern: /^\/leads\/:i\/export\.(json|csv|xlsx)$/ },
  { methods: ['GET'], pattern: /^\/agenda\/:i\/export\.ics$/ },
  { methods: ['GET'], pattern: /^\/processos\/:i\/export\.csv$/ },
  { methods: ['GET'], pattern: /^\/usage\/export\/:i$/ },
];

/** Leituras que a Evolution expõe como POST: os únicos POSTs que uma chave só de leitura pode chamar. */
const READ_POSTS =
  'findChats|findMessages|findContacts|findChatByRemoteJid|findStatusMessage|fetchProfilePictureUrl|' +
  'getBase64FromMediaMessage|whatsappNumbers|fetchProfile|fetchBusinessProfile|fetchPrivacySettings';
const READ_ONLY_POSTS: Rule[] = [{ methods: ['POST'], pattern: new RegExp(`^/chat/(${READ_POSTS})/:i$`) }];

/** GETs que mudam algo mesmo sendo GET: parear um aparelho. */
const READ_ONLY_DENIED: Rule[] = [{ methods: ['GET'], pattern: /^\/instance\/connect\/:i$/ }];

/**
 * `normalizedPath`: vindo de normalizeClientPath (nome da instância trocado por ":i"). `hasInstance`: a rota nomeia
 * uma instância no caminho (o guard já conferiu que é uma que a chave pode ver).
 */
export function teamRouteAllowed(
  method: string,
  normalizedPath: string,
  role: TeamRole,
  hasInstance: boolean,
): boolean {
  if (!isTeamRole(role)) return false;
  // "dono" é igual à chave global; a limitação por instância continua no guard, pelo caminho da requisição.
  if (role === 'dono') return true;
  const verb = (method || '').toUpperCase();
  const match = (rule: Rule) => rule.methods.includes(verb) && rule.pattern.test(normalizedPath);
  if (!hasInstance) return NO_INSTANCE_RULES.some(match);
  if (OWNER_ONLY.some(match)) return false;
  if (role === 'equipe') return ANY.includes(verb) && !EQUIPE_DENIED.some(match);
  if (role === 'leitura') {
    if (READ_ONLY_DENIED.some(match)) return false;
    return verb === 'GET' || READ_ONLY_POSTS.some(match);
  }
  return false;
}

/**
 * A instância como uma chave de equipe a vê no fetchInstances: sem o token real e sem segredos das integrações.
 * `token` é a própria chave de equipe, porque o painel guarda `instance.token` e o envia em cada requisição da
 * instância: com o token real o papel seria burlado.
 */
export function teamInstanceView(info: any, teamKey: string) {
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
    'businessId',
    'clientName',
    'disconnectionReasonCode',
    'disconnectionObject',
    'disconnectionAt',
    'createdAt',
    'updatedAt',
    'dbMode',
    'Setting',
    '_count',
  ];
  const view: Record<string, unknown> = {};
  for (const key of keep) if (key in info) view[key] = info[key];
  view.token = teamKey;
  return view;
}

/** Nomes de instância (ids) que uma chave guardada pode ver (null = todas), a partir da linha do banco. */
export function normalizeInstanceIds(input: unknown): string[] | null {
  if (input === null || input === undefined) return null;
  if (!Array.isArray(input)) return [];
  return [...new Set(input.filter((id) => typeof id === 'string' && id.length > 0 && id.length <= 64))];
}
