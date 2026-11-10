import axios, { AxiosInstance } from 'axios';

/**
 * Saúde das chaves OpenAI de cada cliente, sem entrar na conta OpenAI de ninguém.
 *
 * Duas fontes:
 * 1. Passiva (custo zero): cada resposta real do bot registra aqui se a chave funcionou ou o motivo da falha
 *    (chave inválida, sem crédito, limite de uso, modelo indisponível...). Só em memória: nada vai para o banco.
 * 2. Ativa ("Testar agora"): GET /v1/models (grátis: a chave é válida? o modelo do bot está liberado?) e uma
 *    consulta mínima (embedding de 1 token, ~US$ 0,00000002) que é recusada com `insufficient_quota` quando a
 *    conta está sem crédito. Os cabeçalhos x-ratelimit-* mostram os limites por minuto do nível da conta.
 *
 * O saldo em dólares não é exposto pela OpenAI para chaves comuns (só a chave "Admin" da organização lê a API de
 * custos); o que dá para saber com segurança é "funciona / sem crédito / chave inválida".
 */

export type OpenaiProblem =
  | 'invalid_key'
  | 'no_credit'
  | 'rate_limited'
  | 'model_unavailable'
  | 'permission'
  | 'server_error'
  | 'network'
  | 'unknown';

export type OpenaiVerdict = 'ok' | OpenaiProblem | 'not_tested';

export interface OpenaiErrorInfo {
  kind: OpenaiProblem;
  status: number | null;
  code: string | null;
  message: string;
}

/** Texto curto, em português, para cada situação (painel, MCP, alertas). */
export const VERDICT_TEXT: Record<OpenaiVerdict, string> = {
  ok: 'Funcionando',
  not_tested: 'Ainda sem uso nem teste',
  invalid_key: 'Chave inválida ou revogada',
  no_credit: 'Sem crédito na conta OpenAI',
  rate_limited: 'Limite de uso por minuto atingido',
  model_unavailable: 'Modelo do bot indisponível para esta chave',
  permission: 'Chave sem permissão para este recurso',
  server_error: 'OpenAI instável (erro do servidor)',
  network: 'Sem resposta da OpenAI (rede ou tempo esgotado)',
  unknown: 'Erro desconhecido',
};

/** O que fazer em cada situação. */
export const VERDICT_HINT: Partial<Record<OpenaiVerdict, string>> = {
  invalid_key: 'Gere uma chave nova em platform.openai.com/api-keys e troque nas credenciais OpenAI da instância.',
  no_credit: 'Adicione crédito em platform.openai.com/settings/organization/billing (recomendado: recarga automática).',
  rate_limited: 'Normal em picos; se for frequente, a conta precisa subir de nível (Usage tier) na OpenAI.',
  model_unavailable: 'Troque o modelo do bot ou libere o modelo no projeto da chave (Limits > Model usage).',
  permission: 'A chave é restrita: dê permissão de escrita a Model capabilities no projeto da OpenAI.',
  server_error: 'Costuma passar sozinho; veja status.openai.com.',
};

const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v));

/** Classifica um erro do SDK da OpenAI ou do axios. */
export function classifyOpenaiError(error: any): OpenaiErrorInfo {
  const status = Number(error?.status ?? error?.response?.status) || null;
  const body = error?.error ?? error?.response?.data?.error ?? {};
  const code = str(error?.code ?? body?.code ?? body?.type) || null;
  const message = str(body?.message ?? error?.message ?? error).slice(0, 300);
  const text = `${code ?? ''} ${message}`.toLowerCase();

  let kind: OpenaiProblem = 'unknown';
  if (status === 401 || /invalid_api_key|incorrect api key|invalid api key/.test(text)) kind = 'invalid_key';
  else if (/insufficient_quota|exceeded your current quota|billing_hard_limit|billing/.test(text)) kind = 'no_credit';
  else if (status === 429) kind = 'rate_limited';
  else if (status === 404 || /model_not_found|does not exist|do not have access to (the )?model/.test(text))
    kind = 'model_unavailable';
  else if (status === 403) kind = /model/.test(text) ? 'model_unavailable' : 'permission';
  else if (status && status >= 500) kind = 'server_error';
  else if (!status && /timeout|econn|enotfound|socket|network|fetch failed|aborted/.test(text)) kind = 'network';
  return { kind, status, code, message };
}

export function maskKey(key: string | null | undefined): string {
  const k = str(key);
  if (!k) return '(sem chave)';
  if (k.length <= 10) return '****';
  return `${k.slice(0, 3)}…${k.slice(-4)}`;
}

// ------------------------------------------------------------------------------------------- registry

export interface KeyLimits {
  requestsPerMinute: number | null;
  tokensPerMinute: number | null;
}

export interface KeyTestResult {
  verdict: OpenaiVerdict;
  text: string;
  hint: string | null;
  checkedAt: string;
  model: string | null;
  modelAvailable: boolean | null;
  limits: KeyLimits | null;
  error: OpenaiErrorInfo | null;
  durationMs: number;
}

export interface KeyHealth {
  lastOkAt: number | null;
  lastOkModel: string | null;
  lastError: (OpenaiErrorInfo & { at: number; model: string | null }) | null;
  okCount: number;
  errorCount: number;
  lastTest: KeyTestResult | null;
}

/** Estado em memória por credencial (id de OpenaiCreds, ou "global" para a chave global). */
export class OpenaiHealthRegistry {
  private readonly byKey = new Map<string, KeyHealth>();

  constructor(private readonly now: () => number = Date.now) {}

  private entry(credsId: string): KeyHealth {
    let e = this.byKey.get(credsId);
    if (!e) {
      e = { lastOkAt: null, lastOkModel: null, lastError: null, okCount: 0, errorCount: 0, lastTest: null };
      this.byKey.set(credsId, e);
    }
    return e;
  }

  recordOk(credsId: string | null | undefined, model?: string | null): void {
    if (!credsId) return;
    const e = this.entry(credsId);
    e.lastOkAt = this.now();
    e.lastOkModel = model ?? null;
    e.okCount++;
  }

  recordError(credsId: string | null | undefined, error: unknown, model?: string | null): OpenaiErrorInfo | null {
    if (!credsId) return null;
    const info = classifyOpenaiError(error);
    const e = this.entry(credsId);
    e.lastError = { ...info, at: this.now(), model: model ?? null };
    e.errorCount++;
    return info;
  }

  recordTest(credsId: string, result: KeyTestResult): void {
    this.entry(credsId).lastTest = result;
  }

  get(credsId: string): KeyHealth | null {
    return this.byKey.get(credsId) ?? null;
  }

  forget(credsId: string): void {
    this.byKey.delete(credsId);
  }
}

/**
 * Situação atual de uma chave: vale o acontecimento mais recente entre a última resposta boa, o último erro
 * real e o último teste.
 */
export function currentVerdict(health: KeyHealth | null): { verdict: OpenaiVerdict; at: number | null } {
  if (!health) return { verdict: 'not_tested', at: null };
  const events: { verdict: OpenaiVerdict; at: number }[] = [];
  if (health.lastOkAt) events.push({ verdict: 'ok', at: health.lastOkAt });
  if (health.lastError) events.push({ verdict: health.lastError.kind, at: health.lastError.at });
  if (health.lastTest) events.push({ verdict: health.lastTest.verdict, at: Date.parse(health.lastTest.checkedAt) });
  if (!events.length) return { verdict: 'not_tested', at: null };
  events.sort((a, b) => b.at - a.at);
  return events[0];
}

export const openaiHealthRegistry = new OpenaiHealthRegistry();

// ------------------------------------------------------------------------------------------------ test

const QUOTA_PROBE_MODEL = 'text-embedding-3-small';

function limitsFrom(headers: Record<string, any> | undefined): KeyLimits | null {
  if (!headers) return null;
  const n = (v: unknown) => {
    const x = Number.parseInt(str(v), 10);
    return Number.isFinite(x) ? x : null;
  };
  const requestsPerMinute = n(headers['x-ratelimit-limit-requests']);
  const tokensPerMinute = n(headers['x-ratelimit-limit-tokens']);
  return requestsPerMinute === null && tokensPerMinute === null ? null : { requestsPerMinute, tokensPerMinute };
}

/**
 * Testa uma chave: válida? modelo liberado? tem crédito? Custo: GET /v1/models (grátis) + 1 embedding de 1 token.
 * Se o embedding for negado por restrição do projeto (403/404), confirma o crédito com 1 resposta curtíssima do
 * próprio modelo do bot. Nunca lança.
 */
export async function testOpenaiKey(
  apiKey: string,
  model: string | null,
  options: { http?: AxiosInstance; timeoutMs?: number; now?: () => number } = {},
): Promise<KeyTestResult> {
  const now = options.now ?? Date.now;
  const started = now();
  const http =
    options.http ??
    axios.create({
      baseURL: 'https://api.openai.com/v1',
      timeout: options.timeoutMs ?? 10_000,
    });
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  const done = (
    verdict: OpenaiVerdict,
    extra: Partial<Pick<KeyTestResult, 'modelAvailable' | 'limits' | 'error'>> = {},
  ): KeyTestResult => ({
    verdict,
    text: VERDICT_TEXT[verdict],
    hint: VERDICT_HINT[verdict] ?? null,
    checkedAt: new Date(now()).toISOString(),
    model,
    modelAvailable: extra.modelAvailable ?? null,
    limits: extra.limits ?? null,
    error: extra.error ?? null,
    durationMs: now() - started,
  });

  if (!apiKey) return done('invalid_key', { error: { kind: 'invalid_key', status: null, code: null, message: '' } });

  // 1. chave válida + modelos liberados (grátis)
  let modelAvailable: boolean | null = null;
  try {
    const { data } = await http.get('/models', { headers });
    const ids: string[] = Array.isArray(data?.data) ? data.data.map((m: any) => str(m?.id)) : [];
    if (model) modelAvailable = ids.includes(model);
  } catch (error) {
    const info = classifyOpenaiError(error);
    return done(info.kind, { error: info });
  }

  // 2. crédito: embedding de 1 token
  try {
    const res = await http.post('/embeddings', { model: QUOTA_PROBE_MODEL, input: 'ok' }, { headers });
    const limits = limitsFrom(res?.headers as any);
    if (model && modelAvailable === false) return done('model_unavailable', { modelAvailable, limits });
    return done('ok', { modelAvailable, limits });
  } catch (error) {
    const info = classifyOpenaiError(error);
    if (info.kind !== 'model_unavailable' && info.kind !== 'permission')
      return done(info.kind, { error: info, modelAvailable });
  }

  // 3. embeddings bloqueados no projeto: confirma com o modelo do bot (resposta de poucos tokens)
  if (!model) return done('permission', { modelAvailable });
  const tryChat = (param: 'max_completion_tokens' | 'max_tokens') =>
    http.post('/chat/completions', { model, messages: [{ role: 'user', content: 'ok' }], [param]: 16 }, { headers });
  try {
    let res;
    try {
      res = await tryChat('max_completion_tokens');
    } catch (error) {
      const msg = classifyOpenaiError(error).message;
      if (!/unsupported parameter/i.test(msg)) throw error;
      res = await tryChat('max_tokens');
    }
    return done('ok', { modelAvailable: true, limits: limitsFrom(res?.headers as any) });
  } catch (error) {
    const info = classifyOpenaiError(error);
    return done(info.kind, { error: info, modelAvailable });
  }
}
