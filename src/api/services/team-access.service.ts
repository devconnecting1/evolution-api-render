/**
 * "Equipe" (see src/utils/team-access.ts): the owner creates a key per person with a role and, optionally, the
 * instances it may see; the key is shown once and only its SHA-256 hash is kept.
 */
import {
  generateTeamKey,
  hashTeamKey,
  isTeamKey,
  isTeamRole,
  normalizeInstanceIds,
  TEAM_ROLE_INFO,
  TEAM_ROLES,
  TeamRole,
} from '@utils/team-access';

export type TeamGrant = {
  id: string;
  name: string;
  role: TeamRole;
  /** null = every instance. */
  instanceNames: string[] | null;
  keyHint: string;
};

export class TeamAccessValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors.join(' '));
  }
}

type Deps = {
  prisma: any;
  now?: () => number;
  /** How long a resolved key is trusted before the database is read again (default 30 s). */
  cacheTtlMs?: number;
};

const CACHE_TTL_MS = 30_000;
/** lastUsedAt is written at most once per this interval per key (no write per request). */
const TOUCH_INTERVAL_MS = 10 * 60_000;
const MAX_KEYS = 50;

export class TeamAccessService {
  private readonly cache = new Map<string, { at: number; grant: TeamGrant | null }>();
  private readonly touched = new Map<string, number>();

  constructor(private readonly deps: Deps) {}

  private now() {
    return (this.deps.now ?? Date.now)();
  }

  /** The grant of a `wat_` key, or null (unknown or revoked). */
  public async resolve(key: string): Promise<TeamGrant | null> {
    if (!isTeamKey(key)) return null;
    const hash = hashTeamKey(key);
    const ttl = this.deps.cacheTtlMs ?? CACHE_TTL_MS;
    const hit = this.cache.get(hash);
    if (hit && this.now() - hit.at < ttl) return hit.grant;

    const row = await this.deps.prisma.teamKey.findUnique({ where: { keyHash: hash } });
    let grant: TeamGrant | null = null;
    if (row && row.enabled && isTeamRole(row.role)) {
      const ids = normalizeInstanceIds(row.instances);
      let instanceNames: string[] | null = null;
      if (ids) {
        const rows: { name: string }[] = ids.length
          ? await this.deps.prisma.instance.findMany({ where: { id: { in: ids } }, select: { name: true } })
          : [];
        instanceNames = rows.map((r) => r.name);
      }
      grant = { id: row.id, name: row.name, role: row.role, instanceNames, keyHint: row.keyHint };
    }
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
      this.deps.prisma.teamKey.update({ where: { id }, data: { lastUsedAt: new Date(this.now()) } }),
    ).catch(() => undefined);
  }

  private forget() {
    this.cache.clear();
  }

  public rolesCatalog() {
    return TEAM_ROLES.map((id) => ({ id, ...TEAM_ROLE_INFO[id] }));
  }

  /** Every key, newest first: name, role, instances, hint and last use. Never the hash. */
  public async list() {
    const rows: any[] = await this.deps.prisma.teamKey.findMany({ orderBy: { createdAt: 'desc' } });
    const ids = [...new Set(rows.flatMap((r) => normalizeInstanceIds(r.instances) ?? []))];
    const instances: { id: string; name: string }[] = ids.length
      ? await this.deps.prisma.instance.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
      : [];
    const nameOf = new Map(instances.map((i) => [i.id, i.name]));
    return {
      keys: rows.map((r) => {
        const own = normalizeInstanceIds(r.instances);
        return {
          id: r.id,
          name: r.name,
          role: r.role,
          instances: own ? own.map((id) => nameOf.get(id)).filter(Boolean) : null,
          keyHint: r.keyHint,
          lastUsedAt: r.lastUsedAt ? new Date(r.lastUsedAt).toISOString() : null,
          createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
        };
      }),
      roles: this.rolesCatalog(),
    };
  }

  /** New key for a person. `instances`: list of instance names, or null/absent for all. The key comes back once. */
  public async create(input: { name?: unknown; role?: unknown; instances?: unknown }) {
    const errors: string[] = [];
    const name = typeof input.name === 'string' ? input.name.trim().replace(/\s+/g, ' ') : '';
    if (!name || name.length > 80) errors.push('Informe o nome da pessoa (até 80 caracteres).');
    if (!isTeamRole(input.role)) errors.push(`"role" deve ser ${TEAM_ROLES.join(' ou ')}.`);
    let names: string[] | null = null;
    if (input.instances !== undefined && input.instances !== null) {
      if (!Array.isArray(input.instances) || input.instances.some((n) => typeof n !== 'string' || !n)) {
        errors.push('"instances" deve ser uma lista de nomes de instância, ou vazio para todas.');
      } else {
        names = [...new Set(input.instances as string[])];
        if (!names.length) errors.push('Escolha pelo menos uma instância, ou deixe todas.');
      }
    }
    if (errors.length) throw new TeamAccessValidationError(errors);

    let ids: string[] | null = null;
    if (names) {
      const rows: { id: string; name: string }[] = await this.deps.prisma.instance.findMany({
        where: { name: { in: names } },
        select: { id: true, name: true },
      });
      const found = new Set(rows.map((r) => r.name));
      const missing = names.filter((n) => !found.has(n));
      if (missing.length) throw new TeamAccessValidationError([`Instância não encontrada: ${missing.join(', ')}.`]);
      ids = rows.map((r) => r.id);
    }
    if ((await this.deps.prisma.teamKey.count()) >= MAX_KEYS) {
      throw new TeamAccessValidationError([`Limite de ${MAX_KEYS} chaves de equipe. Revogue as que não usa mais.`]);
    }

    const fresh = generateTeamKey();
    const row = await this.deps.prisma.teamKey.create({
      data: {
        name,
        role: input.role as TeamRole,
        // omitted = NULL in the database = every instance (Prisma refuses a plain null on a Json? column)
        ...(ids === null ? {} : { instances: ids }),
        keyHash: fresh.hash,
        keyHint: fresh.hint,
        enabled: true,
      },
    });
    this.forget();
    return {
      id: row.id,
      name,
      role: input.role as TeamRole,
      instances: names,
      keyHint: fresh.hint,
      key: fresh.key,
    };
  }

  /** Removes a key: it stops working at once (the cache is cleared). */
  public async revoke(id: string) {
    const result = await this.deps.prisma.teamKey.deleteMany({ where: { id } });
    this.forget();
    return { removed: (result?.count ?? 0) > 0 };
  }
}
