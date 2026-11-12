/**
 * "Equipe": one key per person, created by the owner (the global AUTHENTICATION_API_KEY), with a role and, optionally,
 * a list of instances. The global key stays the owner and keeps working exactly as before.
 *
 * Like the client codes (src/utils/client-access.ts), a team key is a random `wat_...` string stored only as a
 * SHA-256 hash, and every request made with it goes through `teamRouteAllowed` on the server; the panel only hides
 * what the role cannot do. Pure functions here; the lookup and the cache live in team-access.service.ts.
 *
 * Roles:
 * - "equipe": everything inside the instances it may see (conversations, AI on/off per contact, bot, agenda,
 *   processos, leads, settings, webhooks), except what stays with the owner: creating or deleting an instance,
 *   disconnecting the WhatsApp, the AI credentials, the plan and limits, client access, team keys, retention and
 *   every /admin route.
 * - "leitura": read only. GET routes plus the few reads the Evolution API exposes as POST (findChats, findMessages…).
 *   Never sends, pauses, edits, deletes or pairs a device.
 */
import { createHash, randomBytes } from 'crypto';

export const TEAM_KEY_PREFIX = 'wat_';

export const TEAM_ROLES = ['equipe', 'leitura'] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export const TEAM_ROLE_INFO: Record<TeamRole, { label: string; description: string }> = {
  equipe: {
    label: 'Equipe',
    description:
      'Atende e configura as instâncias liberadas: conversas, IA, agenda, processos, leads e ajustes. ' +
      'Não cria nem exclui instâncias, não desconecta o WhatsApp e não mexe em credenciais, plano, acesso do cliente ' +
      'e equipe.',
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

/** New key: `wat_` + 32 random bytes in base64url (43 characters). Shown once; only the hash is stored. */
export function generateTeamKey(): { key: string; hash: string; hint: string } {
  const key = TEAM_KEY_PREFIX + randomBytes(32).toString('base64url');
  return { key, hash: hashTeamKey(key), hint: `${TEAM_KEY_PREFIX}…${key.slice(-4)}` };
}

export const isTeamRole = (role: unknown): role is TeamRole => (TEAM_ROLES as readonly unknown[]).includes(role);

type Rule = { methods: string[]; pattern: RegExp };

const ANY = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const WRITE = ['POST', 'PUT', 'PATCH', 'DELETE'];

/** The only routes without an instance in the path a team key may call. */
const NO_INSTANCE_RULES: Rule[] = [
  { methods: ['GET'], pattern: /^\/instance\/fetchInstances$/ },
  { methods: ['POST'], pattern: /^\/verify-creds$/ },
  { methods: ['GET'], pattern: /^\/client-access\/me$/ },
  { methods: ['GET'], pattern: /^\/team\/me$/ },
];

/** Closed to every team key, whatever the role. Paths are normalized: the instance name is ":i". */
const OWNER_ONLY: Rule[] = [
  { methods: ANY, pattern: /^\/instance\/(create|delete\/:i|logout\/:i)$/ },
  // AI credentials (API keys) of the instance: read or write
  { methods: ANY, pattern: /^\/openai\/creds(\/.*)?$/ },
  // plan and limits: reading is fine (the usage page), changing is the owner's
  { methods: WRITE, pattern: /^\/usage\/limits\/:i$/ },
  { methods: ANY, pattern: /^\/(client-access|team|admin)(\/.*)?$/ },
];

/** Reads the Evolution API exposes as POST: the only POSTs a read-only key may call. */
const READ_POSTS =
  'findChats|findMessages|findContacts|findChatByRemoteJid|findStatusMessage|fetchProfilePictureUrl|' +
  'getBase64FromMediaMessage|whatsappNumbers|fetchProfile|fetchBusinessProfile|fetchPrivacySettings';
const READ_ONLY_POSTS: Rule[] = [{ methods: ['POST'], pattern: new RegExp(`^/chat/(${READ_POSTS})/:i$`) }];

/** GETs that change something even if they are reads by verb: pairing a device. */
const READ_ONLY_DENIED: Rule[] = [{ methods: ['GET'], pattern: /^\/instance\/connect\/:i$/ }];

/**
 * `normalizedPath`: from normalizeClientPath (instance name replaced by ":i"). `hasInstance`: the route names an
 * instance in its path (the guard already checked it is one the key may see).
 */
export function teamRouteAllowed(
  method: string,
  normalizedPath: string,
  role: TeamRole,
  hasInstance: boolean,
): boolean {
  const verb = (method || '').toUpperCase();
  const match = (rule: Rule) => rule.methods.includes(verb) && rule.pattern.test(normalizedPath);
  if (!hasInstance) return NO_INSTANCE_RULES.some(match);
  if (OWNER_ONLY.some(match)) return false;
  if (role === 'equipe') return ANY.includes(verb);
  if (role === 'leitura') {
    if (READ_ONLY_DENIED.some(match)) return false;
    return verb === 'GET' || READ_ONLY_POSTS.some(match);
  }
  return false;
}

/**
 * The instance as a team key sees it in fetchInstances: no instance token and no integration secrets. `token` is the
 * team key itself, because the panel stores `instance.token` and sends it on every instance request: with the real
 * token the role would be bypassed.
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

/** Instance names a stored key may see (null = all), from the ids kept in the row. */
export function normalizeInstanceIds(input: unknown): string[] | null {
  if (input === null || input === undefined) return null;
  if (!Array.isArray(input)) return [];
  return [...new Set(input.filter((id) => typeof id === 'string' && id.length > 0 && id.length <= 64))];
}
