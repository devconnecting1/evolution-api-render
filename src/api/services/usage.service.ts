/**
 * "Plano e limites": counts the answers of the AI (one per answered message or burst) and enforces the limits of
 * each instance (business hours, daily caps, monthly franchise).
 *
 * Storage (two small tables, see prisma/*-schema.prisma):
 *   InstanceLimits - one optional row per instance. No row = no limits (the behaviour before this feature).
 *   UsageCounter   - one row per instance and period: type "month" (period 2026-11), "day" (2026-11-03) and
 *                    "contact" (day + remoteJid, with the "notice already sent today" flags). Every write is an
 *                    atomic upsert with increment (INSERT ... ON CONFLICT DO UPDATE SET responses = responses + 1).
 *                    Per-contact rows older than 7 days and day rows older than 90 days are deleted on the write
 *                    path, at most once per instance per day (no timer, no job).
 *
 * Cost of the gate before each answer: the limits are cached in memory for 30 s per instance; without limits
 * nothing is queried; with count limits, one small query (primary key lookups). Every failure here fails open:
 * the AI keeps answering (the usage feature must never take the bot down).
 */
import { Logger } from '@config/logger.config';
import {
  aiAllowedByHours,
  ALLOW,
  COUNTER_CONTACT,
  COUNTER_DAY,
  COUNTER_MONTH,
  DEFAULT_TIMEZONE,
  defaultLimits,
  evaluateGate,
  GateDecision,
  lastDays,
  maskContact,
  normalizeLimits,
  overage,
  percentOf,
  PLAN_PRESETS,
  shiftDay,
  UsageLimits,
  validateLimits,
  validateLimitsInput,
  zonedParts,
} from '@utils/usageLimits';

const CACHE_TTL_MS = 30_000;
const CONTACT_ROWS_DAYS = 7;
const DAY_ROWS_DAYS = 90;
const MAX_JID_CHARS = 100;
const TOP_CONTACTS = 5;
const SNAPSHOT_MAX_INSTANCES = 200;

export class UsageValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors.join(' '));
    this.name = 'UsageValidationError';
  }
}

export type UsageGate = GateDecision & { day: string; limits: UsageLimits | null };

export type UsageSnapshotItem = {
  instanceId: string;
  name: string;
  period: string;
  responses: number;
  limit: number | null;
  percent: number | null;
  alertPercent: number;
  planName: string | null;
  excedente: number;
  blocks1000: number;
};

type UsageOptions = { now?: () => number; cacheTtlMs?: number };

/** Fields accepted by saveLimits (REST and MCP). Absent = unchanged; null = cleared. */
const LIMIT_FIELDS = [
  'planName',
  'monthlyResponses',
  'dailyResponses',
  'perContactDailyResponses',
  'overLimitAction',
  'overLimitMessage',
  'alertPercent',
  'outsideHoursMessage',
] as const;

export class UsageService {
  private readonly logger = new Logger('UsageService');
  private readonly cache = new Map<string, { at: number; limits: UsageLimits | null }>();
  private readonly cleanedOn = new Map<string, string>();

  constructor(
    private readonly prisma: any,
    private readonly options: UsageOptions = {},
  ) {}

  private now(): Date {
    return new Date((this.options.now ?? Date.now)());
  }

  // -------------------------------------------------------------------------------------------- limits

  /** The stored limits (normalized) or null when the instance has none. Cached ~30 s per instance. */
  public async getLimits(instanceId: string): Promise<UsageLimits | null> {
    const ttl = this.options.cacheTtlMs ?? CACHE_TTL_MS;
    const at = this.now().getTime();
    const hit = this.cache.get(instanceId);
    if (hit && at - hit.at < ttl) return hit.limits;

    const row = await this.prisma.instanceLimits.findUnique({ where: { instanceId } });
    const limits = row ? normalizeLimits(row) : null;
    this.cache.set(instanceId, { at, limits });
    return limits;
  }

  /** The limits in effect (defaults = no limit when there is no row). */
  public async getEffectiveLimits(instanceId: string): Promise<UsageLimits> {
    return (await this.getLimits(instanceId)) ?? defaultLimits();
  }

  public invalidate(instanceId: string): void {
    this.cache.delete(instanceId);
  }

  /**
   * Partial update: absent fields keep their value, null clears a limit. Validated as a whole; throws
   * UsageValidationError with every problem found (Brazilian Portuguese).
   */
  public async saveLimits(
    instanceId: string,
    input: Record<string, any>,
  ): Promise<{ previous: UsageLimits | null; limits: UsageLimits }> {
    const inputErrors = validateLimitsInput(input);
    if (inputErrors.length) throw new UsageValidationError(inputErrors);

    const currentRow = await this.prisma.instanceLimits.findUnique({ where: { instanceId } });
    const previous = currentRow ? normalizeLimits(currentRow) : null;
    const base = previous ?? defaultLimits();

    const merged: Record<string, any> = { ...base };
    for (const field of LIMIT_FIELDS) {
      if (input && Object.prototype.hasOwnProperty.call(input, field)) merged[field] = input[field];
    }
    // A preset plan without an explicit number takes the franchise of the plan
    if (
      input?.planName &&
      PLAN_PRESETS[input.planName] &&
      !Object.prototype.hasOwnProperty.call(input, 'monthlyResponses')
    ) {
      merged.monthlyResponses = PLAN_PRESETS[input.planName];
    }
    if (input?.businessHours && typeof input.businessHours === 'object') {
      merged.businessHours = {
        ...base.businessHours,
        ...input.businessHours,
        week: { ...base.businessHours.week, ...(input.businessHours.week ?? {}) },
      };
    } else if (input?.businessHours === null) {
      merged.businessHours = defaultLimits().businessHours;
    }

    const limits = normalizeLimits(merged);
    const errors = validateLimits(limits);
    if (errors.length) throw new UsageValidationError(errors);

    const data = {
      planName: limits.planName,
      monthlyResponses: limits.monthlyResponses,
      dailyResponses: limits.dailyResponses,
      perContactDailyResponses: limits.perContactDailyResponses,
      overLimitAction: limits.overLimitAction,
      overLimitMessage: limits.overLimitMessage,
      alertPercent: limits.alertPercent,
      businessHours: limits.businessHours,
      outsideHoursMessage: limits.outsideHoursMessage,
    };

    const saved = await this.prisma.instanceLimits.upsert({
      where: { instanceId },
      create: { instanceId, ...data },
      update: data,
    });

    this.invalidate(instanceId);
    return { previous, limits: normalizeLimits(saved ?? data) };
  }

  // ---------------------------------------------------------------------------------------------- gate

  /**
   * Whether the AI may answer this contact now. Fails open (allow) when the database is unavailable.
   */
  public async checkBeforeAnswer(instanceId: string, remoteJid: string): Promise<UsageGate> {
    const now = this.now();
    let limits: UsageLimits | null = null;

    try {
      limits = await this.getLimits(instanceId);
      const day = zonedParts(now, limits?.businessHours.timezone ?? DEFAULT_TIMEZONE).day;
      if (!limits) return { ...ALLOW, day, limits };

      const hoursOk = aiAllowedByHours(limits.businessHours, now);
      const needsCounts =
        hoursOk &&
        (limits.monthlyResponses !== null ||
          limits.dailyResponses !== null ||
          limits.perContactDailyResponses !== null);

      const counts = needsCounts
        ? await this.counts(instanceId, remoteJid, now, limits)
        : { month: 0, day: 0, contact: 0 };
      return { ...evaluateGate(limits, counts, hoursOk), day, limits };
    } catch (error) {
      this.logger.error(`Usage gate failed for instance ${instanceId}, answering anyway: ${error?.message ?? error}`);
      return { ...ALLOW, day: zonedParts(now, DEFAULT_TIMEZONE).day, limits };
    }
  }

  /** Answers of this month, of today and of this contact today: one query on the primary key. */
  private async counts(instanceId: string, remoteJid: string, now: Date, limits: UsageLimits) {
    const parts = zonedParts(now, limits.businessHours.timezone);
    const jid = String(remoteJid).slice(0, MAX_JID_CHARS);
    const rows: any[] =
      (await this.prisma.usageCounter.findMany({
        where: {
          instanceId,
          OR: [
            { type: COUNTER_MONTH, period: parts.month, remoteJid: '' },
            { type: COUNTER_DAY, period: parts.day, remoteJid: '' },
            { type: COUNTER_CONTACT, period: parts.day, remoteJid: jid },
          ],
        },
        select: { type: true, responses: true },
      })) ?? [];

    const of = (type: string) => Number(rows.find((row) => row.type === type)?.responses ?? 0);
    return { month: of(COUNTER_MONTH), day: of(COUNTER_DAY), contact: of(COUNTER_CONTACT) };
  }

  /**
   * Claims the notice of the day for a contact (outside hours or over the limit): true for the first caller only,
   * so the customer gets the message at most once per day.
   */
  public async claimNotice(instanceId: string, remoteJid: string, kind: 'hours' | 'limit', day: string) {
    const field = kind === 'hours' ? 'hoursNotice' : 'limitNotice';
    const key = {
      instanceId,
      type: COUNTER_CONTACT,
      period: day,
      remoteJid: String(remoteJid).slice(0, MAX_JID_CHARS),
    };

    try {
      const updated = await this.prisma.usageCounter.updateMany({
        where: { ...key, [field]: false },
        data: { [field]: true },
      });
      if (updated?.count > 0) return true;

      await this.prisma.usageCounter.create({ data: { ...key, responses: 0, [field]: true } });
      return true;
    } catch (error) {
      // P2002: the row exists and the flag was already set (or another message claimed it first)
      if (error?.code !== 'P2002') {
        this.logger.error(`Could not record the ${kind} notice for ${instanceId}: ${error?.message ?? error}`);
      }
      return false;
    }
  }

  // ------------------------------------------------------------------------------------------- counting

  /**
   * One AI answer sent to the contact (call it once per answered message or burst, after the send). Never throws.
   */
  public async recordAnswer(instanceId: string, remoteJid: string): Promise<void> {
    try {
      const now = this.now();
      const limits = await this.getLimits(instanceId).catch((): UsageLimits | null => null);
      const parts = zonedParts(now, limits?.businessHours.timezone ?? DEFAULT_TIMEZONE);
      const jid = String(remoteJid).slice(0, MAX_JID_CHARS);

      const increment = (type: string, period: string, contact: string) =>
        this.prisma.usageCounter.upsert({
          where: { instanceId_type_period_remoteJid: { instanceId, type, period, remoteJid: contact } },
          create: { instanceId, type, period, remoteJid: contact, responses: 1 },
          update: { responses: { increment: 1 } },
        });

      await Promise.all([
        increment(COUNTER_MONTH, parts.month, ''),
        increment(COUNTER_DAY, parts.day, ''),
        increment(COUNTER_CONTACT, parts.day, jid),
      ]);

      this.cleanupOncePerDay(instanceId, parts.day);
    } catch (error) {
      this.logger.error(`Could not count the AI answer of instance ${instanceId}: ${error?.message ?? error}`);
    }
  }

  /** Old per-contact and day rows go away on the first answer of each day (no timer). */
  private cleanupOncePerDay(instanceId: string, today: string): void {
    if (this.cleanedOn.get(instanceId) === today) return;
    this.cleanedOn.set(instanceId, today);

    void Promise.resolve()
      .then(() =>
        this.prisma.usageCounter.deleteMany({
          where: {
            instanceId,
            OR: [
              { type: COUNTER_CONTACT, period: { lt: shiftDay(today, CONTACT_ROWS_DAYS) } },
              { type: COUNTER_DAY, period: { lt: shiftDay(today, DAY_ROWS_DAYS) } },
            ],
          },
        }),
      )
      .catch((error) => this.logger.warn(`Usage cleanup failed for ${instanceId}: ${error?.message ?? error}`));
  }

  // -------------------------------------------------------------------------------------------- reading

  /** What the panel, GET /usage/summary and the MCP show. */
  public async getSummary(instanceId: string) {
    const now = this.now();
    const limits = await this.getEffectiveLimits(instanceId);
    const parts = zonedParts(now, limits.businessHours.timezone);
    const days = lastDays(parts.day, 30);

    const [monthRow, dayRows, contactRows] = await Promise.all([
      this.prisma.usageCounter.findUnique({
        where: {
          instanceId_type_period_remoteJid: { instanceId, type: COUNTER_MONTH, period: parts.month, remoteJid: '' },
        },
      }),
      this.prisma.usageCounter.findMany({
        where: { instanceId, type: COUNTER_DAY, remoteJid: '', period: { gte: days[0], lte: parts.day } },
        select: { period: true, responses: true },
        take: 40,
      }),
      this.prisma.usageCounter.findMany({
        where: { instanceId, type: COUNTER_CONTACT, period: parts.day, responses: { gt: 0 } },
        orderBy: { responses: 'desc' },
        select: { remoteJid: true, responses: true },
        take: TOP_CONTACTS,
      }),
    ]);

    const byDay = new Map<string, number>((dayRows ?? []).map((row: any) => [row.period, Number(row.responses) || 0]));
    const monthResponses = Number(monthRow?.responses ?? 0);
    const todayResponses = byDay.get(parts.day) ?? 0;
    const monthPercent = percentOf(monthResponses, limits.monthlyResponses);
    const { excedente, blocks1000, estimatedBRL } = overage(monthResponses, limits.monthlyResponses);

    return {
      generatedAt: now.toISOString(),
      timezone: limits.businessHours.timezone,
      configured: limits.updatedAt !== null,
      limits,
      month: {
        period: parts.month,
        responses: monthResponses,
        limit: limits.monthlyResponses,
        percent: monthPercent,
        excedente,
        blocks1000,
        estimatedBRL,
        alertPercent: limits.alertPercent,
        status:
          monthPercent === null
            ? 'ok'
            : monthPercent >= 100
              ? 'exceeded'
              : monthPercent >= limits.alertPercent
                ? 'warning'
                : 'ok',
      },
      today: {
        period: parts.day,
        responses: todayResponses,
        limit: limits.dailyResponses,
        percent: percentOf(todayResponses, limits.dailyResponses),
        perContactLimit: limits.perContactDailyResponses,
      },
      aiActiveNow: aiAllowedByHours(limits.businessHours, now),
      last30Days: days.map((day) => ({ day, responses: byDay.get(day) ?? 0 })),
      topContactsToday: (contactRows ?? []).map((row: any) => ({
        contact: maskContact(row.remoteJid),
        responses: Number(row.responses) || 0,
      })),
    };
  }

  /**
   * Month usage of every instance that has limits or answered this month (observability card and alerts).
   * Three small queries, bounded.
   */
  public async snapshot(): Promise<UsageSnapshotItem[]> {
    const now = this.now();
    const limitRows: any[] = (await this.prisma.instanceLimits.findMany({ take: SNAPSHOT_MAX_INSTANCES })) ?? [];
    const limitsById = new Map<string, UsageLimits>(limitRows.map((row) => [row.instanceId, normalizeLimits(row)]));

    const defaultMonth = zonedParts(now, DEFAULT_TIMEZONE).month;
    const monthOf = (instanceId: string) => {
      const limits = limitsById.get(instanceId);
      return limits ? zonedParts(now, limits.businessHours.timezone).month : defaultMonth;
    };
    const periods = new Set<string>([defaultMonth, ...[...limitsById.keys()].map(monthOf)]);

    const counters: any[] =
      (await this.prisma.usageCounter.findMany({
        where: { type: COUNTER_MONTH, remoteJid: '', period: { in: [...periods] } },
        select: { instanceId: true, period: true, responses: true },
        take: SNAPSHOT_MAX_INSTANCES * periods.size,
      })) ?? [];

    const usage = new Map<string, number>();
    for (const row of counters) {
      if (row.period === monthOf(row.instanceId)) usage.set(row.instanceId, Number(row.responses) || 0);
    }

    const ids = [...new Set<string>([...limitsById.keys(), ...usage.keys()])].slice(0, SNAPSHOT_MAX_INSTANCES);
    if (!ids.length) return [];

    const instances: any[] =
      (await this.prisma.instance.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })) ?? [];
    const names = new Map<string, string>(instances.map((row) => [row.id, row.name]));

    return ids
      .filter((id) => names.has(id))
      .map((id) => {
        const limits = limitsById.get(id) ?? defaultLimits();
        const responses = usage.get(id) ?? 0;
        return {
          instanceId: id,
          name: names.get(id) as string,
          period: monthOf(id),
          responses,
          limit: limits.monthlyResponses,
          percent: percentOf(responses, limits.monthlyResponses),
          alertPercent: limits.alertPercent,
          planName: limits.planName,
          ...overage(responses, limits.monthlyResponses),
        };
      })
      .sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1) || a.name.localeCompare(b.name));
  }
}
