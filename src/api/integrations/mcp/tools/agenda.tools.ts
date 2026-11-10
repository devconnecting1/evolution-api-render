import { localToUtc, parseStart } from '@utils/agenda';
import { z } from 'zod';

import { resolveInstance } from '../mcp.instance';
import { contactArg, defineTool, instanceArg, READ_ONLY } from '../mcp.tool';
import { jsonResult, McpToolError, normalizeContactJid } from '../mcp.util';

const agendaError = (error: any): never => {
  if (error?.name === 'AgendaError') throw new McpToolError(error.message);
  throw error;
};

const dayArg = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'use AAAA-MM-DD')
  .optional()
  .describe('Dia inicial no fuso da agenda (AAAA-MM-DD). Padrão: hoje.');

export const listAppointments = defineTool({
  name: 'list_appointments',
  title: 'Listar agendamentos',
  description:
    'Lista os agendamentos da Agenda da instância (horários no fuso da agenda, rótulo como "qui, 07/11 às 14:00", contato, tipo, status pendente/agendado/confirmado/cancelado/realizado/faltou, origem ia/manual/mcp). Padrão: de hoje até 14 dias. As observações internas vêm junto: são da equipe, não repasse ao cliente.',
  input: {
    instance: instanceArg,
    from: dayArg,
    days: z.number().int().min(1).max(90).optional().describe('Quantos dias a partir de from (1 a 90). Padrão: 14.'),
    contact: contactArg.optional(),
    include_cancelled: z.boolean().optional().describe('Incluir cancelados (padrão: não).'),
  },
  annotations: READ_ONLY,
  run: async ({ instance, from, days, contact, include_cancelled }, ctx) => {
    const resolved = await resolveInstance(ctx, instance);
    const settings = await ctx.deps.agenda.getSettings(resolved.id);
    const fromDay = from ?? (await ctx.deps.agenda.today(resolved.id));
    const start = localToUtc(fromDay, 0, settings.timezone);
    if (!start) throw new McpToolError('data inicial inválida.');
    const end = new Date(start.getTime() + (days ?? 14) * 86_400_000);
    const list = await ctx.deps.agenda.listAppointments(resolved.id, {
      from: start,
      to: end,
      contactJids: contact ? [normalizeContactJid(contact)] : undefined,
      status: include_cancelled ? undefined : ['pendente', 'agendado', 'confirmado', 'realizado', 'faltou'],
      limit: 300,
    });
    return jsonResult({
      instance: resolved.name,
      enabled: settings.enabled,
      timezone: settings.timezone,
      count: list.length,
      appointments: list,
    });
  },
});

export const getFreeSlots = defineTool({
  name: 'get_free_slots',
  title: 'Horários livres da agenda',
  description:
    'Horários livres da Agenda (respeita disponibilidade semanal, bloqueios, intervalo entre atendimentos, antecedência mínima e agendamentos existentes).',
  input: {
    instance: instanceArg,
    from: dayArg,
    days: z.number().int().min(1).max(30).optional().describe('Dias a partir de from (1 a 30). Padrão: 7.'),
    type: z.string().min(1).max(80).optional().describe('Tipo de atendimento (padrão: o primeiro).'),
    limit: z.number().int().min(1).max(100).optional().describe('Máximo de horários (padrão 30).'),
  },
  annotations: READ_ONLY,
  run: async ({ instance, from, days, type, limit }, ctx) => {
    const resolved = await resolveInstance(ctx, instance);
    const result = await ctx.deps.agenda
      .freeSlots(resolved.id, { fromDay: from, days: days ?? 7, typeName: type, limit: limit ?? 30 })
      .catch(agendaError);
    return jsonResult({ instance: resolved.name, ...result });
  },
});

export const createAppointment = defineTool({
  name: 'create_appointment',
  title: 'Criar agendamento',
  description:
    'Cria um agendamento na Agenda para um contato. Por padrão só aceita um horário livre da disponibilidade (use get_free_slots) e ENVIA ao cliente a confirmação pelo WhatsApp (dia, hora, tipo, local ou link): confirme com o usuário antes. notify_client=false não envia nada.',
  input: {
    instance: instanceArg,
    contact: contactArg,
    start: z
      .string()
      .min(16)
      .max(40)
      .describe('Início: "2026-11-12T14:00" (fuso da agenda) ou ISO com fuso, ex. "2026-11-12T14:00:00-03:00".'),
    type: z.string().min(1).max(80).optional().describe('Tipo de atendimento (padrão: o primeiro).'),
    name: z.string().max(120).optional().describe('Nome do cliente.'),
    notes: z.string().max(2000).optional().describe('Observação interna (não vai para o cliente).'),
    notify_client: z.boolean().optional().describe('Enviar a confirmação ao cliente (padrão: sim).'),
    outside_availability: z
      .boolean()
      .optional()
      .describe('Permitir horário fora da disponibilidade (ainda sem sobrepor outro agendamento). Padrão: não.'),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  run: async (args, ctx) => {
    const resolved = await resolveInstance(ctx, args.instance);
    const settings = await ctx.deps.agenda.getSettings(resolved.id);
    const startsAt = parseStart(args.start, settings.timezone);
    if (!startsAt) throw new McpToolError('início inválido: use "AAAA-MM-DDTHH:MM".');
    const result = await ctx.deps.agenda
      .createAppointment(resolved.id, {
        remoteJid: normalizeContactJid(args.contact),
        contactName: args.name,
        typeName: args.type,
        startsAt,
        notes: args.notes,
        source: 'mcp',
        notifyClient: args.notify_client !== false,
        enforceAvailability: args.outside_availability !== true,
      })
      .catch(agendaError);
    return jsonResult({ instance: resolved.name, created: result.created, appointment: result.appointment });
  },
});

export const cancelAppointment = defineTool({
  name: 'cancel_appointment',
  title: 'Cancelar agendamento',
  description:
    'Cancela um agendamento (status cancelado; o registro fica). Com notify_client (padrão: sim) o cliente recebe o aviso de cancelamento pelo WhatsApp: confirme com o usuário antes.',
  input: {
    instance: instanceArg,
    id: z.string().min(1).max(64).describe('Id do agendamento (de list_appointments).'),
    notify_client: z.boolean().optional().describe('Avisar o cliente (padrão: sim).'),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  run: async ({ instance, id, notify_client }, ctx) => {
    const resolved = await resolveInstance(ctx, instance);
    const appointment = await ctx.deps.agenda
      .cancelAppointment(resolved.id, id, { notifyClient: notify_client !== false, by: 'mcp' })
      .catch(agendaError);
    return jsonResult({ cancelled: true, instance: resolved.name, appointment });
  },
});

const ranges = z
  .array(z.tuple([z.string(), z.string()]))
  .max(6)
  .optional();

export const updateAgendaSettings = defineTool({
  name: 'update_agenda_settings',
  title: 'Alterar configurações da agenda',
  description:
    'Altera a Agenda da instância: ligar/desligar, fuso, duração do horário, intervalo, antecedência mínima, dias à frente, disponibilidade semanal ({"mon":[["09:00","12:00"],["14:00","18:00"]], ...}), bloqueios, tipos de atendimento, lembretes, pedido de confirmação, permissões da IA e números da equipe. Campos ausentes não mudam; listas SUBSTITUEM as atuais. Confirme com o usuário. Devolve os valores anteriores.',
  input: {
    instance: instanceArg,
    enabled: z.boolean().optional(),
    timezone: z.string().min(1).max(64).optional(),
    slot_minutes: z.number().int().min(5).max(240).optional(),
    buffer_minutes: z.number().int().min(0).max(240).optional(),
    min_notice_hours: z.number().int().min(0).max(720).optional(),
    max_days_ahead: z.number().int().min(1).max(365).optional(),
    availability: z
      .object({ sun: ranges, mon: ranges, tue: ranges, wed: ranges, thu: ranges, fri: ranges, sat: ranges })
      .optional(),
    blocks: z
      .array(
        z.object({
          start: z.string(),
          end: z.string().optional(),
          from: z.string().optional(),
          to: z.string().optional(),
          reason: z.string().max(120).optional(),
        }),
      )
      .max(60)
      .optional()
      .describe('Bloqueios (feriados, férias): {start:"2026-12-24", end:"2026-12-26", reason:"Recesso"}.'),
    appointment_types: z
      .array(
        z.object({
          name: z.string().min(1).max(80),
          minutes: z.number().int().min(5).max(480),
          mode: z.enum(['presencial', 'online', 'telefone']).optional(),
          location: z.string().max(300).optional(),
          instructions: z.string().max(500).optional(),
        }),
      )
      .min(1)
      .max(10)
      .optional(),
    reminders: z
      .object({
        enabled: z.boolean().optional(),
        hours_before: z.array(z.number().int().min(1).max(72)).max(3).optional(),
      })
      .optional(),
    confirmation_enabled: z.boolean().optional(),
    ai_permissions: z
      .object({
        allow_book: z.boolean().optional(),
        allow_reschedule: z.boolean().optional(),
        allow_cancel: z.boolean().optional(),
        require_team_approval: z.boolean().optional().describe('Pedidos da IA ficam pendentes até a equipe aprovar.'),
        show_other_event_details: z
          .boolean()
          .optional()
          .describe('A IA vê também horário e tipo dos outros agendamentos (nunca nomes). Padrão: não.'),
      })
      .optional()
      .describe('O cliente sempre vê só os próprios agendamentos (não configurável).'),
    notify_numbers: z.array(z.string().max(30)).max(5).optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  run: async (args, ctx) => {
    const input: Record<string, any> = {};
    const map: [string, string][] = [
      ['enabled', 'enabled'],
      ['timezone', 'timezone'],
      ['slot_minutes', 'slotMinutes'],
      ['buffer_minutes', 'bufferMinutes'],
      ['min_notice_hours', 'minNoticeHours'],
      ['max_days_ahead', 'maxDaysAhead'],
      ['availability', 'availability'],
      ['blocks', 'blocks'],
      ['appointment_types', 'appointmentTypes'],
      ['notify_numbers', 'notifyNumbers'],
    ];
    for (const [arg, field] of map) if ((args as any)[arg] !== undefined) input[field] = (args as any)[arg];
    if (args.reminders) {
      input.reminders = {};
      if (args.reminders.enabled !== undefined) input.reminders.enabled = args.reminders.enabled;
      if (args.reminders.hours_before !== undefined) input.reminders.hoursBefore = args.reminders.hours_before;
    }
    if (args.confirmation_enabled !== undefined) input.confirmation = { enabled: args.confirmation_enabled };
    if (args.ai_permissions) {
      const map: [string, string][] = [
        ['allow_book', 'allowBook'],
        ['allow_reschedule', 'allowReschedule'],
        ['allow_cancel', 'allowCancel'],
        ['require_team_approval', 'requireTeamApproval'],
        ['show_other_event_details', 'showOtherEventDetails'],
      ];
      input.aiPermissions = {};
      for (const [arg, field] of map) {
        if ((args.ai_permissions as any)[arg] !== undefined)
          input.aiPermissions[field] = (args.ai_permissions as any)[arg];
      }
    }
    if (!Object.keys(input).length) throw new McpToolError('nenhum campo para alterar foi informado.');

    const resolved = await resolveInstance(ctx, args.instance);
    const result = await ctx.deps.agenda.saveSettings(resolved.id, input).catch(agendaError);
    const strip = (settings: any) => (settings ? { ...settings, icsToken: settings.icsToken ? '****' : null } : null);
    return jsonResult({
      updated: true,
      instance: resolved.name,
      previous: strip(result.previous),
      settings: strip(result.settings),
    });
  },
});

export const getAgendaSettings = defineTool({
  name: 'get_agenda_settings',
  title: 'Configurações da agenda',
  description:
    'Mostra a Agenda da instância: se está ligada, fuso, duração e intervalo dos horários, antecedência mínima, dias à frente, disponibilidade semanal, bloqueios, tipos de atendimento, lembretes, pedido de confirmação, o que a IA pode fazer (agendar, remarcar, cancelar, aprovação da equipe) e os números da equipe. Use antes de update_agenda_settings.',
  input: { instance: instanceArg },
  annotations: READ_ONLY,
  run: async ({ instance }, ctx) => {
    const resolved = await resolveInstance(ctx, instance);
    const settings: any = await ctx.deps.agenda.getSettings(resolved.id);
    return jsonResult({
      instance: resolved.name,
      settings: settings ? { ...settings, icsToken: settings.icsToken ? '****' : null } : null,
    });
  },
});

export const updateAppointment = defineTool({
  name: 'update_appointment',
  title: 'Remarcar ou atualizar agendamento',
  description:
    'Remarca um agendamento (novo início; checa conflito e, por padrão, a disponibilidade), muda o status (pendente, agendado, confirmado, realizado, faltou; para cancelar use cancel_appointment), o tipo ou a observação interna. Com notify_client (padrão: sim) o cliente recebe o aviso da remarcação pelo WhatsApp: confirme com o usuário antes.',
  input: {
    instance: instanceArg,
    id: z.string().min(1).max(64).describe('Id do agendamento (de list_appointments).'),
    start: z
      .string()
      .min(16)
      .max(40)
      .optional()
      .describe('Novo início: "2026-11-12T14:00" (fuso da agenda) ou ISO com fuso.'),
    status: z.enum(['pendente', 'agendado', 'confirmado', 'realizado', 'faltou']).optional(),
    type: z.string().min(1).max(80).optional().describe('Novo tipo de atendimento.'),
    notes: z.string().max(2000).nullable().optional().describe('Observação interna (null apaga).'),
    notify_client: z.boolean().optional().describe('Avisar o cliente de uma remarcação (padrão: sim).'),
    outside_availability: z
      .boolean()
      .optional()
      .describe('Permitir horário fora da disponibilidade (ainda sem sobrepor outro agendamento). Padrão: não.'),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  run: async (args, ctx) => {
    if (args.start === undefined && !args.status && !args.type && args.notes === undefined) {
      throw new McpToolError('nada para alterar: informe start, status, type ou notes.');
    }
    const resolved = await resolveInstance(ctx, args.instance);
    let startsAt: Date | undefined;
    if (args.start !== undefined) {
      const settings = await ctx.deps.agenda.getSettings(resolved.id);
      startsAt = parseStart(args.start, settings.timezone) ?? undefined;
      if (!startsAt) throw new McpToolError('início inválido: use "AAAA-MM-DDTHH:MM".');
    }
    const result = await ctx.deps.agenda
      .updateAppointment(resolved.id, args.id, {
        startsAt,
        status: args.status,
        typeName: args.type,
        notes: args.notes,
        notifyClient: args.notify_client !== false,
        enforceAvailability: args.outside_availability !== true,
        by: 'mcp',
      })
      .catch(agendaError);
    return jsonResult({ updated: true, instance: resolved.name, result });
  },
});

export const agendaTools = [
  listAppointments,
  getFreeSlots,
  createAppointment,
  updateAppointment,
  cancelAppointment,
  getAgendaSettings,
  updateAgendaSettings,
];
