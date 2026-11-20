/**
 * Cobrança manual por instância ("Plano e limites" > Cobrança).
 *
 * O WhatsAI é operado por uma pessoa física, sem gateway de pagamento: o administrador registra cada cobrança (mês de
 * referência, valor, status, forma de pagamento) e, quando ela fica paga, ganha um número de recibo. O recibo é
 * montado no painel com os dados desta resposta e os do prestador (BILLING_PROVIDER_*), que ficam no servidor e nunca
 * no código.
 *
 * Regras:
 * - só a chave global escreve (o router garante); o código do cliente com o módulo "plano" só lê;
 * - a numeração dos recibos é única no sistema todo e nunca volta atrás: o último número dado fica em
 *   GlobalSetting "billing.receiptSeq", então apagar a última cobrança não faz o número ser reaproveitado;
 * - uma cobrança paga que volta a pendente ou atrasada mantém o número (o recibo deixa de ser mostrado);
 * - a tabela fica no banco principal (CONTROL_MODELS), porque a cobrança é consultada antes de saber a instância.
 */
import type { Billing } from '@config/env.config';
import QRCode from 'qrcode';

export const BILLING_STATUSES = ['pago', 'pendente', 'atrasado'] as const;
export type BillingStatus = (typeof BILLING_STATUSES)[number];
export const BILLING_METHODS = ['pix', 'boleto', 'transferencia', 'outro'] as const;
export type BillingMethod = (typeof BILLING_METHODS)[number];

export const MAX_AMOUNT_CENTS = 100_000_000; // R$ 1.000.000,00
export const NOTE_MAX = 280;
const SEQ_KEY = 'billing.receiptSeq';
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export class BillingValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors.join(' '));
    this.name = 'BillingValidationError';
  }
}

export class BillingNotFoundError extends Error {
  constructor(message = 'Cobrança não encontrada nesta instância.') {
    super(message);
    this.name = 'BillingNotFoundError';
  }
}

export type BillingInput = {
  period?: unknown;
  amountCents?: unknown;
  status?: unknown;
  method?: unknown;
  paidAt?: unknown;
  note?: unknown;
};

type Clean = {
  period?: string;
  amountCents?: number;
  status?: BillingStatus;
  method?: BillingMethod | null;
  paidAt?: Date | null;
  note?: string | null;
};

type Deps = {
  prisma: any;
  provider: () => Billing | undefined;
  now?: () => Date;
};

const ENTRY_SELECT = {
  id: true,
  period: true,
  amountCents: true,
  status: true,
  method: true,
  paidAt: true,
  note: true,
  receiptNumber: true,
  createdAt: true,
  updatedAt: true,
};

/** Validates and normalizes the body; `partial` for updates (only the fields sent are checked). */
export function validateBillingInput(input: BillingInput, partial = false): Clean {
  const errors: string[] = [];
  const out: Clean = {};
  const body = input && typeof input === 'object' ? input : {};
  const has = (k: keyof BillingInput) => body[k] !== undefined;

  if (has('period') || !partial) {
    if (typeof body.period !== 'string' || !PERIOD_RE.test(body.period)) {
      errors.push('"period" deve ser o mês de referência no formato AAAA-MM (ex.: 2026-11).');
    } else out.period = body.period;
  }
  if (has('amountCents') || !partial) {
    const n = body.amountCents;
    if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0 || n > MAX_AMOUNT_CENTS) {
      errors.push('"amountCents" deve ser o valor em centavos, um número inteiro maior que zero.');
    } else out.amountCents = n;
  }
  if (has('status') || !partial) {
    const st = body.status ?? (partial ? undefined : 'pendente');
    if (!(BILLING_STATUSES as readonly unknown[]).includes(st)) {
      errors.push(`"status" deve ser ${BILLING_STATUSES.join(', ')}.`);
    } else out.status = st as BillingStatus;
  }
  if (has('method')) {
    if (body.method === null || body.method === '') out.method = null;
    else if (!(BILLING_METHODS as readonly unknown[]).includes(body.method)) {
      errors.push(`"method" deve ser ${BILLING_METHODS.join(', ')}.`);
    } else out.method = body.method as BillingMethod;
  }
  if (has('paidAt')) {
    if (body.paidAt === null || body.paidAt === '') out.paidAt = null;
    else {
      const d = typeof body.paidAt === 'string' ? new Date(body.paidAt) : null;
      if (!d || Number.isNaN(d.getTime())) errors.push('"paidAt" deve ser uma data (ex.: 2026-11-05).');
      else out.paidAt = d;
    }
  }
  if (has('note')) {
    if (body.note === null) out.note = null;
    else if (typeof body.note !== 'string') errors.push('"note" deve ser um texto.');
    else {
      const t = body.note.trim();
      if (t.length > NOTE_MAX) errors.push(`"note" pode ter até ${NOTE_MAX} caracteres.`);
      else out.note = t || null;
    }
  }
  if (errors.length) throw new BillingValidationError(errors);
  return out;
}

/** Data of the provider for the receipt; `missing` names the environment variables that are not set. */
export function providerView(provider: Billing | undefined) {
  const name = provider?.PROVIDER_NAME || null;
  const doc = provider?.PROVIDER_DOC || null;
  const city = provider?.PROVIDER_CITY || null;
  const missing = [
    !name ? 'BILLING_PROVIDER_NAME' : null,
    !doc ? 'BILLING_PROVIDER_DOC' : null,
    !city ? 'BILLING_PROVIDER_CITY' : null,
  ].filter(Boolean);
  return { name, doc, city, configured: missing.length === 0, missing };
}

export type PixKeyType = 'cpf' | 'cnpj' | 'email' | 'phone' | 'random';

function cpfValid(d: string): boolean {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  const digit = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return digit(9) === Number(d[9]) && digit(10) === Number(d[10]);
}

/** Normalizes a Pix key the way the DICT stores it, or null when it is not a valid key. */
export function normalizePixKey(raw: string | undefined | null): { key: string; type: PixKeyType } | null {
  const value = String(raw || '').trim();
  if (!value) return null;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
    return { key: value.toLowerCase(), type: 'random' };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 77)
    return { key: value.toLowerCase(), type: 'email' };
  if (/^\+\d{12,13}$/.test(value.replace(/[\s()-]/g, ''))) return { key: value.replace(/[\s()-]/g, ''), type: 'phone' };
  const digits = value.replace(/\D/g, '');
  if (/^[\d.\-/\s]+$/.test(value) && digits.length === 11 && cpfValid(digits)) return { key: digits, type: 'cpf' };
  if (/^[\d.\-/\s]+$/.test(value) && digits.length === 14) return { key: digits, type: 'cnpj' };
  return null;
}

/** Field of the Pix BR Code (EMV): id + two-digit length + value. */
function emv(id: string, value: string): string {
  return id + String(value.length).padStart(2, '0') + value;
}

/** CRC16-CCITT (poly 0x1021, start 0xFFFF), as the BR Code standard asks. */
export function crc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Text the BR Code accepts in name and city: no accents, only letters, digits and spaces. */
function emvText(value: string, max: number): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
}

/**
 * Static "Pix copia e cola" (BR Code of the Banco Central) for a key, with the amount when there is one. The bank app
 * shows the receiver's name and city and the amount; `txid` identifies the month in the statement.
 */
export function pixCode(input: {
  key: string;
  name: string;
  city: string;
  amountCents?: number;
  txid?: string;
}): string | null {
  const key = normalizePixKey(input.key);
  const name = emvText(input.name || '', 25);
  const city = emvText(input.city || '', 15);
  if (!key || !name || !city) return null;
  const txid =
    String(input.txid || '')
      .replace(/[^A-Za-z0-9]/g, '')
      .slice(0, 25) || '***';
  let payload =
    emv('00', '01') +
    emv('26', emv('00', 'br.gov.bcb.pix') + emv('01', key.key)) +
    emv('52', '0000') +
    emv('53', '986');
  if (input.amountCents && input.amountCents > 0) payload += emv('54', (input.amountCents / 100).toFixed(2));
  payload += emv('58', 'BR') + emv('59', name) + emv('60', city) + emv('62', emv('05', txid)) + '6304';
  return payload + crc16(payload);
}

export type PixChargeReason = 'open' | 'plan' | null;

/**
 * How the client pays: Pix key, "copia e cola" and bank transfer data. `charge` is the amount the code carries: the open
 * entries, or the plan's monthly price when the current month has no entry yet; with no amount the code still works and
 * the client types the value in the bank app.
 */
export function paymentView(
  provider: Billing | undefined,
  charge: { cents: number; period: string | null; reason?: PixChargeReason },
) {
  const pix = normalizePixKey(provider?.PIX_KEY);
  const bankName = provider?.BANK_NAME?.trim() || null;
  const account = provider?.BANK_ACCOUNT?.trim() || null;
  const bank =
    bankName && account
      ? {
          name: bankName,
          code: provider?.BANK_CODE?.trim() || null,
          branch: provider?.BANK_BRANCH?.trim() || null,
          account,
          accountType: provider?.BANK_ACCOUNT_TYPE?.trim() || null,
          holder: provider?.PROVIDER_NAME || null,
          holderDoc: provider?.PROVIDER_DOC || null,
        }
      : null;
  const cents = charge.cents > 0 ? charge.cents : 0;
  const code = pix
    ? pixCode({
        key: pix.key,
        name: provider?.PROVIDER_NAME || '',
        city: provider?.PROVIDER_CITY || '',
        amountCents: cents,
        txid: cents ? 'WHATSAI' + String(charge.period || '').replace(/\D/g, '') : undefined,
      })
    : null;
  return {
    configured: Boolean(pix || bank),
    pix: pix ? { key: pix.key, type: pix.type, holder: provider?.PROVIDER_NAME || null } : null,
    pixCode: code,
    pixAmountCents: code ? cents : 0,
    pixPeriod: code && cents ? charge.period : null,
    pixReason: (code && cents ? charge.reason || 'open' : null) as PixChargeReason,
    /** Why there is no "copia e cola": the receiver's name and city are part of the code. */
    pixMissing: pix && !code ? ['BILLING_PROVIDER_NAME', 'BILLING_PROVIDER_CITY'] : [],
    bank,
    invalidPixKey: Boolean(provider?.PIX_KEY && !pix),
  };
}

/** QR Code of the "copia e cola" as an SVG data URL (shown in an <img>, so it never runs as markup). */
export async function pixQrDataUrl(code: string | null): Promise<string | null> {
  if (!code) return null;
  try {
    const svg = await QRCode.toString(code, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    });
    return 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');
  } catch {
    return null;
  }
}

/** Month ("YYYY-MM") in Brasília time, the reference of a monthly charge. */
export function currentPeriod(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}`;
}

/** First day of the oldest period still open (pending or overdue), or null when everything is paid. */
export function oldestOpenPeriod(entries: { period: string; status: string }[]): string | null {
  const open = entries
    .filter((e) => e.status !== 'pago')
    .map((e) => e.period)
    .sort();
  return open[0] ?? null;
}

export class BillingService {
  constructor(private readonly deps: Deps) {}

  private now() {
    return (this.deps.now ?? (() => new Date()))();
  }

  /**
   * History of the instance, newest month first, with totals, the provider data for the receipts and how to pay.
   * `plan.priceCents` (the plan's monthly price) is the amount of the Pix code when nothing is open and the current
   * month has no entry yet.
   */
  public async list(instanceId: string, plan: { name?: string | null; priceCents?: number | null } = {}) {
    const entries = await this.deps.prisma.billingEntry.findMany({
      where: { instanceId },
      orderBy: [{ period: 'desc' }, { createdAt: 'desc' }],
      select: ENTRY_SELECT,
    });
    const sum = (st: BillingStatus) =>
      entries.filter((e: any) => e.status === st).reduce((t: number, e: any) => t + e.amountCents, 0);
    const openPeriod = oldestOpenPeriod(entries);
    // the most recent paid entry that actually names a payment method (a paid entry may omit it)
    const paidWithMethod = entries.filter((e: any) => e.status === 'pago' && e.method);
    return {
      entries,
      totals: { paidCents: sum('pago'), pendingCents: sum('pendente'), overdueCents: sum('atrasado') },
      openPeriod,
      // first day of the open period: the panel shows the month, not an invented due day
      nextDueDate: openPeriod ? `${openPeriod}-01` : null,
      paymentMethod: paidWithMethod.length ? paidWithMethod[0].method : null,
      provider: providerView(this.deps.provider()),
      payment: await this.payment(entries, openPeriod, sum('pendente') + sum('atrasado'), plan),
    };
  }

  private async payment(
    entries: { period: string }[],
    openPeriod: string | null,
    openCents: number,
    plan: { name?: string | null; priceCents?: number | null },
  ) {
    let charge: { cents: number; period: string | null; reason: PixChargeReason } = {
      cents: openCents,
      period: openPeriod,
      reason: openCents > 0 ? 'open' : null,
    };
    if (!openCents && plan.priceCents && plan.priceCents > 0) {
      const period = currentPeriod(this.now());
      if (!entries.some((e) => e.period === period)) charge = { cents: plan.priceCents, period, reason: 'plan' };
    }
    const view = paymentView(this.deps.provider(), charge);
    return {
      ...view,
      planName: charge.reason === 'plan' ? plan.name || null : null,
      pixQr: await pixQrDataUrl(view.pixCode),
    };
  }

  public async create(instanceId: string, input: BillingInput) {
    const data = validateBillingInput(input, false);
    if (data.status === 'pago' && !data.paidAt) data.paidAt = this.now();
    if (data.status !== 'pago') data.paidAt = null;
    const row = await this.deps.prisma.billingEntry.create({
      data: { ...data, instanceId },
      select: ENTRY_SELECT,
    });
    return data.status === 'pago' ? this.ensureReceipt(instanceId, row) : row;
  }

  public async update(instanceId: string, id: string, input: BillingInput) {
    const current = await this.find(instanceId, id);
    const data = validateBillingInput(input, true);
    if (data.status !== undefined && data.status !== 'pago' && data.paidAt === undefined) {
      // an open charge has no payment date; the receipt number, if any, stays in the history
      data.paidAt = null;
    }
    if (
      data.status === 'pago' &&
      current.status !== 'pago' &&
      (data.paidAt === undefined || data.paidAt === null) &&
      !current.paidAt
    ) {
      data.paidAt = this.now();
    }
    const row = await this.deps.prisma.billingEntry.update({
      where: { id: current.id },
      data,
      select: ENTRY_SELECT,
    });
    return row.status === 'pago' ? this.ensureReceipt(instanceId, row) : row;
  }

  public async remove(instanceId: string, id: string) {
    const current = await this.find(instanceId, id);
    await this.deps.prisma.billingEntry.delete({ where: { id: current.id } });
    return { deleted: true, id: current.id };
  }

  private async find(instanceId: string, id: string) {
    const row =
      typeof id === 'string' && id
        ? await this.deps.prisma.billingEntry.findFirst({ where: { id, instanceId }, select: ENTRY_SELECT })
        : null;
    if (!row) throw new BillingNotFoundError();
    return row;
  }

  /**
   * Gives the next receipt number to a paid entry that has none. The sequence lives in GlobalSetting and is also
   * checked against the highest number in use, so a number is never handed out twice (the unique index on
   * receiptNumber is the last guard; a collision is retried).
   */
  private async ensureReceipt(instanceId: string, row: any) {
    if (row.receiptNumber) return row;
    for (let attempt = 0; attempt < 3; attempt++) {
      const seqRow = await this.deps.prisma.globalSetting.findUnique({ where: { key: SEQ_KEY } });
      const top = await this.deps.prisma.billingEntry.aggregate({ _max: { receiptNumber: true } });
      const last = Math.max(Number(seqRow?.value?.last) || 0, Number(top?._max?.receiptNumber) || 0);
      const next = last + 1;
      try {
        const updated = await this.deps.prisma.billingEntry.update({
          where: { id: row.id },
          data: { receiptNumber: next },
          select: ENTRY_SELECT,
        });
        await this.deps.prisma.globalSetting.upsert({
          where: { key: SEQ_KEY },
          create: { key: SEQ_KEY, value: { last: next } },
          update: { value: { last: next } },
        });
        return updated;
      } catch (error: any) {
        if (error?.code !== 'P2002' || attempt === 2) throw error;
      }
    }
    return row;
  }
}
