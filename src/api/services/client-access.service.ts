/**
 * "Acesso do cliente" (see src/utils/client-access.ts): the administrator turns it on per instance, picks the
 * modules and gets a code once; the client logs in with that code and only reaches those modules.
 */
import {
  CLIENT_MODULE_INFO,
  CLIENT_MODULES,
  ClientModule,
  DEFAULT_CLIENT_MODULES,
  generateClientKey,
  hashClientKey,
  isClientKey,
  normalizeModules,
  validateModulesInput,
} from '@utils/client-access';

export type ClientAccessGrant = { instanceId: string; instanceName: string; modules: ClientModule[] };

export class ClientAccessValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors.join(' '));
  }
}

type Deps = {
  prisma: any;
  now?: () => number;
  /** How long a resolved code is trusted before the database is read again (default 30 s). */
  cacheTtlMs?: number;
};

const CACHE_TTL_MS = 30_000;
/** lastUsedAt is written at most once per this interval per code (no write per request). */
const TOUCH_INTERVAL_MS = 10 * 60_000;

export class ClientAccessService {
  private readonly cache = new Map<string, { at: number; grant: ClientAccessGrant | null }>();
  private readonly touched = new Map<string, number>();

  constructor(private readonly deps: Deps) {}

  private now() {
    return (this.deps.now ?? Date.now)();
  }

  /** The grant of a `wac_` code, or null (unknown, revoked, turned off or instance removed). */
  public async resolve(key: string): Promise<ClientAccessGrant | null> {
    if (!isClientKey(key)) return null;
    const hash = hashClientKey(key);
    const ttl = this.deps.cacheTtlMs ?? CACHE_TTL_MS;
    const hit = this.cache.get(hash);
    if (hit && this.now() - hit.at < ttl) return hit.grant;

    const row = await this.deps.prisma.clientAccess.findUnique({
      where: { keyHash: hash },
      include: { Instance: { select: { id: true, name: true } } },
    });
    const grant =
      row && row.enabled && row.Instance
        ? { instanceId: row.Instance.id, instanceName: row.Instance.name, modules: normalizeModules(row.modules) }
        : null;
    if (this.cache.size > 500) this.cache.clear();
    this.cache.set(hash, { at: this.now(), grant });
    if (grant) this.touch(hash, row.id);
    return grant;
  }

  private touch(hash: string, id: string) {
    const last = this.touched.get(hash) ?? 0;
    if (this.now() - last < TOUCH_INTERVAL_MS) return;
    this.touched.set(hash, this.now());
    Promise.resolve(
      this.deps.prisma.clientAccess.update({ where: { id }, data: { lastUsedAt: new Date(this.now()) } }),
    ).catch(() => undefined);
  }

  private forget() {
    this.cache.clear();
  }

  public modulesCatalog() {
    return CLIENT_MODULES.map((id) => ({ id, ...CLIENT_MODULE_INFO[id] }));
  }

  public async view(instanceId: string, instanceName: string) {
    const row = await this.deps.prisma.clientAccess.findUnique({ where: { instanceId } });
    return {
      instance: instanceName,
      configured: !!row,
      enabled: row ? !!row.enabled : false,
      modules: row ? normalizeModules(row.modules) : DEFAULT_CLIENT_MODULES,
      keyHint: row?.keyHint ?? null,
      lastUsedAt: row?.lastUsedAt ? new Date(row.lastUsedAt).toISOString() : null,
      catalog: this.modulesCatalog(),
    };
  }

  /**
   * Turns the access on/off, changes the modules and, with `newKey` (or on the first save), creates a new code.
   * The code comes back only in this answer; the previous one stops working at once.
   */
  public async save(
    instanceId: string,
    instanceName: string,
    input: { enabled?: unknown; modules?: unknown; newKey?: unknown },
  ) {
    const errors: string[] = [];
    if (input.enabled !== undefined && typeof input.enabled !== 'boolean')
      errors.push('"enabled" deve ser true ou false.');
    if (input.modules !== undefined) errors.push(...validateModulesInput(input.modules));
    if (input.newKey !== undefined && typeof input.newKey !== 'boolean')
      errors.push('"newKey" deve ser true ou false.');
    if (errors.length) throw new ClientAccessValidationError(errors);

    const current = await this.deps.prisma.clientAccess.findUnique({ where: { instanceId } });
    const modules =
      input.modules !== undefined
        ? normalizeModules(input.modules)
        : current
          ? normalizeModules(current.modules)
          : DEFAULT_CLIENT_MODULES;
    const enabled = input.enabled !== undefined ? (input.enabled as boolean) : current ? !!current.enabled : true;
    const fresh = !current || input.newKey === true ? generateClientKey() : null;

    const data: Record<string, unknown> = { enabled, modules };
    if (fresh) Object.assign(data, { keyHash: fresh.hash, keyHint: fresh.hint, lastUsedAt: null });

    if (current) await this.deps.prisma.clientAccess.update({ where: { instanceId }, data });
    else await this.deps.prisma.clientAccess.create({ data: { ...data, instanceId } });
    this.forget();

    return { ...(await this.view(instanceId, instanceName)), ...(fresh ? { key: fresh.key } : {}) };
  }

  /** Removes the access: the code stops working at once. */
  public async revoke(instanceId: string, instanceName: string) {
    await this.deps.prisma.clientAccess.deleteMany({ where: { instanceId } });
    this.forget();
    return this.view(instanceId, instanceName);
  }
}
