/**
 * "Agenda": where appointments live. AgendaService keeps every rule (availability, overlaps in a transaction,
 * idempotency, permissions, reminders) and talks to the storage only through this interface, so a Google Calendar
 * adapter can plug in later (AgendaSettings.provider) without touching the AI tools, the REST routes or the panel.
 *
 * Today there is one implementation, `internal`: the Appointment table of the WhatsAI database. `db` is the
 * Prisma client or the transaction client (bookings run inside the service transaction).
 */
import { AgendaProviderName, HOLDING_STATUSES, Interval } from '@utils/agenda';

export type EventRange = { from: Date; to: Date };

export interface AgendaProvider {
  readonly name: AgendaProviderName;
  /** Occupied intervals overlapping the range (cancelled appointments excluded). */
  getBusy(instanceId: string, range: EventRange, db?: any): Promise<Interval[]>;
  /** Stores a new appointment and returns its row. */
  createEvent(instanceId: string, data: Record<string, any>, db?: any): Promise<any>;
  updateEvent(instanceId: string, id: string, data: Record<string, any>, db?: any): Promise<any>;
  /** Marks the appointment as cancelled (the record stays). */
  cancelEvent(instanceId: string, id: string, data: Record<string, any>, db?: any): Promise<any>;
  /** Future appointments of ONE contact (every address of it), oldest first. */
  listOwnEvents(
    instanceId: string,
    contactJids: string[],
    options?: { from?: Date; statuses?: string[]; limit?: number },
  ): Promise<any[]>;
}

export class InternalAgendaProvider implements AgendaProvider {
  readonly name = 'internal' as const;

  constructor(private readonly prisma: any) {}

  async getBusy(instanceId: string, range: EventRange, db: any = this.prisma): Promise<Interval[]> {
    const rows: any[] =
      (await db.appointment.findMany({
        where: { instanceId, status: { not: 'cancelado' }, startsAt: { lt: range.to }, endsAt: { gt: range.from } },
        select: { id: true, startsAt: true, endsAt: true },
        take: 2000,
      })) ?? [];
    return rows.map((row) => ({ id: row.id, start: new Date(row.startsAt), end: new Date(row.endsAt) }));
  }

  createEvent(instanceId: string, data: Record<string, any>, db: any = this.prisma) {
    return db.appointment.create({ data: { ...data, instanceId } });
  }

  updateEvent(_instanceId: string, id: string, data: Record<string, any>, db: any = this.prisma) {
    return db.appointment.update({ where: { id }, data });
  }

  cancelEvent(instanceId: string, id: string, data: Record<string, any>, db: any = this.prisma) {
    return this.updateEvent(instanceId, id, { ...data, status: 'cancelado' }, db);
  }

  async listOwnEvents(
    instanceId: string,
    contactJids: string[],
    options: { from?: Date; statuses?: string[]; limit?: number } = {},
  ): Promise<any[]> {
    if (!contactJids.length) return [];
    return (
      (await this.prisma.appointment.findMany({
        where: {
          instanceId,
          remoteJid: { in: contactJids },
          status: { in: options.statuses ?? HOLDING_STATUSES },
          ...(options.from ? { startsAt: { gte: options.from } } : {}),
        },
        orderBy: { startsAt: 'asc' },
        take: Math.min(options.limit ?? 20, 100),
      })) ?? []
    );
  }
}
