import { AgendaSettingsDto, AppointmentCreateDto, AppointmentUpdateDto } from '@api/dto/agenda.dto';
import { InstanceDto } from '@api/dto/instance.dto';
import { AgendaError, AgendaService } from '@api/services/agenda.service';
import type { GoogleCalendarService } from '@api/services/google-calendar.service';
import { localToUtc, parseStart } from '@utils/agenda';
import { createJid } from '@utils/createJid';
import { normalizeUserJid } from '@utils/lidJid';

// Same shape as src/exceptions (thrown objects the error middleware turns into the response). Not imported from
// there on purpose: @exceptions pulls the whole route table into this module's bundle (tsup bundles every entry).
function BadRequestException(...message: string[]): never {
  throw { status: 400, error: 'Bad Request', message };
}
function NotFoundException(...message: string[]): never {
  throw { status: 404, error: 'Not Found', message };
}

/** Contact of a request: a JID or a phone number with country code. null when invalid. */
export function contactJid(value: unknown): string | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (text.includes('@')) {
    const jid = normalizeUserJid(text);
    return jid && /@(s\.whatsapp\.net|lid)$/.test(jid) ? jid : null;
  }
  const digits = text.replace(/\D/g, '');
  return /^\d{10,15}$/.test(digits) ? createJid(digits) : null;
}

/** "Agenda" REST routes (/agenda/*). */
export class AgendaController {
  constructor(
    private readonly agenda: AgendaService,
    private readonly prisma: any,
    private readonly google?: GoogleCalendarService,
  ) {}

  // ------------------------------------------------------------------------------------- Google Agenda

  /** Connection of the instance to a Google Agenda (never the tokens). */
  public async googleStatus(instance: InstanceDto) {
    const row = await this.instanceOf(instance);
    if (!this.google) return { instance: row.name, available: false, connected: false };
    return { instance: row.name, ...(await this.google.status(row.id)) };
  }

  /** URL of the Google consent screen; the panel opens it in the same tab. */
  public async googleConnect(instance: InstanceDto & Record<string, any>) {
    const row = await this.instanceOf(instance);
    if (!this.google?.available()) {
      BadRequestException('A integração com o Google Agenda ainda não foi configurada no servidor (GOOGLE_CLIENT_ID).');
    }
    const hint = typeof instance.email === 'string' && /^[^\s@]+@[^\s@]+$/.test(instance.email) ? instance.email : null;
    return { instance: row.name, url: this.google.connectUrl(row.id, hint) };
  }

  /** Disconnects (revokes the access at Google). The events already copied stay in the Google Agenda. */
  public async googleDisconnect(instance: InstanceDto) {
    const row = await this.instanceOf(instance);
    if (this.google) await this.google.disconnect(row.id);
    return { instance: row.name, connected: false };
  }

  private async instanceOf(instance: InstanceDto): Promise<{ id: string; name: string }> {
    const row = await this.prisma.instance.findUnique({
      where: { name: instance.instanceName },
      select: { id: true, name: true },
    });
    if (!row) NotFoundException(`A instância "${instance.instanceName}" não existe.`);
    return row;
  }

  private fail(error: any): never {
    if (error instanceof AgendaError) {
      if (error.code === 'not_found') NotFoundException(error.message);
      BadRequestException(...error.errors);
    }
    throw error;
  }

  /** A query date: ISO instant, or YYYY-MM-DD = midnight in the agenda zone. */
  private async when(instanceId: string, value: unknown): Promise<Date | undefined> {
    if (value === undefined || value === null || value === '') return undefined;
    const text = String(value);
    const tz = (await this.agenda.getSettings(instanceId)).timezone;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? localToUtc(text, 0, tz) : parseStart(text, tz);
    if (!date) BadRequestException(`Data inválida: "${text.slice(0, 40)}". Use AAAA-MM-DD ou ISO.`);
    return date;
  }

  public async list(instance: InstanceDto & Record<string, any>) {
    const row = await this.instanceOf(instance);
    const contact = instance.contact ? contactJid(instance.contact) : null;
    if (instance.contact && !contact) BadRequestException('Contato inválido.');
    const from = await this.when(row.id, instance.from);
    const to = await this.when(row.id, instance.to);
    const status = instance.status ? String(instance.status).split(',').filter(Boolean) : undefined;
    const settings = await this.agenda.getSettings(row.id);
    return {
      instance: row.name,
      timezone: settings.timezone,
      enabled: settings.enabled,
      appointments: await this.agenda.listAppointments(row.id, {
        from: from ?? (to ? undefined : new Date(Date.now() - 86_400_000)),
        to,
        contactJids: contact ? [contact] : undefined,
        status,
        limit: instance.limit ? Number(instance.limit) || undefined : undefined,
      }),
    };
  }

  public async slots(instance: InstanceDto & Record<string, any>) {
    const row = await this.instanceOf(instance);
    try {
      return {
        instance: row.name,
        ...(await this.agenda.freeSlots(row.id, {
          fromDay: instance.from ? String(instance.from).slice(0, 10) : undefined,
          days: instance.days ? Number(instance.days) : 7,
          typeName: instance.type ? String(instance.type) : undefined,
          limit: instance.limit ? Math.min(Number(instance.limit) || 200, 500) : 200,
        })),
      };
    } catch (error) {
      this.fail(error);
    }
  }

  public async create(instance: InstanceDto, data: AppointmentCreateDto) {
    const row = await this.instanceOf(instance);
    const remoteJid = contactJid(data.remoteJid ?? data.number);
    if (!remoteJid) BadRequestException('Informe o contato: número com DDI e DDD (ex.: 5511999998888) ou o JID.');
    const settings = await this.agenda.getSettings(row.id);
    const startsAt = parseStart(data.startsAt, settings.timezone);
    if (!startsAt) BadRequestException('Data e hora inválidas.');
    try {
      const result = await this.agenda.createAppointment(row.id, {
        remoteJid,
        contactName: data.contactName,
        typeName: data.typeName,
        startsAt,
        notes: data.notes,
        source: 'manual',
        notifyClient: data.notifyClient !== false,
        enforceAvailability: false,
      });
      return { instance: row.name, created: result.created, appointment: result.appointment };
    } catch (error) {
      this.fail(error);
    }
  }

  public async update(instance: InstanceDto & Record<string, any>, data: AppointmentUpdateDto) {
    const row = await this.instanceOf(instance);
    const settings = await this.agenda.getSettings(row.id);
    const startsAt = data.startsAt ? parseStart(data.startsAt, settings.timezone) : undefined;
    if (data.startsAt && !startsAt) BadRequestException('Data e hora inválidas.');
    try {
      return {
        instance: row.name,
        appointment: await this.agenda.updateAppointment(row.id, String(instance.id), {
          status: data.status,
          startsAt: startsAt ?? undefined,
          typeName: data.typeName,
          notes: data.notes,
          contactName: data.contactName,
          notifyClient: data.notifyClient === true,
          by: 'manual',
        }),
      };
    } catch (error) {
      this.fail(error);
    }
  }

  public async cancel(instance: InstanceDto & Record<string, any>) {
    const row = await this.instanceOf(instance);
    try {
      const notify = String(instance.notifyClient ?? '') === 'true';
      return {
        instance: row.name,
        appointment: await this.agenda.cancelAppointment(row.id, String(instance.id), {
          notifyClient: notify,
          by: 'manual',
          reason: typeof instance.reason === 'string' ? instance.reason : null,
        }),
      };
    } catch (error) {
      this.fail(error);
    }
  }

  public async getSettings(instance: InstanceDto) {
    const row = await this.instanceOf(instance);
    return {
      instance: row.name,
      configured: await this.agenda.isConfigured(row.id),
      settings: await this.agenda.getSettings(row.id),
    };
  }

  public async saveSettings(instance: InstanceDto, data: AgendaSettingsDto) {
    const row = await this.instanceOf(instance);
    try {
      const { previous, settings } = await this.agenda.saveSettings(row.id, { ...data });
      return { instance: row.name, settings, previous };
    } catch (error) {
      this.fail(error);
    }
  }

  public async regenerateIcsToken(instance: InstanceDto) {
    const row = await this.instanceOf(instance);
    return { instance: row.name, icsToken: await this.agenda.regenerateIcsToken(row.id) };
  }

  public async ics(instance: InstanceDto) {
    const row = await this.instanceOf(instance);
    return this.agenda.icsFor(row.id);
  }
}
