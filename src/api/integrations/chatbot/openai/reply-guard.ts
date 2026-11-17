/**
 * Guardrails applied to every answer of the OpenAI bot BEFORE it is sent (post-processing, model-agnostic):
 *
 * 1. Repetition: the candidate is compared, sentence by sentence, with the AI's previous replies of this
 *    conversation (normalized tokens, Jaccard similarity). A repeated question ("Qual o nome do plano?" asked again
 *    after the customer answered "Assim") or a repeated sentence ("vou sinalizar como urgente" four times) makes
 *    the answer be regenerated ONCE with an instruction listing what not to repeat; if it still repeats, the
 *    repeated sentences are removed.
 * 2. Internal notes and, with the "advocacia" ethics profile, fees/prices, promises of result and legal opinions:
 *    same treatment (regenerate once, then remove the sentence).
 * 3. At most one question per message (the last one is kept) and a maximum length (cut at a sentence boundary,
 *    keeping the question).
 * 4. Never an empty message: a short acknowledgement instead.
 *
 * Thresholds are constants (tested in test/unit/reply-guard.test.ts); every decision increments a counter that
 * is logged by the service.
 */

/** Two statements are "the same" from this token Jaccard similarity on. */
export const SENTENCE_SIMILARITY_THRESHOLD = 0.8;
/** Questions are shorter and rephrased more: a lower threshold, on the content words only. */
export const QUESTION_SIMILARITY_THRESHOLD = 0.6;
/** Statements shorter than this (content words) are never treated as repetitions ("Entendi.", "Obrigado!"). */
export const MIN_SENTENCE_TOKENS = 4;
/** Questions with fewer content words are never treated as repetitions ("Tudo bem?"). */
export const MIN_QUESTION_TOKENS = 2;
export const MAX_QUESTIONS_PER_MESSAGE = 1;
/** WhatsApp answers are short: longer ones are cut at a sentence boundary (the question is kept). */
export const MAX_REPLY_CHARS = 600;
/** How many previous AI replies of the conversation are kept for the comparison (session.context.botReplies). */
export const PREVIOUS_REPLIES_KEPT = 20;
/**
 * Sent when nothing is left after the guard (never an empty message). Neutral: the assistant speaks as "a
 * assistente", so no gendered word ("obrigado/obrigada").
 */
export const FALLBACK_ACKNOWLEDGEMENT = 'Certo, entendi. Vou passar isso para a equipe.';
/** Tried in order when the reply would be empty or a copy of an earlier one (the first not sent yet wins). */
export const SHORT_ACKNOWLEDGEMENTS = [FALLBACK_ACKNOWLEDGEMENT, 'Combinado!', 'Certo!', 'Perfeito.', 'Anotado.'];

export type GuardPolicy = { advocacia?: boolean };

export type GuardIssue =
  | { kind: 'repeated_question'; sentence: string; previous: string }
  | { kind: 'repeated_sentence'; sentence: string; previous: string }
  | { kind: 'internal_note'; sentence: string }
  | { kind: 'fees'; sentence: string }
  | { kind: 'promise'; sentence: string }
  | { kind: 'legal_opinion'; sentence: string };

export type GuardResult = {
  text: string;
  original: string;
  regenerated: boolean;
  /** Problems of the first candidate. */
  issues: GuardIssue[];
  /** Sentences removed from the final text (repetition / policy). */
  removed: string[];
  questionsTrimmed: number;
  truncated: boolean;
  fallback: boolean;
};

/** Process-wide counters (logged; read by the simulator and the observability snapshot). */
export const replyGuardStats = {
  checked: 0,
  regenerated: 0,
  regenerationFailed: 0,
  repeatsRemoved: 0,
  policyRemoved: 0,
  questionsTrimmed: 0,
  truncated: 0,
  fallbacks: 0,
};

export function resetReplyGuardStats(): void {
  for (const key of Object.keys(replyGuardStats) as (keyof typeof replyGuardStats)[]) replyGuardStats[key] = 0;
}

// ------------------------------------------------------------------------------------------- text helpers

const STOPWORDS = new Set(
  (
    'a o e é as os ao aos de do da dos das em no na nos nas num numa um uma uns umas para pra pro por pelo pela ' +
    'pelos pelas com sem que se ou mas me te lhe nos vos seu sua seus suas meu minha meus minhas teu tua isso ' +
    'isto esse essa este esta aquele aquela ja ainda tambem bem muito mais menos so entao aqui ai la sim nao ' +
    'voce voces vc o senhor a senhora sr sra'
  )
    .split(/\s+/)
    .map((word) => fold(word)),
);
/** Words that only make a question polite or interrogative: ignored when comparing questions. */
const QUESTION_FILLERS = new Set(
  (
    'qual quais como quando onde quem quanto quantos quantas poderia poderiam pode podem consegue conseguiria ' +
    'gostaria saber informar dizer falar confirmar contar me ok certo favor por'
  )
    .split(/\s+/)
    .map((word) => fold(word)),
);

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Content tokens of a sentence (accents, case, punctuation and stop words removed; naive plural folding). */
export function tokens(text: string, question = false): string[] {
  return fold(text)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1 || /\d/.test(word))
    .filter((word) => !STOPWORDS.has(word) && !(question && QUESTION_FILLERS.has(word)))
    .map((word) => (word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word));
}

export function jaccard(a: string[], b: string[]): number {
  const left = new Set(a);
  const right = new Set(b);
  if (!left.size && !right.size) return 1;
  let common = 0;
  for (const word of left) if (right.has(word)) common++;
  return common / (left.size + right.size - common);
}

/** Same text once accents, case, punctuation and spacing are ignored. */
const sameText = (a: string, b: string) => {
  const norm = (text: string) =>
    fold(text)
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  return norm(a) === norm(b);
};

export const isQuestion = (sentence: string): boolean => /\?\s*["')\]]*\s*$/.test(sentence.trim());

/**
 * Sentences of one line: a sentence ends at . ! ? … followed by a space (or the end), so the dots of numbers
 * ("OAB/RJ 000.000", "R$ 1.500", "nº 0001234-56.2026") and of abbreviations without a space never split it.
 */
const lineSentences = (line: string): string[] =>
  line
    .split(/(?<=[.!?…]["')\]]*)\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

/** Sentences of a text (paragraph and line breaks also end a sentence). */
export function splitSentences(text: string): string[] {
  if (typeof text !== 'string') return [];
  const result: string[] = [];
  for (const line of text.split(/\n+/)) {
    const parts = lineSentences(line);
    for (const part of parts) if (part.trim()) result.push(part.trim());
  }
  return result;
}

/** Rebuilds the text without the given sentences, keeping paragraphs and line breaks. */
export function removeSentences(text: string, remove: (sentence: string) => boolean): string {
  return text
    .split(/\n{2,}/)
    .map((paragraph) =>
      paragraph
        .split('\n')
        .map((line) =>
          lineSentences(line)
            .map((part) => part.trim())
            .filter((part) => part && !remove(part))
            .join(' '),
        )
        .filter((line) => line.trim())
        .join('\n'),
    )
    .filter((paragraph) => paragraph.trim())
    .join('\n\n')
    .trim();
}

// ------------------------------------------------------------------------------------------- detection

const INTERNAL_NOTE_PATTERNS = [
  /(texto|mensagem|conte[uú]do) que veio junto/i,
  /veio junto (com|a|à) (sua|tua) mensagem/i,
  /\brascunhos?\b/i,
  /nota interna/i,
  /contexto desta conversa/i,
  /mensagem do sistema/i,
  /instru[cç][oõ]es (do sistema|internas|que recebi)/i,
  /\bmeu prompt\b|\bprompt do sistema\b/i,
  /externalAdReply/i,
  /an[uú]ncio anexado/i,
];

const FEE_PATTERNS = [
  /R\$\s?\d/i,
  /\b\d{1,3}(?:[.,]\d+)?\s?(%|por cento)\s+(do|da|de|sobre)\b/i,
  /honor[aá]rios?\s+(s[aã]o|ser[aã]o|ficam|ficariam|custam|de\s+\d|é\s+de|e\s+de)/i,
  /(consulta|atendimento|processo|a[cç][aã]o)\s+(custa|sai|fica|ficaria|custaria)\s+(por\s+|em\s+)?(uns\s+|cerca de\s+)?\d/i,
  /\b\d+\s?(reais|mil reais)\b/i,
];

const PROMISE_PATTERNS = [
  /\bvai ganhar\b/i,
  /\bv[aã]o ganhar\b/i,
  /\bcausa ganha\b/i,
  /\b(eu )?garanto\b|\bgarantimos\b|\bgarantido\b/i,
  /com certeza (voc[eê] |o senhor |a senhora )?(vai|v[aã]o) (ganhar|receber|conseguir)/i,
  /\b100\s?% de (chance|certeza)\b/i,
];

const OPINION_PATTERN =
  /\b(voc[eê]|vc|a senhora|o senhor|ela|ele|sua m[aã]e|seu pai)\s+(tem|t[eê]m|teria|possui)\s+(sim\s+)?(todo\s+o\s+)?direito\b/i;
const OPINION_CONDITIONAL = /\b(se|saber se|ver se|verificar se|avaliar se|analisar se|confirmar se|caso)\b/i;

export function policyIssues(sentence: string, policy: GuardPolicy): GuardIssue[] {
  const issues: GuardIssue[] = [];
  if (INTERNAL_NOTE_PATTERNS.some((pattern) => pattern.test(sentence)))
    issues.push({ kind: 'internal_note', sentence });
  if (policy.advocacia) {
    if (FEE_PATTERNS.some((pattern) => pattern.test(sentence))) issues.push({ kind: 'fees', sentence });
    if (PROMISE_PATTERNS.some((pattern) => pattern.test(sentence))) issues.push({ kind: 'promise', sentence });
    const opinion = OPINION_PATTERN.exec(sentence);
    if (opinion && !OPINION_CONDITIONAL.test(sentence.slice(0, opinion.index + opinion[0].length))) {
      issues.push({ kind: 'legal_opinion', sentence });
    }
  }
  return issues;
}

/** Every problem of a candidate compared with the previous replies of the conversation. */
export function analyzeReply(candidate: string, previousReplies: string[], policy: GuardPolicy = {}): GuardIssue[] {
  const previous = previousReplies.flatMap(splitSentences);
  const previousQuestions = previous
    .filter(isQuestion)
    .map((sentence) => ({ sentence, words: tokens(sentence, true) }));
  const previousStatements = previous.map((sentence) => ({ sentence, words: tokens(sentence) }));
  const issues: GuardIssue[] = [];

  for (const sentence of splitSentences(candidate)) {
    issues.push(...policyIssues(sentence, policy));

    if (isQuestion(sentence)) {
      const words = tokens(sentence, true);
      // The very same question (short ones too: "Como você se chama?")
      const same = previousQuestions.find((item) => sameText(item.sentence, sentence));
      if (same) {
        issues.push({ kind: 'repeated_question', sentence, previous: same.sentence });
        continue;
      }
      if (words.length < MIN_QUESTION_TOKENS) continue;
      const match = previousQuestions.find(
        (item) =>
          item.words.length >= MIN_QUESTION_TOKENS && jaccard(words, item.words) >= QUESTION_SIMILARITY_THRESHOLD,
      );
      if (match) issues.push({ kind: 'repeated_question', sentence, previous: match.sentence });
      continue;
    }

    const words = tokens(sentence);
    if (words.length < MIN_SENTENCE_TOKENS) continue;
    const match = previousStatements.find((item) => jaccard(words, item.words) >= SENTENCE_SIMILARITY_THRESHOLD);
    if (match) issues.push({ kind: 'repeated_sentence', sentence, previous: match.sentence });
  }
  return issues;
}

/** The extra instruction of the single regeneration. */
export function regenerationInstruction(issues: GuardIssue[]): string {
  const repeated = [...new Set(issues.filter((issue) => issue.kind.startsWith('repeated')).map((i) => i.sentence))];
  const lines = ['Reescreva a sua última resposta ao cliente seguindo estas correções:'];
  if (repeated.length) {
    lines.push(
      `- Não repita nada do que você já disse nesta conversa. Não diga nem pergunte de novo: ${repeated
        .map((sentence) => `"${sentence}"`)
        .join('; ')}.`,
      '- Se o cliente já respondeu, considere a resposta dele (mesmo curta, como "Sim" ou um nome) e siga para o próximo passo.',
    );
  }
  if (issues.some((issue) => issue.kind === 'internal_note')) {
    lines.push('- Não mencione notas internas, rascunhos, anúncios anexados nem "texto que veio junto".');
  }
  if (issues.some((issue) => issue.kind === 'fees')) lines.push('- Não informe valores, preços nem honorários.');
  if (issues.some((issue) => issue.kind === 'promise')) lines.push('- Não prometa nem garanta resultado.');
  if (issues.some((issue) => issue.kind === 'legal_opinion')) {
    lines.push('- Não diga se a pessoa tem ou não direito: isso só o advogado avalia.');
  }
  lines.push('- No máximo uma pergunta, mensagem curta.');
  return lines.join('\n');
}

// ------------------------------------------------------------------------------------------- shaping

/** Keeps only the last question of the text (the others are removed). Returns the text and how many were cut. */
/** A question that only makes sense after the previous one ("Se sim, em que mês?", "Caso não, ..."). */
const DEPENDENT_QUESTION =
  /^(se sim|se n[aã]o|se for|e se|caso (sim|n[aã]o|tenha|seja)|ou (seja|ent[aã]o)|e quando|desde quando)\b/i;

/**
 * Keeps one question: the last one, unless it is a follow-up of the question before it (then that main question
 * is kept and the follow-up dropped, or "O bebê já nasceu? Se sim, em que mês?" would become "Se sim, em que mês?").
 */
export function keepLastQuestion(text: string): { text: string; trimmed: number } {
  const questions = splitSentences(text).filter(isQuestion);
  if (questions.length <= MAX_QUESTIONS_PER_MESSAGE) return { text, trimmed: 0 };
  let keep = questions.length - 1;
  while (keep > 0 && DEPENDENT_QUESTION.test(questions[keep])) keep--;
  let index = -1;
  const result = removeSentences(text, (sentence) => {
    if (!isQuestion(sentence)) return false;
    index++;
    return index !== keep;
  });
  return { text: result, trimmed: questions.length - MAX_QUESTIONS_PER_MESSAGE };
}

/** Removes sentences said twice in the same reply (keeps the first), e.g. a rambling draft. */
export function dropRepeatedWithin(text: string): { text: string; removed: number } {
  const seen: string[][] = [];
  let removed = 0;
  const result = removeSentences(text, (sentence) => {
    const words = tokens(sentence, isQuestion(sentence));
    if (words.length < MIN_SENTENCE_TOKENS) return false;
    if (seen.some((previous) => jaccard(words, previous) >= SENTENCE_SIMILARITY_THRESHOLD)) {
      removed++;
      return true;
    }
    seen.push(words);
    return false;
  });
  return { text: result, removed };
}

/** Cuts a long text at a sentence boundary, keeping its (last) question at the end. */
export function limitLength(text: string, max = MAX_REPLY_CHARS): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  const sentences = splitSentences(text);
  const question = [...sentences].reverse().find(isQuestion);
  const budget = max - (question ? question.length + 1 : 0);
  const kept: string[] = [];
  let size = 0;
  for (const sentence of sentences) {
    if (sentence === question) continue;
    if (size + sentence.length + 1 > budget) break;
    kept.push(sentence);
    size += sentence.length + 1;
  }
  if (question) kept.push(question);
  let result = kept.join(' ').trim();
  if (!result)
    result = text
      .slice(0, max)
      .replace(/\s+\S*$/, '')
      .trim();
  return { text: result, truncated: true };
}

const normalizeSpaces = (text: string) =>
  String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/**
 * Applies every guardrail to a candidate answer. `regenerate` (optional) asks the model once more with an extra
 * instruction; it is only called when the candidate repeats itself or breaks a rule.
 */
export async function guardReply(input: {
  candidate: string;
  previousReplies: string[];
  policy?: GuardPolicy;
  regenerate?: (instruction: string) => Promise<string | null | undefined>;
}): Promise<GuardResult> {
  const policy = input.policy ?? {};
  const original = normalizeSpaces(input.candidate);
  const previous = (input.previousReplies ?? []).filter((reply) => typeof reply === 'string' && reply.trim());
  replyGuardStats.checked++;

  const firstIssues = analyzeReply(original, previous, policy);
  let text = original;
  let issues = firstIssues;
  let regenerated = false;

  if (issues.length && input.regenerate) {
    const retry = await input.regenerate(regenerationInstruction(issues)).catch((): null => null);
    if (typeof retry === 'string' && retry.trim()) {
      text = normalizeSpaces(retry);
      issues = analyzeReply(text, previous, policy);
      regenerated = true;
      replyGuardStats.regenerated++;
    } else {
      replyGuardStats.regenerationFailed++;
    }
  }

  const removed: string[] = [];
  if (issues.length) {
    const bad = new Set(issues.map((issue) => issue.sentence));
    text = removeSentences(text, (sentence) => {
      if (!bad.has(sentence)) return false;
      removed.push(sentence);
      return true;
    });
    for (const issue of issues) {
      if (issue.kind.startsWith('repeated')) replyGuardStats.repeatsRemoved++;
      else replyGuardStats.policyRemoved++;
    }
  }

  const within = dropRepeatedWithin(text);
  text = within.text;
  replyGuardStats.repeatsRemoved += within.removed;

  const single = keepLastQuestion(text);
  text = single.text;
  replyGuardStats.questionsTrimmed += single.trimmed;

  const limited = limitLength(text);
  text = limited.text;
  if (limited.truncated) replyGuardStats.truncated++;

  let fallback = false;
  // Never the very same message as an earlier reply (what is left after removing repetitions can be, e.g. a
  // short "Está tudo anotado." said again), and never an empty one: a short acknowledgement not used yet
  if (!text.trim() || previous.some((reply) => sameText(reply, text))) {
    text =
      SHORT_ACKNOWLEDGEMENTS.find((ack) => !previous.some((reply) => sameText(reply, ack))) ?? FALLBACK_ACKNOWLEDGEMENT;
    fallback = true;
    replyGuardStats.fallbacks++;
  }

  return {
    text,
    original,
    regenerated,
    issues: firstIssues,
    removed,
    questionsTrimmed: single.trimmed,
    truncated: limited.truncated,
    fallback,
  };
}
