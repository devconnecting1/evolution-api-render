/**
 * "Visão Geral com o resultado do escritório": the API behind the first screen of the panel.
 *
 * The question the page answers is "how was the week?". Everything is scoped by instanceId (the Prisma router sends
 * the queries to the dedicated database of the instance when it has one) and grouped in the office time zone
 * (the same one of "Plano e limites" and of the agenda), never in UTC.
 *
 * Sources, all existing models:
 *   Lead         - leads created in the period (createdAt) and the current "aguardando equipe" snapshot.
 *   Appointment  - appointments booked in the period (createdAt) and the agenda of today (startsAt).
 *   UsageCounter - AI answers per day (the same counters of "Plano e limites"; kept for 90 days).
 *   InstanceLimits - monthly franchise and time zone.
 *   Process / ProcessMovement / Publication - alerts (through the process service, optional).
 *
 * Not invented: "1ª resposta" is not part of the response because the stored leads only keep the last human reply
 * (Lead.lastHumanReplyAt), not the first one. The PR records the decision.
 *
 * There is no timer and no cache: the route is only queried when the Visão Geral opens (Neon can stay asleep).
 */
import { AWAITING_STATUSES } from '@utils/leads';
import {
  overviewDays,
  OverviewPeriod,
  overviewRange,
  overviewVariation,
  zonedDay,
  zonedDayStart,
  zonedTime,
} from '@utils/overview';
import { COUNTER_DAY, COUNTER_MONTH, normalizeLimits, percentOf, shiftDay, zonedParts } from '@utils/usageLimits';

const AWAITING_ALERT_MS = 2 * 60 * 60 * 1000;
/** A guard for the daily buckets: law-office volumes are in the hundreds; beyond this the totals still use count(). */
const DEFAULT_SCAN_LIMIT = 10_000;
const TODAY_MAX = 20;

export type OverviewAlerts = { processesWithNews: number; unseenPublications: number };

export type OverviewOptions = {
  now?: () => number;
  /** Optional: the same badge of the Processos page (src/api/services/processos.service.ts). */
  processesBadge?: (instanceId: string) => Promise<OverviewAlerts>;
  scanLimit?: number;
};

export class OverviewService {
  constructor(
    private readonly prisma: any,
    private readonly options: OverviewOptions = {},
  ) {}

  private now(): Date {
    return new Date((this.options.now ?? Date.now)());
  }

  private async processAlerts(instanceId: string): Promise<OverviewAlerts> {
    if (!this.options.processesBadge) return { processesWithNews: 0, unseenPublications: 0 };
    try {
      const badge = await this.options.processesBadge(instanceId);
      return {
        processesWithNews: Number(badge?.processesWithNews) || 0,
        unseenPublications: Number(badge?.unseenPublications) || 0,
      };
    } catch {
      // The overview must never fail because of the court-case alerts
      return { processesWithNews: 0, unseenPublications: 0 };
    }
  }

  public async get(instanceId: string, days: OverviewPeriod) {
    const now = this.now();
    const limitsRow = await this.prisma.instanceLimits.findUnique({ where: { instanceId } });
    const limits = normalizeLimits(limitsRow);
    const timezone = limits.businessHours.timezone;
    const today = zonedDay(now, timezone);
    const range = overviewRange(today, days);
    const daysInPeriod = overviewDays(range);
    const scanLimit = this.options.scanLimit ?? DEFAULT_SCAN_LIMIT;

    // [from, tomorrow) is the whole current period, today included; [previousFrom, from) is the previous one.
    const from = zonedDayStart(range.from, timezone);
    const tomorrow = zonedDayStart(shiftDay(today, -1), timezone);
    const todayStart = zonedDayStart(today, timezone);
    const previousFrom = zonedDayStart(range.previousFrom, timezone);
    const month = zonedParts(now, timezone).month;

    const [
      leadRows,
      appointmentRows,
      previousLeads,
      previousAppointments,
      usageRows,
      monthRow,
      awaitingRows,
      todayRows,
      alerts,
    ] = await Promise.all([
      this.prisma.lead.findMany({
        where: { instanceId, createdAt: { gte: from, lt: tomorrow } },
        select: { createdAt: true },
        take: scanLimit,
      }),
      this.prisma.appointment.findMany({
        where: { instanceId, createdAt: { gte: from, lt: tomorrow } },
        select: { createdAt: true },
        take: scanLimit,
      }),
      this.prisma.lead.count({ where: { instanceId, createdAt: { gte: previousFrom, lt: from } } }),
      this.prisma.appointment.count({ where: { instanceId, createdAt: { gte: previousFrom, lt: from } } }),
      this.prisma.usageCounter.findMany({
        where: {
          instanceId,
          type: COUNTER_DAY,
          remoteJid: '',
          period: { gte: range.previousFrom, lte: range.to },
        },
        select: { period: true, responses: true },
      }),
      this.prisma.usageCounter.findUnique({
        where: {
          instanceId_type_period_remoteJid: { instanceId, type: COUNTER_MONTH, period: month, remoteJid: '' },
        },
        select: { responses: true },
      }),
      this.prisma.lead.findMany({
        where: { instanceId, status: { in: AWAITING_STATUSES }, awaitingHumanSince: { not: null } },
        select: { awaitingHumanSince: true },
      }),
      this.prisma.appointment.findMany({
        where: {
          instanceId,
          startsAt: { gte: todayStart, lt: tomorrow },
          status: { not: 'cancelado' },
        },
        orderBy: { startsAt: 'asc' },
        take: TODAY_MAX,
        select: { id: true, startsAt: true, contactName: true, typeName: true, status: true },
      }),
      this.processAlerts(instanceId),
    ]);

    const leadsTotal =
      leadRows.length >= scanLimit
        ? await this.prisma.lead.count({ where: { instanceId, createdAt: { gte: from, lt: tomorrow } } })
        : leadRows.length;
    const appointmentsTotal =
      appointmentRows.length >= scanLimit
        ? await this.prisma.appointment.count({ where: { instanceId, createdAt: { gte: from, lt: tomorrow } } })
        : appointmentRows.length;

    const leadsByDay = this.bucket(leadRows, timezone);
    const appointmentsByDay = this.bucket(appointmentRows, timezone);
    const aiByDay = new Map<string, number>(
      (usageRows ?? []).map((row: any) => [String(row.period), Number(row.responses) || 0]),
    );

    const aiResponses = daysInPeriod.reduce((sum, day) => sum + (aiByDay.get(day) ?? 0), 0);
    const previousAiResponses = (usageRows ?? [])
      .filter((row: any) => String(row.period) >= range.previousFrom && String(row.period) <= range.previousTo)
      .reduce((sum: number, row: any) => sum + (Number(row.responses) || 0), 0);

    const waiting = (awaitingRows ?? [])
      .map((row: any) => new Date(row.awaitingHumanSince).getTime())
      .filter((at: number) => Number.isFinite(at));
    const awaitingTeam = waiting.length;
    const awaitingOver2h = waiting.filter((at: number) => at <= now.getTime() - AWAITING_ALERT_MS).length;

    const monthResponses = Number(monthRow?.responses) || 0;

    return {
      generatedAt: now.toISOString(),
      timezone,
      period: { days, from: range.from, to: range.to },
      previousPeriod: { from: range.previousFrom, to: range.previousTo },
      totals: {
        leadsNew: leadsTotal,
        awaitingTeam,
        appointments: appointmentsTotal,
        aiResponses,
      },
      previous: {
        leadsNew: Number(previousLeads) || 0,
        awaitingTeam: null,
        appointments: Number(previousAppointments) || 0,
        aiResponses: previousAiResponses,
      },
      variation: {
        leadsNew: overviewVariation(leadsTotal, Number(previousLeads) || 0),
        awaitingTeam: null,
        appointments: overviewVariation(appointmentsTotal, Number(previousAppointments) || 0),
        aiResponses: overviewVariation(aiResponses, previousAiResponses),
      },
      daily: daysInPeriod.map((day) => ({
        day,
        leads: leadsByDay.get(day) ?? 0,
        appointments: appointmentsByDay.get(day) ?? 0,
        aiResponses: aiByDay.get(day) ?? 0,
      })),
      plan: {
        month,
        responses: monthResponses,
        limit: limits.monthlyResponses,
        percent: percentOf(monthResponses, limits.monthlyResponses),
      },
      today: {
        day: today,
        appointments: (todayRows ?? []).map((row: any) => ({
          id: row.id,
          time: zonedTime(new Date(row.startsAt), timezone),
          startsAt: new Date(row.startsAt).toISOString(),
          contactName: row.contactName ?? null,
          typeName: row.typeName,
          status: row.status,
        })),
      },
      alerts: {
        processesWithNews: alerts.processesWithNews,
        unseenPublications: alerts.unseenPublications,
        leadsWaitingOver2h: awaitingOver2h,
      },
    };
  }

  /** Rows -> local day -> count, in the office time zone. */
  private bucket(rows: any[], timezone: string): Map<string, number> {
    const out = new Map<string, number>();
    for (const row of rows ?? []) {
      const day = zonedDay(new Date(row.createdAt), timezone);
      out.set(day, (out.get(day) ?? 0) + 1);
    }
    return out;
  }
}
