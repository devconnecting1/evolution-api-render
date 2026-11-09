/**
 * "Processos": monitoring of court cases (CNJ DataJud) and DJEN publications by OAB number, per instance.
 *
 * Neon-friendly: the in-process ticker (every 5 min) keeps the next due time in memory and touches the database
 * only when something is due (lastCheckedAt older than checkEveryHours) or after a change made through the API.
 * Small batches (5 processes + 2 OAB numbers per run), one request at a time with pauses, timeouts, backoff on
 * 429/5xx per source, error stored on the item. Notifications only for NEW items (never on the first import),
 * held during the quiet hours. Single process (1 Render replica), like the rest of the bot.
 */
import { buildProcessContextBlock } from '@utils/processos/aiContext';
import { DATAJUD_ALIASES, extractCnjCandidates, onlyDigits, parseCnj } from '@utils/processos/cnj';
import { DATAJUD_PUBLIC_KEY, fetchDataJudProcess, FetchLike, SourceError } from '@utils/processos/datajud';
import { fetchDjenByOab } from '@utils/processos/djen';
import {
  clientMessageText,
  DEFAULT_CLIENT_TEMPLATE,
  isQuietNow,
  normalizeNotifyNumber,
  normalizeQuietHours,
  quietEndsAt,
  QuietHours,
  teamMovementText,
  teamPublicationText,
  validateClientTemplate,
} from '@utils/processos/notify';

export class ProcessosError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type ProcessSettingsView = {
  enabled: boolean;
  checkEveryHours: number;
  djenDays: number;
  notifyNumbers: string[];
  quietHours: QuietHours;
  clientMessageTemplate: string;
};

export type ProcessosOptions = {
  fetchImpl?: FetchLike;
  datajudApiKey?: string;
  datajudBaseUrl?: string;
  djenBaseUrl?: string;
  /** Pause between two external requests of a run (ms). */
  pauseMs?: number;
  now?: () => Date;
  logger?: { log?: (m: string) => void; warn?: (m: string) => void; error?: (m: string) => void };
};

const BATCH_PROCESSES = 5;
const BATCH_OAB = 2;
const TICK_MS = 5 * 60_000;
const HOUR = 3600_000;
const MANUAL_SYNC_MIN_MS = 60_000;
const MANUAL_SYNC_PER_HOUR = 30;
const CLIENT_NOTICE_MIN_MS = 20 * HOUR;
const PENDING_EXPIRES_MS = 3 * 24 * HOUR;
const MAX_LIST = 1000;

const DEFAULT_SETTINGS: ProcessSettingsView = {
  enabled: false,
  checkEveryHours: 6,
  djenDays: 7,
  notifyNumbers: [],
  quietHours: normalizeQuietHours(null),
  clientMessageTemplate: DEFAULT_CLIENT_TEMPLATE,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const clip = (value: unknown, max: number): string | null => {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : null;
};

/**
 * Stored form of the contact the team links to a process: "<digits>@s.whatsapp.net" or a full @lid JID.
 * null = unlink, undefined = invalid.
 */
export function normalizeLinkedJid(value: unknown): string | null | undefined {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (/@lid$/.test(text) && /^\d{5,20}@lid$/.test(text)) return text;
  const digits = onlyDigits(text.split('@')[0]);
  if (digits.length < 10 || digits.length > 15) return undefined;
  return `${digits}@s.whatsapp.net`;
}

/** JIDs that are the same WhatsApp number (BR numbers with and without the 9th digit). Never other numbers. */
export function jidVariants(remoteJid: string): string[] {
  if (!remoteJid) return [];
  if (remoteJid.endsWith('@lid')) return [remoteJid];
  const digits = onlyDigits(remoteJid.split('@')[0]);
  if (!digits) return [];
  const out = new Set([`${digits}@s.whatsapp.net`]);
  if (digits.startsWith('55') && digits.length === 13 && digits[4] === '9') {
    out.add(`${digits.slice(0, 4)}${digits.slice(5)}@s.whatsapp.net`);
  } else if (digits.startsWith('55') && digits.length === 12) {
    out.add(`${digits.slice(0, 4)}9${digits.slice(4)}@s.whatsapp.net`);
  }
  return [...out];
}

export function processStatus(
  row: { initialized?: boolean; lastError?: string | null; errorCount?: number },
  unseen: number,
) {
  if (row.lastError && (row.errorCount ?? 0) > 0) return 'erro';
  if (unseen > 0) return 'novidade';
  if (!row.initialized) return 'aguardando';
  return 'em_dia';
}

const csvCell = (value: unknown) => {
  const text = value == null ? '' : value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export class ProcessosService {
  private readonly fetchImpl?: FetchLike;
  private readonly now: () => Date;
  private readonly pauseMs: number;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<any> | null = null;
  /** In-memory next due moment: 0 = check the database on the next run. */
  private nextDueAt = 0;
  private pendingMayExist = true;
  private readonly backoff: Record<'datajud' | 'djen', { until: number; level: number }> = {
    datajud: { until: 0, level: 0 },
    djen: { until: 0, level: 0 },
  };
  private readonly manualSyncs = new Map<string, number[]>();
  private readonly importQueue: string[] = [];
  private importing = false;
  private readonly settingsCache = new Map<string, { at: number; value: ProcessSettingsView }>();

  constructor(
    private readonly prisma: any,
    private readonly waMonitor: { waInstances: Record<string, any> },
    private readonly options: ProcessosOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl;
    this.now = options.now ?? (() => new Date());
    this.pauseMs = options.pauseMs ?? 1500;
  }

  private log(level: 'log' | 'warn' | 'error', message: string) {
    this.options.logger?.[level]?.(`[Processos] ${message}`);
  }

  // ------------------------------------------------------------------------------------------- instance + settings

  async instanceByName(name: string): Promise<{ id: string; name: string }> {
    const row = await this.prisma.instance.findUnique({ where: { name }, select: { id: true, name: true } });
    if (!row) throw new ProcessosError(404, `A instância "${name}" não existe.`);
    return row;
  }

  toSettingsView(row: any): ProcessSettingsView {
    if (!row) return { ...DEFAULT_SETTINGS, quietHours: { ...DEFAULT_SETTINGS.quietHours } };
    const numbers = Array.isArray(row.notifyNumbers)
      ? row.notifyNumbers.map(normalizeNotifyNumber).filter(Boolean)
      : [];
    return {
      enabled: row.enabled === true,
      checkEveryHours: Number(row.checkEveryHours) || DEFAULT_SETTINGS.checkEveryHours,
      djenDays: Number(row.djenDays) || DEFAULT_SETTINGS.djenDays,
      notifyNumbers: [...new Set<string>(numbers)],
      quietHours: normalizeQuietHours(row.quietHours),
      clientMessageTemplate:
        row.clientMessageTemplate && !validateClientTemplate(row.clientMessageTemplate)
          ? row.clientMessageTemplate
          : DEFAULT_CLIENT_TEMPLATE,
    };
  }

  async getSettings(instanceId: string): Promise<ProcessSettingsView & { configured: boolean }> {
    const row = await this.prisma.processSettings.findUnique({ where: { instanceId } });
    return { configured: !!row, ...this.toSettingsView(row) };
  }

  async saveSettings(instanceId: string, input: Record<string, any>) {
    const errors: string[] = [];
    const data: Record<string, any> = {};
    if (input.enabled !== undefined) data.enabled = input.enabled === true;
    if (input.checkEveryHours !== undefined) {
      const n = Number(input.checkEveryHours);
      if (!Number.isInteger(n) || n < 2 || n > 48) errors.push('Verificar a cada: use de 2 a 48 horas.');
      else data.checkEveryHours = n;
    }
    if (input.djenDays !== undefined) {
      const n = Number(input.djenDays);
      if (!Number.isInteger(n) || n < 1 || n > 30) errors.push('Dias do DJEN: use de 1 a 30.');
      else data.djenDays = n;
    }
    if (input.notifyNumbers !== undefined) {
      const list = Array.isArray(input.notifyNumbers) ? input.notifyNumbers : [];
      const numbers = list.map(normalizeNotifyNumber);
      if (numbers.some((n: string | null) => !n))
        errors.push('Números da equipe: use DDI + DDD + número (ex.: 5521999990000).');
      if (list.length > 10) errors.push('Números da equipe: no máximo 10.');
      data.notifyNumbers = [...new Set(numbers.filter(Boolean))];
    }
    if (input.quietHours !== undefined) data.quietHours = normalizeQuietHours(input.quietHours);
    if (input.clientMessageTemplate !== undefined) {
      const problem = validateClientTemplate(input.clientMessageTemplate);
      if (problem) errors.push(problem);
      else data.clientMessageTemplate = input.clientMessageTemplate ? String(input.clientMessageTemplate) : null;
    }
    if (errors.length) throw new ProcessosError(400, errors.join(' '));

    const previous = await this.prisma.processSettings.findUnique({ where: { instanceId } });
    const row = await this.prisma.processSettings.upsert({
      where: { instanceId },
      create: { instanceId, ...data },
      update: data,
    });
    this.settingsCache.delete(instanceId);
    this.invalidate();
    return { previous: previous ? this.toSettingsView(previous) : null, settings: this.toSettingsView(row) };
  }

  private async cachedSettings(instanceId: string): Promise<ProcessSettingsView> {
    const hit = this.settingsCache.get(instanceId);
    if (hit && this.now().getTime() - hit.at < 60_000) return hit.value;
    const value = this.toSettingsView(await this.prisma.processSettings.findUnique({ where: { instanceId } }));
    this.settingsCache.set(instanceId, { at: this.now().getTime(), value });
    return value;
  }

  // ------------------------------------------------------------------------------------------------- processes

  private view(row: any) {
    const unseen = row._count?.ProcessMovement ?? 0;
    const last = row.ProcessMovement?.[0] ?? null;
    const { _count, ProcessMovement, ...rest } = row;
    void _count;
    void ProcessMovement;
    return {
      ...rest,
      unseen,
      lastMovement: last ? { occurredAt: last.occurredAt, name: last.name } : null,
      status: processStatus(row, unseen),
    };
  }

  async list(instanceId: string, filters: Record<string, any> = {}) {
    const rows = await this.prisma.process.findMany({
      where: { instanceId },
      orderBy: [{ lastMovementAt: 'desc' }, { createdAt: 'desc' }],
      take: MAX_LIST,
      include: {
        _count: { select: { ProcessMovement: { where: { seenAt: null } } } },
        ProcessMovement: { orderBy: { occurredAt: 'desc' }, take: 1, select: { occurredAt: true, name: true } },
      },
    });
    const all = rows.map((row: any) => this.view(row));
    const counts = {
      all: all.filter((p: any) => p.active).length,
      news: all.filter((p: any) => p.active && p.unseen > 0).length,
      archived: all.filter((p: any) => !p.active).length,
      errors: all.filter((p: any) => p.active && p.status === 'erro').length,
    };

    const viewName = ['news', 'archived'].includes(filters.view) ? filters.view : 'all';
    const q = String(filters.q ?? '')
      .trim()
      .toLowerCase();
    const qDigits = onlyDigits(q);
    const tribunal = String(filters.tribunal ?? '')
      .trim()
      .toLowerCase();
    const from = filters.from ? new Date(String(filters.from)) : null;
    const to = filters.to ? new Date(`${String(filters.to).slice(0, 10)}T23:59:59Z`) : null;

    const items = all.filter((p: any) => {
      if (viewName === 'archived' ? p.active : !p.active) return false;
      if (viewName === 'news' && p.unseen === 0) return false;
      if (tribunal && p.tribunalAlias !== tribunal) return false;
      if (from && !Number.isNaN(from.getTime()) && (!p.lastMovementAt || p.lastMovementAt < from)) return false;
      if (to && !Number.isNaN(to.getTime()) && (!p.lastMovementAt || p.lastMovementAt > to)) return false;
      if (q) {
        const hay = [p.apelido, p.clientName, p.classe, p.orgaoJulgador, p.numeroCnj].join(' ').toLowerCase();
        if (!hay.includes(q) && !(qDigits.length >= 4 && p.numeroDigits.includes(qDigits))) return false;
      }
      return true;
    });

    const unseenPublications = await this.prisma.publication.count({ where: { instanceId, seenAt: null } });
    return {
      items,
      counts: { ...counts, unseenPublications },
      tribunals: [...new Set(all.map((p: any) => p.tribunalAlias))].sort(),
    };
  }

  async badge(instanceId: string) {
    const [processes, publications] = await Promise.all([
      this.prisma.process.count({ where: { instanceId, active: true, ProcessMovement: { some: { seenAt: null } } } }),
      this.prisma.publication.count({ where: { instanceId, seenAt: null } }),
    ]);
    return { processesWithNews: processes, unseenPublications: publications, total: processes + publications };
  }

  private async findOwned(instanceId: string, id: string) {
    const row = await this.prisma.process.findFirst({ where: { id, instanceId } });
    if (!row) throw new ProcessosError(404, 'Processo não encontrado nesta instância.');
    return row;
  }

  async get(instanceId: string, id: string, movementsLimit = 200) {
    await this.findOwned(instanceId, id);
    const row = await this.prisma.process.findFirst({
      where: { id, instanceId },
      include: {
        _count: { select: { ProcessMovement: { where: { seenAt: null } } } },
        ProcessMovement: { orderBy: { occurredAt: 'desc' }, take: Math.min(Math.max(1, movementsLimit), 500) },
        Publication: {
          orderBy: { disponibilizadaEm: 'desc' },
          take: 20,
          select: { id: true, siglaTribunal: true, tipo: true, disponibilizadaEm: true, link: true, seenAt: true },
        },
      },
    });
    const movements = row.ProcessMovement.map((m: any) => ({
      id: m.id,
      occurredAt: m.occurredAt,
      code: m.code,
      name: m.name,
      complement: m.complement,
      seen: !!m.seenAt,
    }));
    const unseen = row._count?.ProcessMovement ?? 0;
    const { _count, ProcessMovement, Publication, ...rest } = row;
    void _count;
    void ProcessMovement;
    return { ...rest, unseen, status: processStatus(row, unseen), movements, publications: Publication };
  }

  private validatePatch(input: Record<string, any>, errors: string[]) {
    const data: Record<string, any> = {};
    for (const [key, max] of [
      ['apelido', 120],
      ['clientName', 120],
    ] as const) {
      if (input[key] !== undefined) data[key] = clip(input[key], max);
    }
    if (input.remoteJid !== undefined) {
      const jid = normalizeLinkedJid(input.remoteJid);
      if (jid === undefined) errors.push('Contato: use o número com DDI e DDD (ex.: 5521999990000).');
      else data.remoteJid = jid;
    }
    if (input.tribunalAlias !== undefined && input.tribunalAlias !== null && input.tribunalAlias !== '') {
      const alias = String(input.tribunalAlias).trim().toLowerCase();
      if (!DATAJUD_ALIASES.includes(alias)) errors.push(`Tribunal "${alias}" não existe na API pública do DataJud.`);
      else data.tribunalAlias = alias;
    }
    for (const key of ['active', 'notifyTeam', 'notifyClient', 'allowAiAnswer', 'segredoJustica']) {
      if (input[key] !== undefined) data[key] = input[key] === true;
    }
    return data;
  }

  async add(instanceId: string, input: Record<string, any>) {
    const parsed = parseCnj(input.numero);
    if (parsed.ok === false) throw new ProcessosError(400, parsed.error);
    const errors: string[] = [];
    const data = this.validatePatch(input, errors);
    const alias = data.tribunalAlias ?? parsed.alias;
    if (!alias) errors.push('Não foi possível identificar o tribunal pelo número: informe o tribunal (ex.: tjrj).');
    if (errors.length) throw new ProcessosError(400, errors.join(' '));

    const existing = await this.prisma.process.findUnique({
      where: { instanceId_numeroDigits: { instanceId, numeroDigits: parsed.digits } },
    });
    if (existing) throw new ProcessosError(409, `O processo ${parsed.formatted} já está na lista.`);

    const row = await this.prisma.process.create({
      data: { ...data, instanceId, numeroCnj: parsed.formatted, numeroDigits: parsed.digits, tribunalAlias: alias },
    });
    this.enqueueImport([row.id]);
    return row;
  }

  /** Pasted list: one or many numbers per line. Max 200 per call. */
  async bulkAdd(instanceId: string, text: string, defaults: Record<string, any> = {}) {
    const candidates = extractCnjCandidates(text);
    const unrecognized = String(text ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !extractCnjCandidates(line).length)
      .slice(0, 50);
    if (candidates.length > 200) throw new ProcessosError(400, 'No máximo 200 processos por vez.');

    const invalid: { input: string; error: string }[] = unrecognized.map((input) => ({
      input,
      error: 'Nenhum número CNJ reconhecido nesta linha.',
    }));
    const valid: { digits: string; formatted: string; alias: string }[] = [];
    for (const candidate of candidates) {
      const parsed = parseCnj(candidate);
      if (parsed.ok === false) invalid.push({ input: parsed.input, error: parsed.error });
      else if (!parsed.alias) invalid.push({ input: candidate, error: 'Tribunal não identificado pelo número.' });
      else valid.push({ digits: parsed.digits, formatted: parsed.formatted, alias: parsed.alias });
    }

    const existing = valid.length
      ? await this.prisma.process.findMany({
          where: { instanceId, numeroDigits: { in: valid.map((v) => v.digits) } },
          select: { numeroDigits: true, numeroCnj: true },
        })
      : [];
    const known = new Set(existing.map((e: any) => e.numeroDigits));
    const fresh = valid.filter((v) => !known.has(v.digits));
    const errors: string[] = [];
    const patch = this.validatePatch({ notifyTeam: defaults.notifyTeam }, errors);

    if (fresh.length) {
      await this.prisma.process.createMany({
        data: fresh.map((v) => ({
          ...patch,
          instanceId,
          numeroCnj: v.formatted,
          numeroDigits: v.digits,
          tribunalAlias: v.alias,
        })),
        skipDuplicates: true,
      });
      const created = await this.prisma.process.findMany({
        where: { instanceId, numeroDigits: { in: fresh.map((v) => v.digits) } },
        select: { id: true },
      });
      this.enqueueImport(created.map((c: any) => c.id));
    }
    return {
      added: fresh.map((v) => v.formatted),
      duplicates: existing.map((e: any) => e.numeroCnj),
      invalid,
    };
  }

  async update(instanceId: string, id: string, input: Record<string, any>) {
    const before = await this.findOwned(instanceId, id);
    const errors: string[] = [];
    const data = this.validatePatch(input, errors);
    if (errors.length) throw new ProcessosError(400, errors.join(' '));
    if (data.notifyClient === true && !(data.remoteJid ?? before.remoteJid)) {
      throw new ProcessosError(
        400,
        'Para avisar o cliente, vincule antes o contato (WhatsApp) do cliente ao processo.',
      );
    }
    if (data.allowAiAnswer === true && !(data.remoteJid ?? before.remoteJid)) {
      throw new ProcessosError(400, 'Para a IA responder, vincule antes o contato (WhatsApp) do cliente ao processo.');
    }
    // Unlinking the contact turns off everything that depends on it
    if ('remoteJid' in data && !data.remoteJid) {
      data.notifyClient = false;
      data.allowAiAnswer = false;
    }
    const row = await this.prisma.process.update({ where: { id }, data });
    if (data.active === true) this.invalidate();
    return row;
  }

  async remove(instanceId: string, id: string) {
    await this.findOwned(instanceId, id);
    await this.prisma.process.delete({ where: { id } });
    return { deleted: true };
  }

  async markSeen(instanceId: string, id: string) {
    await this.findOwned(instanceId, id);
    const { count } = await this.prisma.processMovement.updateMany({
      where: { processId: id, seenAt: null },
      data: { seenAt: this.now() },
    });
    return { marked: count };
  }

  async manualSync(instanceId: string, id: string) {
    const row = await this.findOwned(instanceId, id);
    const now = this.now().getTime();
    const key = instanceId;
    const recent = (this.manualSyncs.get(key) ?? []).filter((t) => now - t < HOUR);
    const lastOfThis = this.manualSyncs.get(`p:${id}`)?.[0] ?? 0;
    if (now - lastOfThis < MANUAL_SYNC_MIN_MS) {
      throw new ProcessosError(429, 'Este processo acabou de ser consultado. Tente de novo em 1 minuto.');
    }
    if (recent.length >= MANUAL_SYNC_PER_HOUR) {
      throw new ProcessosError(429, 'Muitas consultas manuais nesta hora. Tente de novo mais tarde.');
    }
    this.manualSyncs.set(key, [...recent, now]);
    this.manualSyncs.set(`p:${id}`, [now]);
    if (this.backoff.datajud.until > now) {
      throw new ProcessosError(503, 'O DataJud está instável: nova tentativa automática em alguns minutos.');
    }
    const settings = await this.cachedSettings(instanceId);
    const result = await this.syncProcess(row, settings);
    if (result.created > 0) this.pendingMayExist = true;
    return { result, process: await this.get(instanceId, id, 50) };
  }

  async exportCsv(instanceId: string): Promise<string> {
    const { items } = await this.list(instanceId, {});
    const archived = (await this.list(instanceId, { view: 'archived' })).items;
    const header = [
      'Processo',
      'Apelido',
      'Cliente',
      'Tribunal',
      'Classe',
      'Assuntos',
      'Órgão julgador',
      'Ajuizamento',
      'Última movimentação',
      'Data da última movimentação',
      'Atualizado em',
      'Situação',
      'Arquivado',
    ];
    const labels: Record<string, string> = {
      em_dia: 'Em dia',
      novidade: 'Nova movimentação',
      erro: 'Erro',
      aguardando: 'Aguardando consulta',
    };
    const lines = [...items, ...archived].map((p: any) =>
      [
        p.numeroCnj,
        p.apelido,
        p.clientName,
        p.tribunalAlias.toUpperCase(),
        p.classe,
        p.assuntos,
        p.orgaoJulgador,
        p.dataAjuizamento,
        p.lastMovement?.name,
        p.lastMovement?.occurredAt,
        p.lastSyncedAt,
        labels[p.status] ?? p.status,
        p.active ? 'não' : 'sim',
      ]
        .map(csvCell)
        .join(';'),
    );
    return '﻿' + [header.join(';'), ...lines].join('\r\n') + '\r\n';
  }

  // --------------------------------------------------------------------------------------------- OAB + DJEN

  async listOab(instanceId: string) {
    return this.prisma.oabWatch.findMany({ where: { instanceId }, orderBy: { createdAt: 'asc' } });
  }

  private parseOab(input: Record<string, any>) {
    const numeroOab = String(input.numeroOab ?? '')
      .trim()
      .toUpperCase()
      .replace(/[^0-9A-Z]/g, '');
    const ufOab = String(input.ufOab ?? '')
      .trim()
      .toUpperCase();
    if (!/^\d{1,8}[A-Z]?$/.test(numeroOab))
      throw new ProcessosError(400, 'Número da OAB inválido (ex.: 123456 ou 123456A).');
    if (!/^[A-Z]{2}$/.test(ufOab)) throw new ProcessosError(400, 'UF da OAB inválida (ex.: RJ).');
    return { numeroOab, ufOab };
  }

  async addOab(instanceId: string, input: Record<string, any>) {
    const { numeroOab, ufOab } = this.parseOab(input);
    const existing = await this.prisma.oabWatch.findUnique({
      where: { instanceId_numeroOab_ufOab: { instanceId, numeroOab, ufOab } },
    });
    if (existing) throw new ProcessosError(409, `A OAB ${numeroOab}/${ufOab} já está sendo acompanhada.`);
    const row = await this.prisma.oabWatch.create({
      data: { instanceId, numeroOab, ufOab, label: clip(input.label, 120) },
    });
    this.invalidate();
    return row;
  }

  async updateOab(instanceId: string, id: string, input: Record<string, any>) {
    const row = await this.prisma.oabWatch.findFirst({ where: { id, instanceId } });
    if (!row) throw new ProcessosError(404, 'OAB não encontrada nesta instância.');
    const data: Record<string, any> = {};
    if (input.active !== undefined) data.active = input.active === true;
    if (input.label !== undefined) data.label = clip(input.label, 120);
    this.invalidate();
    return this.prisma.oabWatch.update({ where: { id }, data });
  }

  async removeOab(instanceId: string, id: string) {
    const row = await this.prisma.oabWatch.findFirst({ where: { id, instanceId } });
    if (!row) throw new ProcessosError(404, 'OAB não encontrada nesta instância.');
    await this.prisma.oabWatch.delete({ where: { id } });
    return { deleted: true };
  }

  async listPublications(instanceId: string, filters: Record<string, any> = {}) {
    const where: Record<string, any> = { instanceId };
    if (filters.unseen === true || filters.unseen === 'true' || filters.unseen === '1') where.seenAt = null;
    if (filters.tribunal) where.siglaTribunal = String(filters.tribunal).toUpperCase();
    if (filters.processId) where.linkedProcessId = String(filters.processId);
    const range: Record<string, Date> = {};
    if (filters.from && !Number.isNaN(new Date(filters.from).getTime())) range.gte = new Date(filters.from);
    if (filters.to && !Number.isNaN(new Date(filters.to).getTime()))
      range.lte = new Date(`${String(filters.to).slice(0, 10)}T23:59:59Z`);
    if (Object.keys(range).length) where.disponibilizadaEm = range;
    const page = Math.max(1, Number(filters.page) || 1);
    const take = Math.min(100, Math.max(1, Number(filters.limit) || 50));
    const [total, rows] = await Promise.all([
      this.prisma.publication.count({ where }),
      this.prisma.publication.findMany({
        where,
        orderBy: [{ disponibilizadaEm: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * take,
        take,
        include: {
          OabWatch: { select: { numeroOab: true, ufOab: true, label: true } },
          Process: { select: { id: true, apelido: true, numeroCnj: true } },
        },
      }),
    ]);
    return { total, page, pages: Math.max(1, Math.ceil(total / take)), items: rows };
  }

  async markPublicationsSeen(instanceId: string, input: { ids?: string[]; all?: boolean }) {
    const where: Record<string, any> = { instanceId, seenAt: null };
    if (!input.all) {
      const ids = Array.isArray(input.ids) ? input.ids.map(String).slice(0, 500) : [];
      if (!ids.length) throw new ProcessosError(400, 'Informe as publicações (ids) ou all: true.');
      where.id = { in: ids };
    }
    const { count } = await this.prisma.publication.updateMany({ where, data: { seenAt: this.now() } });
    return { marked: count };
  }

  // ------------------------------------------------------------------------------------------------ sync engine

  private sourceBlocked(source: 'datajud' | 'djen') {
    return this.backoff[source].until > this.now().getTime();
  }

  private noteSource(source: 'datajud' | 'djen', error?: SourceError) {
    const b = this.backoff[source];
    if (!error) {
      b.level = 0;
      b.until = 0;
      return;
    }
    if (!error.retryable) return;
    b.level = Math.min(b.level + 1, 7);
    b.until = this.now().getTime() + Math.min(60, 2 ** (b.level - 1)) * 60_000;
  }

  private sourceOptions() {
    return {
      fetchImpl: this.fetchImpl,
      apiKey: this.options.datajudApiKey || DATAJUD_PUBLIC_KEY,
      baseUrl: this.options.datajudBaseUrl,
    };
  }

  /** One DataJud query + 3 small queries. First successful import: stored as seen, never notified. */
  async syncProcess(row: any, settings: ProcessSettingsView) {
    const now = this.now();
    let parsed: Awaited<ReturnType<typeof fetchDataJudProcess>>;
    try {
      parsed = await fetchDataJudProcess(row.tribunalAlias, row.numeroDigits, this.sourceOptions());
      this.noteSource('datajud');
    } catch (error) {
      const message = error instanceof SourceError ? error.message : 'Falha ao consultar o DataJud.';
      if (error instanceof SourceError) this.noteSource('datajud', error);
      else this.log('error', `DataJud ${row.numeroCnj}: ${error?.message ?? error}`);
      await this.prisma.process.update({
        where: { id: row.id },
        data: { lastCheckedAt: now, lastError: message.slice(0, 300), errorCount: { increment: 1 } },
      });
      return { ok: false, created: 0, error: message };
    }

    if (!parsed.found) {
      const message =
        'Não encontrado no DataJud: o tribunal pode ainda não ter enviado, o processo pode estar em segredo de justiça ou em outro tribunal (ajuste o tribunal).';
      await this.prisma.process.update({
        where: { id: row.id },
        data: { lastCheckedAt: now, lastError: message.slice(0, 300), errorCount: { increment: 1 } },
      });
      return { ok: false, created: 0, error: message };
    }

    const first = !row.initialized;
    const known = new Set(
      (await this.prisma.processMovement.findMany({ where: { processId: row.id }, select: { hash: true } })).map(
        (m: any) => m.hash,
      ),
    );
    const fresh = parsed.movements.filter((m) => !known.has(m.hash));
    const segredo = row.segredoJustica || parsed.sigilo;
    const notify = !first && settings.enabled && (row.notifyTeam || (row.notifyClient && row.remoteJid && !segredo));
    if (fresh.length) {
      await this.prisma.processMovement.createMany({
        data: fresh.map((m) => ({
          processId: row.id,
          occurredAt: m.occurredAt,
          code: m.code,
          name: m.name,
          complement: m.complement,
          hash: m.hash,
          seenAt: first ? now : null,
          notifyStatus: notify ? 'pending' : 'none',
        })),
        skipDuplicates: true,
      });
    }
    const latest = parsed.movements[0]?.occurredAt ?? null;
    await this.prisma.process.update({
      where: { id: row.id },
      data: {
        classe: parsed.classe,
        assuntos: parsed.assuntos,
        orgaoJulgador: parsed.orgaoJulgador,
        dataAjuizamento: parsed.dataAjuizamento,
        lastMovementAt: latest && (!row.lastMovementAt || latest > row.lastMovementAt) ? latest : row.lastMovementAt,
        lastCheckedAt: now,
        lastSyncedAt: now,
        lastError: null,
        errorCount: 0,
        initialized: true,
        segredoJustica: segredo,
      },
    });
    if (notify && fresh.length) this.pendingMayExist = true;
    return { ok: true, created: fresh.length, first, notified: notify ? fresh.length : 0 };
  }

  async syncOab(watch: any, settings: ProcessSettingsView) {
    const now = this.now();
    const first = !watch.initialized;
    const from = new Date(now.getTime() - (first ? 30 : settings.djenDays) * 24 * HOUR);
    let items: Awaited<ReturnType<typeof fetchDjenByOab>>;
    try {
      items = await fetchDjenByOab(
        { numeroOab: watch.numeroOab, ufOab: watch.ufOab, from, to: now },
        { fetchImpl: this.fetchImpl, baseUrl: this.options.djenBaseUrl, pauseMs: this.pauseMs },
      );
      this.noteSource('djen');
    } catch (error) {
      const message = error instanceof SourceError ? error.message : 'Falha ao consultar o DJEN.';
      if (error instanceof SourceError) this.noteSource('djen', error);
      else this.log('error', `DJEN ${watch.numeroOab}/${watch.ufOab}: ${error?.message ?? error}`);
      await this.prisma.oabWatch.update({
        where: { id: watch.id },
        data: { lastCheckedAt: now, lastError: message.slice(0, 300), errorCount: { increment: 1 } },
      });
      return { ok: false, created: 0, error: message };
    }

    const ids = [...new Set(items.map((i) => i.externalId))];
    const existing = ids.length
      ? await this.prisma.publication.findMany({
          where: { instanceId: watch.instanceId, externalId: { in: ids } },
          select: { externalId: true },
        })
      : [];
    const known = new Set(existing.map((e: any) => e.externalId));
    const seenIds = new Set<string>();
    const fresh = items.filter(
      (i) => !known.has(i.externalId) && !seenIds.has(i.externalId) && seenIds.add(i.externalId),
    );

    let created = 0;
    if (fresh.length) {
      const digits = [...new Set(fresh.map((i) => i.processDigits).filter(Boolean))];
      const linked = digits.length
        ? await this.prisma.process.findMany({
            where: { instanceId: watch.instanceId, numeroDigits: { in: digits } },
            select: { id: true, numeroDigits: true },
          })
        : [];
      const byDigits = new Map(linked.map((p: any) => [p.numeroDigits, p.id]));
      const notify = !first && settings.enabled;
      const result = await this.prisma.publication.createMany({
        data: fresh.map((i) => ({
          instanceId: watch.instanceId,
          oabWatchId: watch.id,
          externalId: i.externalId,
          processNumber: i.processNumber,
          processDigits: i.processDigits,
          siglaTribunal: i.siglaTribunal,
          tipo: i.tipo,
          orgao: i.orgao,
          disponibilizadaEm: i.disponibilizadaEm,
          texto: i.texto,
          link: i.link,
          linkedProcessId: (i.processDigits && byDigits.get(i.processDigits)) || null,
          seenAt: first ? now : null,
          notifyStatus: notify ? 'pending' : 'none',
        })),
        skipDuplicates: true,
      });
      created = result?.count ?? fresh.length;
      if (notify && created) this.pendingMayExist = true;
    }
    await this.prisma.oabWatch.update({
      where: { id: watch.id },
      data: { lastCheckedAt: now, lastError: null, errorCount: 0, initialized: true },
    });
    return { ok: true, created, first };
  }

  private enqueueImport(ids: string[]) {
    this.importQueue.push(...ids);
    if (this.importing) return;
    this.importing = true;
    void (async () => {
      try {
        while (this.importQueue.length) {
          const id = this.importQueue.shift();
          if (this.sourceBlocked('datajud')) break;
          const row = await this.prisma.process.findUnique({ where: { id } }).catch(() => null);
          if (!row || row.initialized) continue;
          await this.syncProcess(row, await this.cachedSettings(row.instanceId)).catch((error) =>
            this.log('error', `import ${id}: ${error?.message ?? error}`),
          );
          if (this.importQueue.length) await sleep(this.pauseMs);
        }
      } finally {
        this.importQueue.length = 0;
        this.importing = false;
        this.invalidate();
      }
    })();
  }

  /** Forget the cached next due time: the next run checks the database. */
  invalidate() {
    this.nextDueAt = 0;
  }

  /** One run (ticker or POST /processos/tick). `force` skips the in-memory due time. Never two at once. */
  async tick(options: { force?: boolean } = {}) {
    if (this.running) return { skipped: 'running' };
    const now = this.now().getTime();
    if (!options.force && this.nextDueAt > now) {
      return { skipped: 'not-due', nextDueAt: new Date(this.nextDueAt).toISOString() };
    }
    this.running = this.runTick().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async runTick() {
    const summary = { processes: 0, publications: 0, newMovements: 0, newPublications: 0, notifications: 0, errors: 0 };
    const enabledRows = await this.prisma.processSettings.findMany({ where: { enabled: true } });
    const nowDate = this.now();
    const now = nowDate.getTime();
    if (!enabledRows.length) {
      this.nextDueAt = now + 6 * HOUR;
      return { ...summary, nextDueAt: new Date(this.nextDueAt).toISOString() };
    }
    const settingsById = new Map<string, ProcessSettingsView>(
      enabledRows.map((row: any) => [row.instanceId, this.toSettingsView(row)]),
    );
    const dueWhere = (hoursOf: (s: ProcessSettingsView) => number) =>
      [...settingsById.entries()].flatMap(([instanceId, s]) => [
        { instanceId, lastCheckedAt: null },
        { instanceId, lastCheckedAt: { lt: new Date(now - hoursOf(s) * HOUR) } },
      ]);

    let full = false;
    if (!this.sourceBlocked('datajud')) {
      const due = await this.prisma.process.findMany({
        where: { active: true, OR: dueWhere((s) => s.checkEveryHours) },
        orderBy: { lastCheckedAt: { sort: 'asc', nulls: 'first' } },
        take: BATCH_PROCESSES,
      });
      full = due.length === BATCH_PROCESSES;
      for (const [k, row] of due.entries()) {
        if (this.sourceBlocked('datajud')) break;
        const result = await this.syncProcess(row, settingsById.get(row.instanceId));
        summary.processes++;
        summary.newMovements += result.ok && !result.first ? result.created : 0;
        if (!result.ok) summary.errors++;
        if (k < due.length - 1) await sleep(this.pauseMs);
      }
    }
    if (!this.sourceBlocked('djen')) {
      const due = await this.prisma.oabWatch.findMany({
        where: { active: true, OR: dueWhere((s) => s.checkEveryHours) },
        orderBy: { lastCheckedAt: { sort: 'asc', nulls: 'first' } },
        take: BATCH_OAB,
      });
      full = full || due.length === BATCH_OAB;
      for (const watch of due) {
        if (this.sourceBlocked('djen')) break;
        const result = await this.syncOab(watch, settingsById.get(watch.instanceId));
        summary.publications++;
        summary.newPublications += result.ok && !result.first ? result.created : 0;
        if (!result.ok) summary.errors++;
        await sleep(this.pauseMs);
      }
    }

    let heldUntil = Infinity;
    if (this.pendingMayExist) {
      const dispatched = await this.dispatch(settingsById);
      summary.notifications = dispatched.sent;
      heldUntil = dispatched.heldUntil;
      this.pendingMayExist = dispatched.held > 0;
    }

    this.nextDueAt = full ? now + 60_000 : Math.min(await this.computeNextDue(settingsById), heldUntil);
    return { ...summary, nextDueAt: new Date(this.nextDueAt).toISOString() };
  }

  private async computeNextDue(settingsById: Map<string, ProcessSettingsView>): Promise<number> {
    const now = this.now().getTime();
    let next = now + 6 * HOUR;
    for (const [instanceId, s] of settingsById.entries()) {
      for (const model of ['process', 'oabWatch']) {
        const oldest = await this.prisma[model].findFirst({
          where: { instanceId, active: true },
          orderBy: { lastCheckedAt: { sort: 'asc', nulls: 'first' } },
          select: { lastCheckedAt: true },
        });
        if (!oldest) continue;
        const due = oldest.lastCheckedAt ? new Date(oldest.lastCheckedAt).getTime() + s.checkEveryHours * HOUR : now;
        next = Math.min(next, due);
      }
    }
    for (const source of ['datajud', 'djen'] as const) {
      if (this.backoff[source].until > now) next = Math.max(next, Math.min(this.backoff[source].until, next + HOUR));
    }
    return Math.max(next, now + 60_000);
  }

  // ------------------------------------------------------------------------------------------------ notifications

  private channelOf(instanceName: string) {
    const channel = this.waMonitor?.waInstances?.[instanceName];
    return channel && channel.connectionStatus?.state === 'open' ? channel : null;
  }

  private async send(channel: any, number: string, text: string) {
    await channel.textMessage({ number, text, delay: 0, linkPreview: false }, false, true);
  }

  private async notifyClient(channel: any, process: any, settings: ProcessSettingsView): Promise<boolean> {
    if (!process.notifyClient || !process.remoteJid || process.segredoJustica) return false;
    const last = process.lastClientNotice ? new Date(process.lastClientNotice).getTime() : 0;
    if (this.now().getTime() - last < CLIENT_NOTICE_MIN_MS) return false;
    const number = process.remoteJid.endsWith('@lid') ? process.remoteJid : process.remoteJid.split('@')[0];
    await this.send(channel, number, clientMessageText(settings.clientMessageTemplate, process.clientName));
    await this.prisma.process.update({ where: { id: process.id }, data: { lastClientNotice: this.now() } });
    return true;
  }

  /** Sends what is pending for every enabled instance outside its quiet hours. */
  async dispatch(settingsById: Map<string, ProcessSettingsView>) {
    let sent = 0;
    let held = 0;
    let heldUntil = Infinity;
    const now = this.now();
    const active: string[] = [];
    for (const [instanceId, s] of settingsById.entries()) {
      if (isQuietNow(s.quietHours, now)) {
        held++;
        heldUntil = Math.min(heldUntil, quietEndsAt(s.quietHours, now).getTime());
      } else active.push(instanceId);
    }
    if (!active.length) return { sent, held, heldUntil };

    const instances = await this.prisma.instance.findMany({
      where: { id: { in: active } },
      select: { id: true, name: true },
    });
    const nameOf = new Map(instances.map((i: any) => [i.id, i.name]));

    const movements = await this.prisma.processMovement.findMany({
      where: { notifyStatus: 'pending', Process: { instanceId: { in: active } } },
      include: { Process: true },
      orderBy: { occurredAt: 'asc' },
      take: 200,
    });
    const publications = await this.prisma.publication.findMany({
      where: { notifyStatus: 'pending', instanceId: { in: active } },
      include: { Process: true },
      orderBy: { disponibilizadaEm: 'asc' },
      take: 50,
    });

    const byProcess = new Map<string, any[]>();
    for (const m of movements) byProcess.set(m.processId, [...(byProcess.get(m.processId) ?? []), m]);

    const done: { movement: string[]; publication: string[] } = { movement: [], publication: [] };
    const skipped: { movement: string[]; publication: string[] } = { movement: [], publication: [] };
    const expired = (created: Date) => now.getTime() - new Date(created).getTime() > PENDING_EXPIRES_MS;
    const clientDone = new Set<string>();

    for (const [, list] of byProcess.entries()) {
      const process = list[0].Process;
      const settings = settingsById.get(process.instanceId);
      const channel = this.channelOf(String(nameOf.get(process.instanceId) ?? ''));
      const ids = list.map((m) => m.id);
      if (!channel) {
        held++;
        if (list.every((m) => expired(m.createdAt))) skipped.movement.push(...ids);
        continue;
      }
      try {
        if (process.notifyTeam) {
          const text = teamMovementText(process, list);
          for (const number of settings.notifyNumbers) {
            await this.send(channel, number, text);
            sent++;
          }
        }
        if (await this.notifyClient(channel, process, settings)) {
          sent++;
          clientDone.add(process.id);
        }
        done.movement.push(...ids);
      } catch (error) {
        this.log('error', `notification ${process.numeroCnj}: ${error?.message ?? error}`);
        held++;
      }
    }

    for (const p of publications) {
      const settings = settingsById.get(p.instanceId);
      const channel = this.channelOf(String(nameOf.get(p.instanceId) ?? ''));
      if (!channel) {
        held++;
        if (expired(p.createdAt)) skipped.publication.push(p.id);
        continue;
      }
      try {
        const text = teamPublicationText(p);
        for (const number of settings.notifyNumbers) {
          await this.send(channel, number, text);
          sent++;
        }
        if (p.Process && !clientDone.has(p.Process.id) && (await this.notifyClient(channel, p.Process, settings))) {
          sent++;
          clientDone.add(p.Process.id);
        }
        done.publication.push(p.id);
      } catch (error) {
        this.log('error', `notification DJEN ${p.externalId}: ${error?.message ?? error}`);
        held++;
      }
    }

    const mark = async (model: string, ids: string[], status: string) => {
      if (ids.length)
        await this.prisma[model].updateMany({ where: { id: { in: ids } }, data: { notifyStatus: status } });
    };
    await mark('processMovement', done.movement, 'sent');
    await mark('publication', done.publication, 'sent');
    await mark('processMovement', skipped.movement, 'skipped');
    await mark('publication', skipped.publication, 'skipped');
    if (movements.length === 200 || publications.length === 50) held++;
    return { sent, held, heldUntil };
  }

  // ------------------------------------------------------------------------------------------------ AI context

  /** Context block for the OpenAI bot: only the processes linked by the team to THIS contact, opt-in. */
  async aiContext(instanceId: string, remoteJid: string): Promise<string | null> {
    const settings = await this.cachedSettings(instanceId);
    if (!settings.enabled) return null;
    const variants = jidVariants(remoteJid);
    if (!variants.length) return null;
    const processes = await this.prisma.process.findMany({
      where: {
        instanceId,
        active: true,
        allowAiAnswer: true,
        segredoJustica: false,
        remoteJid: { in: variants },
      },
      select: { id: true, numeroCnj: true },
      take: 5,
    });
    if (!processes.length) return null;
    const movements = await this.prisma.processMovement.findMany({
      where: { processId: { in: processes.map((p: any) => p.id) } },
      orderBy: { occurredAt: 'desc' },
      select: { processId: true, occurredAt: true },
      take: 50,
    });
    return buildProcessContextBlock(
      processes.map((p: any) => ({
        label: `Processo nº ${p.numeroCnj}`,
        updates: movements
          .filter((m: any) => m.processId === p.id)
          .slice(0, 3)
          .map((m: any) => new Date(m.occurredAt)),
      })),
    );
  }

  // ------------------------------------------------------------------------------------------------ ticker

  startTicker(intervalMs = TICK_MS, firstDelayMs = 90_000) {
    if (this.timer) return;
    const run = () => this.tick().catch((error) => this.log('error', `tick: ${error?.message ?? error}`));
    setTimeout(run, firstDelayMs).unref?.();
    this.timer = setInterval(run, intervalMs);
    this.timer.unref?.();
  }

  stopTicker() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** For the tests. */
  get state() {
    return { nextDueAt: this.nextDueAt, backoff: this.backoff, pendingMayExist: this.pendingMayExist };
  }
}
