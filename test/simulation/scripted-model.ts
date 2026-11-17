/**
 * Deterministic stand-in for the OpenAI model in CI: a rule-based triage assistant that reads exactly what the
 * real model receives (system prompt, history, context note, tools) and answers like one.
 *
 * On purpose it is NOT perfect: in ~30% of the replies it writes a flawed draft (repeats a question already
 * answered, asks two questions, quotes a fee, gives an opinion, promises a result, mentions the "texto que veio
 * junto", rambles). The guardrails of the pipeline must fix those before the hard gates look at the transcript,
 * which is what the simulator measures. On a regeneration request it usually fixes the draft (90%).
 */
import { CONTEXT_NOTE_HEADER } from '@api/integrations/chatbot/openai/ai-context';
import { HANDOFF_TOOL_NAME } from '@api/integrations/chatbot/openai/handoff-ai';

import { hash, rng } from './matrix';
import { CAMPAIGNS, CITIES, OFFICE, QUESTIONS, SLOTS, TIMES_OF_DAY } from './office';

export const FLAWS = [
  'repeat_question',
  'two_questions',
  'fee',
  'opinion',
  'promise',
  'internal',
  'long',
  'repeat_statement',
] as const;
export type Flaw = (typeof FLAWS)[number];
export const FLAW_RATE = 0.3;
export const REGENERATION_FIX_RATE = 0.9;

export const FAREWELL = 'Certo! Uma pessoa da equipe vai continuar o atendimento por aqui.';
const CLOSINGS = [
  'Está tudo anotado. A equipe vai falar com você em breve.',
  'Combinado!',
  'Certo, fico no aguardo junto com a equipe.',
  'Perfeito, até breve.',
];

/** Process-wide counters (report: how many flawed drafts the guard had to fix). */
export const modelStats = { calls: 0, flawed: 0, regenerations: 0, toolCalls: 0 };
export const flawCounts: Record<string, number> = {};

const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const textOf = (content: any): string => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part?.type === 'text' ? part.text : part?.type === 'image_url' ? '[imagem]' : part?.type ? '[arquivo]' : '',
      )
      .join('\n');
  }
  return '';
};

/** Which triage slot a bot question asks (also used by the simulated customer to answer a real model). */
export function questionSlot(question: string): (typeof SLOTS)[number] | 'campanha' | null {
  const q = fold(question);
  if (/\bnome\b|se chama|como (voce|o senhor|a senhora) chama/.test(q) && !/plano|procedimento|empresa/.test(q)) {
    return 'nome';
  }
  if (/cidade|municipio|bairro|onde (voce )?mora/.test(q)) return 'cidade';
  if (/horario|que horas|hora .*(ligar|falar|contato)|periodo/.test(q)) return 'horario';
  if (/prazo|urgen|audiencia|data marcada/.test(q)) return 'urgencia';
  if (/aconteceu|conte|contar|explicar|qual (e|o) (o )?(problema|assunto)|como posso ajudar|do que se trata/.test(q)) {
    return 'assunto';
  }
  if (/quanto tempo|ha quantos|ja nasceu|para voce ou|qual procedimento|ainda trabalha/.test(q)) return 'campanha';
  return null;
}

const isQuestion = (text: string) => /\?\s*$/.test(text.trim());
const sentences = (text: string) => text.match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()) ?? [];

type State = {
  filled: Set<string>;
  asked: Set<string>;
  askedCount: Record<string, number>;
  name: string | null;
  city: string | null;
  campaign: string | null;
  campaignAsked: boolean;
  complete: boolean;
  assistantCount: number;
  closingsSent: number;
  lastQuestion: string | null;
  previousStatements: string[];
};

const URGENT = /urgente|preso|audiencia|ate sexta|muita dor|prazo correndo|cortaram|assinar um papel/;
const HUMAN = /pessoa de verdade|falar com (o|um|uma) (advogad|atendente|pessoa|humano)|atendente|humano/;
const DISTRUST = /golpe|e robo|eh robo|robo\?|pegadinha/;

function campaignOf(note: string): string | null {
  for (const [intent, ad] of Object.entries(CAMPAIGNS)) if (note.includes(ad.title)) return intent;
  return null;
}

function extractName(text: string): string | null {
  const match = /(?:meu nome e|me chamo|sou (?:a|o))\s+([a-zÀ-ſ]+(?:\s+[a-zÀ-ſ]+){0,4})/i.exec(text.normalize('NFC'));
  return match ? match[1] : null;
}

function deriveState(convo: { role: string; text: string }[], campaign: string | null): State {
  const state: State = {
    filled: new Set(),
    asked: new Set(),
    askedCount: {},
    name: null,
    city: null,
    campaign,
    campaignAsked: false,
    complete: false,
    assistantCount: 0,
    closingsSent: 0,
    lastQuestion: null,
    previousStatements: [],
  };
  let previousQuestion: string | null = null;
  for (const message of convo) {
    if (message.role === 'assistant') {
      state.assistantCount++;
      const parts = sentences(message.text);
      const question = [...parts].reverse().find(isQuestion) ?? null;
      previousQuestion = question;
      if (question) {
        state.lastQuestion = question;
        const slot = questionSlot(question);
        if (slot === 'campanha') state.campaignAsked = true;
        else if (slot) {
          state.asked.add(slot);
          state.askedCount[slot] = (state.askedCount[slot] ?? 0) + 1;
        }
      }
      state.previousStatements.push(...parts.filter((part) => !isQuestion(part)));
      if (CLOSINGS.some((text) => message.text.includes(text)) || /ja anotei tudo/.test(fold(message.text))) {
        state.closingsSent++;
      }
      continue;
    }
    const raw = message.text;
    const text = fold(raw);
    const asked = previousQuestion ? questionSlot(previousQuestion) : null;
    for (const city of CITIES) if (text.includes(fold(city))) state.city = city;
    if (state.city) state.filled.add('cidade');
    const named = extractName(raw);
    if (named) state.name = named;
    else if (asked === 'nome' && raw.trim().split(/\s+/).length <= 6)
      state.name = raw.replace(/[^\p{L}\s]/gu, '').trim();
    if (state.name) state.filled.add('nome');
    const words = text.split(/\s+/).filter(Boolean).length;
    // The prefilled text of an ad ("tenho interesse, quero mais informações") is not a description of the case
    const generic = /tenho interesse|mais informac/.test(text);
    if (asked === 'assunto' || asked === 'campanha' || (words >= 6 && !generic)) state.filled.add('assunto');
    if (asked === 'urgencia' || URGENT.test(text)) state.filled.add('urgencia');
    if (asked === 'horario' || TIMES_OF_DAY.some((time) => text.includes(fold(time)))) state.filled.add('horario');
  }
  state.complete = SLOTS.every((slot) => state.filled.has(slot));
  return state;
}

type Reply = { text: string; toolCall?: { name: string; args: any } };

function cleanReply(
  user: string,
  state: State,
  options: { handoffTool: boolean; toolDone: boolean; media: boolean },
): Reply {
  const u = fold(user);
  if (options.toolDone) return { text: FAREWELL };
  const parts: string[] = [];

  if (options.handoffTool && (HUMAN.test(u) || DISTRUST.test(u) || URGENT.test(u))) {
    const motivo = HUMAN.test(u) ? 'pedido_humano' : DISTRUST.test(u) ? 'desconfianca' : 'urgencia';
    return { text: '', toolCall: { name: HANDOFF_TOOL_NAME, args: { motivo, resumo: user.slice(0, 120) } } };
  }

  // Not a case for the office
  if (/preso|criminal|flagrante/.test(u)) {
    return {
      text: 'O escritório não atua na área criminal. O ideal é procurar um advogado criminalista ou a Defensoria Pública.',
    };
  }
  if (/imposto|icms|receita federal|tributar/.test(u)) {
    return {
      text: 'O escritório não atua com questões tributárias. Recomendo procurar um advogado tributarista ou um contador.',
    };
  }
  if (/promocao|aumente suas vendas|robo de whatsapp/.test(u)) return { text: 'Obrigada, mas não temos interesse.' };
  if (/pizza/.test(u)) {
    return { text: `Acho que houve um engano: este é o WhatsApp do ${OFFICE.name}. Tenha um ótimo dia!` };
  }

  // Adversarial
  if (/ignore (todas )?(as )?suas instrucoes|sua configuracao/.test(u)) {
    parts.push('Posso ajudar apenas com o atendimento do escritório.');
  }
  if (/seu prompt|o que te mandaram/.test(u)) parts.push('Não posso compartilhar isso.');
  if (/se eu tenho direito|tenho direito/.test(u)) {
    parts.push('Quem avalia o seu caso é o advogado, depois de entender os detalhes.');
  }
  if (/quanto (fica|custa|e)|cobram|valor|preco/.test(u)) {
    parts.push('Os valores são explicados pelo advogado na conversa sobre o seu caso.');
  }
  if (/dados da ultima cliente|telefone dela|outra cliente/.test(u)) {
    parts.push('Não posso passar informações de outras pessoas.');
  }
  if (/manda uma mensagem pro|mande uma mensagem para/.test(u)) {
    parts.push('Não consigo enviar mensagens para outras pessoas.');
  }
  if (/tenho 1[0-7] anos/.test(u)) parts.push('Para seguir, preciso falar também com o seu pai, mãe ou responsável.');
  if (/idiota|porcaria/.test(u)) parts.push('Entendo a sua frustração. Estou aqui para ajudar.');
  if (HUMAN.test(u)) parts.push('Vou deixar anotado que você quer falar com uma pessoa da equipe.');
  if (DISTRUST.test(u))
    parts.push(`Aqui é a assistente virtual do ${OFFICE.name}, e a equipe acompanha o atendimento.`);
  if (/nao estou entendendo|pegadinha/.test(u)) parts.push('Sem problema, vamos com calma.');

  // Office facts (only the configured ones)
  if (/endereco|onde fica|localiza/.test(u)) parts.push(`O endereço é ${OFFICE.address}.`);
  if (/horario de atendimento|que horas (abre|fecha|voces)|funcionam/.test(u)) {
    parts.push(`O atendimento é ${OFFICE.hours}.`);
  }
  if (/\boab\b|registro/.test(u)) parts.push(`O registro do escritório é ${OFFICE.oab}.`);
  if (/telefone fixo|numero fixo|telefone do escritorio/.test(u)) parts.push(`O telefone fixo é ${OFFICE.phone}.`);
  if (options.media) parts.push('Recebi o que você enviou, obrigada.');
  if (/sou cliente|meu processo|andamento/.test(u)) {
    parts.push('Vou pedir para a equipe verificar o andamento do seu processo.');
  }
  if (/^(oi|ola|bom dia|boa tarde|boa noite)[\s!.,]*$/.test(u.trim()) && state.assistantCount === 0) {
    return { text: `Olá! Sou a assistente virtual do ${OFFICE.name}. Como posso ajudar?` };
  }

  // A well-behaved assistant never says the same thing twice in a conversation
  const fresh = (list: string[]) => list.filter((part) => !state.previousStatements.includes(part));
  const closing = () => {
    const text =
      state.closingsSent === 0
        ? 'Obrigada! Já anotei tudo. Uma pessoa da equipe vai entrar em contato com você.'
        : CLOSINGS[(state.closingsSent - 1) % CLOSINGS.length];
    return { text: [...fresh(parts), text].join(' ') };
  };

  if (state.complete) return closing();

  if (state.name && !state.asked.has('horario') && state.filled.has('nome') && state.asked.has('nome')) {
    parts.push(`Obrigada, ${state.name.split(' ')[0]}.`);
  }

  let question: string | null = null;
  if (state.campaign && !state.campaignAsked) question = CAMPAIGNS[state.campaign].question;
  if (!question) {
    // Next field not given yet; a question left unanswered is asked once more, with other words
    const next = SLOTS.find((slot) => !state.filled.has(slot) && (state.askedCount[slot] ?? 0) < 2);
    if (next) question = QUESTIONS[next][(state.askedCount[next] ?? 0) % 2];
  }
  if (!question) return closing();
  const said = fresh(parts);
  if (!said.length && state.assistantCount > 0)
    said.push(state.previousStatements.includes('Entendi.') ? 'Certo.' : 'Entendi.');
  return { text: [...said, question].join(' ') };
}

function applyFlaw(flaw: Flaw, reply: string, state: State): string {
  const question = [...sentences(reply)].reverse().find(isQuestion);
  const body = sentences(reply)
    .filter((part) => part !== question)
    .join(' ');
  switch (flaw) {
    case 'repeat_question':
      return state.lastQuestion ? `${body} ${state.lastQuestion}`.trim() : reply;
    case 'two_questions': {
      const other = SLOTS.find((slot) => !state.filled.has(slot) && !(question && questionSlot(question) === slot));
      return other ? `${reply} ${QUESTIONS[other][0]}` : reply;
    }
    case 'fee':
      return `A consulta inicial custa R$ 150. ${reply}`;
    case 'opinion':
      return `Pelo que você contou, você tem direito à indenização. ${reply}`;
    case 'promise':
      return `Pode ficar tranquila que vai ganhar. ${reply}`;
    case 'internal':
      return `Pelo texto que veio junto com a sua mensagem, já entendi o assunto. ${reply}`;
    case 'long':
      return `${'Vou explicar com calma como funciona o atendimento do escritório e cada etapa da análise do seu caso, que é feita com cuidado pela equipe. '.repeat(6)}${reply}`;
    case 'repeat_statement': {
      const old = state.previousStatements.find((statement) => statement.split(/\s+/).length >= 5);
      return old ? `${old} ${reply}` : reply;
    }
  }
}

const completion = (reply: Reply, id: string) => ({
  id,
  object: 'chat.completion',
  choices: [
    {
      index: 0,
      message: reply.toolCall
        ? {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: `call_${id}`,
                type: 'function',
                function: { name: reply.toolCall.name, arguments: JSON.stringify(reply.toolCall.args) },
              },
            ],
          }
        : { role: 'assistant', content: reply.text },
      finish_reason: reply.toolCall ? 'tool_calls' : 'stop',
    },
  ],
});

/** The scripted triage model as an OpenAI client (chat.completions.create). */
export function createScriptedModel(options: { flawRate?: number; echo?: boolean } = {}) {
  const flawRate = options.flawRate ?? FLAW_RATE;
  let counter = 0;

  const respond = (params: any) => {
    modelStats.calls++;
    const id = `sim${++counter}`;
    const messages: any[] = params.messages ?? [];
    const last = messages.at(-1);
    const regenerating = last?.role === 'system' && /^Reescreva/.test(textOf(last.content));
    const toolDone = messages.some((message) => message.role === 'tool');
    const handoffTool = (params.tools ?? []).some((tool: any) => tool?.function?.name === HANDOFF_TOOL_NAME);
    const note = textOf(
      messages.find((m) => m.role === 'system' && textOf(m.content).startsWith(CONTEXT_NOTE_HEADER))?.content,
    );

    // The conversation the model sees (regeneration: without the rejected draft and the instruction)
    const visible = regenerating ? messages.slice(0, -2) : messages;
    const convo = visible
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && (m.content || '') !== '')
      .map((m) => ({ role: m.role, text: textOf(m.content) }));
    const lastUser = [...visible].reverse().find((m) => m.role === 'user');
    const userText = textOf(lastUser?.content);

    if (options.echo) {
      const tokens = [...new Set(userText.match(/PROTO-[A-Z0-9]+/g) ?? [])];
      return completion({ text: `Recebido: ${tokens.join(' ')} (${userText.split('\n').length} linha(s)).` }, id);
    }

    const media =
      Array.isArray(lastUser?.content) && lastUser.content.some((part: any) => part?.type && part.type !== 'text');
    const state = deriveState(convo, campaignOf(note));
    const clean = cleanReply(userText, state, {
      handoffTool,
      toolDone,
      media: media || /\[figurinha|\[o contato enviou|\[imagem/.test(userText),
    });
    if (clean.toolCall) {
      modelStats.toolCalls++;
      return completion(clean, id);
    }

    const random = rng(hash(`${userText}|${state.assistantCount}|${messages.length}`));
    if (regenerating) {
      modelStats.regenerations++;
      const draft = textOf(messages.at(-2)?.content);
      if (draft.includes(FAREWELL)) return completion({ text: FAREWELL }, id);
      if (!random.chance(REGENERATION_FIX_RATE)) return completion({ text: draft }, id);
      return completion(clean, id);
    }

    if (!toolDone && clean.text && random.chance(flawRate)) {
      const flaw = random.pick(FLAWS);
      const flawed = applyFlaw(flaw, clean.text, state);
      if (flawed !== clean.text) {
        modelStats.flawed++;
        flawCounts[flaw] = (flawCounts[flaw] ?? 0) + 1;
        return completion({ text: flawed }, id);
      }
    }
    return completion(clean, id);
  };

  return {
    chat: { completions: { create: async (params: any) => respond(params) } },
    files: { create: async () => ({ id: `file-${++counter}` }) },
  };
}
