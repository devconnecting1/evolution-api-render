/**
 * "Registro de ações" (see src/utils/audit-log.ts): writes one row per recorded action and lists them for the owner.
 *
 * Writes never block or fail a request: they are fire-and-forget, at most MAX_PENDING at a time (beyond that the
 * row is dropped and counted), and once a day rows older than RETENTION_DAYS are removed.
 */
import { AUDIT_TYPE_LABEL, AUDIT_TYPES, AuditType, csvCell } from '@utils/audit-log';

export type AuditActorKind = 'owner' | 'team' | 'client' | 'instance';

export type AuditEntry = {
  actor: string;
  actorKind: AuditActorKind;
  type: AuditType;
  action: string;
  instanceName?: string | null;
  target?: string | null;
  method: string;
  path: string;
  status: number;
  ip?: string | null;
};

type Deps = {
  prisma: any;
  now?: () => number;
  logger?: { warn: (message: string) => void };
};

export const AUDIT_RETENTION_DAYS = 180;
const MAX_PENDING = 100;
const PAGE_MAX = 200;
const CSV_MAX = 10_000;

const clip = (value: unknown, max: number): string | null =>
  value === null || value === undefined || value === '' ? null : String(value).slice(0, max);

export class AuditLogService {
  private pending = 0;
  private dropped = 0;
  private purgedOn = '';

  constructor(private readonly deps: Deps) {}

  private now() {
    return (this.deps.now ?? Date.now)();
  }

  /** Records an action without waiting; never throws. */
  public record(entry: AuditEntry): void {
    if (this.pending >= MAX_PENDING) {
      this.dropped += 1;
      return;
    }
    this.pending += 1;
    const data = {
      actor: clip(entry.actor, 120) ?? 'Desconhecido',
      actorKind: entry.actorKind,
      type: entry.type,
      action: clip(entry.action, 120) ?? '',
      instanceName: clip(entry.instanceName, 120),
      target: clip(entry.target, 160),
      method: clip(entry.method, 8) ?? '',
      path: clip(entry.path, 200) ?? '',
      status: Number.isFinite(entry.status) ? entry.status : 0,
      ip: clip(entry.ip, 64),
    };
    Promise.resolve()
      .then(() => this.deps.prisma.auditLog.create({ data }))
      .catch((error: any) => this.deps.logger?.warn(`Registro de ações: não gravou (${error?.message ?? error})`))
      .finally(() => {
        this.pending -= 1;
      });
    this.purgeOncePerDay();
  }

  public stats() {
    return { pending: this.pending, dropped: this.dropped };
  }

  private purgeOncePerDay() {
    const today = new Date(this.now()).toISOString().slice(0, 10);
    if (this.purgedOn === today) return;
    this.purgedOn = today;
    const cutoff = new Date(this.now() - AUDIT_RETENTION_DAYS * 86_400_000);
    Promise.resolve()
      .then(() => this.deps.prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } }))
      .catch(() => undefined);
  }

  private where(filters: Record<string, unknown>) {
    const where: Record<string, any> = {};
    const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : null);
    const instance = text(filters.instance);
    if (instance) where.instanceName = instance;
    const actor = text(filters.actor);
    if (actor) where.actor = actor;
    const type = text(filters.type);
    if (type && (AUDIT_TYPES as readonly string[]).includes(type)) where.type = type;
    const date = (v: unknown) => {
      const s = text(v);
      if (!s) return null;
      const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T00:00:00-03:00' : s);
      return Number.isNaN(d.getTime()) ? null : d;
    };
    const from = date(filters.from);
    const to = date(filters.to);
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = from;
      // "até 12/11" includes the whole day
      if (to)
        where.createdAt.lt = /^\d{4}-\d{2}-\d{2}$/.test(String(filters.to).trim())
          ? new Date(to.getTime() + 86_400_000)
          : to;
    }
    return where;
  }

  private static view(row: any) {
    return {
      id: row.id,
      at: row.createdAt ? new Date(row.createdAt).toISOString() : null,
      actor: row.actor,
      actorKind: row.actorKind,
      type: row.type,
      typeLabel: AUDIT_TYPE_LABEL[row.type as AuditType] ?? row.type,
      action: row.action,
      instance: row.instanceName,
      target: row.target,
      ip: row.ip,
    };
  }

  /** Newest first, with filters; `page` from 1. Also the actors and instances seen, for the filter menus. */
  public async list(filters: Record<string, unknown> = {}) {
    const where = this.where(filters);
    const size = Math.min(PAGE_MAX, Math.max(1, Number(filters.size) || 50));
    const page = Math.max(1, Math.floor(Number(filters.page) || 1));
    const [total, rows, actors, instances] = await Promise.all([
      this.deps.prisma.auditLog.count({ where }),
      this.deps.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * size,
        take: size,
      }),
      this.deps.prisma.auditLog.findMany({ distinct: ['actor'], select: { actor: true }, take: 100 }),
      this.deps.prisma.auditLog.findMany({
        where: { instanceName: { not: null } },
        distinct: ['instanceName'],
        select: { instanceName: true },
        take: 200,
      }),
    ]);
    return {
      total,
      page,
      pages: Math.max(1, Math.ceil(total / size)),
      items: rows.map(AuditLogService.view),
      actors: actors
        .map((a: any) => a.actor)
        .filter(Boolean)
        .sort(),
      instances: instances
        .map((a: any) => a.instanceName)
        .filter(Boolean)
        .sort(),
      types: AUDIT_TYPES.map((id) => ({ id, label: AUDIT_TYPE_LABEL[id] })),
      retentionDays: AUDIT_RETENTION_DAYS,
    };
  }

  /** CSV (UTF-8 with BOM, ";" for Excel in Portuguese), at most CSV_MAX rows. */
  public async csv(filters: Record<string, unknown> = {}) {
    const rows = await this.deps.prisma.auditLog.findMany({
      where: this.where(filters),
      orderBy: { createdAt: 'desc' },
      take: CSV_MAX,
    });
    const head = ['Quando (UTC)', 'Quem', 'Tipo de acesso', 'Área', 'Ação', 'Instância', 'Alvo', 'IP'];
    const kind: Record<string, string> = {
      owner: 'Dono',
      team: 'Equipe',
      client: 'Cliente',
      instance: 'Token da instância',
    };
    const lines = rows.map((r: any) => {
      const v = AuditLogService.view(r);
      return [v.at, v.actor, kind[v.actorKind] ?? v.actorKind, v.typeLabel, v.action, v.instance, v.target, v.ip]
        .map(csvCell)
        .join(';');
    });
    return '﻿' + [head.map(csvCell).join(';'), ...lines].join('\r\n') + '\r\n';
  }
}
