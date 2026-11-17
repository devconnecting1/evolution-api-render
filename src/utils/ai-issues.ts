import { ReviewConversation, ReviewEntry } from './conversation-review';
import { ResolvedSender } from './message-sender';
import { BusinessHours, isInsideSchedule, zonedParts } from './usageLimits';

/**
 * Signs of problems of the AI in a conversation, for a person (or Claude) to review: candidates, never verdicts.
 * Pure functions over the entries of review-export.service.ts (texts already redacted), so the rules are tested
 * without a database.
 */
export const SEVERITIES = ['baixa', 'media', 'alta'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const ISSUE_TYPES = [
  'unanswered',
  'ai_after_human_takeover',
  'repeated_ai_answer',
  'repeated_question',
  'double_question',
  'long_answer',
  'double_reply',
  'fallback_sent',
  'ethics_candidate',
  'off_hours_reply',
  'paused_too_long',
] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];

export const ISSUE_INFO: Record<IssueType, { severity: Severity; label: string }> = {
  unanswered: { severity: 'media', label: 'Cliente sem resposta no horário de atendimento' },
  ai_after_human_takeover: { severity: 'alta', label: 'IA respondeu depois que a equipe assumiu' },
  repeated_ai_answer: { severity: 'media', label: 'IA repetiu uma resposta inteira' },
  repeated_question: { severity: 'media', label: 'IA repetiu uma pergunta já feita' },
  double_question: { severity: 'baixa', label: 'Duas perguntas na mesma mensagem' },
  long_answer: { severity: 'baixa', label: 'Resposta longa (mais de 3 frases ou 450 caracteres)' },
  double_reply: { severity: 'media', label: 'Duas respostas da IA para uma mesma vez do cliente' },
  fallback_sent: { severity: 'alta', label: 'IA mandou a mensagem de erro (sem resposta)' },
  ethics_candidate: { severity: 'alta', label: 'Possível fala sobre preço, honorário ou resultado (perfil advocacia)' },
  off_hours_reply: { severity: 'media', label: 'IA respondeu fora do horário configurado' },
  paused_too_long: { severity: 'alta', label: 'Equipe assumiu e o cliente ficou mais de 24 h sem resposta' },
};

export const severityRank = (severity: Severity) => SEVERITIES.indexOf(severity);

export type IssueFlag = {
  type: IssueType;
  severity: Severity;
  /** Unix seconds of the message that shows the problem. */
  at: number;
  messageId: string | null;
  /** At most 120 characters, already redacted. */
  evidence: string;
};

export type IssueConfig = {
  /** Minutes without any answer before a customer message counts as unanswered (default 30). */
  unansweredMinutes: number;
  /** Business hours of "Plano e limites"; without a schedule every hour counts. */
  hours: BusinessHours | null;
  /** The bot texts that are not answers: unknownMessage (fallback) and the "fora do horário" notice. */
  fallbackTexts: string[];
  outsideHoursTexts: string[];
  /** The bot pauses for a team message (stopBotFromMe). */
  pausesForTeam: boolean;
  /** Minutes the human pause lasts (0 = until resumed by hand; counted as 24 h here). */
  resumeMinutes: number;
  /** splitMessages on: consecutive AI parts of one answer are expected, double_reply is not checked. */
  splitMessages: boolean;
  /** ethicsProfile "advocacia". */
  advocacia: boolean;
  /** Unix seconds: the end of what can be judged (now or the end of the period). */
  until: number;
};

const DOUBLE_REPLY_SECONDS = 30;
const PAUSED_TOO_LONG_SECONDS = 24 * 3600;
const LONG_CHARS = 450;
const LONG_SENTENCES = 3;

export const normalizeText = (text: string) =>
  String(text ?? '')
    .replace(/[*_~`]/g, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}?]+/gu, ' ')
    .trim();

export const evidenceOf = (text: string) => {
  const flat = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > 120 ? `${flat.slice(0, 119)}…` : flat;
};

const sentences = (text: string) =>
  String(text ?? '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter((part) => /\p{L}/u.test(part));

const questions = (text: string) => sentences(text).filter((part) => part.endsWith('?'));

const isText = (entry: ReviewEntry) => !entry.text.startsWith('[');
const isTeam = (sender: ResolvedSender) => sender === 'panel' || sender === 'device';
const isReply = (sender: ResolvedSender) => sender !== 'contact';

const ETHICS =
  /R\$|\bpre[cç]os?\b|\bvalor(es)?\b|\bhonor[aá]rios?\b|\bcustas?\b|\bgr[aá]tis\b|\bgratuit|\bvai ganhar\b|\btem direito\b|\bgarant(o|imos|ia|ido)\b|\bcausa ganha\b/i;

function insideHours(hours: BusinessHours | null, at: number): boolean {
  if (!hours?.enabled) return true;
  return isInsideSchedule(hours.week, zonedParts(new Date(at * 1000), hours.timezone));
}

function aiAllowedAt(hours: BusinessHours | null, at: number): boolean {
  if (!hours?.enabled || hours.mode === 'always') return true;
  const inside = isInsideSchedule(hours.week, zonedParts(new Date(at * 1000), hours.timezone));
  return hours.mode === 'inside' ? inside : !inside;
}

/** Every flag of one conversation, in time order. */
export function conversationIssues(conversation: ReviewConversation, config: IssueConfig): IssueFlag[] {
  const flags: IssueFlag[] = [];
  const entries = conversation.entries;
  const flag = (type: IssueType, entry: ReviewEntry, evidence = entry.text) =>
    flags.push({
      type,
      severity: ISSUE_INFO[type].severity,
      at: entry.at,
      messageId: entry.messageId,
      evidence: evidenceOf(evidence),
    });

  const fallback = new Set(config.fallbackTexts.map(normalizeText).filter((text) => text.length >= 2));
  const outside = new Set(config.outsideHoursTexts.map(normalizeText).filter((text) => text.length >= 2));
  const pauseSeconds = config.resumeMinutes > 0 ? config.resumeMinutes * 60 : PAUSED_TOO_LONG_SECONDS;
  const seenAnswers = new Set<string>();
  const seenQuestions: string[] = [];
  let lastTeamAt: number | null = null;
  let lastAiAfterTeam = false;
  let lastCustomerAt: number | null = null;
  let aiSinceCustomer: ReviewEntry | null = null;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    if (entry.sender === 'contact') {
      // A customer turn starts with the first message after a reply; the next reply answers the whole turn
      if (i === 0 || isReply(entries[i - 1].sender)) {
        const next = entries.slice(i + 1).find((e) => isReply(e.sender));
        const waited = (next ? next.at : config.until) - entry.at;
        const takeover = config.pausesForTeam && lastTeamAt !== null && !lastAiAfterTeam;
        if (takeover && waited >= PAUSED_TOO_LONG_SECONDS) {
          flag('paused_too_long', entry);
        } else if (waited >= config.unansweredMinutes * 60 && insideHours(config.hours, entry.at)) {
          flag('unanswered', entry);
        }
      }
      lastCustomerAt = entry.at;
      aiSinceCustomer = null;
      continue;
    }

    if (isTeam(entry.sender)) {
      lastTeamAt = entry.at;
      lastAiAfterTeam = false;
      continue;
    }
    if (entry.sender !== 'ai') continue;

    const norm = normalizeText(entry.text);
    const isFallback = fallback.has(norm);
    const isOutsideNotice = outside.has(norm);

    if (config.pausesForTeam && lastTeamAt !== null && !lastAiAfterTeam && entry.at - lastTeamAt < pauseSeconds) {
      flag('ai_after_human_takeover', entry);
    }
    lastAiAfterTeam = true;

    if (isFallback) flag('fallback_sent', entry);
    if (!isOutsideNotice && !aiAllowedAt(config.hours, entry.at)) flag('off_hours_reply', entry);

    if (isText(entry) && !isFallback && !isOutsideNotice) {
      const repeatedAnswer = norm.length >= 20 && seenAnswers.has(norm);
      if (repeatedAnswer) flag('repeated_ai_answer', entry);
      seenAnswers.add(norm);

      // The same question again, also with another lead-in ("Para começar, qual é..." then "Qual é...")
      const asked = questions(entry.text);
      const repeated = asked.find((q) => {
        const n = normalizeText(q);
        return n.length >= 10 && seenQuestions.some((seen) => seen.endsWith(n) || n.endsWith(seen));
      });
      if (repeated && !repeatedAnswer) flag('repeated_question', entry, repeated);
      for (const q of asked) seenQuestions.push(normalizeText(q));
      if (asked.length >= 2) flag('double_question', entry);

      if (entry.text.length > LONG_CHARS || sentences(entry.text).length > LONG_SENTENCES) flag('long_answer', entry);
      if (config.advocacia && ETHICS.test(entry.text)) flag('ethics_candidate', entry);

      if (
        !config.splitMessages &&
        aiSinceCustomer &&
        lastCustomerAt !== null &&
        entry.at - aiSinceCustomer.at <= DOUBLE_REPLY_SECONDS
      ) {
        flag('double_reply', entry);
      }
      aiSinceCustomer = entry;
    }
  }

  return flags.sort((a, b) => a.at - b.at);
}
