/**
 * One simulated customer per case: reactive (reads the bot's last question and answers it in the persona's style),
 * with the channel behaviour, the lifecycle event and the adversarial message of its case injected at fixed points.
 * Runs on the virtual clock; deterministic for the case seed.
 */
import { CONTEXT_NOTE_HEADER } from '@api/integrations/chatbot/openai/ai-context';

import { plainPdf } from '../helpers/pdf';
import { ADVERSARIAL_TEXT, INTENTS, styleShort, styleText } from './customers';
import { rng, SimCase } from './matrix';
import {
  AD_PREFILLED_TEXT,
  CAMPAIGNS,
  CITIES,
  contactPhone,
  FIRST_NAMES,
  GENERIC_AD,
  LAST_NAMES,
  OFFICE,
  TIMES_OF_DAY,
} from './office';
import { questionSlot } from './scripted-model';
import { OfficeInstance, TranscriptEvent, World } from './world';

const PNG_BASE64 = Buffer.from('sim-png-bytes').toString('base64');
const PDF_BASE64 = plainPdf(2).toString('base64');
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const DAY = 24 * 60 * MINUTE;

/** Monday 16/11/2026, 00:00 in São Paulo (UTC-3). Every run starts here (virtual). */
export const SIM_EPOCH = Date.UTC(2026, 10, 16, 3, 0, 0);

/** Virtual start of a case, by lifecycle (office opens 9h–18h on weekdays). */
export function startTime(item: SimCase): number {
  const spread = (item.index % 180) * MINUTE; // 3 hours of arrivals
  switch (item.lifecycle) {
    case 'fora_horario':
      return SIM_EPOCH + 21 * 60 * MINUTE + (item.index % 60) * MINUTE; // Monday 21h–22h
    case 'fim_semana':
      return SIM_EPOCH + 5 * DAY + 10 * 60 * MINUTE + spread; // Saturday 10h–13h
    case 'feriado':
      return Date.UTC(2026, 11, 25, 13, 0, 0) + spread; // Christmas (Friday) 10h–13h
    default:
      return SIM_EPOCH + 9 * 60 * MINUTE + 30 * MINUTE + spread; // Monday 9h30–12h30
  }
}

export type Persona = {
  name: string;
  phone: string;
  jid: string;
  city: string;
  wrongCity: string;
  time: string;
};

export function personaOf(item: SimCase, instanceIndex: number): Persona {
  const random = rng(item.seed);
  const name = `${FIRST_NAMES[item.index % FIRST_NAMES.length]} ${LAST_NAMES[Math.floor(item.index / FIRST_NAMES.length) % LAST_NAMES.length]}`;
  const phone = contactPhone(item.index, instanceIndex);
  const city = random.pick(CITIES.filter((c) => c !== 'Nova Iguaçu'));
  return { name, phone, jid: `${phone}@s.whatsapp.net`, city, wrongCity: city, time: random.pick(TIMES_OF_DAY) };
}

export type ConversationResult = {
  case: SimCase;
  office: OfficeInstance;
  persona: Persona;
  chatJid: string;
  /** JIDs the bot may legitimately write to for this contact. */
  contactJids: string[];
  /** Slots the customer gave (ground truth for completeness). */
  given: Set<string>;
  /** Virtual ms from the first customer message to the first bot message. */
  firstReplyMs: number | null;
  expectations: {
    noReply: boolean;
    handoff: boolean;
    pausedByTeam: boolean;
    teamTookOverAt: number | null;
    campaignQuestion: string | null;
    triage: boolean;
    outsideHours: boolean;
  };
  sessionAfter: any;
};

/** Plays one case. */
export async function playConversation(world: World, item: SimCase, office: OfficeInstance) {
  const clock = world.clock;
  const instanceIndex = world.instances.indexOf(office);
  const persona = personaOf(item, instanceIndex);
  const intent = INTENTS[item.intent];
  const random = rng(item.seed ^ 0x5bd1e995);
  const style = (text: string, salt = 0) => styleText(text, item.persona, item.seed + salt);
  const isGroup = item.channel === 'grupo';
  const groupJid = `1203630000${String(item.index).padStart(8, '0')}@g.us`;
  const lid = `${String(900000000000000 + item.index * 7 + instanceIndex)}@lid`;
  // The bot answers the address it knows: the group, the @lid when the phone is hidden, or the phone
  const chatJid = isGroup ? groupJid : item.channel === 'lid_sem_numero' ? lid : persona.jid;
  const transcript = world.transcript(office, chatJid);
  const given = new Set<string>();
  const outsideHours =
    office.hoursMode === 'inside' && ['fora_horario', 'fim_semana'].includes(item.lifecycle) && !isGroup;

  const expectations: ConversationResult['expectations'] = {
    noReply: isGroup || item.channel === 'reacao',
    // Decided by the checks from what the customer actually said (see checks.ts: handoffExpected)
    handoff: false,
    pausedByTeam: item.lifecycle === 'equipe_assumiu',
    teamTookOverAt: null,
    campaignQuestion:
      item.channel === 'anuncio_com_referral' && CAMPAIGNS[item.intent] ? CAMPAIGNS[item.intent].question : null,
    triage: intent.triage,
    outsideHours,
  };

  await clock.sleep(Math.max(0, startTime(item) - clock.now()));
  const firstAt = clock.now();

  const baseMsg = (text: string, extra: Record<string, any> = {}) => {
    const id = world.nextMessageId();
    const key: any = { id, remoteJid: chatJid, fromMe: false };
    if (isGroup) key.participant = persona.jid;
    if (item.channel === 'lid') Object.assign(key, { remoteJid: lid, remoteJidAlt: persona.jid });
    if (item.channel === 'lid_sem_numero') key.remoteJid = lid;
    return {
      key,
      pushName: persona.name.split(' ')[0],
      message: { conversation: text },
      messageType: 'conversation',
      messageTimestamp: Math.floor(clock.now() / 1000),
      ...extra,
    };
  };
  const contactJids = [persona.jid, ...(item.channel === 'lid_sem_numero' ? [lid] : [])];
  const send = async (text: string, kind = 'text', msg?: any) => {
    const message = msg ?? baseMsg(text);
    if (item.persona === 'audio_transcrito' && !msg) {
      message.message = { audioMessage: { seconds: 12, mimetype: 'audio/ogg' }, speechToText: text };
      message.messageType = 'audioMessage';
    }
    await world.receive(office, chatJid, message, { kind });
    return message;
  };
  const botReplies = () => transcript.filter((event) => event.who === 'bot');
  const waitReply = async (since: number, timeout = 3 * MINUTE): Promise<TranscriptEvent | null> => {
    const deadline = clock.now() + timeout;
    while (clock.now() < deadline) {
      const reply = botReplies()[since];
      if (reply) return reply;
      await clock.sleep(SECOND);
    }
    return botReplies()[since] ?? null;
  };
  const think = () =>
    clock.sleep((item.persona === 'apressado' ? 3 : item.persona === 'idoso' ? 45 : 12 + random.int(20)) * SECOND);

  // ------------------------------------------------------------------ opening (channel behaviour)
  const opening = style(intent.opening);
  const campaign = CAMPAIGNS[item.intent];
  switch (item.channel) {
    case 'rajada':
      await send(style('oi'));
      await clock.sleep(2 * SECOND);
      await send(opening);
      await clock.sleep(2 * SECOND);
      await send(style(intent.details, 1));
      given.add('assunto');
      break;
    case 'dividida': {
      const words = opening.split(' ');
      const cut = Math.max(1, Math.floor(words.length / 2));
      await send(words.slice(0, cut).join(' '));
      await clock.sleep(3 * SECOND);
      await send(words.slice(cut).join(' '));
      break;
    }
    case 'so_midia_foto':
      await send('', 'media', {
        ...baseMsg(''),
        message: { imageMessage: { mimetype: 'image/png' }, base64: PNG_BASE64 },
        messageType: 'imageMessage',
      });
      await clock.sleep(20 * SECOND);
      await send(opening);
      break;
    case 'so_midia_pdf':
      await send('', 'media', {
        ...baseMsg(''),
        message: {
          documentMessage: { mimetype: 'application/pdf', fileName: 'extrato-fgts.pdf' },
          base64: PDF_BASE64,
        },
        messageType: 'documentMessage',
      });
      await clock.sleep(20 * SECOND);
      await send(opening);
      break;
    case 'figurinha':
      await send(opening);
      await clock.sleep(15 * SECOND);
      await send('', 'sticker', {
        ...baseMsg(''),
        message: { stickerMessage: { mimetype: 'image/webp' } },
        messageType: 'stickerMessage',
      });
      break;
    case 'reacao':
      await send('', 'reaction', {
        ...baseMsg(''),
        message: { reactionMessage: { text: '👍', key: { id: 'OLD', remoteJid: chatJid } } },
        messageType: 'reactionMessage',
      });
      break;
    case 'link_instagram':
      await send(`${opening} vi isso aqui https://instagram.example/p/sim${item.index}`);
      break;
    case 'apagada': {
      const original = await send(opening);
      await clock.sleep(4 * SECOND);
      await send('', 'delete', {
        ...baseMsg(''),
        message: { protocolMessage: { type: 0, key: original.key } },
        messageType: 'protocolMessage',
      });
      break;
    }
    case 'editada': {
      const original = await send(opening);
      await clock.sleep(4 * SECOND);
      await send(`${opening} (corrigido)`, 'edit', {
        ...baseMsg(''),
        message: { editedMessage: { message: { protocolMessage: { type: 14, key: original.key } } } },
        messageType: 'editedMessage',
      });
      break;
    }
    case 'duplicada': {
      const original = await send(opening);
      await clock.sleep(2 * SECOND);
      await send(opening, 'duplicate', structuredClone(original));
      break;
    }
    case 'ordem_trocada': {
      const later = baseMsg(style(intent.details, 1), { messageTimestamp: Math.floor(clock.now() / 1000) + 5 });
      const earlier = baseMsg(opening, { messageTimestamp: Math.floor(clock.now() / 1000) });
      await send(later.message.conversation, 'out_of_order', later);
      await clock.sleep(SECOND);
      await send(earlier.message.conversation, 'out_of_order', earlier);
      given.add('assunto');
      break;
    }
    case 'anuncio_com_referral': {
      const ad = campaign ?? GENERIC_AD;
      const msg = baseMsg(style('oi, vi o anúncio'));
      msg.message = { extendedTextMessage: { text: msg.message.conversation } } as any;
      (msg as any).messageType = 'extendedTextMessage';
      (msg as any).contextInfo = { externalAdReply: { title: ad.title, body: ad.body, sourceType: 'ad' } };
      // getConversationMessage appends the ad body with its marker, like the real channel
      await send((msg.message as any).extendedTextMessage.text, 'ad', msg);
      break;
    }
    case 'anuncio_sem_referral':
      await send(AD_PREFILLED_TEXT, 'ad_no_referral');
      break;
    default:
      await send(opening);
  }

  // ------------------------------------------------------------------ dialogue
  const firstReply = await waitReply(0);
  const firstReplyMs = firstReply ? firstReply.at - firstAt : null;
  const maxTurns = 9;
  let adversarialSent = item.adversarial === 'nenhum';
  let correctionSent = item.lifecycle !== 'corrige_info';
  let topicChanged = item.lifecycle !== 'muda_assunto';
  let returned = item.lifecycle !== 'volta_dias';
  const teamTookOver = item.lifecycle !== 'equipe_assumiu';
  const afterTriage = item.lifecycle !== 'triagem_completa';

  for (let turn = 1; turn <= maxTurns && !expectations.noReply; turn++) {
    if (!botReplies().length && turn > 1) break;
    await think();
    // Read what the bot said last only now: a second reply may have arrived while "thinking"
    const seen = botReplies().length;
    const last = botReplies().at(-1);
    const question = last ? ([...(last.text.match(/[^.!?]+\?/g) ?? [])].pop()?.trim() ?? '') : '';
    const slot = question ? questionSlot(question) : null;

    // Lifecycle and adversarial events, at fixed turns
    if (!teamTookOver && turn === (item.adversarial === 'nenhum' ? 2 : 3)) {
      expectations.teamTookOverAt = clock.now();
      const msg = {
        // The team writes in the same chat: the @lid when that is the only address WhatsApp gives
        key: { id: world.nextMessageId(), remoteJid: chatJid, fromMe: true },
        pushName: 'Você',
        message: { conversation: `Oi! Aqui é a ${OFFICE.teamMemberName}, da equipe. Vou continuar o seu atendimento.` },
        messageType: 'conversation',
      };
      await world.receive(office, chatJid, msg, { kind: 'team', who: 'team' });
      await clock.sleep(90 * SECOND);
      await send(style('ah que bom, obrigado'));
      await clock.sleep(30 * SECOND);
      await send(style('então, como faço?'));
      await clock.sleep(2 * MINUTE);
      break;
    }
    if (!adversarialSent && turn === 2) {
      adversarialSent = true;
      await send(style(ADVERSARIAL_TEXT[item.adversarial], 7), 'adversarial');
      if (!(await waitReply(seen))) break;
      continue;
    }
    if (!topicChanged && turn === 3) {
      topicChanged = true;
      await send(style(intent.otherTopic ?? 'ah, e outra coisa: também tenho um problema com a conta de luz', 3));
      if (!(await waitReply(seen))) break;
      continue;
    }
    if (!returned && turn === 4) {
      returned = true;
      await clock.sleep(3 * DAY);
      await send(style('oi, voltei. alguma novidade?', 4), 'return');
      if (!(await waitReply(seen))) break;
      continue;
    }

    let answer: string;
    switch (slot) {
      case 'nome':
        answer = item.persona === 'uma_palavra' ? persona.name.split(' ')[0] : styleShort(persona.name, item.persona);
        given.add('nome');
        break;
      case 'cidade':
        answer = styleShort(persona.city, item.persona);
        given.add('cidade');
        break;
      case 'horario':
        answer = styleShort(persona.time, item.persona);
        given.add('horario');
        break;
      case 'urgencia':
        answer = style(intent.urgency, 5);
        given.add('urgencia');
        break;
      case 'assunto':
      case 'campanha':
        answer = style(intent.details, 1);
        given.add('assunto');
        break;
      default:
        answer = afterTriage ? style('ok', 6) : style('tá bom, obrigado', 6);
        if (afterTriage && !question) {
          // Closing message without question: conversation is over
          await send(answer);
          await waitReply(seen, 2 * MINUTE);
          turn = maxTurns;
          continue;
        }
    }
    await send(answer, slot ? `answer:${slot === 'campanha' ? 'assunto' : slot}` : 'text');

    if (!correctionSent && slot === 'cidade') {
      correctionSent = true;
      await clock.sleep(5 * SECOND);
      await send(styleShort('não, é Nova Iguaçu', item.persona), 'correction');
      persona.city = 'Nova Iguaçu';
    }
    const reply = await waitReply(seen);
    if (!reply) break;
    if (!afterTriage && !/\?/.test(reply.text) && given.size >= 4) {
      await think();
      await send(style('ok, obrigado. mas só confirmando, vocês vão me ligar mesmo?', 8), 'after_triage');
      await waitReply(seen + 1);
      break;
    }
  }

  await clock.sleep(5 * MINUTE);
  const sessionAfter = await world.session(office, [...new Set([persona.jid, chatJid, lid])]);
  return {
    case: item,
    office,
    persona,
    chatJid,
    contactJids: [...contactJids, chatJid],
    given,
    firstReplyMs,
    expectations,
    sessionAfter,
  } satisfies ConversationResult;
}

/** The internal note never reaches a customer (used by the checks). */
export const INTERNAL_MARKERS = [CONTEXT_NOTE_HEADER, 'externalAdReplyBody', OFFICE.canary];
