/**
 * "Agenda": the scheduling system of WhatsAI. Appointments live in the database (AgendaSettings + Appointment) and
 * are operated by the AI through WhatsApp (tools of the OpenAI bot), by the team through the panel and by MCP.
 *
 * - Off by default: no AgendaSettings row, or enabled = false, means no tools, no reminders, no reply handling.
 * - Overlaps are prevented in a transaction: the AgendaSettings row of the instance is updated first (row lock), so
 *   two bookings of one instance never check availability at the same time (PostgreSQL and MySQL alike).
 * - Reminders: a lightweight in-process ticker (60 s, single-flight) that only touches the database when something
 *   is due (the next due time is kept in memory, re-checked at most every 30 min), so Neon can still scale to zero;
 *   POST /agenda/tick runs it on demand (external cron when the free Render instance slept). Idempotent through
 *   Appointment.remindersSent.
 * - Messages to the client: only booking confirmation, reminders and confirm/cancel/reschedule acknowledgments
 *   (src/utils/agenda.ts). The team numbers get short internal notices.
 */
import { runWithInstance } from '@api/repository/instance-db';
import { Logger } from '@config/logger.config';
import {
  ACTIVE_STATUSES,
  AgendaProviderName,
  AgendaSettings,
  AI_MAX_ACTIVE_PER_CONTACT,
  APPOINTMENT_STATUSES,
  AppointmentSource,
  AppointmentStatus,
  bookingConfirmationText,
  buildIcs,
  cancelledAckText,
  changeRequestAckText,
  confirmedAckText,
  decideReminder,
  defaultAgendaSettings,
  findType,
  formatSlot,
  generateSlots,
  HOLDING_STATUSES,
  Interval,
  isBookableSlot,
  MAX_REMINDER_HOURS,
  MODE_LABELS,
  normalizeAgendaSettings,
  normalizeNotifyNumbers,
  overlaps,
  parseReminderReply,
  reminderText,
  REPLY_WINDOW_HOURS,
  rescheduledAckText,
  shortName,
  TeamEvent,
  teamNotificationText,
  validateAgendaInput,
  validateAgendaSettings,
} from '@utils/agenda';
import { normalizeUserJid } from '@utils/lidJid';
import { zonedParts } from '@utils/usageLimits';
import { randomBytes } from 'crypto';

import { AgendaProvider, InternalAgendaProvider } from './agenda.provider';

const CACHE_TTL_MS = 30_000;
const TICK_INTERVAL_MS = 60_000;
/** Without anything due, the database is checked again after this (writes in this process reset it). */
const TICK_MAX_SLEEP_MS = 6 * 3_600_000;
/** Reminders reach at most 72 h + the evening shift before the start. */
const TICK_HORIZON_MS = (MAX_REMINDER_HOURS + 24) * 3_600_000 + TICK_MAX_SLEEP_MS;
const TICK_BATCH = 500;
const ICS_PAST_DAYS = 30;
const ICS_FUTURE_DAYS = 180;
const LIST_MAX = 500;

export class AgendaError extends Error {
  constructor(
    message: string,
    public readonly code: 'invalid' | 'conflict' | 'not_found' | 'forbidden' = 'invalid',
    public readonly errors: string[] = [message],
  ) {
    super(message);
    this.name = 'AgendaError';
  }
}

export type SendText = (instanceId: string, jid: string, text: string) => Promise<boolean>;

type AgendaOptions = {
  now?: () => number;
  cacheTtlMs?: number;
  /** Sends a WhatsApp text from the instance; false when it could not (instance not connected). */
  sendText?: SendText;
  /** Storage adapters by name (default: the internal one over Prisma). */
  providers?: Partial<Record<AgendaProviderName, AgendaProvider>>;
};

export type CreateInput = {
  remoteJid: string;
  contactName?: string | null;
  typeName?: string | null;
  startsAt: Date;
  notes?: string | null;
  source: AppointmentSource;
  /** Send the booking confirmation to the client (panel/MCP). The AI writes its own. */
  notifyClient?: boolean;
  /** Only free slots of the availability (AI). The team may book any free time. */
  enforceAvailability?: boolean;
  /** Other addresses of the same contact (LID / phone) for the idempotency and per-contact checks. */
  contactJids?: string[];
};

export type UpdateInput = {
  status?: AppointmentStatus;
  startsAt?: Date;
  typeName?: string;
  notes?: string | null;
  contactName?: string | null;
  notifyClient?: boolean;
  enforceAvailability?: boolean;
  by?: string;
};

const iso = (value: any): string | null => (value ? new Date(value).toISOString() : null);

/** What the API, the panel and the MCP see of an appointment. */
export function serializeAppointment(row: any, timeZone: string) {
  return {
    id: row.id,
    remoteJid: row.remoteJid,
    contactName: row.contactName ?? null,
    typeName: row.typeName,
    mode: row.mode ?? null,
    startsAt: iso(row.startsAt),
    endsAt: iso(row.endsAt),
    label: formatSlot(new Date(row.startsAt), timeZone),
    status: row.status,
    notes: row.notes ?? null,
    source: row.source,
    remindersSent: row.remindersSent ?? {},
    confirmedAt: iso(row.confirmedAt),
    cancelledAt: iso(row.cancelledAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export class AgendaService {
  private readonly logger = new Logger('AgendaService');
  private readonly cache = new Map<string, { at: number; settings: AgendaSettings; stored: boolean }>();
  private readonly names = new Map<string, string>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private nextRunAt = 0;
  private dedicated = new Set<string>();
  /** Dedicated databases whose agenda is off (cleared when the settings change in this process). */
  private readonly knownOff = new Set<string>();
  private readonly providers: Record<string, AgendaProvider>;

  constructor(
    private readonly prisma: any,
    private readonly waMonitor?: { waInstances: Record<string, any> },
    private readonly options: AgendaOptions = {},
  ) {
    this.providers = { internal: new InternalAgendaProvider(prisma), ...(options.providers ?? {}) };
  }

  /** The storage of this agenda (settings.provider); unknown names fall back to the internal one. */
  public providerFor(settings: AgendaSettings): AgendaProvider {
    return this.providers[settings.provider] ?? this.providers.internal;
  }

  private now(): Date {
    return new Date((this.options.now ?? Date.now)());
  }

  /** The clock of the service (injectable in the tests). */
  public clock(): Date {
    return this.now();
  }

  // ------------------------------------------------------------------------------------------ settings

  public async getSettings(instanceId: string): Promise<AgendaSettings> {
    return (await this.loadSettings(instanceId)).settings;
  }

  public async isConfigured(instanceId: string): Promise<boolean> {
    return (await this.loadSettings(instanceId)).stored;
  }

  private async loadSettings(instanceId: string) {
    const at = this.now().getTime();
    const hit = this.cache.get(instanceId);
    if (hit && at - hit.at < (this.options.cacheTtlMs ?? CACHE_TTL_MS)) return hit;
    const row = await this.prisma.agendaSettings.findUnique({ where: { instanceId } });
    const entry = { at, settings: row ? normalizeAgendaSettings(row) : defaultAgendaSettings(), stored: !!row };
    this.cache.set(instanceId, entry);
    return entry;
  }

  /** Agenda on for this instance. Never throws (false on any failure). */
  public async isEnabled(instanceId: string): Promise<boolean> {
    try {
      return (await this.getSettings(instanceId)).enabled;
    } catch {
      return false;
    }
  }

  public invalidate(instanceId: string): void {
    this.cache.delete(instanceId);
    this.knownOff.delete(instanceId);
    this.nextRunAt = 0;
  }

  /** Partial update (absent = unchanged). Throws AgendaError with every problem (PT-BR). */
  public async saveSettings(instanceId: string, input: Record<string, any>) {
    const inputErrors = validateAgendaInput(input);
    if (inputErrors.length) throw new AgendaError(inputErrors.join(' '), 'invalid', inputErrors);

    const row = await this.prisma.agendaSettings.findUnique({ where: { instanceId } });
    const previous = row ? normalizeAgendaSettings(row) : null;
    const base: any = previous ?? defaultAgendaSettings();
    const merged: any = { ...base };
    const simple = [
      'enabled',
      'timezone',
      'provider',
      'slotMinutes',
      'bufferMinutes',
      'minNoticeHours',
      'maxDaysAhead',
    ];
    for (const key of [...simple, 'availability', 'blocks', 'appointmentTypes', 'notifyNumbers']) {
      if (input[key] !== undefined) merged[key] = input[key];
    }
    for (const key of ['reminders', 'confirmation', 'aiPermissions']) {
      if (input[key] && typeof input[key] === 'object') merged[key] = { ...base[key], ...input[key] };
    }
    if (input.availability && typeof input.availability === 'object') {
      merged.availability = { ...base.availability, ...input.availability };
    }

    const settings = normalizeAgendaSettings({ ...merged, icsToken: base.icsToken });
    const errors = validateAgendaSettings(settings);
    if (errors.length) throw new AgendaError(errors.join(' '), 'invalid', errors);

    const data = {
      enabled: settings.enabled,
      timezone: settings.timezone,
      provider: settings.provider,
      slotMinutes: settings.slotMinutes,
      bufferMinutes: settings.bufferMinutes,
      minNoticeHours: settings.minNoticeHours,
      maxDaysAhead: settings.maxDaysAhead,
      availability: settings.availability,
      blocks: settings.blocks,
      appointmentTypes: settings.appointmentTypes,
      reminders: settings.reminders,
      confirmation: settings.confirmation,
      aiPermissions: settings.aiPermissions,
      notifyNumbers: settings.notifyNumbers,
    };
    const saved = await this.prisma.agendaSettings.upsert({
      where: { instanceId },
      create: { instanceId, ...data },
      update: data,
    });
    this.invalidate(instanceId);
    return { previous, settings: normalizeAgendaSettings(saved ?? data) };
  }

  /** New random token for the public ICS URL (the old URL stops working). */
  public async regenerateIcsToken(instanceId: string): Promise<string> {
    const icsToken = randomBytes(24).toString('hex');
    await this.prisma.agendaSettings.upsert({
      where: { instanceId },
      create: { instanceId, icsToken },
      update: { icsToken },
    });
    this.invalidate(instanceId);
    return icsToken;
  }

  // -------------------------------------------------------------------------------------------- reading

  private async busy(instanceId: string, from: Date, to: Date, db?: any): Promise<Interval[]> {
    const settings = await this.getSettings(instanceId);
    return this.providerFor(settings).getBusy(instanceId, { from, to }, db);
  }

  /**
   * Future appointments of ONE contact (every address of it). The only listing the AI ever gets: a contact never
   * sees appointments of other people (onlyOwnAppointments is always on).
   */
  public async listOwnAppointments(instanceId: string, contactJids: string[], limit = 10) {
    const settings = await this.getSettings(instanceId);
    const jids = [...new Set(contactJids.map(normalizeUserJid).filter(Boolean))];
    const rows = await this.providerFor(settings).listOwnEvents(instanceId, jids, { from: this.now(), limit });
    return rows.map((row) => serializeAppointment(row, settings.timezone));
  }

  public async listAppointments(
    instanceId: string,
    filter: { from?: Date; to?: Date; contactJids?: string[]; status?: string[]; limit?: number } = {},
  ) {
    const settings = await this.getSettings(instanceId);
    const where: any = { instanceId };
    if (filter.from || filter.to) {
      where.startsAt = {};
      if (filter.from) where.startsAt.gte = filter.from;
      if (filter.to) where.startsAt.lt = filter.to;
    }
    if (filter.contactJids?.length) where.remoteJid = { in: filter.contactJids };
    if (filter.status?.length) where.status = { in: filter.status };
    const rows: any[] =
      (await this.prisma.appointment.findMany({
        where,
        orderBy: { startsAt: 'asc' },
        take: Math.min(filter.limit ?? LIST_MAX, LIST_MAX),
      })) ?? [];
    return rows.map((row) => serializeAppointment(row, settings.timezone));
  }

  public async getAppointment(instanceId: string, id: string) {
    const row = await this.prisma.appointment.findFirst({ where: { id: String(id), instanceId } });
    if (!row) throw new AgendaError('Agendamento não encontrado.', 'not_found');
    return row;
  }

  /** Free slots from a local day (default today) for a type (default: the first type). */
  public async freeSlots(
    instanceId: string,
    options: { fromDay?: string; days?: number; typeName?: string | null; limit?: number } = {},
  ) {
    const settings = await this.getSettings(instanceId);
    const type = findType(settings, options.typeName);
    if (!type) throw new AgendaError(`Tipo de atendimento desconhecido: "${options.typeName}".`, 'invalid');
    const now = this.now();
    const days = Math.max(1, Math.min(options.days ?? 7, settings.maxDaysAhead + 1, 60));
    const horizon = new Date(now.getTime() + (settings.maxDaysAhead + 2) * 86_400_000);
    const busy = await this.busy(instanceId, new Date(now.getTime() - 86_400_000), horizon);
    const slots = generateSlots(settings, {
      now,
      fromDay: options.fromDay,
      days,
      durationMinutes: type.minutes,
      busy,
      limit: options.limit,
    });
    return {
      timezone: settings.timezone,
      type,
      slots: slots.map((slot) => ({
        startsAt: slot.start.toISOString(),
        endsAt: slot.end.toISOString(),
        label: formatSlot(slot.start, settings.timezone),
      })),
    };
  }

  // -------------------------------------------------------------------------------------------- writing

  /**
   * Books one appointment. Idempotent per contact + start (the same booking twice returns the first one). The
   * availability check and the insert run in one transaction, serialized per instance by the settings row lock.
   */
  public async createAppointment(instanceId: string, input: CreateInput) {
    const settings = await this.getSettings(instanceId);
    const remoteJid = normalizeUserJid(input.remoteJid);
    if (!remoteJid || remoteJid.endsWith('@g.us')) throw new AgendaError('Contato inválido para agendamento.');
    const type = findType(settings, input.typeName);
    if (!type) {
      throw new AgendaError(
        `Tipo de atendimento desconhecido: "${input.typeName}". Tipos: ${settings.appointmentTypes.map((t) => t.name).join(', ')}.`,
      );
    }
    const start = input.startsAt;
    if (!(start instanceof Date) || Number.isNaN(start.getTime())) throw new AgendaError('Data e hora inválidas.');
    const end = new Date(start.getTime() + type.minutes * 60_000);
    const now = this.now();
    if (input.enforceAvailability !== false && start.getTime() < now.getTime()) {
      throw new AgendaError('Esse horário já passou.', 'conflict');
    }
    const jids = [...new Set([remoteJid, ...(input.contactJids ?? []).map(normalizeUserJid).filter(Boolean)])];

    await this.prisma.agendaSettings.upsert({ where: { instanceId }, create: { instanceId }, update: {} });

    // runWithInstance: with "banco próprio por instância" the transaction opens on the database of the instance
    const result = await runWithInstance(instanceId, () =>
      this.prisma.$transaction(
        async (tx: any) => {
          await tx.agendaSettings.update({ where: { instanceId }, data: { bookingSeq: { increment: 1 } } });

          const same = await tx.appointment.findFirst({
            where: { instanceId, remoteJid: { in: jids }, startsAt: start, status: { not: 'cancelado' } },
          });
          if (same) return { row: same, created: false };

          if (input.source === 'ia') {
            const active = await tx.appointment.count({
              where: { instanceId, remoteJid: { in: jids }, status: { in: HOLDING_STATUSES }, startsAt: { gt: now } },
            });
            if (active >= AI_MAX_ACTIVE_PER_CONTACT) {
              throw new AgendaError(
                `Este contato já tem ${active} agendamentos futuros. Para marcar outro, a equipe precisa ajudar.`,
                'forbidden',
              );
            }
          }

          const margin = settings.bufferMinutes * 60_000;
          const busy = await this.busy(
            instanceId,
            new Date(start.getTime() - margin - 86_400_000),
            new Date(end.getTime() + margin + 86_400_000),
            tx,
          );
          if (input.enforceAvailability !== false) {
            if (!isBookableSlot(settings, start, type.minutes, busy, now)) {
              throw new AgendaError('Esse horário não está disponível.', 'conflict');
            }
          } else if (busy.some((item) => overlaps({ start, end }, item, settings.bufferMinutes))) {
            throw new AgendaError('Já existe um agendamento nesse horário.', 'conflict');
          }

          // AI bookings wait for the team when requireTeamApproval is on (the slot is held meanwhile)
          const pending = input.source === 'ia' && settings.aiPermissions.requireTeamApproval;
          const row = await this.providerFor(settings).createEvent(
            instanceId,
            {
              remoteJid,
              contactName: input.contactName?.trim().slice(0, 120) || null,
              typeName: type.name,
              mode: type.mode,
              startsAt: start,
              endsAt: end,
              status: pending ? 'pendente' : 'agendado',
              notes: input.notes?.trim().slice(0, 2000) || null,
              source: input.source,
              remindersSent: {},
            },
            tx,
          );
          return { row, created: true };
        },
        { timeout: 15_000 },
      ),
    );

    if (result.created) {
      this.nextRunAt = 0;
      if (input.notifyClient) {
        await this.safeSend(instanceId, remoteJid, bookingConfirmationText(result.row, type, settings.timezone));
      }
      if (input.source !== 'manual') {
        await this.notifyTeam(
          instanceId,
          result.row.status === 'pendente' ? 'pendente' : 'novo',
          result.row,
          input.source,
        );
      }
    }
    return { appointment: serializeAppointment(result.row, settings.timezone), created: result.created, type };
  }

  /** Status, reschedule, notes. Rescheduling re-checks overlaps (and the availability when asked). */
  public async updateAppointment(instanceId: string, id: string, input: UpdateInput) {
    const settings = await this.getSettings(instanceId);
    const current = await this.getAppointment(instanceId, id);
    if (input.status && !APPOINTMENT_STATUSES.includes(input.status)) throw new AgendaError('Status inválido.');

    const data: any = {};
    const now = this.now();
    let rescheduled = false;
    const type =
      findType(settings, input.typeName ?? current.typeName) ??
      ({
        name: current.typeName,
        minutes: Math.round((+current.endsAt - +current.startsAt) / 60_000),
        mode: current.mode,
      } as any);
    if (input.typeName !== undefined && !findType(settings, input.typeName)) {
      throw new AgendaError(`Tipo de atendimento desconhecido: "${input.typeName}".`);
    }

    const newStart = input.startsAt ?? (input.typeName !== undefined ? new Date(current.startsAt) : null);
    if (newStart) {
      if (Number.isNaN(newStart.getTime())) throw new AgendaError('Data e hora inválidas.');
      const end = new Date(newStart.getTime() + type.minutes * 60_000);
      rescheduled = newStart.getTime() !== new Date(current.startsAt).getTime();
      Object.assign(data, { startsAt: newStart, endsAt: end, typeName: type.name, mode: type.mode });
      if (rescheduled) Object.assign(data, { remindersSent: {}, awaitingReplyAt: null, confirmedAt: null });
      if (rescheduled && !input.status && current.status === 'confirmado') data.status = 'agendado';
    }
    if (input.status) {
      data.status = input.status;
      if (input.status === 'confirmado') data.confirmedAt = now;
      if (input.status === 'cancelado') Object.assign(data, { cancelledAt: now, awaitingReplyAt: null });
    }
    if (input.notes !== undefined) data.notes = input.notes?.trim().slice(0, 2000) || null;
    if (input.contactName !== undefined) data.contactName = input.contactName?.trim().slice(0, 120) || null;
    if (!Object.keys(data).length) throw new AgendaError('Nada para alterar.');

    let row: any;
    if (newStart && (data.status ?? current.status) !== 'cancelado') {
      await this.prisma.agendaSettings.upsert({ where: { instanceId }, create: { instanceId }, update: {} });
      row = await runWithInstance(instanceId, () =>
        this.prisma.$transaction(
          async (tx: any) => {
            await tx.agendaSettings.update({ where: { instanceId }, data: { bookingSeq: { increment: 1 } } });
            const busy = await this.busy(
              instanceId,
              new Date(newStart.getTime() - 2 * 86_400_000),
              new Date(newStart.getTime() + 2 * 86_400_000),
              tx,
            );
            if (input.enforceAvailability) {
              if (
                newStart.getTime() < now.getTime() ||
                !isBookableSlot(settings, newStart, type.minutes, busy, now, current.id)
              ) {
                throw new AgendaError('Esse horário não está disponível.', 'conflict');
              }
            } else if (
              busy.some(
                (item) =>
                  item.id !== current.id &&
                  overlaps({ start: newStart, end: data.endsAt }, item, settings.bufferMinutes),
              )
            ) {
              throw new AgendaError('Já existe um agendamento nesse horário.', 'conflict');
            }
            return this.providerFor(settings).updateEvent(instanceId, current.id, data, tx);
          },
          { timeout: 15_000 },
        ),
      );
    } else {
      const provider = this.providerFor(settings);
      row =
        data.status === 'cancelado'
          ? await provider.cancelEvent(instanceId, current.id, data)
          : await provider.updateEvent(instanceId, current.id, data);
    }
    this.nextRunAt = 0;

    const by = input.by ?? 'manual';
    const cancelled = data.status === 'cancelado' && current.status !== 'cancelado';
    // The team approved a booking request of the AI: the client gets the booking confirmation
    const approved = current.status === 'pendente' && ACTIVE_STATUSES.includes(row.status);
    const future = new Date(row.startsAt).getTime() > now.getTime();
    if (approved && !rescheduled && input.notifyClient && new Date(row.startsAt).getTime() > now.getTime()) {
      await this.safeSend(
        instanceId,
        row.remoteJid,
        bookingConfirmationText(row, findType(settings, row.typeName), settings.timezone),
      );
    }
    if (cancelled) {
      if (input.notifyClient && future)
        await this.safeSend(instanceId, row.remoteJid, cancelledAckText(row, settings.timezone));
      if (by !== 'manual') await this.notifyTeam(instanceId, 'cancelado', row, by);
    } else if (rescheduled) {
      if (input.notifyClient && future) {
        await this.safeSend(
          instanceId,
          row.remoteJid,
          rescheduledAckText(row, findType(settings, row.typeName), settings.timezone),
        );
      }
      if (by !== 'manual') await this.notifyTeam(instanceId, 'remarcado', row, by);
    }
    return serializeAppointment(row, settings.timezone);
  }

  public async cancelAppointment(
    instanceId: string,
    id: string,
    options: { notifyClient?: boolean; by?: string } = {},
  ) {
    return this.updateAppointment(instanceId, id, { status: 'cancelado', ...options });
  }

  // ------------------------------------------------------------------------------------- notifications

  private async instanceName(instanceId: string): Promise<string | null> {
    if (this.names.has(instanceId)) return this.names.get(instanceId);
    const row = await this.prisma.instance.findUnique({ where: { id: instanceId }, select: { name: true } });
    if (row?.name) this.names.set(instanceId, row.name);
    return row?.name ?? null;
  }

  private async defaultSend(instanceId: string, jid: string, text: string): Promise<boolean> {
    const name = await this.instanceName(instanceId);
    const channel = name ? this.waMonitor?.waInstances?.[name] : null;
    if (!channel || channel.connectionStatus?.state !== 'open') return false;
    // fromChatbot = true: the echo is registered as a bot message (it never pauses the AI)
    await channel.textMessage(
      { number: jid.includes('@lid') ? jid : jid.split('@')[0], text, delay: 1200, linkPreview: false },
      false,
      true,
    );
    return true;
  }

  /** Never throws. */
  private async safeSend(instanceId: string, jid: string, text: string): Promise<boolean> {
    try {
      const send = this.options.sendText ?? ((a: string, b: string, c: string) => this.defaultSend(a, b, c));
      return await send(instanceId, jid, text);
    } catch (error) {
      this.logger.error(`Agenda message to a contact of ${instanceId} failed: ${error?.message ?? error}`);
      return false;
    }
  }

  /** Agenda numbers, else the numbers of the Leads notifications (when that feature is installed and on). */
  private async teamNumbers(instanceId: string): Promise<string[]> {
    const own = (await this.getSettings(instanceId)).notifyNumbers;
    if (own.length) return own;
    try {
      const leads = await this.prisma.leadSettings?.findUnique?.({ where: { instanceId } });
      return leads?.notifyEnabled ? normalizeNotifyNumbers(leads.notifyNumbers) : [];
    } catch {
      return [];
    }
  }

  private async notifyTeam(instanceId: string, event: TeamEvent, row: any, by: string): Promise<void> {
    const numbers = await this.teamNumbers(instanceId);
    if (!numbers.length) return;
    const settings = await this.getSettings(instanceId);
    const text = teamNotificationText(event, row, settings.timezone, by);
    for (const number of numbers) await this.safeSend(instanceId, `${number}@s.whatsapp.net`, text);
  }

  // ------------------------------------------------------------------------------------- reminder reply

  /**
   * The first message of a contact after a reminder: "1"/"confirmo" confirms, "2" asks to change. Anything else
   * clears the wait and goes to the AI as usual. Returns what the OpenAI flow does with it, or null.
   */
  public async handleReminderReply(
    instanceId: string,
    jids: string[],
    text: string,
  ): Promise<{ reply?: string; note?: string; fallback?: string } | null> {
    if (!(await this.isEnabled(instanceId))) return null;
    const now = this.now();
    const contact = jids.map(normalizeUserJid).filter(Boolean);
    if (!contact.length) return null;
    const row = await this.prisma.appointment.findFirst({
      where: {
        instanceId,
        remoteJid: { in: contact },
        status: { in: ACTIVE_STATUSES },
        startsAt: { gt: now },
        awaitingReplyAt: { gte: new Date(now.getTime() - REPLY_WINDOW_HOURS * 3_600_000) },
      },
      orderBy: { awaitingReplyAt: 'desc' },
    });
    if (!row) return null;

    const settings = await this.getSettings(instanceId);
    const kind = parseReminderReply(text);
    const data: any = { awaitingReplyAt: null };
    if (kind === 'confirm') Object.assign(data, { status: 'confirmado', confirmedAt: row.confirmedAt ?? now });
    await this.prisma.appointment.update({ where: { id: row.id, instanceId }, data });
    if (!kind) return null;
    if (kind === 'confirm') return { reply: confirmedAckText(row, settings.timezone) };

    const ai = settings.aiPermissions;
    const ack = changeRequestAckText(row, settings.timezone);
    if (ai.allowCancel || ai.allowReschedule) {
      return {
        note:
          `[Resposta ao lembrete: o cliente quer remarcar ou cancelar o agendamento ${row.id} ` +
          `(${row.typeName}, ${formatSlot(new Date(row.startsAt), settings.timezone)}). Pergunte se prefere remarcar ou cancelar e use as ferramentas.]`,
        fallback: ack,
      };
    }
    await this.notifyTeam(instanceId, 'pedido', row, 'cliente');
    return { reply: ack };
  }

  // --------------------------------------------------------------------------------------------- ticker

  /** Starts the in-process ticker (idempotent). */
  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.runIfDue(), TICK_INTERVAL_MS);
    this.timer.unref?.();
  }

  public stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async runIfDue(): Promise<void> {
    if (this.running || this.now().getTime() < this.nextRunAt) return;
    await this.tick().catch((error) => this.logger.error(`Agenda tick failed: ${error?.message ?? error}`));
  }

  /**
   * Sends the reminders that are due. Single-flight: a call while another runs returns { running: true }.
   */
  public async tick() {
    if (this.running) return { running: true };
    this.running = true;
    const now = this.now();
    const stats = { running: false, checked: 0, sent: 0, skipped: 0, failed: 0, waiting: 0, nextRunAt: '' };
    let next = now.getTime() + TICK_MAX_SLEEP_MS;
    try {
      const rows: any[] = await this.enabledSettingsRows();
      const settingsById = new Map<string, AgendaSettings>();
      for (const row of rows) {
        const settings = normalizeAgendaSettings(row);
        if (settings.reminders.enabled && settings.reminders.hoursBefore.length)
          settingsById.set(row.instanceId, settings);
      }

      if (settingsById.size) {
        const appointments: any[] = [];
        for (const group of this.byDatabase([...settingsById.keys()])) {
          appointments.push(
            ...((await this.prisma.appointment.findMany({
              where: {
                instanceId: group.length === 1 ? group[0] : { in: group },
                status: { in: ACTIVE_STATUSES },
                startsAt: { gt: now, lte: new Date(now.getTime() + TICK_HORIZON_MS) },
              },
              orderBy: { startsAt: 'asc' },
              take: TICK_BATCH,
            })) ?? []),
          );
        }

        for (const appointment of appointments) {
          stats.checked++;
          const settings = settingsById.get(appointment.instanceId);
          const sent = { ...(appointment.remindersSent ?? {}) };
          const start = new Date(appointment.startsAt);
          const decision = decideReminder(
            { startsAt: start, createdAt: appointment.createdAt ? new Date(appointment.createdAt) : undefined },
            settings.reminders.hoursBefore,
            settings.timezone,
            sent,
            now,
          );

          if (decision.action === 'wait') {
            if (decision.at) {
              next = Math.min(next, decision.at.getTime());
              stats.waiting++;
            }
            continue;
          }

          for (const key of decision.skip) sent[key] = { at: now.toISOString(), skipped: true };
          stats.skipped += decision.skip.length;
          const data: any = { remindersSent: sent };

          if (decision.action === 'send') {
            const text = reminderText(
              appointment,
              findType(settings, appointment.typeName),
              settings.timezone,
              settings.confirmation.enabled,
            );
            let ok = false;
            let failed = false;
            try {
              const send = this.options.sendText ?? ((a: string, b: string, c: string) => this.defaultSend(a, b, c));
              ok = await send(appointment.instanceId, appointment.remoteJid, text);
            } catch (error) {
              failed = true;
              this.logger.error(`Reminder ${appointment.id} failed: ${error?.message ?? error}`);
            }
            if (ok) {
              sent[decision.key] = { at: now.toISOString(), ok: true };
              data.awaitingReplyAt = now;
              stats.sent++;
            } else if (failed) {
              sent[decision.key] = { at: now.toISOString(), ok: false };
              stats.failed++;
            } else {
              // Instance not connected: try again on the next tick
              next = Math.min(next, now.getTime() + TICK_INTERVAL_MS);
              if (!decision.skip.length) continue;
            }
          }
          // Only this exact state is overwritten (another writer wins: the next tick sees its update)
          await this.prisma.appointment.updateMany({
            where: { id: appointment.id, instanceId: appointment.instanceId, updatedAt: appointment.updatedAt },
            data,
          });
          next = Math.min(next, now.getTime() + TICK_INTERVAL_MS);
        }
        if (appointments.length >= TICK_BATCH) next = now.getTime() + TICK_INTERVAL_MS;
      }
    } finally {
      this.running = false;
      this.nextRunAt = Math.max(next, now.getTime() + TICK_INTERVAL_MS - 1000);
      stats.nextRunAt = new Date(this.nextRunAt).toISOString();
    }
    return stats;
  }

  // ----------------------------------------------------------------------- "banco próprio por instância"

  /** Instances with their own database (control plane). Empty when the feature is off. */
  private async dedicatedIds(): Promise<string[]> {
    try {
      const rows: any[] =
        (await this.prisma.instanceDatabase?.findMany?.({
          where: { status: 'ready' },
          select: { instanceId: true },
        })) ?? [];
      this.dedicated = new Set(rows.map((row) => row.instanceId));
    } catch {
      this.dedicated = new Set();
    }
    return [...this.dedicated];
  }

  /** Instance ids grouped per database: the shared ones in one query, each dedicated one on its own. */
  private byDatabase(ids: string[]): string[][] {
    const shared = ids.filter((id) => !this.dedicated.has(id));
    return [...(shared.length ? [shared] : []), ...ids.filter((id) => this.dedicated.has(id)).map((id) => [id])];
  }

  /**
   * AgendaSettings rows with the agenda on, from the shared database and from every dedicated one (a dedicated
   * database whose agenda is known to be off is not queried again: it can sleep).
   */
  private async enabledSettingsRows(): Promise<any[]> {
    const dedicated = await this.dedicatedIds();
    const shared: any[] = (await this.prisma.agendaSettings.findMany({ where: { enabled: true }, take: 500 })) ?? [];
    const rows = shared.filter((row: any) => !this.dedicated.has(row.instanceId));
    for (const instanceId of dedicated) {
      if (this.knownOff.has(instanceId)) continue;
      const row = await this.prisma.agendaSettings.findUnique({ where: { instanceId } }).catch((): any => null);
      if (row?.enabled) rows.push(row);
      else this.knownOff.add(instanceId);
    }
    return rows;
  }

  // ------------------------------------------------------------------------------------------------ ICS

  public async icsFor(instanceId: string): Promise<string> {
    const settings = await this.getSettings(instanceId);
    const now = this.now();
    const rows: any[] =
      (await this.prisma.appointment.findMany({
        where: {
          instanceId,
          startsAt: {
            gte: new Date(now.getTime() - ICS_PAST_DAYS * 86_400_000),
            lt: new Date(now.getTime() + ICS_FUTURE_DAYS * 86_400_000),
          },
        },
        orderBy: { startsAt: 'asc' },
        take: 2000,
      })) ?? [];
    const name = (await this.instanceName(instanceId)) ?? 'WhatsAI';
    return buildIcs({
      name: `Agenda ${name}`,
      timeZone: settings.timezone,
      now,
      events: rows.map((row) => {
        const type = findType(settings, row.typeName);
        const phone = String(row.remoteJid).split('@')[0].replace(/\D/g, '');
        // Notes are never in the feed (professional secrecy): only who, what and where
        return {
          uid: `${row.id}@whatsai`,
          start: new Date(row.startsAt),
          end: new Date(row.endsAt),
          summary: [row.typeName, shortName(row.contactName)].filter(Boolean).join(' — '),
          description: [
            row.contactName ? `Cliente: ${row.contactName}` : null,
            phone ? `WhatsApp: +${phone}` : null,
            row.mode ? `Modo: ${MODE_LABELS[row.mode as keyof typeof MODE_LABELS] ?? row.mode}` : null,
            `Status: ${row.status}`,
          ]
            .filter(Boolean)
            .join('\n'),
          location: type?.mode === 'presencial' || type?.mode === 'online' ? type.location : null,
          status: row.status === 'cancelado' ? 'CANCELLED' : row.status === 'agendado' ? 'TENTATIVE' : 'CONFIRMED',
          updatedAt: row.updatedAt ? new Date(row.updatedAt) : null,
        };
      }),
    });
  }

  /** The feed of the instance whose token matches; null when no instance has it. */
  public async icsByToken(token: string): Promise<string | null> {
    if (!/^[a-f0-9]{32,64}$/.test(String(token ?? ''))) return null;
    let row = await this.prisma.agendaSettings.findUnique({ where: { icsToken: token } });
    if (!row) {
      for (const instanceId of await this.dedicatedIds()) {
        row = await this.prisma.agendaSettings
          .findFirst({ where: { instanceId, icsToken: token } })
          .catch((): any => null);
        if (row) break;
      }
    }
    return row ? this.icsFor(row.instanceId) : null;
  }

  /** Today in the agenda zone (YYYY-MM-DD). */
  public async today(instanceId: string): Promise<string> {
    return zonedParts(this.now(), (await this.getSettings(instanceId)).timezone).day;
  }
}
