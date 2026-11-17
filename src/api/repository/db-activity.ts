/**
 * Registro leve, só em memória, das consultas ao banco principal.
 *
 * Para que serve: o Neon (plano grátis) desliga o banco depois de 5 minutos sem consultas e liga de novo na
 * primeira consulta. Cada "acordada" gasta cota de CU-h. Este registro guarda, para cada acordada, quais
 * consultas a causaram (tabela e tipo: SELECT, INSERT...), para descobrir o que mantém o banco ligado.
 *
 * Privacidade: guarda só o verbo SQL e o nome da tabela; nunca parâmetros, valores ou o texto completo.
 * Nada é gravado no banco (isso, por si, acordaria o banco).
 */

export interface DbQueryRef {
  op: string;
  table: string;
}

export interface DbWake {
  at: string;
  /** Minutos sem nenhuma consulta antes desta (≥ limite de inatividade). */
  idleMinutes: number;
  /** Primeiras consultas da rajada que acordou o banco. */
  queries: DbQueryRef[];
}

export interface DbActivitySnapshot {
  since: string;
  idleThresholdMinutes: number;
  totalQueries: number;
  lastQueryAt: string | null;
  /** Acordadas mais recentes primeiro. */
  wakes: DbWake[];
  /** Consultas que mais acordaram o banco (tabela + tipo da primeira consulta da rajada). */
  topWakeCauses: { cause: string; count: number }[];
}

const MAX_WAKES = 300;
const QUERIES_PER_WAKE = 8;
/** O Neon dorme após 5 min sem consultas; com folga, "acordado" = consultou há menos de 4 min. */
export const DB_AWAKE_WINDOW_MS = 4 * 60_000;
/** Resumo diário no Redis: some sozinho depois disto. */
const DAILY_TTL_SECONDS = 35 * 24 * 3600;
const DAILY_PREFIX = 'whatsai:db-activity:daily:';

/** Onde o resumo diário sobrevive aos deploys (Redis). Sem ele, só a memória do processo. */
export interface DbActivityDailyStore {
  /** Soma 1 em cada campo do dia (HINCRBY) e renova o TTL. Rejeita quando o Redis não está pronto. */
  increment(day: string, fields: string[], ttlSeconds: number): Promise<void>;
  read(day: string): Promise<Record<string, string> | null>;
}

export interface DbActivityDay {
  date: string;
  wakes: number;
  topCauses: { cause: string; count: number }[];
  /** Acordadas por hora UTC (0..23). */
  byHourUtc: number[];
}

export class DbActivityTracker {
  private readonly startedAt: number;
  private lastAt = 0;
  private total = 0;
  private readonly wakes: { at: number; idleMs: number; queries: DbQueryRef[] }[] = [];
  private dailyStore: DbActivityDailyStore | null = null;
  /** Campos ainda não enviados ao Redis (Redis fora do ar ou ainda conectando). */
  private pending: { day: string; fields: string[] }[] = [];
  private flushing: Promise<void> | null = null;

  constructor(
    private readonly idleThresholdMs = 5 * 60_000,
    private readonly now: () => number = Date.now,
  ) {
    this.startedAt = this.now();
  }

  record(sql: string): void {
    const at = this.now();
    const ref = describeQuery(sql);
    this.total++;

    const idle = this.lastAt ? at - this.lastAt : at - this.startedAt;
    if (this.lastAt && idle >= this.idleThresholdMs) {
      this.wakes.push({ at, idleMs: idle, queries: [ref] });
      if (this.wakes.length > MAX_WAKES) this.wakes.shift();
      this.countDaily(at, `${ref.op} ${ref.table}`);
    } else {
      const current = this.wakes[this.wakes.length - 1];
      // ainda dentro da rajada que acordou o banco (primeiros segundos)
      if (current && at - current.at < 10_000 && current.queries.length < QUERIES_PER_WAKE) {
        current.queries.push(ref);
      }
    }
    this.lastAt = at;
  }

  /** Momento da última consulta (ms) ou null; não toca no banco. */
  lastQueryAt(): number | null {
    return this.lastAt || null;
  }

  /** O banco consultou há pouco (ainda está ligado)? Releituras opcionais devem esperar por isso. */
  isAwake(windowMs = DB_AWAKE_WINDOW_MS): boolean {
    return Boolean(this.lastAt) && this.now() - this.lastAt < windowMs;
  }

  /** Liga o resumo diário persistente (Redis). */
  attachDailyStore(store: DbActivityDailyStore | null): void {
    this.dailyStore = store;
  }

  private countDaily(at: number, cause: string): void {
    const day = new Date(at).toISOString().slice(0, 10);
    const hour = String(new Date(at).getUTCHours()).padStart(2, '0');
    // nomes de campo seguros: verbo + tabela já vêm sem valores (describeQuery)
    this.pending.push({ day, fields: ['wakes', `h:${hour}`, `c:${cause.slice(0, 80)}`] });
    if (this.pending.length > 500) this.pending.shift();
    void this.flushDaily();
  }

  /** Envia o que estiver pendente; em falha, guarda para a próxima acordada. Uma remessa por vez. */
  flushDaily(): Promise<void> {
    if (this.flushing) return this.flushing.then(() => (this.pending.length ? this.flushDaily() : undefined));
    if (!this.dailyStore || !this.pending.length) return Promise.resolve();
    const store = this.dailyStore;
    this.flushing = (async () => {
      try {
        while (this.pending.length) {
          const item = this.pending[0];
          await store.increment(`${DAILY_PREFIX}${item.day}`, item.fields, DAILY_TTL_SECONDS);
          this.pending.shift();
        }
      } catch {
        // Redis indisponível: tenta de novo na próxima acordada
      }
    })().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  /** Resumo dos últimos `days` dias guardado no Redis (sobrevive aos deploys). Vazio sem Redis. */
  async daily(days = 14): Promise<DbActivityDay[]> {
    if (!this.dailyStore) return [];
    await this.flushDaily();
    const result: DbActivityDay[] = [];
    for (let i = 0; i < Math.min(35, Math.max(1, days)); i++) {
      const date = new Date(this.now() - i * 86_400_000).toISOString().slice(0, 10);
      let row: Record<string, string> | null = null;
      try {
        row = await this.dailyStore.read(`${DAILY_PREFIX}${date}`);
      } catch {
        row = null;
      }
      if (!row || !Object.keys(row).length) continue;
      const byHourUtc = Array.from({ length: 24 }, (_, hour) => Number(row[`h:${String(hour).padStart(2, '0')}`] ?? 0));
      const topCauses = Object.entries(row)
        .filter(([key]) => key.startsWith('c:'))
        .map(([key, value]) => ({ cause: key.slice(2), count: Number(value) || 0 }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
      result.push({ date, wakes: Number(row.wakes ?? 0), topCauses, byHourUtc });
    }
    return result;
  }

  snapshot(limit = 50): DbActivitySnapshot {
    const causes = new Map<string, number>();
    for (const wake of this.wakes) {
      const first = wake.queries[0];
      const key = `${first.op} ${first.table}`;
      causes.set(key, (causes.get(key) ?? 0) + 1);
    }
    return {
      since: new Date(this.startedAt).toISOString(),
      idleThresholdMinutes: Math.round(this.idleThresholdMs / 60_000),
      totalQueries: this.total,
      lastQueryAt: this.lastAt ? new Date(this.lastAt).toISOString() : null,
      wakes: this.wakes
        .slice(-Math.max(1, limit))
        .reverse()
        .map((w) => ({
          at: new Date(w.at).toISOString(),
          idleMinutes: Math.round(w.idleMs / 6_000) / 10,
          queries: w.queries,
        })),
      topWakeCauses: [...causes.entries()]
        .map(([cause, count]) => ({ cause, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 15),
    };
  }
}

/** Verbo e tabela de um SQL gerado pelo Prisma, sem nenhum valor. */
export function describeQuery(sql: string): DbQueryRef {
  const text = String(sql ?? '').trim();
  const op = (/^\s*([A-Za-z]+)/.exec(text)?.[1] ?? 'OTHER').toUpperCase();
  const tableMatch = /\b(?:FROM|INTO|UPDATE|JOIN)\s+((?:"[^"]+"\.)?"[^"]+"|`[^`]+`(?:\.`[^`]+`)?)/i.exec(text) ?? null;
  let table = tableMatch ? tableMatch[1] : op === 'BEGIN' || op === 'COMMIT' || op === 'ROLLBACK' ? '-' : '?';
  table = table.replace(/^"public"\./, '').replace(/["`]/g, '');
  return { op, table };
}

export const dbActivity = new DbActivityTracker();

/**
 * Cache "sem acordar o banco": dentro do TTL vale; depois do TTL, só é relido se o banco já estiver acordado (a
 * releitura sai de graça) e nunca passa de `maxStaleMs`. Para dados que só mudam pela própria API (que já
 * invalida o cache) e cujo TTL existe só para pegar edições feitas direto no banco.
 */
export function softCacheValid(
  cachedAt: number,
  ttlMs: number,
  options: { now?: number; maxStaleMs?: number; awake?: () => boolean } = {},
): boolean {
  const age = (options.now ?? Date.now()) - cachedAt;
  if (age < ttlMs) return true;
  if (age >= (options.maxStaleMs ?? 24 * 3_600_000)) return false;
  return !(options.awake ?? (() => dbActivity.isAwake()))();
}
