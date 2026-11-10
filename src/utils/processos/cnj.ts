/**
 * CNJ unified process number (Resolução CNJ 65/2008): NNNNNNN-DD.AAAA.J.TR.OOOO
 *   N = sequence, DD = check digits (ISO 7064 mod 97-10), AAAA = year, J = segment, TR = court, OOOO = origin.
 * DD = 98 - ((N AAAA J TR OOOO 00) mod 97); a number is valid when (N AAAA J TR OOOO DD) mod 97 = 1.
 *
 * J.TR -> DataJud alias (https://datajud-wiki.cnj.jus.br/api-publica/endpoints): 8.19 -> tjrj, 5.01 -> trt1,
 * 4.02 -> trf2, 3.00 -> stj, 5.00 -> tst, 6.00 -> tse, 7.xx -> stm, 6.19 -> tre-rj, 9.13 -> tjmmg ...
 * The STF (J = 1) and the CNJ (J = 2) are not in the public DataJud API.
 */

/** UF of each TR code used by the state (8), electoral (6) and state military (9) courts. */
export const UF_BY_TR: Record<string, string> = {
  '01': 'ac',
  '02': 'al',
  '03': 'ap',
  '04': 'am',
  '05': 'ba',
  '06': 'ce',
  '07': 'df',
  '08': 'es',
  '09': 'go',
  '10': 'ma',
  '11': 'mt',
  '12': 'ms',
  '13': 'mg',
  '14': 'pa',
  '15': 'pb',
  '16': 'pr',
  '17': 'pe',
  '18': 'pi',
  '19': 'rj',
  '20': 'rn',
  '21': 'rs',
  '22': 'ro',
  '23': 'rr',
  '24': 'sc',
  '25': 'se',
  '26': 'sp',
  '27': 'to',
};

/** Every alias of the public DataJud API (used to validate a manual override). */
export const DATAJUD_ALIASES: string[] = [
  'tst',
  'tse',
  'stj',
  'stm',
  ...['1', '2', '3', '4', '5', '6'].map((n) => `trf${n}`),
  ...Object.values(UF_BY_TR).map((uf) => (uf === 'df' ? 'tjdft' : `tj${uf}`)),
  ...Array.from({ length: 24 }, (_, k) => `trt${k + 1}`),
  ...Object.values(UF_BY_TR).map((uf) => (uf === 'df' ? 'tre-dft' : `tre-${uf}`)),
  'tjmmg',
  'tjmrs',
  'tjmsp',
];

export type CnjParts = { sequencial: string; dv: string; ano: string; j: string; tr: string; origem: string };

export const onlyDigits = (value: unknown): string => String(value ?? '').replace(/\D/g, '');

export function cnjParts(digits: string): CnjParts | null {
  if (!/^\d{20}$/.test(digits)) return null;
  return {
    sequencial: digits.slice(0, 7),
    dv: digits.slice(7, 9),
    ano: digits.slice(9, 13),
    j: digits.slice(13, 14),
    tr: digits.slice(14, 16),
    origem: digits.slice(16, 20),
  };
}

/** The two check digits for the other 18 digits (N AAAA J TR OOOO). */
export function cnjCheckDigits(sequencial: string, ano: string, j: string, tr: string, origem: string): string {
  const base = BigInt(`${sequencial}${ano}${j}${tr}${origem}00`);
  return String(98n - (base % 97n)).padStart(2, '0');
}

export const formatCnj = (digits: string): string => {
  const p = cnjParts(digits);
  return p ? `${p.sequencial}-${p.dv}.${p.ano}.${p.j}.${p.tr}.${p.origem}` : digits;
};

export function isValidCnj(digits: string): boolean {
  const p = cnjParts(digits);
  if (!p) return false;
  return cnjCheckDigits(p.sequencial, p.ano, p.j, p.tr, p.origem) === p.dv;
}

/** DataJud alias of a CNJ number from its J.TR, or null when the court is not in the public API. */
export function aliasFor(digits: string): string | null {
  const p = cnjParts(digits);
  if (!p) return null;
  const { j, tr } = p;
  const uf = UF_BY_TR[tr];
  switch (j) {
    case '3':
      return 'stj';
    case '4':
      return /^0[1-6]$/.test(tr) ? `trf${Number(tr)}` : null;
    case '5':
      if (tr === '00') return 'tst';
      return Number(tr) >= 1 && Number(tr) <= 24 ? `trt${Number(tr)}` : null;
    case '6':
      if (tr === '00') return 'tse';
      return uf ? (uf === 'df' ? 'tre-dft' : `tre-${uf}`) : null;
    case '7':
      return 'stm';
    case '8':
      return uf ? (uf === 'df' ? 'tjdft' : `tj${uf}`) : null;
    case '9':
      return { '13': 'tjmmg', '21': 'tjmrs', '26': 'tjmsp' }[tr] ?? null;
    default:
      return null; // 1 = STF, 2 = CNJ: not in the public DataJud API
  }
}

/** Court acronym as the DJEN writes it (TJRJ, TRT1, TRF2, STJ, TRE-RJ ...). */
export const tribunalLabel = (alias: string | null | undefined): string => String(alias ?? '').toUpperCase();

export type ParsedCnj =
  | { ok: true; digits: string; formatted: string; alias: string | null }
  | { ok: false; input: string; error: string };

/** Validates one number typed or pasted by the user (formatted or 20 digits). Messages in PT-BR. */
export function parseCnj(input: string): ParsedCnj {
  const raw = String(input ?? '').trim();
  const digits = onlyDigits(raw);
  if (digits.length !== 20) {
    return { ok: false, input: raw, error: 'O número CNJ tem 20 dígitos (NNNNNNN-DD.AAAA.J.TR.OOOO).' };
  }
  if (!isValidCnj(digits)) {
    return { ok: false, input: raw, error: 'Dígito verificador inválido: confira o número do processo.' };
  }
  const p = cnjParts(digits);
  if (p.j === '1') {
    return { ok: false, input: raw, error: 'Processos do STF não estão na API pública do DataJud.' };
  }
  return { ok: true, digits, formatted: formatCnj(digits), alias: aliasFor(digits) };
}

const CNJ_IN_TEXT = /\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4}/g;

/** Every candidate CNJ number of a pasted text (one per line, separated by commas, inside sentences...). */
export function extractCnjCandidates(text: string): string[] {
  const found = String(text ?? '').match(CNJ_IN_TEXT) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of found) {
    const digits = onlyDigits(item);
    if (!seen.has(digits)) {
      seen.add(digits);
      out.push(item);
    }
  }
  return out;
}
