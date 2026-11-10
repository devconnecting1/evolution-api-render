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

export class DbActivityTracker {
  private readonly startedAt: number;
  private lastAt = 0;
  private total = 0;
  private readonly wakes: { at: number; idleMs: number; queries: DbQueryRef[] }[] = [];

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
    } else {
      const current = this.wakes[this.wakes.length - 1];
      // ainda dentro da rajada que acordou o banco (primeiros segundos)
      if (current && at - current.at < 10_000 && current.queries.length < QUERIES_PER_WAKE) {
        current.queries.push(ref);
      }
    }
    this.lastAt = at;
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
