/**
 * "Chaves e credenciais": one admin-only view of the secrets stored per instance (OpenAI credentials, instance
 * token, webhook URL, API keys of the other chatbot integrations), always masked. A single value is revealed
 * only by `revealCredential`, behind the admin guard, the re-typed global key and the rate limit of the router.
 *
 * Pure functions over an injected Prisma client: the REST router and the MCP tool share them, the tests hand in
 * fakes. Only plain Prisma calls (findMany/findFirst), so PostgreSQL and MySQL behave the same.
 */

/** Never shown in full: the last 4 characters at most, and only when the value is long enough. */
const MIN_LENGTH_FOR_SUFFIX = 12;
const ELLIPSIS = '…';

/**
 * Masks a secret as `sk-…WXYZ`: a short alphabetic prefix such as `sk-` / `app-` (when the value is long enough
 * for it not to matter), an ellipsis and the last 4 characters. Short values become `****`; empty ones null.
 */
export function maskCredential(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  const text = String(value).trim();
  if (!text) return null;
  if (text.length < MIN_LENGTH_FOR_SUFFIX) return '****';

  const prefix = /^[A-Za-z]{2,8}[-_]/.exec(text)?.[0] ?? '';
  const shownPrefix = text.length >= prefix.length + MIN_LENGTH_FOR_SUFFIX ? prefix : '';

  return `${shownPrefix}${ELLIPSIS}${text.slice(-4)}`;
}

/** A path segment that looks like a token (Slack/n8n style webhook URLs carry the secret in the path). */
const TOKEN_SEGMENT = /^(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{20,}$/;

/**
 * Masks a URL for display: user and password, every query string value, the fragment and token-like path
 * segments. Scheme, host and the readable part of the path stay, so the admin can tell the URLs apart.
 */
export function maskCredentialUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url.trim()) return null;

  try {
    const parsed = new URL(url.trim());
    if (parsed.username) parsed.username = '****';
    if (parsed.password) parsed.password = '****';
    for (const key of [...new Set(parsed.searchParams.keys())]) parsed.searchParams.set(key, '****');
    parsed.hash = '';
    parsed.pathname = parsed.pathname
      .split('/')
      .map((segment) => (TOKEN_SEGMENT.test(segment) ? `${ELLIPSIS}${segment.slice(-4)}` : segment))
      .join('/');

    return decodeURI(parsed.toString());
  } catch {
    return '****';
  }
}

export type CredentialKind =
  | 'openai'
  | 'instance_token'
  | 'webhook_url'
  | 'n8n_webhook_url'
  | 'n8n_basic_auth'
  | 'dify'
  | 'flowise'
  | 'evoai'
  | 'evolution_bot'
  | 'chatwoot'
  | 'wavoip'
  | 'pusher'
  | 'proxy';

type KindSpec = {
  label: string;
  /** Prisma delegate. */
  model: string;
  /** Column holding the secret. */
  field: string;
  /** Column naming the record for the admin (never a secret), if any. */
  nameField?: string;
  /** How the masked value is built. */
  mask: 'secret' | 'url';
};

/** Every secret column of the schema shown on the page. Typebot has none (URL only); S3 is configured by env. */
export const CREDENTIAL_KINDS: Record<CredentialKind, KindSpec> = {
  openai: { label: 'OpenAI', model: 'openaiCreds', field: 'apiKey', nameField: 'name', mask: 'secret' },
  instance_token: { label: 'Token da instância', model: 'instance', field: 'token', mask: 'secret' },
  webhook_url: { label: 'Webhook', model: 'webhook', field: 'url', mask: 'url' },
  n8n_webhook_url: { label: 'N8N (URL)', model: 'n8n', field: 'webhookUrl', nameField: 'description', mask: 'url' },
  n8n_basic_auth: {
    label: 'N8N (senha)',
    model: 'n8n',
    field: 'basicAuthPass',
    nameField: 'description',
    mask: 'secret',
  },
  dify: { label: 'Dify', model: 'dify', field: 'apiKey', nameField: 'description', mask: 'secret' },
  flowise: { label: 'Flowise', model: 'flowise', field: 'apiKey', nameField: 'description', mask: 'secret' },
  evoai: { label: 'EvoAI', model: 'evoai', field: 'apiKey', nameField: 'description', mask: 'secret' },
  evolution_bot: {
    label: 'Evolution Bot',
    model: 'evolutionBot',
    field: 'apiKey',
    nameField: 'description',
    mask: 'secret',
  },
  chatwoot: { label: 'Chatwoot', model: 'chatwoot', field: 'token', nameField: 'nameInbox', mask: 'secret' },
  wavoip: { label: 'Wavoip', model: 'setting', field: 'wavoipToken', mask: 'secret' },
  pusher: { label: 'Pusher', model: 'pusher', field: 'secret', nameField: 'appId', mask: 'secret' },
  proxy: { label: 'Proxy (senha)', model: 'proxy', field: 'password', nameField: 'host', mask: 'secret' },
};

export const CREDENTIAL_KIND_NAMES = Object.keys(CREDENTIAL_KINDS) as CredentialKind[];

export interface CredentialsDeps {
  prisma: any;
  waMonitor?: { waInstances: Record<string, any> };
  /** DATABASE_CONNECTION_CLIENT_NAME: only this deployment's instances (same filter as fetchInstances). */
  clientName?: string;
  /** Whether OPENAI_API_KEY_GLOBAL is set. Its value never reaches this module. */
  openaiGlobalKeySet: boolean;
  logger?: { error(message: unknown): void };
}

export type CredentialItem = {
  kind: CredentialKind;
  label: string;
  /** Record id, the `id` of the reveal request. */
  id: string;
  name: string | null;
  masked: string;
};

export type CredentialsInstance = {
  id: string;
  name: string;
  connectionStatus: string;
  integration: string | null;
  /** "own" (own Neon database ready), "shared" (main database), null when the deployment has no per-instance DBs. */
  dbMode: 'own' | 'shared' | null;
  /** The OpenAI bot of this instance answers with OPENAI_API_KEY_GLOBAL (no own key stored). */
  openaiGlobalFallback: boolean;
  items: CredentialItem[];
};

export type CredentialsOverview = {
  generatedAt: string;
  openaiGlobalKey: { configured: boolean };
  kinds: { kind: CredentialKind; label: string }[];
  instances: CredentialsInstance[];
};

const MAX_INSTANCES = 1000;

function instancesWhere(deps: CredentialsDeps): Record<string, any> {
  return deps.clientName ? { clientName: deps.clientName } : {};
}

function liveState(deps: CredentialsDeps, row: any): string {
  const live = deps.waMonitor?.waInstances?.[row.name]?.connectionStatus?.state;
  return String(live || row.connectionStatus || 'close');
}

function maskFor(spec: KindSpec, value: unknown): string | null {
  return spec.mask === 'url' ? maskCredentialUrl(value) : maskCredential(value);
}

async function rowsOf(deps: CredentialsDeps, spec: KindSpec, instanceIds: string[]): Promise<any[]> {
  const delegate = deps.prisma?.[spec.model];
  if (!delegate?.findMany || !instanceIds.length) return [];

  const select: Record<string, boolean> = { id: true, instanceId: true, [spec.field]: true };
  if (spec.nameField) select[spec.nameField] = true;

  try {
    return (await delegate.findMany({ where: { instanceId: { in: instanceIds } }, select })) ?? [];
  } catch (error) {
    deps.logger?.error(`credentials: ${spec.model} unavailable: ${error?.message ?? error}`);
    return [];
  }
}

/**
 * Status of the own database of each instance (InstanceDatabase, same rule as the monitor: "own" once ready). Only
 * the status is read: the encrypted connection URI never leaves the table. Null when the table does not exist.
 */
async function databaseModes(deps: CredentialsDeps, instanceIds: string[]): Promise<Map<string, string> | null> {
  const delegate = deps.prisma?.instanceDatabase;
  if (!delegate?.findMany) return null;

  try {
    const rows: any[] = instanceIds.length
      ? await delegate.findMany({
          where: { instanceId: { in: instanceIds } },
          select: { instanceId: true, status: true },
        })
      : [];
    return new Map((rows ?? []).map((row) => [row.instanceId, String(row.status)]));
  } catch (error) {
    deps.logger?.error(`credentials: instanceDatabase unavailable: ${error?.message ?? error}`);
    return null;
  }
}

/** Every instance of the deployment with its secrets masked. Nothing here ever returns a full secret. */
export async function listCredentials(deps: CredentialsDeps): Promise<CredentialsOverview> {
  const instances: any[] =
    (await deps.prisma.instance.findMany({
      where: instancesWhere(deps),
      orderBy: { name: 'asc' },
      take: MAX_INSTANCES,
    })) ?? [];

  const byId = new Map<string, CredentialsInstance>();
  for (const row of instances) {
    const items: CredentialItem[] = [];
    const token = maskCredential(row.token);
    if (token) {
      items.push({
        kind: 'instance_token',
        label: CREDENTIAL_KINDS.instance_token.label,
        id: row.id,
        name: null,
        masked: token,
      });
    }

    byId.set(row.id, {
      id: row.id,
      name: row.name,
      connectionStatus: liveState(deps, row),
      integration: row.integration ?? null,
      dbMode: null,
      openaiGlobalFallback: false,
      items,
    });
  }

  const ids = [...byId.keys()];
  const kinds = CREDENTIAL_KIND_NAMES.filter((kind) => kind !== 'instance_token');
  const [results, databases] = await Promise.all([
    Promise.all(kinds.map((kind) => rowsOf(deps, CREDENTIAL_KINDS[kind], ids))),
    databaseModes(deps, ids),
  ]);
  if (databases) {
    for (const instance of byId.values()) instance.dbMode = databases.get(instance.id) === 'ready' ? 'own' : 'shared';
  }

  kinds.forEach((kind, index) => {
    const spec = CREDENTIAL_KINDS[kind];
    for (const row of results[index]) {
      const target = byId.get(row.instanceId);
      const masked = maskFor(spec, row[spec.field]);
      if (!target || !masked) continue;

      const name = spec.nameField ? row[spec.nameField] : null;
      target.items.push({
        kind,
        label: spec.label,
        id: String(row.id),
        name: typeof name === 'string' && name.trim() ? name.trim() : null,
        masked,
      });
    }
  });

  for (const instance of byId.values()) {
    const ownOpenaiKey = instance.items.some((item) => item.kind === 'openai');
    instance.openaiGlobalFallback = deps.openaiGlobalKeySet && !ownOpenaiKey;
  }

  return {
    generatedAt: new Date().toISOString(),
    openaiGlobalKey: { configured: deps.openaiGlobalKeySet },
    kinds: CREDENTIAL_KIND_NAMES.map((kind) => ({ kind, label: CREDENTIAL_KINDS[kind].label })),
    instances: [...byId.values()],
  };
}

export type RevealedCredential = {
  kind: CredentialKind;
  id: string;
  instance: { id: string; name: string };
  value: string;
};

/**
 * The full value of one secret, or null when the record does not exist, belongs to another deployment or holds no
 * value. Callers must have checked the admin key and the re-typed password; this function only reads.
 */
export async function revealCredential(
  deps: CredentialsDeps,
  kind: CredentialKind,
  id: string,
): Promise<RevealedCredential | null> {
  const spec = CREDENTIAL_KINDS[kind];
  if (!spec || typeof id !== 'string' || !id) return null;

  const delegate = deps.prisma?.[spec.model];
  if (!delegate?.findFirst) return null;

  const isInstance = spec.model === 'instance';
  const select: Record<string, boolean> = { id: true, [spec.field]: true };
  if (!isInstance) select.instanceId = true;

  const row = await delegate.findFirst({ where: { id }, select });
  const value = row?.[spec.field];
  if (!row || typeof value !== 'string' || !value) return null;

  const instanceId = isInstance ? row.id : row.instanceId;
  const instance = await deps.prisma.instance.findFirst({
    where: { id: instanceId, ...instancesWhere(deps) },
    select: { id: true, name: true },
  });
  if (!instance) return null;

  return { kind, id: String(row.id), instance: { id: instance.id, name: instance.name }, value };
}
