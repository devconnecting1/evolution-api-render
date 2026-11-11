/**
 * "Agenda" for the OpenAI bot: function tools of Chat Completions, only when the agenda of the instance is on.
 *
 * Isolated from openai.service.ts on purpose: the service only asks for a context (null = agenda off, nothing
 * changes) and runs the bounded tool loop below. Every tool call is validated on the server: the model never
 * books what it says, only a slot that is still free right now; the contact is always the one of the chat (the
 * model cannot see or change appointments of anyone else).
 */
import { AgendaError, AgendaService } from '@api/services/agenda.service';
import { AgendaSettings, AI_MAX_SLOTS, findType, formatSlot, MODE_LABELS, parseStart, toLocalIso } from '@utils/agenda';
import { normalizeUserJid } from '@utils/lidJid';
import { zonedParts } from '@utils/usageLimits';

/** Tool rounds per answer (each round = one more Chat Completions call). */
export const MAX_TOOL_ROUNDS = 3;
const MAX_CALLS_PER_ROUND = 5;

/** Models that rejected the `tools` parameter (learned at runtime, per process). */
export const modelsWithoutTools = new Set<string>();

export type AgendaAiContext = {
  systemPrompt: string;
  tools: any[];
  execute: (name: string, args: any) => Promise<any>;
};

const fn = (name: string, description: string, properties: Record<string, any>, required: string[] = []) => ({
  type: 'function',
  function: {
    name,
    description,
    parameters: { type: 'object', properties, required, additionalProperties: false },
  },
});

export function agendaTools(settings: AgendaSettings): any[] {
  const types = settings.appointmentTypes.map((type) => type.name);
  const tipo = { type: 'string', description: `Tipo de atendimento. Um de: ${types.join(', ')}.` };
  const which = {
    type: 'string',
    description: 'Id do agendamento (de meus_agendamentos) ou "proximo" para o próximo agendamento do cliente.',
  };
  const tools = [
    fn(
      'consultar_horarios',
      `Lista até ${AI_MAX_SLOTS} próximos horários livres da agenda. Nunca invente horários: use sempre esta ferramenta.`,
      {
        data_inicio: { type: 'string', description: 'Primeiro dia (AAAA-MM-DD). Padrão: hoje.' },
        dias: { type: 'integer', description: 'Quantos dias olhar a partir de data_inicio (1 a 14). Padrão: 7.' },
        tipo,
      },
    ),
    fn('meus_agendamentos', 'Agendamentos futuros DESTE cliente (o contato desta conversa).', {}),
  ];
  const ai = settings.aiPermissions;
  if (ai.allowBook) {
    tools.push(
      fn(
        'agendar',
        'Marca o horário para ESTE cliente. Só chame depois que o cliente confirmou dia, hora e tipo.',
        {
          inicio_iso: {
            type: 'string',
            description: 'Início exatamente como veio de consultar_horarios (inicio_iso).',
          },
          tipo,
          nome: { type: 'string', description: 'Nome do cliente, se ele informou.' },
        },
        ['inicio_iso'],
      ),
    );
  }
  if (ai.allowReschedule) {
    tools.push(
      fn(
        'remarcar',
        'Muda o horário de um agendamento deste cliente. Só depois de o cliente escolher o novo horário.',
        {
          agendamento: which,
          novo_inicio_iso: { type: 'string', description: 'Novo início (de consultar_horarios).' },
        },
        ['agendamento', 'novo_inicio_iso'],
      ),
    );
  }
  if (ai.allowCancel) {
    tools.push(
      fn('cancelar', 'Cancela um agendamento deste cliente, depois que ele confirmar.', { agendamento: which }, [
        'agendamento',
      ]),
    );
  }
  return tools;
}

export function agendaSystemPrompt(settings: AgendaSettings, now: Date): string {
  const today = zonedParts(now, settings.timezone);
  const [y, m, d] = today.day.split('-');
  const types = settings.appointmentTypes
    .map((type) => `${type.name} (${type.minutes} min, ${MODE_LABELS[type.mode]})`)
    .join('; ');
  const ai = settings.aiPermissions;
  const limits = [
    ai.allowBook ? null : 'Você NÃO pode marcar horários: diga que a equipe vai entrar em contato para agendar.',
    ai.allowReschedule ? null : 'Você NÃO pode remarcar: diga que a equipe vai entrar em contato.',
    ai.allowCancel ? null : 'Você NÃO pode cancelar: diga que a equipe vai entrar em contato.',
  ].filter(Boolean);
  return [
    'Agenda (ferramentas disponíveis nesta conversa):',
    `- Agora: ${formatSlot(now, settings.timezone).replace(`${d}/${m}`, `${d}/${m}/${y}`)} (fuso ${settings.timezone}). Todos os horários estão nesse fuso.`,
    `- Tipos de atendimento: ${types}.`,
    '- Para horários, use consultar_horarios e ofereça no máximo 3 opções por mensagem. Nunca invente nem prometa horário que a ferramenta não deu.',
    '- Antes de agendar, confirme com o cliente o dia, a hora e o tipo; só chame agendar depois que ele disser que sim.',
    '- Para remarcar ou cancelar, use meus_agendamentos e confirme com o cliente qual é o agendamento.',
    '- Você só vê os agendamentos deste cliente. Nunca fale de agendamentos de outras pessoas.',
    '- Se nenhum horário servir, ofereça os próximos dias ou diga que a equipe vai entrar em contato.',
    '- Ao confirmar, informe dia, hora, tipo e o local ou link que a ferramenta devolver. Não fale de valores, não prometa resultados e não dê orientação jurídica.',
    ...limits.map((text) => `- ${text}`),
    ...(ai.requireTeamApproval
      ? [
          '- Todo agendamento seu fica PENDENTE até a equipe aprovar: diga isso ao cliente e não confirme o horário como definitivo.',
        ]
      : []),
  ].join('\n');
}

/** The contact of the chat: the phone JID when known (LID otherwise) plus every alternative address. */
export function contactJidsOf(remoteJid: string, msg?: any): string[] {
  const jids = [remoteJid, msg?.key?.remoteJidAlt, msg?.key?.senderPn]
    .map((jid) => normalizeUserJid(jid))
    .filter((jid): jid is string => !!jid && !jid.endsWith('@g.us'));
  const unique = [...new Set(jids)];
  return [
    ...unique.filter((jid) => jid.endsWith('@s.whatsapp.net')),
    ...unique.filter((jid) => !jid.endsWith('@s.whatsapp.net')),
  ];
}

const failure = (erro: string, mensagem: string, extra: Record<string, any> = {}) => ({
  ok: false,
  erro,
  mensagem,
  ...extra,
});

/**
 * The context of one answer, or null when the agenda is off, the chat is a group, or the model cannot use tools.
 */
export async function buildAgendaContext(
  agenda: AgendaService | undefined,
  instanceId: string,
  remoteJid: string,
  options: { msg?: any; pushName?: string; model?: string | null; now?: () => Date } = {},
): Promise<AgendaAiContext | null> {
  if (!agenda || !instanceId || String(remoteJid).endsWith('@g.us')) return null;
  if (options.model && modelsWithoutTools.has(options.model)) return null;
  if (!(await agenda.isEnabled(instanceId))) return null;

  const stored = await agenda.getSettings(instanceId);
  // Paused types are invisible to the AI (the team still books them in the panel)
  const activeTypes = stored.appointmentTypes.filter((type) => type.active !== false);
  if (!activeTypes.length) return null;
  const settings = { ...stored, appointmentTypes: activeTypes };
  const now = options.now ? options.now() : agenda.clock();
  const jids = contactJidsOf(remoteJid, options.msg);
  if (!jids.length) return null;
  const tz = settings.timezone;

  // onlyOwnAppointments (always on): the only listing the model gets is the one of this contact
  const mine = async () =>
    (await agenda.listOwnAppointments(instanceId, jids, 10)).map((item) => ({
      id: item.id,
      tipo: item.typeName,
      quando: item.label,
      inicio_iso: toLocalIso(new Date(item.startsAt), tz),
      status: item.status,
    }));
  const pick = async (which: unknown) => {
    const list = await mine();
    const key = String(which ?? '').trim();
    const found = !key || /^pr[oó]ximo$/i.test(key) ? list[0] : list.find((item) => item.id === key);
    return { found, list };
  };
  const slots = async (fromDay?: string, days?: number, typeName?: string) => {
    const result = await agenda.freeSlots(instanceId, {
      fromDay: /^\d{4}-\d{2}-\d{2}$/.test(String(fromDay ?? '')) ? fromDay : undefined,
      days: Math.max(1, Math.min(Number(days) || 7, 14)),
      typeName,
      limit: AI_MAX_SLOTS,
    });
    return result.slots.map((slot) => ({ inicio_iso: toLocalIso(new Date(slot.startsAt), tz), quando: slot.label }));
  };

  // showOtherEventDetails: off (default) = the model only sees free slots. On = also when other appointments are and
  // their type. Never names, numbers or notes of other people.
  const occupied = async (fromDay?: string, days?: number) => {
    const today = await agenda.today(instanceId);
    const first =
      /^\d{4}-\d{2}-\d{2}$/.test(String(fromDay ?? '')) && String(fromDay) > today ? String(fromDay) : today;
    const from = parseStart(`${first}T00:00`, tz) ?? now;
    const to = new Date(from.getTime() + Math.max(1, Math.min(Number(days) || 7, 14)) * 86_400_000);
    const list = await agenda.listAppointments(instanceId, {
      from,
      to,
      status: ['pendente', 'agendado', 'confirmado'],
      limit: 60,
    });
    return list
      .filter((item) => !jids.includes(item.remoteJid))
      .map((item) => ({ quando: item.label, tipo: item.typeName }));
  };

  const execute = async (name: string, args: any): Promise<any> => {
    try {
      switch (name) {
        case 'consultar_horarios': {
          const type = findType(settings, args?.tipo);
          if (args?.tipo && !type)
            return failure('tipo_desconhecido', `Tipos: ${settings.appointmentTypes.map((t) => t.name).join(', ')}.`);
          const list = await slots(args?.data_inicio, args?.dias, type?.name);
          const extra = settings.aiPermissions.showOtherEventDetails
            ? { ocupados: await occupied(args?.data_inicio, args?.dias) }
            : {};
          return list.length
            ? { ok: true, tipo: type?.name, horarios: list, ...extra }
            : {
                ok: true,
                tipo: type?.name,
                horarios: [],
                mensagem:
                  'Sem horários livres nesse período: tente outros dias ou diga que a equipe vai entrar em contato.',
              };
        }
        case 'meus_agendamentos':
          return { ok: true, agendamentos: await mine() };
        case 'agendar': {
          if (!settings.aiPermissions.allowBook)
            return failure('sem_permissao', 'A equipe vai entrar em contato para agendar.');
          const start = parseStart(args?.inicio_iso, tz);
          if (!start) return failure('data_invalida', 'Use o inicio_iso exatamente como veio de consultar_horarios.');
          const type = findType(settings, args?.tipo);
          if (args?.tipo && !type)
            return failure('tipo_desconhecido', `Tipos: ${settings.appointmentTypes.map((t) => t.name).join(', ')}.`);
          const result = await agenda.createAppointment(instanceId, {
            remoteJid: jids[0],
            contactJids: jids,
            contactName: String(args?.nome ?? '').trim() || options.pushName || null,
            typeName: type?.name,
            startsAt: start,
            source: 'ia',
            enforceAvailability: true,
          });
          const pending = result.appointment.status === 'pendente';
          return {
            ok: true,
            ja_existia: !result.created,
            pendente_aprovacao: pending,
            mensagem: pending
              ? 'Pedido registrado: a equipe precisa aprovar. Diga ao cliente que ele recebe a confirmação assim que a equipe aprovar; NÃO diga que está confirmado.'
              : undefined,
            id: result.appointment.id,
            tipo: result.type.name,
            quando: result.appointment.label,
            modo: MODE_LABELS[result.type.mode],
            local_ou_link: result.type.location,
            o_que_levar: result.type.instructions,
          };
        }
        case 'remarcar': {
          if (!settings.aiPermissions.allowReschedule)
            return failure('sem_permissao', 'A equipe vai entrar em contato para remarcar.');
          const { found, list } = await pick(args?.agendamento);
          if (!found)
            return failure('nao_encontrado', 'Agendamento não encontrado para este cliente.', { agendamentos: list });
          const start = parseStart(args?.novo_inicio_iso, tz);
          if (!start) return failure('data_invalida', 'Use o inicio_iso exatamente como veio de consultar_horarios.');
          const updated = await agenda.updateAppointment(instanceId, found.id, {
            startsAt: start,
            enforceAvailability: true,
            by: 'ia',
          });
          const type = findType(settings, updated.typeName);
          return {
            ok: true,
            id: updated.id,
            tipo: updated.typeName,
            quando: updated.label,
            local_ou_link: type?.location ?? null,
          };
        }
        case 'cancelar': {
          if (!settings.aiPermissions.allowCancel)
            return failure('sem_permissao', 'A equipe vai entrar em contato para cancelar.');
          const { found, list } = await pick(args?.agendamento);
          if (!found)
            return failure('nao_encontrado', 'Agendamento não encontrado para este cliente.', { agendamentos: list });
          const cancelled = await agenda.cancelAppointment(instanceId, found.id, { by: 'ia' });
          return { ok: true, id: cancelled.id, cancelado: cancelled.label };
        }
        default:
          return failure('ferramenta_desconhecida', 'Ferramenta inexistente.');
      }
    } catch (error) {
      if (error instanceof AgendaError) {
        if (error.code === 'conflict') {
          const next = await slots().catch((): any[] => []);
          return failure('horario_indisponivel', `${error.message} Ofereça um destes.`, { proximos: next });
        }
        return failure(error.code, error.message);
      }
      return failure('falha', 'Não foi possível acessar a agenda agora: diga que a equipe vai confirmar.');
    }
  };

  return { systemPrompt: agendaSystemPrompt(settings, now), tools: agendaTools(settings), execute };
}

/** A 400 of OpenAI saying the model does not take tools / function calling. */
export function isToolsUnsupportedError(error: any): boolean {
  const status = error?.status ?? error?.response?.status;
  if (status !== 400) return false;
  const body = error?.error ?? error?.response?.data?.error ?? {};
  const text = [error?.message, body?.message, body?.param, error?.param].filter(Boolean).join(' ');
  return (
    /\btools?\b|function|tool_choice/i.test(text) && /not supported|unsupported|does not support|invalid/i.test(text)
  );
}

/**
 * Chat Completions with tools, at most MAX_TOOL_ROUNDS rounds of tool calls; the last call forbids tools
 * (tool_choice "none") so the answer is always text. Works on a copy of `messages`.
 */
export async function runToolLoop(
  messages: any[],
  context: Pick<AgendaAiContext, 'tools' | 'execute'>,
  create: (messages: any[], extra: Record<string, any>) => Promise<any>,
  maxRounds = MAX_TOOL_ROUNDS,
): Promise<{ completion: any; rounds: number; calls: string[] }> {
  const convo = [...messages];
  const calls: string[] = [];
  for (let round = 0; ; round++) {
    const last = round >= maxRounds;
    const completion = await create(convo, { tools: context.tools, tool_choice: last ? 'none' : 'auto' });
    const message = completion?.choices?.[0]?.message;
    const toolCalls = (message?.tool_calls ?? []).filter((call: any) => call?.type === 'function' && call.function);
    if (!toolCalls.length || last) return { completion, rounds: round, calls };

    const used = toolCalls.slice(0, MAX_CALLS_PER_ROUND);
    convo.push({ role: 'assistant', content: message.content ?? null, tool_calls: used });
    for (const call of used) {
      let args: any = {};
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        args = {};
      }
      calls.push(call.function.name);
      const output = await context.execute(call.function.name, args);
      convo.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(output) });
    }
  }
}
