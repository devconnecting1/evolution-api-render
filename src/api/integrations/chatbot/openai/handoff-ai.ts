/**
 * "Transferir para a equipe" (OpenaiSetting.handoffTool, off by default): a function tool the model calls when
 * the customer asks for a person, distrusts the AI ("é golpe?") or reports a concrete urgency (prazo, audiência,
 * prisão, corte de energia...). The prompt lists what is NOT a reason (greetings, short or confused messages, a plain
 * account of the case, price, an old client asking about the process): with the broad wording the real model
 * (reasoning `none`, the only level with tools) handed over 42% of ordinary first messages (18/11/2026). The AI still sends its short reply ("vou chamar alguém da equipe"); right after it the
 * session is paused the same way as "Assumir conversa" / pause_bot_for_contact (manual pause: only the team
 * reactivates it) and the team numbers of "Leads" get an internal notice.
 *
 * The tool only RECORDS the request (execute is synchronous and side-effect free); the service applies it after
 * the reply went out, so the farewell message is not discarded by the pause.
 */

export const HANDOFF_TOOL_NAME = 'transferir_para_equipe';
export const HANDOFF_REASONS = ['pedido_humano', 'desconfianca', 'urgencia', 'outro'] as const;
export type HandoffReason = (typeof HANDOFF_REASONS)[number];

export const HANDOFF_REASON_LABELS: Record<HandoffReason, string> = {
  pedido_humano: 'pediu para falar com uma pessoa',
  desconfianca: 'desconfiou do atendimento automático',
  urgencia: 'relatou urgência',
  outro: 'precisa da equipe',
};

export type HandoffRequest = { reason: HandoffReason; summary: string };

export const MAX_HANDOFF_SUMMARY_CHARS = 300;
/** Sent when the model called the tool without writing a reply. */
export const HANDOFF_FAREWELL =
  'Vou passar sua conversa para uma pessoa da equipe, que continua o atendimento por aqui.';

export function handoffTool() {
  return {
    type: 'function',
    function: {
      name: HANDOFF_TOOL_NAME,
      description:
        'Passa a conversa para uma pessoa da equipe e pausa o atendimento automático deste cliente. Use SOMENTE ' +
        'quando o cliente pedir para falar com uma pessoa/advogado, disser que desconfia do atendimento, relatar ' +
        'uma urgência concreta ou contar que caiu ou está caindo num golpe (alguém se passando pela empresa, pelo ' +
        'advogado ou por banco, pedindo pagamento ou dados). Não use para cumprimentos, dúvidas, relatos comuns do caso, perguntas de preço ou ' +
        'de andamento de processo.',
      parameters: {
        type: 'object',
        properties: {
          motivo: { type: 'string', enum: [...HANDOFF_REASONS] },
          resumo: {
            type: 'string',
            description: 'Resumo de uma frase do que o cliente precisa, para a equipe (não é enviado ao cliente).',
          },
        },
        required: ['motivo', 'resumo'],
        additionalProperties: false,
      },
    },
  };
}

export function handoffSystemPrompt(): string {
  return [
    'Transferência para a equipe (ferramenta disponível nesta conversa):',
    `- Chame ${HANDOFF_TOOL_NAME} SOMENTE em um destes casos:`,
    '  1) o cliente pede para falar com uma pessoa, atendente ou advogado;',
    '  2) o cliente diz que desconfia do atendimento ("é golpe?", "é robô?", "é pegadinha?");',
    '  3) urgência concreta: prazo ou audiência nos próximos dias, prisão, corte de serviço essencial, cirurgia ou tratamento negado, risco à saúde;',
    '  4) golpe: alguém se passou pela empresa, pelo advogado, por tribunal ou banco pedindo pagamento, Pix ou dados, ou a pessoa diz que já pagou ou enviou dados a um golpista (motivo urgencia). Antes, dê as orientações de segurança contra golpes na mesma resposta.',
    '- Em todo o resto, NÃO chame: continue a triagem normalmente, com uma pergunta. Exemplos em que NÃO se transfere: cumprimento ("oi", "bom dia"), mensagem curta ou confusa ("assim", "não entendi"), pessoa que só conta o caso (demissão, FGTS atrasado, benefício do INSS), arquivo sem texto, pergunta de preço, cliente antigo perguntando do processo (anote e diga que a equipe verifica o andamento), pedido que você não pode fazer (explique e siga).',
    '- Depois de chamar, responda numa frase curta que uma pessoa da equipe vai continuar o atendimento por aqui (no caso de golpe, junto com as orientações de segurança). Não faça mais perguntas.',
    '- Não prometa prazo de retorno nem resultado.',
  ].join('\n');
}

/** Normalizes the tool arguments (anything unknown becomes "outro"). */
export function parseHandoffArgs(args: any): HandoffRequest {
  const reason = (HANDOFF_REASONS as readonly string[]).includes(args?.motivo)
    ? (args.motivo as HandoffReason)
    : 'outro';
  const summary =
    typeof args?.resumo === 'string' ? args.resumo.replace(/\s+/g, ' ').trim().slice(0, MAX_HANDOFF_SUMMARY_CHARS) : '';
  return { reason, summary };
}

/** Internal notice for the team numbers (never sent to the client). */
export function handoffNotificationText(
  request: HandoffRequest,
  contact: { name?: string | null; phone?: string | null },
) {
  return [
    `Atendimento transferido para a equipe — ${contact.name || 'Sem nome'} ${HANDOFF_REASON_LABELS[request.reason]}.`,
    request.summary || 'Sem resumo.',
    'A IA foi pausada para este contato (reative pelo painel quando terminar).',
    contact.phone
      ? `Conversa: https://wa.me/${contact.phone}`
      : 'Conversa: número oculto pelo WhatsApp (veja no painel).',
  ].join('\n');
}

/** Tool context of one answer: the tool, its prompt and an executor that records the request. */
export function buildHandoffContext() {
  let request: HandoffRequest | null = null;
  return {
    systemPrompt: handoffSystemPrompt(),
    tools: [handoffTool()],
    get request() {
      return request;
    },
    execute: async (name: string, args: any) => {
      if (name !== HANDOFF_TOOL_NAME) return null;
      request = parseHandoffArgs(args);
      return { ok: true, observacao: 'A equipe foi avisada. Despeça-se em uma frase curta, sem perguntas.' };
    },
  };
}
