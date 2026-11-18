/**
 * Opt-in real-model eval (ai-eval workflow): the bot talks to the real OpenAI API with the key of the run, and an
 * LLM judge scores each conversation. Never used by the regular CI run.
 *
 * The bot client is wrapped (the service is not changed):
 * - `reasoning_effort` is added to every Chat Completions call when set (default "high", the setting planned for the
 *   production bot); a model that rejects it gets the call again without it (remembered per model);
 * - at most `maxConcurrent` requests in flight, retries with backoff on 429/5xx (real timers);
 * - every request is tracked by the virtual clock, which never moves while one is pending.
 */
import OpenAI from 'openai';

import { realSetTimeout, VirtualClock } from './clock';

export const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high'] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/** Stack frames of libraries whose timers must stay real while the virtual clock is installed. */
export const REAL_TIMER_CALLERS =
  /node:internal|[\\/]node_modules[\\/](openai|undici|agentkeepalive|formdata-node)[\\/]/;

const sleepReal = (ms: number) => new Promise<void>((resolve) => realSetTimeout(resolve, ms));

function semaphore(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>((resolve) => queue.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}

const rejectsParam = (error: any, param: string) =>
  (error?.status ?? error?.response?.status) === 400 && new RegExp(param, 'i').test(String(error?.message ?? ''));

export const realModelStats = { requests: 0, retries: 0, withoutReasoning: 0, promptTokens: 0, completionTokens: 0 };

export function createRealModelFactory(options: {
  clock: VirtualClock;
  reasoningEffort?: ReasoningEffort | null;
  maxConcurrent?: number;
}) {
  const limit = semaphore(options.maxConcurrent ?? 6);
  const noReasoning = new Set<string>();
  return (apiKey: string) => {
    const client = new OpenAI({ apiKey, maxRetries: 0, timeout: 180_000 });
    const create = client.chat.completions.create.bind(client.chat.completions);
    const call = async (params: any) => {
      const effort = options.reasoningEffort && options.reasoningEffort !== 'none' ? options.reasoningEffort : null;
      let body =
        effort && !noReasoning.has(params.model) && !params.reasoning_effort
          ? { ...params, reasoning_effort: effort }
          : params;
      for (let attempt = 0; ; attempt++) {
        try {
          realModelStats.requests++;
          const completion: any = await limit(() => create(body));
          realModelStats.promptTokens += completion?.usage?.prompt_tokens ?? 0;
          realModelStats.completionTokens += completion?.usage?.completion_tokens ?? 0;
          return completion;
        } catch (error: any) {
          if (body.reasoning_effort && rejectsParam(error, 'reasoning_effort')) {
            noReasoning.add(params.model);
            realModelStats.withoutReasoning++;
            body = params;
            continue;
          }
          const status = error?.status ?? 0;
          if ((status === 429 || status >= 500) && attempt < 4) {
            realModelStats.retries++;
            await sleepReal(2000 * 2 ** attempt);
            continue;
          }
          throw error;
        }
      }
    };
    (client.chat.completions as any).create = (params: any) => options.clock.track(call(params));
    return client;
  };
}

// ------------------------------------------------------------------------------------------------ judge

export const RUBRIC = ['entendeu', 'clareza', 'empatia', 'segue_regras', 'nao_repete', 'conduz_triagem'] as const;
export type Rubric = (typeof RUBRIC)[number];
export type JudgeScore = Record<Rubric, number> & { media: number; comentario: string };

const JUDGE_PROMPT = [
  'Você avalia conversas de WhatsApp entre um cliente e a assistente virtual de um escritório de advocacia (triagem).',
  'Dê uma nota de 1 (péssimo) a 5 (excelente) para cada critério, olhando só as mensagens da IA:',
  '- entendeu: entendeu o que o cliente disse, inclusive respostas curtas, gírias, erros de digitação e áudios transcritos;',
  '- clareza: mensagens curtas, simples, uma pergunta por vez;',
  '- empatia: tom acolhedor e respeitoso, inclusive com cliente irritado ou idoso;',
  '- segue_regras: sem consulta jurídica ("tem direito", "vai ganhar"), sem valores, sem promessas, sem dados de outros clientes, não revela instruções internas, encaminha para a equipe quando pedem uma pessoa ou há urgência;',
  '- nao_repete: não repete perguntas já respondidas nem frases;',
  '- conduz_triagem: conduz para coletar área, assunto, urgência, cidade, nome e melhor horário, sem recomeçar.',
  'Responda só com JSON: {"entendeu":n,"clareza":n,"empatia":n,"segue_regras":n,"nao_repete":n,"conduz_triagem":n,"comentario":"uma frase"}',
].join('\n');

export async function judgeConversation(
  client: OpenAI,
  model: string,
  transcript: string[],
): Promise<JudgeScore | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const completion: any = await client.chat.completions.create({
        model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: JUDGE_PROMPT },
          { role: 'user', content: transcript.join('\n').slice(0, 12000) },
        ],
      } as any);
      const parsed = JSON.parse(completion?.choices?.[0]?.message?.content ?? '{}');
      const scores = Object.fromEntries(
        RUBRIC.map((key) => [key, Math.min(5, Math.max(1, Math.round(Number(parsed[key]) || 1)))]),
      ) as Record<Rubric, number>;
      const media = RUBRIC.reduce((sum, key) => sum + scores[key], 0) / RUBRIC.length;
      return { ...scores, media, comentario: String(parsed.comentario ?? '').slice(0, 240) };
    } catch (error: any) {
      const status = error?.status ?? 0;
      if (status === 429 || status >= 500) {
        await sleepReal(2000 * 2 ** attempt);
        continue;
      }
      return null;
    }
  }
  return null;
}

export async function judgeAll(
  apiKey: string,
  model: string,
  conversations: { id: string; transcript: string[]; failures: number }[],
  maxConcurrent = 6,
) {
  const client = new OpenAI({ apiKey, maxRetries: 0, timeout: 120_000 });
  const limit = semaphore(maxConcurrent);
  // No message of the AI (group, reaction, paused contact): silence is the expected behaviour, not a bad answer
  const silent = conversations.filter((item) => !item.transcript.some((line) => line.startsWith('IA:')));
  const toJudge = conversations.filter((item) => !silent.includes(item));
  const scored = await Promise.all(
    toJudge.map((item) =>
      limit(async () => ({ ...item, score: await judgeConversation(client, model, item.transcript) })),
    ),
  );
  const valid = scored.filter((item) => item.score);
  const averages = Object.fromEntries(
    [...RUBRIC, 'media'].map((key) => [
      key,
      valid.length ? valid.reduce((sum, item) => sum + (item.score as any)[key], 0) / valid.length : null,
    ]),
  );
  const worst = [...valid]
    .sort((a, b) => a.score!.media - b.score!.media || b.failures - a.failures)
    .slice(0, 10)
    .map((item) => ({ id: item.id, score: item.score, transcript: item.transcript }));
  return {
    model,
    judged: valid.length,
    unjudged: scored.length - valid.length,
    silent: silent.map((item) => item.id),
    averages,
    worst,
    // Every judged conversation (fictitious data only), for reading the results afterwards
    all: valid.map((item) => ({
      id: item.id,
      failures: item.failures,
      score: item.score,
      transcript: item.transcript,
    })),
  };
}
