/**
 * CNJ DataJud, API Pública (https://datajud-wiki.cnj.jus.br/api-publica/):
 *   POST https://api-publica.datajud.cnj.jus.br/api_publica_<alias>/_search
 *   Authorization: APIKey <chave pública>   body: {"query":{"match":{"numeroProcesso":"<20 dígitos>"}}}
 * Elasticsearch response: hits.hits[]._source with classe, assuntos[], orgaoJulgador, dataAjuizamento, grau,
 * nivelSigilo and movimentos[] {codigo, nome, dataHora, complementosTabelados[]}. One process can have several
 * documents (one per grau: G1, G2, JE...): their movements are merged.
 * Terms of use v1.2: at most 120 requests per minute; the CNJ does not guarantee data being current.
 */
import { createHash } from 'crypto';

/**
 * Current public key published by the CNJ on https://datajud-wiki.cnj.jus.br/api-publica/acesso (it is public and
 * the CNJ may change it at any time: set DATAJUD_API_KEY to the new value without a deploy of the code).
 */
export const DATAJUD_PUBLIC_KEY = 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';
export const DATAJUD_BASE_URL = 'https://api-publica.datajud.cnj.jus.br';

export type FetchLike = (
  url: string,
  init?: any,
) => Promise<{
  ok: boolean;
  status: number;
  headers?: { get(name: string): string | null };
  json(): Promise<any>;
  text(): Promise<string>;
}>;

export type ParsedMovement = {
  occurredAt: Date;
  code: number | null;
  name: string;
  complement: string | null;
  hash: string;
};

export type ParsedProcess = {
  found: boolean;
  classe: string | null;
  assuntos: string | null;
  orgaoJulgador: string | null;
  dataAjuizamento: Date | null;
  sigilo: boolean;
  movements: ParsedMovement[];
};

export class SourceError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    /** 429 / 5xx / network: try again later with backoff. */
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

const clip = (value: unknown, max: number): string | null => {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
};

/** DataJud dates come as ISO ("2018-10-30T14:06:24.000Z") or compact ("20181029000000"). */
export function parseDataJudDate(value: unknown): Date | null {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  const compact = /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?$/.exec(text);
  if (compact) {
    const [, y, mo, d, h = '00', mi = '00', s = '00'] = compact;
    const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(text) || text.length <= 10 ? text : `${text}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function complementOf(movement: any): string | null {
  const items = Array.isArray(movement?.complementosTabelados) ? movement.complementosTabelados : [];
  const parts = items
    .map((c: any) => {
      const label = String(c?.descricao ?? '')
        .replace(/_/g, ' ')
        .trim();
      const value = String(c?.nome ?? c?.valor ?? '').trim();
      return label && value ? `${label}: ${value}` : value || label;
    })
    .filter(Boolean);
  return clip(parts.join('; '), 500);
}

export function movementHash(code: number | null, occurredAt: Date, name: string, complement: string | null): string {
  return createHash('sha256')
    .update([code ?? '', occurredAt.toISOString(), name, complement ?? ''].join('|'))
    .digest('hex')
    .slice(0, 40);
}

/** Parses an Elasticsearch response of the DataJud into one process (movements merged, deduped, newest first). */
export function parseDataJudResponse(body: any): ParsedProcess {
  const hits: any[] = Array.isArray(body?.hits?.hits) ? body.hits.hits : [];
  const sources = hits.map((hit) => hit?._source).filter(Boolean);
  if (!sources.length) {
    return {
      found: false,
      classe: null,
      assuntos: null,
      orgaoJulgador: null,
      dataAjuizamento: null,
      sigilo: false,
      movements: [],
    };
  }

  // The most recently updated document gives the "capa" (current class and court)
  const ranked = [...sources].sort((a, b) =>
    String(b?.dataHoraUltimaAtualizacao ?? '').localeCompare(String(a?.dataHoraUltimaAtualizacao ?? '')),
  );
  const head = ranked[0];

  const byHash = new Map<string, ParsedMovement>();
  for (const source of sources) {
    for (const m of Array.isArray(source?.movimentos) ? source.movimentos : []) {
      const occurredAt = parseDataJudDate(m?.dataHora);
      const name = clip(m?.nome, 300);
      if (!occurredAt || !name) continue;
      const code = Number.isFinite(Number(m?.codigo)) ? Number(m.codigo) : null;
      const complement = complementOf(m);
      const hash = movementHash(code, occurredAt, name, complement);
      if (!byHash.has(hash)) byHash.set(hash, { occurredAt, code, name, complement, hash });
    }
  }

  const assuntos = (Array.isArray(head?.assuntos) ? head.assuntos : [])
    .flat()
    .map((a: any) => a?.nome)
    .filter(Boolean);

  return {
    found: true,
    classe: clip(head?.classe?.nome, 200),
    assuntos: clip(assuntos.join(', '), 300),
    orgaoJulgador: clip(head?.orgaoJulgador?.nome, 200),
    dataAjuizamento: parseDataJudDate(head?.dataAjuizamento),
    sigilo: sources.some((s) => Number(s?.nivelSigilo) > 0),
    movements: [...byHash.values()].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()),
  };
}

export type DataJudOptions = { apiKey?: string; baseUrl?: string; timeoutMs?: number; fetchImpl?: FetchLike };

export async function fetchDataJudProcess(alias: string, digits: string, options: DataJudOptions = {}) {
  const fetchImpl: FetchLike = options.fetchImpl ?? (globalThis.fetch as any);
  const url = `${options.baseUrl || DATAJUD_BASE_URL}/api_publica_${encodeURIComponent(alias)}/_search`;
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `APIKey ${options.apiKey || DATAJUD_PUBLIC_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: { match: { numeroProcesso: digits } }, size: 10 }),
      // The DataJud may take ~30 s per query (measured on 04/11/2026)
      signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
    });
  } catch (error) {
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    throw new SourceError(timeout ? 'DataJud não respondeu a tempo.' : 'Sem conexão com o DataJud.', null, true);
  }

  if (response.status === 401 || response.status === 403) {
    throw new SourceError(
      'DataJud recusou a chave pública: confira DATAJUD_API_KEY (a chave vigente está na wiki do DataJud).',
      response.status,
      false,
    );
  }
  if (response.status === 404) {
    throw new SourceError(`Tribunal "${alias}" não existe na API pública do DataJud.`, 404, false);
  }
  if (response.status === 429 || response.status >= 500) {
    throw new SourceError(`DataJud indisponível (HTTP ${response.status}).`, response.status, true);
  }
  if (!response.ok) throw new SourceError(`DataJud respondeu HTTP ${response.status}.`, response.status, false);

  return parseDataJudResponse(await response.json());
}
