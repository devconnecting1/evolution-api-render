/**
 * DJEN (Diário de Justiça Eletrônico Nacional), Comunica PJe public query API, no authentication:
 *   GET https://comunicaapi.pje.jus.br/api/v1/comunicacao?numeroOab=&ufOab=&dataDisponibilizacaoInicio=YYYY-MM-DD
 *       &dataDisponibilizacaoFim=YYYY-MM-DD&pagina=1&itensPorPagina=100   (also numeroProcesso, siglaTribunal)
 * Response: { status, message, count, items: [{ id, data_disponibilizacao, siglaTribunal, tipoComunicacao,
 * nomeOrgao, texto (HTML), numero_processo, numeroprocessocommascara, link, hash, ... }] }.
 * Rate limit per IP (x-ratelimit-* headers; wait 1 min after a 429); at most 10.000 results per query.
 * Swagger: https://comunicaapi.pje.jus.br/swagger/index.html. Requests from outside Brazil are reported to get
 * HTTP 403 (CloudFront geo block): that is what the sandbox of this project got, and what Render (Ohio) may get.
 */
import { formatCnj, onlyDigits } from './cnj';
import { FetchLike, SourceError } from './datajud';

export const DJEN_BASE_URL = 'https://comunicaapi.pje.jus.br';
const PAGE_SIZE = 100;
const MAX_PAGES = 5;

export type ParsedPublication = {
  externalId: string;
  processNumber: string | null;
  processDigits: string | null;
  siglaTribunal: string | null;
  tipo: string | null;
  orgao: string | null;
  disponibilizadaEm: Date | null;
  texto: string | null;
  link: string | null;
};

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ordm: 'º',
  ordf: 'ª',
  sect: '§',
};

/** The DJEN text is HTML: plain text, entities decoded, blank lines collapsed, at most `max` characters. */
export function htmlToText(html: unknown, max = 4000): string | null {
  let text = String(html ?? '')
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (all, name) => ENTITIES[name.toLowerCase()] ?? all)
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) return null;
  if (text.length > max) text = text.slice(0, max - 1).trimEnd() + '…';
  return text;
}

const str = (value: unknown, max: number): string | null => {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : null;
};

export function parseDjenItem(item: any): ParsedPublication | null {
  const externalId = str(item?.id ?? item?.hash, 64);
  if (!externalId) return null;
  const digits = onlyDigits(item?.numero_processo ?? item?.numeroprocessocommascara);
  const dateText = String(item?.data_disponibilizacao ?? item?.datadisponibilizacao ?? '').slice(0, 10);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateText) ? new Date(`${dateText}T12:00:00Z`) : null;
  return {
    externalId,
    processDigits: digits.length === 20 ? digits : null,
    processNumber: digits.length === 20 ? formatCnj(digits) : str(item?.numeroprocessocommascara, 25),
    siglaTribunal: str(item?.siglaTribunal, 20),
    tipo: str(item?.tipoComunicacao, 80),
    orgao: str(item?.nomeOrgao, 200),
    disponibilizadaEm: date,
    texto: htmlToText(item?.texto),
    link: /^https?:\/\//i.test(String(item?.link ?? '')) ? str(item.link, 500) : null,
  };
}

export function parseDjenResponse(body: any): { count: number; items: ParsedPublication[] } {
  const items = (Array.isArray(body?.items) ? body.items : []).map(parseDjenItem).filter(Boolean);
  return { count: Number(body?.count) || items.length, items };
}

const ymd = (date: Date) => date.toISOString().slice(0, 10);

export type DjenQuery = { numeroOab: string; ufOab: string; from: Date; to: Date };
export type DjenOptions = { baseUrl?: string; timeoutMs?: number; fetchImpl?: FetchLike; pauseMs?: number };

/** Communications of an OAB number in a period (up to 5 pages of 100). */
export async function fetchDjenByOab(query: DjenQuery, options: DjenOptions = {}): Promise<ParsedPublication[]> {
  const fetchImpl: FetchLike = options.fetchImpl ?? (globalThis.fetch as any);
  const out: ParsedPublication[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const params = new URLSearchParams({
      numeroOab: query.numeroOab,
      ufOab: query.ufOab.toUpperCase(),
      dataDisponibilizacaoInicio: ymd(query.from),
      dataDisponibilizacaoFim: ymd(query.to),
      pagina: String(page),
      itensPorPagina: String(PAGE_SIZE),
    });
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await fetchImpl(`${options.baseUrl || DJEN_BASE_URL}/api/v1/comunicacao?${params}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
      });
    } catch (error) {
      const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      throw new SourceError(timeout ? 'DJEN não respondeu a tempo.' : 'Sem conexão com o DJEN.', null, true);
    }
    if (response.status === 403) {
      throw new SourceError(
        'DJEN recusou o acesso (HTTP 403): a API costuma bloquear servidores fora do Brasil.',
        403,
        true,
      );
    }
    if (response.status === 429 || response.status >= 500) {
      throw new SourceError(`DJEN indisponível (HTTP ${response.status}).`, response.status, true);
    }
    if (!response.ok) throw new SourceError(`DJEN respondeu HTTP ${response.status}.`, response.status, false);

    const { count, items } = parseDjenResponse(await response.json());
    out.push(...items);
    if (items.length < PAGE_SIZE || out.length >= count) break;

    // Polite: respect the rate limit window of the IP
    const remaining = Number(response.headers?.get('x-ratelimit-remaining'));
    const pause = Number.isFinite(remaining) && remaining <= 1 ? 60_000 : (options.pauseMs ?? 1000);
    await new Promise((resolve) => setTimeout(resolve, pause));
  }
  return out;
}
