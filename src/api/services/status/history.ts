/**
 * Histórico do status público em formato compacto (cabe com folga nos 25 MB do Key Value grátis).
 *
 * - days: 90 dias (UTC) com segundos operacional / degradado / fora / manutenção por componente. O que não foi
 *   observado não entra em nenhuma das quatro contas: a cobertura é real, nunca presumida.
 * - buckets: 14 faixas de 12 horas (7 dias), alinhadas ao horário de Brasília (00h–12h e 12h–24h, UTC-3), com o
 *   pior estado visto e os segundos cobertos. Faixas de 3 horas gravadas antes (até 17/11/2026) são somadas na faixa
 *   de 12 horas que as contém ao ler o histórico, sem perder nada.
 * - incidents: até 120 incidentes dos últimos 90 dias, com tipo fixo e os números usados nos textos.
 * - boot / seen: início do processo atual e o último sinal de vida gravado (para medir a lacuna de um reinício).
 */
import { INCIDENT_TYPES, IncidentType, PublicState, Severity, STATE_RANK } from './signals';

export const DAY_MS = 24 * 3_600_000;
export const BUCKET_MS = 12 * 3_600_000;
/** As faixas começam às 00h e 12h de Brasília (03h e 15h UTC; o Brasil não tem horário de verão desde 2019). */
export const BUCKET_OFFSET_MS = 3 * 3_600_000;
export const HISTORY_BUCKETS = 14;
export const HISTORY_BUCKET_DAYS = (HISTORY_BUCKETS * BUCKET_MS) / DAY_MS;
export const HISTORY_DAYS = 90;
const MAX_INCIDENTS = 120;
/** Uma amostra cobre no máximo este intervalo desde a anterior; acima disso o período fica sem dados. */
export const MAX_SAMPLE_GAP_MS = 10 * 60_000;

export type Seconds4 = [number, number, number, number];
export type StoredDay = { d: string; c: Record<string, Seconds4> };
export type StoredBucket = { t: number; c: Record<string, PublicState>; m: number };
export type StoredIncident = {
  id: string;
  c: string;
  t: IncidentType;
  s: Severity;
  a: number;
  b: number | null;
  d?: Record<string, number | string | null>;
};
export type StatusStore = {
  v: 2;
  days: StoredDay[];
  buckets: StoredBucket[];
  incidents: StoredIncident[];
  boot: { at: number; commit: string | null; version: string | null } | null;
  seen: number | null;
};

const SLOT: Partial<Record<PublicState, number>> = { operational: 0, degraded: 1, outage: 2, maintenance: 3 };
const SEVERITIES: Severity[] = ['maintenance', 'degraded', 'outage'];

/** Início da faixa de 12 horas que contém `ms`. */
export function bucketStart(ms: number): number {
  return Math.floor((ms - BUCKET_OFFSET_MS) / BUCKET_MS) * BUCKET_MS + BUCKET_OFFSET_MS;
}

/** Junta faixas com o mesmo início (inclusive as de 3 horas antigas): pior estado e soma dos segundos cobertos. */
function foldBuckets(buckets: StoredBucket[]): StoredBucket[] {
  const byStart = new Map<number, StoredBucket>();
  for (const bucket of buckets) {
    const t = bucketStart(bucket.t);
    const target = byStart.get(t) ?? { t, c: {}, m: 0 };
    byStart.set(t, target);
    target.m = Math.min(BUCKET_MS / 1000, Math.round((target.m + bucket.m) * 10) / 10);
    for (const [id, state] of Object.entries(bucket.c)) {
      const previous = target.c[id];
      if (!previous || STATE_RANK[state] > STATE_RANK[previous]) target.c[id] = state;
    }
  }
  return [...byStart.values()].sort((a, b) => a.t - b.t);
}

export function emptyStore(): StatusStore {
  return { v: 2, days: [], buckets: [], incidents: [], boot: null, seen: null };
}

export function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

const finite = (value: unknown): number | null => {
  const n = Number(value);
  return value !== null && value !== undefined && value !== '' && Number.isFinite(n) ? n : null;
};
const isState = (value: unknown): value is PublicState =>
  value === 'operational' ||
  value === 'degraded' ||
  value === 'outage' ||
  value === 'maintenance' ||
  value === 'no_data';
const safeId = (value: unknown): string | null => {
  const text = String(value ?? '');
  return /^[a-z0-9-]{1,40}$/.test(text) ? text : null;
};

/** Lê o que veio do Redis/GlobalSetting tolerando lixo: o que não for válido é descartado. */
export function normalizeStore(raw: unknown): StatusStore {
  const store = emptyStore();
  if (!raw || typeof raw !== 'object') return store;
  const value = (typeof raw === 'string' ? safeParse(raw) : raw) as Record<string, any> | null;
  if (!value || value.v !== 2) return store;

  for (const day of Array.isArray(value.days) ? value.days : []) {
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(String(day.d))) continue;
    const c: Record<string, Seconds4> = {};
    for (const [id, cell] of Object.entries(day.c ?? {})) {
      if (!safeId(id) || !Array.isArray(cell) || cell.length !== 4) continue;
      const nums = cell.map((item) => Math.max(0, finite(item) ?? 0)) as Seconds4;
      c[id] = nums;
    }
    store.days.push({ d: String(day.d), c });
  }
  for (const bucket of Array.isArray(value.buckets) ? value.buckets : []) {
    const t = finite(bucket?.t);
    if (t === null) continue;
    const c: Record<string, PublicState> = {};
    for (const [id, state] of Object.entries(bucket.c ?? {})) if (safeId(id) && isState(state)) c[id] = state;
    store.buckets.push({ t, c, m: Math.max(0, finite(bucket.m) ?? 0) });
  }
  store.buckets = foldBuckets(store.buckets);
  for (const item of Array.isArray(value.incidents) ? value.incidents : []) {
    const a = finite(item?.a);
    const c = safeId(item?.c);
    if (a === null || !c || !INCIDENT_TYPES.includes(item.t) || !SEVERITIES.includes(item.s)) continue;
    const data: Record<string, number | string | null> = {};
    for (const [key, val] of Object.entries((item.d ?? {}) as Record<string, unknown>)) {
      if (!/^[a-zA-Z]{1,20}$/.test(key)) continue;
      if (val === null) data[key] = null;
      else if (typeof val === 'number') data[key] = val;
      else if (typeof val === 'string') data[key] = val.slice(0, 120);
    }
    store.incidents.push({
      id: String(item.id ?? `${c}-${a}`).slice(0, 60),
      c,
      t: item.t,
      s: item.s,
      a,
      b: finite(item.b),
      ...(Object.keys(data).length ? { d: data } : {}),
    });
  }
  const bootAt = finite(value.boot?.at);
  if (bootAt !== null) {
    store.boot = {
      at: bootAt,
      commit: typeof value.boot.commit === 'string' ? value.boot.commit.slice(0, 12) : null,
      version: typeof value.boot.version === 'string' ? value.boot.version.slice(0, 20) : null,
    };
  }
  store.seen = finite(value.seen);
  return store;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Atribui o intervalo [from, to) aos estados atuais. Intervalos maiores que MAX_SAMPLE_GAP_MS são cortados: a
 * parte que ninguém observou fica sem dados.
 */
export function recordSample(store: StatusStore, states: Record<string, PublicState>, from: number | null, to: number) {
  if (from === null || to <= from) {
    markBucket(store, states, to, 0);
    return;
  }
  const start = Math.max(from, to - MAX_SAMPLE_GAP_MS);
  let cursor = start;
  while (cursor < to) {
    const dayEnd = (Math.floor(cursor / DAY_MS) + 1) * DAY_MS;
    const bucketEnd = bucketStart(cursor) + BUCKET_MS;
    const end = Math.min(to, dayEnd, bucketEnd);
    const seconds = (end - cursor) / 1000;
    addDay(store, dayKey(cursor), states, seconds);
    markBucket(store, states, cursor, seconds);
    cursor = end;
  }
}

function addDay(store: StatusStore, key: string, states: Record<string, PublicState>, seconds: number) {
  let day = store.days.find((item) => item.d === key);
  if (!day) {
    day = { d: key, c: {} };
    store.days.push(day);
  }
  for (const [id, state] of Object.entries(states)) {
    const slot = SLOT[state];
    if (slot === undefined) continue;
    const cell = day.c[id] ?? (day.c[id] = [0, 0, 0, 0]);
    cell[slot] = Math.round((cell[slot] + seconds) * 10) / 10;
  }
}

function markBucket(store: StatusStore, states: Record<string, PublicState>, at: number, seconds: number) {
  const t = bucketStart(at);
  let bucket = store.buckets.find((item) => item.t === t);
  if (!bucket) {
    bucket = { t, c: {}, m: 0 };
    store.buckets.push(bucket);
  }
  bucket.m = Math.round((bucket.m + seconds) * 10) / 10;
  for (const [id, state] of Object.entries(states)) {
    if (state === 'no_data') continue;
    const previous = bucket.c[id];
    if (!previous || STATE_RANK[state] > STATE_RANK[previous]) bucket.c[id] = state;
  }
}

/** Remove o que passou da janela (90 dias, 7 dias de faixas, 120 incidentes). */
export function pruneStore(store: StatusStore, now: number) {
  const oldestDay = dayKey(now - (HISTORY_DAYS - 1) * DAY_MS);
  store.days = store.days.filter((day) => day.d >= oldestDay).sort((a, b) => a.d.localeCompare(b.d));
  const oldestBucket = bucketStart(now) - (HISTORY_BUCKETS - 1) * BUCKET_MS;
  store.buckets = store.buckets.filter((bucket) => bucket.t >= oldestBucket).sort((a, b) => a.t - b.t);
  store.incidents = store.incidents
    .filter((item) => (item.b ?? now) >= now - HISTORY_DAYS * DAY_MS)
    .sort((a, b) => b.a - a.a)
    .slice(0, MAX_INCIDENTS);
}

export type DaySummary = { state: PublicState; uptime: number | null; coverage: number };

/** Estado do dia: fora ≥ 5 min → fora; degradado/fora → degradado; manutenção → manutenção; senão operacional. */
export function summarizeDay(cell: Seconds4 | undefined, periodSeconds: number): DaySummary {
  if (!cell) return { state: 'no_data', uptime: null, coverage: 0 };
  const [op, deg, out, maint] = cell;
  const covered = op + deg + out + maint;
  if (covered <= 0) return { state: 'no_data', uptime: null, coverage: 0 };
  const state: PublicState =
    out >= 300
      ? 'outage'
      : deg >= 300 || out > 0
        ? 'degraded'
        : maint > 0
          ? 'maintenance'
          : deg > 0
            ? 'degraded'
            : 'operational';
  return {
    state,
    uptime: Math.round(((covered - out) / covered) * 10000) / 100,
    coverage: Math.min(100, Math.round((covered / Math.max(1, periodSeconds)) * 1000) / 10),
  };
}

/** Junta o histórico guardado (base) com o desta execução (current): somas pelo maior valor, incidentes únicos. */
export function mergeStores(base: StatusStore, current: StatusStore): StatusStore {
  const result = normalizeStore(JSON.parse(JSON.stringify(base)));
  for (const day of current.days) {
    const target = result.days.find((item) => item.d === day.d);
    if (!target) {
      result.days.push(JSON.parse(JSON.stringify(day)));
      continue;
    }
    for (const [id, cell] of Object.entries(day.c)) {
      const existing = target.c[id];
      target.c[id] = existing ? (existing.map((value, index) => Math.max(value, cell[index])) as Seconds4) : [...cell];
    }
  }
  for (const bucket of current.buckets) {
    const target = result.buckets.find((item) => item.t === bucket.t);
    if (!target) {
      result.buckets.push(JSON.parse(JSON.stringify(bucket)));
      continue;
    }
    target.m = Math.max(target.m, bucket.m);
    for (const [id, state] of Object.entries(bucket.c)) {
      if (!target.c[id] || STATE_RANK[state] > STATE_RANK[target.c[id]]) target.c[id] = state;
    }
  }
  const ids = new Set(result.incidents.map((item) => item.id));
  for (const item of current.incidents) {
    const existing = result.incidents.find((other) => other.id === item.id);
    if (existing) Object.assign(existing, item);
    else if (!ids.has(item.id)) result.incidents.push({ ...item });
  }
  result.boot = current.boot ?? result.boot;
  result.seen = Math.max(result.seen ?? 0, current.seen ?? 0) || null;
  return result;
}
