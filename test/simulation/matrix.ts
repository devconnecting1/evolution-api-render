/**
 * Coverage matrix of the simulator: five dimensions, generated combinatorially.
 *
 * 1. Pairwise (all-pairs): a greedy generator builds rows until every pair of values of every two dimensions appears
 *    at least once (this is what large conversational-AI test suites use to keep the matrix small but complete).
 * 2. Filled up to the requested size with seeded random rows (same seed = same cases, in CI and locally).
 * Some combinations make no sense (a group chat cannot come from an ad); `compatible` rejects them and the pairs
 * they would cover are reported as excluded, never silently lost.
 */

export const DIMENSIONS = {
  intent: [
    'bpc_loas',
    'salario_maternidade',
    'interrupcao_energia',
    'interrupcao_internet',
    'interrupcao_telefone',
    'trabalhista_demissao',
    'trabalhista_fgts',
    'trabalhista_horas_extras',
    'trabalhista_justa_causa',
    'consumidor_plano_saude',
    'consumidor_cobranca_indevida',
    'familia_pensao',
    'familia_divorcio',
    'previdenciario_aposentadoria',
    'cliente_antigo_processo',
    'fora_area_criminal',
    'fora_area_tributario',
    'spam',
    'contato_errado',
    'so_cumprimento',
  ],
  persona: [
    'padrao',
    'idoso',
    'girias_cariocas',
    'sem_pontuacao',
    'maiusculas',
    'erros_digitacao',
    'emojis',
    'audio_transcrito',
    'longo_confuso',
    'uma_palavra',
    'em_nome_de_outro',
    'irritado',
    'desconfiado',
    'apressado',
  ],
  channel: [
    'normal',
    'rajada',
    'dividida',
    'so_midia_foto',
    'so_midia_pdf',
    'figurinha',
    'reacao',
    'link_instagram',
    'apagada',
    'editada',
    'duplicada',
    'ordem_trocada',
    'lid',
    'lid_sem_numero',
    'grupo',
    'anuncio_com_referral',
    'anuncio_sem_referral',
  ],
  lifecycle: [
    'primeira',
    'volta_dias',
    'equipe_assumiu',
    'fora_horario',
    'fim_semana',
    'feriado',
    'triagem_completa',
    'muda_assunto',
    'corrige_info',
  ],
  adversarial: [
    'nenhum',
    'prompt_injection',
    'parecer_disfarcado',
    'preco_indireto',
    'se_passa_advogado',
    'dados_outro_cliente',
    'mensagem_terceiros',
    'menor_idade',
    'conteudo_improprio',
    'extrair_prompt',
    'pede_humano',
  ],
} as const;

export type Dimension = keyof typeof DIMENSIONS;
export type SimCase = { [K in Dimension]: (typeof DIMENSIONS)[K][number] } & { index: number; seed: number };

export const DIMENSION_NAMES = Object.keys(DIMENSIONS) as Dimension[];

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (max: number) => Math.floor(next() * max),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
    chance: (p: number) => next() < p,
  };
}

/** Stable 32-bit hash of a string (FNV-1a). */
export function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

type Row = Partial<Record<Dimension, string>>;

/** Combinations that cannot happen (or that one dimension already decides). */
export function compatible(row: Row): boolean {
  const group = row.channel === 'grupo';
  const ad = row.channel === 'anuncio_com_referral' || row.channel === 'anuncio_sem_referral';
  if (group && row.lifecycle && !['primeira', 'fim_semana', 'fora_horario', 'feriado'].includes(row.lifecycle)) {
    return false;
  }
  if (ad && row.lifecycle && ['equipe_assumiu', 'volta_dias', 'triagem_completa'].includes(row.lifecycle)) {
    return false;
  }
  if (ad && row.intent && ['cliente_antigo_processo', 'contato_errado'].includes(row.intent)) return false;
  return true;
}

const pairKey = (a: Dimension, va: string, b: Dimension, vb: string) => `${a}=${va}|${b}=${vb}`;

/** Every pair of values of two different dimensions that a compatible row can contain. */
export function allPairs(): Set<string> {
  const pairs = new Set<string>();
  for (let i = 0; i < DIMENSION_NAMES.length; i++) {
    for (let j = i + 1; j < DIMENSION_NAMES.length; j++) {
      const a = DIMENSION_NAMES[i];
      const b = DIMENSION_NAMES[j];
      for (const va of DIMENSIONS[a]) {
        for (const vb of DIMENSIONS[b]) {
          if (compatible({ [a]: va, [b]: vb })) pairs.add(pairKey(a, va, b, vb));
        }
      }
    }
  }
  return pairs;
}

export function pairsOf(row: Row): string[] {
  const keys: string[] = [];
  for (let i = 0; i < DIMENSION_NAMES.length; i++) {
    for (let j = i + 1; j < DIMENSION_NAMES.length; j++) {
      const a = DIMENSION_NAMES[i];
      const b = DIMENSION_NAMES[j];
      if (row[a] !== undefined && row[b] !== undefined) keys.push(pairKey(a, row[a]!, b, row[b]!));
    }
  }
  return keys;
}

/**
 * Greedy all-pairs: each new row starts from the most "missing" pair and adds, dimension by dimension, the value
 * covering the most missing pairs (ties broken by the seeded RNG). Deterministic for a seed.
 */
export function pairwiseRows(seed: number): Row[] {
  const random = rng(seed);
  const missing = allPairs();
  const rows: Row[] = [];
  let guard = 0;
  while (missing.size && guard++ < 5000) {
    const [first] = missing;
    const [left, right] = first.split('|').map((part) => part.split('=')) as [string[], string[]];
    const row: Row = { [left[0]]: left[1], [right[0]]: right[1] };
    const order = DIMENSION_NAMES.filter((dim) => row[dim] === undefined);
    for (const dim of order) {
      let best: string[] = [];
      let bestScore = -1;
      for (const value of DIMENSIONS[dim]) {
        const candidate = { ...row, [dim]: value };
        if (!compatible(candidate)) continue;
        const score = pairsOf(candidate).filter((key) => missing.has(key)).length;
        if (score > bestScore) {
          best = [value];
          bestScore = score;
        } else if (score === bestScore) best.push(value);
      }
      row[dim] = best.length ? random.pick(best) : DIMENSIONS[dim][0];
    }
    if (!compatible(row)) {
      missing.delete(first);
      continue;
    }
    for (const key of pairsOf(row)) missing.delete(key);
    rows.push(row);
  }
  return rows;
}

/** The full case list: pairwise rows first, then seeded random compatible rows up to `count`. */
export function buildCases(count: number, seed: number): SimCase[] {
  const random = rng(seed ^ 0x9e3779b9);
  const rows = pairwiseRows(seed);
  while (rows.length < count) {
    const row: Row = {};
    for (const dim of DIMENSION_NAMES) row[dim] = random.pick(DIMENSIONS[dim]);
    if (compatible(row)) rows.push(row);
  }
  return rows.map((row, index) => ({ ...(row as any), index, seed: hash(`${seed}:${index}`) }));
}

/** Coverage per dimension (cases per value) and pairwise coverage of the case list. */
export function coverage(cases: SimCase[]) {
  const perDimension = Object.fromEntries(
    DIMENSION_NAMES.map((dim) => [
      dim,
      Object.fromEntries(DIMENSIONS[dim].map((value) => [value, cases.filter((c) => c[dim] === value).length])),
    ]),
  ) as Record<Dimension, Record<string, number>>;
  const all = allPairs();
  const covered = new Set<string>();
  for (const item of cases) for (const key of pairsOf(item)) if (all.has(key)) covered.add(key);
  return {
    perDimension,
    pairs: { total: all.size, covered: covered.size, percent: (100 * covered.size) / all.size },
    missingPairs: [...all].filter((key) => !covered.has(key)),
  };
}
