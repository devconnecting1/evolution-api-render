/**
 * "Leads (triagem)": turns each private WhatsApp conversation of an instance into one structured lead the office can
 * act on (src/utils/leads.ts has the rules).
 *
 * When: after the OpenAI bot sends an answer (OpenaiService.sendMessageToBot, right after the usage count), in the
 * background (never delays the answer), at most one analysis per conversation at a time, only when the trigger rules
 * say so (3+ client messages; first time, 3 new client messages, or still "novo" after 24 h). Also on demand for old
 * conversations (backfill, sequential, concurrency 2, one run per instance at a time).
 *
 * Cost: one Chat Completions call with structured output over the last 30 stored messages (text, captions and stored
 * transcriptions; never media downloads), with the instance's own OpenAI credential, bounded by a timeout and a token
 * cap. Not counted as an answer of "Plano e limites"; skipped when the limits block the AI (daily caps, franchise).
 *
 * Storage: two small tables, Lead (one row per conversation, fixed-size fields) and LeadSettings (one optional row
 * per instance). Every failure is only logged: leads must never take the bot down.
 *
 * Nothing in a lead is ever sent to the client. The only message this service sends is the optional internal notice
 * to the team numbers (off by default), once per lead.
 */
import { Logger } from '@config/logger.config';
import {
  buildTranscript,
  deriveAwaitingSince,
  detectSource,
  EDITABLE_FIELDS,
  extractionJsonSchema,
  extractionSystemPrompt,
  extractionUserPrompt,
  isGroupLikeJid,
  LEAD_PRIORITIES,
  LEAD_STATUSES,
  LeadSettingsView,
  leadsToCsv,
  leadsToXlsxSheets,
  LIMITS,
  mergeExtraction,
  mergeLeadSettings,
  normalizeLeadSettings,
  notificationText,
  onlyDigits,
  OPEN_STATUSES,
  parseExtraction,
  phoneOfJid,
  preferredJid,
  PRIORITY_RANK,
  shouldExtract,
  shouldNotify,
  TranscriptEntry,
  validateLeadPatch,
  validateLeadSettings,
  validateLeadSettingsInput,
} from '@utils/leads';
import { buildXlsx } from '@utils/xlsx';
import OpenAI from 'openai';

const SETTINGS_TTL_MS = 30_000;
const OPENAI_TIMEOUT_MS = 30_000;
/** Reasoning models (o-series, gpt-5/6) spend part of the budget thinking: they get more room. */
const REASONING_MODEL = /^(ft:)?(o\d|gpt-5|gpt-6)/i;
const MAX_TOKENS = 600;
const MAX_REASONING_TOKENS = 2500;
const FAILURE_BACKOFF_MS = 10 * 60_000;
const EXPORT_MAX = 5000;
const BACKFILL_CONCURRENCY = 2;
const BACKFILL_SCAN_LIMIT = 2000;
const MEDIA_TYPES = ['imageMessage', 'videoMessage', 'documentMessage', 'documentWithCaptionMessage', 'ptvMessage'];
const SORTS = ['priority', 'recent', 'waiting', 'created', 'name'] as const;

export class LeadsValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors.join(' '));
    this.name = 'LeadsValidationError';
  }
}

export class LeadsConflictError extends Error {}

export type OpenaiFactory = (apiKey: string) => Pick<OpenAI, 'chat'>;

export type LeadsOptions = {
  now?: () => number;
  /** postgresql | mysql (JSON path syntax and case-insensitive search). */
  provider?: string;
  openai?: OpenaiFactory;
  settingsTtlMs?: number;
  timeoutMs?: number;
};

/** What the bot hands over after an answer went out. */
export type BotReplyContext = {
  /** The running channel (Baileys / Cloud API): sending and the LID/phone pairs. */
  instance: any;
  instanceId: string;
  instanceName: string;
  remoteJid: string;
  pushName?: string | null;
  apiKey: string;
  model?: string | null;
};

export type AnalyzeResult = { status: 'created' | 'updated' | 'skipped' | 'error'; reason?: string; lead?: any };

export type BackfillState = {
  running: boolean;
  total: number;
  done: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  days: number;
  startedAt: string | null;
  finishedAt: string | null;
};

type UsageGate = {
  checkBeforeAnswer: (instanceId: string, remoteJid: string) => Promise<{ allow: boolean; reason: string }>;
};

const iso = (value: unknown) => (value ? new Date(value as any).toISOString() : null);
const list = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];

/** The lead as the API, the panel and the MCP show it. */
export function leadView(row: any) {
  if (!row) return null;
  const phone = phoneOfJid(row.remoteJid);
  return {
    id: row.id,
    remoteJid: row.remoteJid,
    phone,
    pushName: row.pushName ?? null,
    name: row.name ?? null,
    area: row.area ?? null,
    city: row.city ?? null,
    summary: row.summary ?? null,
    status: row.status,
    statusSource: row.statusSource ?? 'ai',
    priority: row.priority ?? 'normal',
    priorityReason: row.priorityReason ?? null,
    missingInfo: list(row.missingInfo),
    nextStep: row.nextStep ?? null,
    opposingParty: row.opposingParty ?? null,
    hasLawyer: typeof row.hasLawyer === 'boolean' ? row.hasLawyer : null,
    documentsMentioned: list(row.documentsMentioned),
    mediaCount: Number(row.mediaCount) || 0,
    source: row.source ?? null,
    manualFields: list(row.manualFields),
    awaitingHumanSince: (OPEN_STATUSES as string[]).includes(row.status) ? iso(row.awaitingHumanSince) : null,
    lastHumanReplyAt: iso(row.lastHumanReplyAt),
    firstMessageAt: iso(row.firstMessageAt),
    lastMessageAt: iso(row.lastMessageAt),
    lastClientMessageAt: iso(row.lastClientMessageAt),
    lastExtractedAt: iso(row.lastExtractedAt),
    extractedFromCount: Number(row.extractedFromCount) || 0,
    notifiedAt: iso(row.notifiedAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    whatsappUrl: phone ? `https://wa.me/${phone}` : null,
  };
}

export class LeadsService {
  private readonly logger = new Logger('LeadsService');
  private readonly settingsCache = new Map<string, { at: number; settings: LeadSettingsView }>();
  private readonly inFlight = new Map<string, Promise<AnalyzeResult>>();
  private readonly failedAt = new Map<string, number>();
  private readonly backfills = new Map<string, BackfillState>();
  private readonly pending = new Set<Promise<unknown>>();

  constructor(
    private readonly prisma: any,
    private readonly usage: UsageGate | null,
    private readonly waMonitor: { waInstances: Record<string, any> } | null,
    private readonly options: LeadsOptions = {},
  ) {}

  private now(): Date {
    return new Date((this.options.now ?? Date.now)());
  }

  private get mysql(): boolean {
    return this.options.provider === 'mysql';
  }

  private openai(apiKey: string): Pick<OpenAI, 'chat'> {
    if (this.options.openai) return this.options.openai(apiKey);
    return new OpenAI({ apiKey, timeout: this.options.timeoutMs ?? OPENAI_TIMEOUT_MS, maxRetries: 1 });
  }

  /** Resolves when every background analysis started so far is over (tests, graceful shutdown). */
  public async idle(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }

  private track<T>(promise: Promise<T>): Promise<T> {
    this.pending.add(promise);
    promise.finally(() => this.pending.delete(promise)).catch(() => undefined);
    return promise;
  }

  // ------------------------------------------------------------------------------------------ settings

  public async getSettings(instanceId: string): Promise<LeadSettingsView> {
    const ttl = this.options.settingsTtlMs ?? SETTINGS_TTL_MS;
    const at = this.now().getTime();
    const hit = this.settingsCache.get(instanceId);
    if (hit && at - hit.at < ttl) return hit.settings;
    const row = await this.prisma.leadSettings.findUnique({ where: { instanceId } });
    const settings = normalizeLeadSettings(row);
    this.settingsCache.set(instanceId, { at, settings });
    return settings;
  }

  public async getStoredSettings(instanceId: string) {
    const row = await this.prisma.leadSettings.findUnique({ where: { instanceId } });
    return { configured: !!row, settings: normalizeLeadSettings(row) };
  }

  public async saveSettings(instanceId: string, input: any) {
    const inputErrors = validateLeadSettingsInput(input);
    if (inputErrors.length) throw new LeadsValidationError(inputErrors);

    const row = await this.prisma.leadSettings.findUnique({ where: { instanceId } });
    const previous = row ? normalizeLeadSettings(row) : null;
    const settings = mergeLeadSettings(previous ?? normalizeLeadSettings(null), input);
    const errors = validateLeadSettings(settings);
    if (errors.length) throw new LeadsValidationError(errors);

    const data = {
      enabled: settings.enabled,
      areas: settings.areas,
      extractionModel: settings.extractionModel,
      notifyEnabled: settings.notify.enabled,
      notifyNumbers: settings.notify.numbers,
      notifyOn: settings.notify.on,
    };
    const saved = await this.prisma.leadSettings.upsert({
      where: { instanceId },
      create: { instanceId, ...data },
      update: data,
    });
    this.settingsCache.delete(instanceId);
    return { previous, settings: normalizeLeadSettings(saved ?? data) };
  }

  // ------------------------------------------------------------------------------------------ hooks

  /**
   * The bot answered `remoteJid`: maybe analyse the conversation, in the background. Never throws, never waits.
   */
  public afterBotReply(context: BotReplyContext): void {
    if (!context?.instanceId || !context.remoteJid || !context.apiKey || isGroupLikeJid(context.remoteJid)) return;
    const task = new Promise<void>((resolve) => setImmediate(resolve))
      .then(() => this.analyzeConversation({ ...context, trigger: 'reply' }))
      .catch((error) =>
        this.logger.error(`Lead analysis failed for ${context.instanceName}: ${error?.message ?? error}`),
      );
    this.track(task);
  }

  /**
   * A person of the team wrote in the chat (the human takeover of the OpenAI bot): the lead no longer waits for the
   * team. One small update; nothing happens when the conversation has no lead.
   */
  public recordHumanReply(instanceId: string, remoteJids: string[], at: Date = this.now()): void {
    const jids = [...new Set(remoteJids.filter((jid) => typeof jid === 'string' && jid && !isGroupLikeJid(jid)))];
    if (!instanceId || !jids.length) return;
    const task = Promise.resolve()
      .then(() =>
        this.prisma.lead.updateMany({
          where: { instanceId, remoteJid: { in: jids } },
          data: { lastHumanReplyAt: at, awaitingHumanSince: null },
        }),
      )
      .catch((error) => this.logger.warn(`Could not record the team reply on the lead: ${error?.message ?? error}`));
    this.track(task);
  }

  // ------------------------------------------------------------------------------------------ analysis

  private keyFilter(field: string, value: unknown) {
    return { key: { path: this.mysql ? `$.${field}` : [field], equals: value as any } };
  }

  private async equivalentJids(channel: any, remoteJid: string): Promise<string[]> {
    try {
      if (typeof channel?.resolveEquivalentJids === 'function') {
        const jids = await channel.resolveEquivalentJids(remoteJid);
        if (Array.isArray(jids) && jids.length) return [...new Set<string>([remoteJid, ...jids])];
      }
    } catch (error) {
      this.logger.verbose(`LID/phone lookup failed: ${error?.message ?? error}`);
    }
    return [remoteJid];
  }

  /** Last messages of the conversation (any of its addresses), newest first. */
  private async loadMessages(instanceId: string, jids: string[], take: number) {
    return (
      (await this.prisma.message.findMany({
        where: { instanceId, OR: jids.map((jid) => this.keyFilter('remoteJid', jid)) },
        orderBy: { messageTimestamp: 'desc' },
        take,
        select: { key: true, pushName: true, messageType: true, message: true, messageTimestamp: true },
      })) ?? []
    );
  }

  private async firstClientMessage(instanceId: string, jids: string[]) {
    return this.prisma.message.findFirst({
      where: {
        instanceId,
        AND: [{ OR: jids.map((jid) => this.keyFilter('remoteJid', jid)) }, this.keyFilter('fromMe', false)],
      },
      orderBy: { messageTimestamp: 'asc' },
      select: { message: true, messageTimestamp: true },
    });
  }

  private async countClientMedia(instanceId: string, jids: string[]): Promise<number> {
    try {
      return await this.prisma.message.count({
        where: {
          instanceId,
          messageType: { in: MEDIA_TYPES },
          AND: [{ OR: jids.map((jid) => this.keyFilter('remoteJid', jid)) }, this.keyFilter('fromMe', false)],
        },
      });
    } catch (error) {
      this.logger.verbose(`Media count failed: ${error?.message ?? error}`);
      return 0;
    }
  }

  /** User turns of the bot session (they hold the audio the bot transcribed); only read when needed. */
  private async sessionHistory(instanceId: string, jids: string[]): Promise<string[]> {
    try {
      const session = await this.prisma.integrationSession.findFirst({
        where: { instanceId, remoteJid: { in: jids } },
        orderBy: { updatedAt: 'desc' },
        select: { context: true },
      });
      const context = typeof session?.context === 'string' ? JSON.parse(session.context) : session?.context;
      const history: any[] = Array.isArray(context?.history) ? context.history : [];
      return history
        .filter((item) => item?.role === 'user')
        .map((item) =>
          typeof item.content === 'string'
            ? item.content
            : Array.isArray(item.content)
              ? item.content
                  .filter((part: any) => part?.type === 'text')
                  .map((part: any) => part.text)
                  .join('\n')
              : '',
        )
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  private async findLead(instanceId: string, jids: string[]) {
    const rows: any[] =
      (await this.prisma.lead.findMany({ where: { instanceId, remoteJid: { in: jids } }, take: 2 })) ?? [];
    return rows.find((row) => row.remoteJid.endsWith('@s.whatsapp.net')) ?? rows[0] ?? null;
  }

  /** OpenAI credential and model for an instance without a bot context (backfill). */
  private async credentialsOf(instanceId: string, settings: LeadSettingsView) {
    const bot = await this.prisma.openaiBot.findFirst({
      where: { instanceId, enabled: true },
      orderBy: { createdAt: 'asc' },
      select: { openaiCredsId: true, model: true },
    });
    let credsId = bot?.openaiCredsId ?? null;
    if (!credsId) {
      const defaults = await this.prisma.openaiSetting.findFirst({
        where: { instanceId },
        select: { openaiCredsId: true },
      });
      credsId = defaults?.openaiCredsId ?? null;
    }
    const creds = credsId ? await this.prisma.openaiCreds.findUnique({ where: { id: credsId } }) : null;
    if (!creds?.apiKey) return null;
    return { apiKey: creds.apiKey as string, model: settings.extractionModel ?? bot?.model ?? 'gpt-4o-mini' };
  }

  /**
   * Analyses one conversation when the rules say so (or always with `force`, the backfill). At most one analysis
   * per conversation at a time; a failed one is not retried for 10 minutes.
   */
  public async analyzeConversation(params: {
    instance?: any;
    instanceId: string;
    instanceName: string;
    remoteJid: string;
    pushName?: string | null;
    apiKey?: string;
    model?: string | null;
    trigger: 'reply' | 'backfill';
  }): Promise<AnalyzeResult> {
    const { instanceId, remoteJid } = params;
    if (isGroupLikeJid(remoteJid)) return { status: 'skipped', reason: 'grupo' };

    const settings = await this.getSettings(instanceId);
    if (!settings.enabled) return { status: 'skipped', reason: 'desativado' };

    const channel = params.instance ?? this.waMonitor?.waInstances?.[params.instanceName];
    const jids = await this.equivalentJids(channel, remoteJid);
    const jid = preferredJid(jids, remoteJid);
    const key = `${instanceId}|${jid}`;

    const team = new Set(settings.notify.numbers);
    if (jids.some((item) => team.has(onlyDigits(phoneOfJid(item)))))
      return { status: 'skipped', reason: 'número da equipe' };

    const running = this.inFlight.get(key);
    if (running) return { status: 'skipped', reason: 'análise em andamento' };
    const failed = this.failedAt.get(key);
    if (failed && this.now().getTime() - failed < FAILURE_BACKOFF_MS)
      return { status: 'skipped', reason: 'falha recente' };

    const task = this.runAnalysis({ ...params, settings, channel, jids, jid, key });
    this.inFlight.set(key, task);
    try {
      return await task;
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async runAnalysis(params: {
    instanceId: string;
    instanceName: string;
    pushName?: string | null;
    apiKey?: string;
    model?: string | null;
    trigger: 'reply' | 'backfill';
    settings: LeadSettingsView;
    channel: any;
    jids: string[];
    jid: string;
    key: string;
  }): Promise<AnalyzeResult> {
    const { instanceId, settings, jids, jid } = params;
    const now = this.now();

    const lead = await this.findLead(instanceId, jids);
    const records: any[] = await this.loadMessages(instanceId, jids, LIMITS.transcriptMessages);
    const entries: TranscriptEntry[] = records.map((record) => this.entryOf(record));

    const lastExtracted = lead?.lastExtractedAt ? new Date(lead.lastExtractedAt).getTime() / 1000 : -Infinity;
    const clientEntries = entries.filter((entry) => !entry.fromMe);
    if (params.trigger === 'backfill') {
      // Old conversations: only the ones never analysed
      if (clientEntries.length < LIMITS.minClientMessages)
        return { status: 'skipped', reason: 'poucas mensagens do cliente' };
      if (lead?.lastExtractedAt) return { status: 'skipped', reason: 'já analisada' };
    } else {
      const decision = shouldExtract({
        clientMessages: clientEntries.length,
        newClientMessages: clientEntries.filter((entry) => entry.timestamp > lastExtracted).length,
        lead,
        now: now.getTime(),
      });
      if (!decision.run) return { status: 'skipped', reason: decision.reason };
    }

    // "Plano e limites": the daily caps and the franchise block the analysis too (business hours do not: the
    // analysis is not an answer to the client)
    if (this.usage) {
      const gate = await this.usage.checkBeforeAnswer(instanceId, jid).catch(() => ({ allow: true, reason: 'ok' }));
      if (!gate.allow && gate.reason !== 'hours') return { status: 'skipped', reason: `limite: ${gate.reason}` };
    }

    const creds = params.apiKey
      ? { apiKey: params.apiKey, model: settings.extractionModel ?? params.model ?? 'gpt-4o-mini' }
      : await this.credentialsOf(instanceId, settings);
    if (!creds) return { status: 'skipped', reason: 'sem credencial OpenAI' };

    const history = entries.some((entry) => entry.untranscribedAudio)
      ? await this.sessionHistory(instanceId, jids)
      : [];
    const transcript = buildTranscript(entries, history);
    const pushName =
      params.pushName ||
      records.find((record) => !record?.key?.fromMe && record?.pushName)?.pushName ||
      lead?.pushName ||
      null;

    let extraction;
    try {
      extraction = await this.extract(creds.apiKey, creds.model, settings.areas, transcript.text, lead, pushName);
    } catch (error) {
      this.failedAt.set(params.key, now.getTime());
      this.logger.error(
        `Lead extraction failed (instance ${params.instanceName}, model ${creds.model}): ${error?.status ?? ''} ${
          error?.message ?? error
        }`,
      );
      return { status: 'error', reason: 'falha na OpenAI' };
    }
    if (!extraction) {
      this.failedAt.set(params.key, now.getTime());
      this.logger.warn(`Lead extraction returned no usable JSON (instance ${params.instanceName})`);
      return { status: 'error', reason: 'resposta inválida' };
    }
    this.failedAt.delete(params.key);

    const first =
      lead?.firstMessageAt || lead?.source ? null : await this.firstClientMessage(instanceId, jids).catch(() => null);
    const mediaCount = await this.countClientMedia(instanceId, jids);
    const merged = mergeExtraction(lead, extraction);
    const clientTimes = clientEntries.map((entry) => entry.timestamp * 1000);
    const lastClientAt =
      transcript.lastClientAt ?? (lead?.lastClientMessageAt ? new Date(lead.lastClientMessageAt) : null);

    const firstAt =
      [
        lead?.firstMessageAt ? new Date(lead.firstMessageAt) : null,
        transcript.firstAt,
        first ? new Date(Number(first.messageTimestamp) * 1000) : null,
      ]
        .filter((date): date is Date => !!date && Number.isFinite(date.getTime()))
        .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

    const data: Record<string, any> = {
      ...merged,
      pushName: pushName ? String(pushName).slice(0, LIMITS.pushName) : null,
      mediaCount,
      source: lead?.source ?? detectSource(first ? this.textOf(first.message) : null),
      firstMessageAt: firstAt,
      lastMessageAt: transcript.lastAt ?? lead?.lastMessageAt ?? null,
      lastClientMessageAt: lastClientAt,
      awaitingHumanSince: deriveAwaitingSince({
        status: merged.status,
        priority: merged.priority,
        current: lead?.awaitingHumanSince,
        lastHumanReplyAt: lead?.lastHumanReplyAt,
        lastClientAt,
        clientTimes,
      }),
      lastExtractedAt: now,
      extractedFromCount: transcript.clientMessages,
    };

    let saved: any;
    let status: AnalyzeResult['status'];
    if (lead) {
      // A lead first stored under the LID moves to the phone JID when it becomes known
      if (lead.remoteJid !== jid && jid.endsWith('@s.whatsapp.net')) data.remoteJid = jid;
      saved = await this.prisma.lead.update({ where: { id: lead.id }, data }).catch(async (error: any) => {
        if (error?.code !== 'P2002' || !data.remoteJid) throw error;
        delete data.remoteJid;
        return this.prisma.lead.update({ where: { id: lead.id }, data });
      });
      status = 'updated';
    } else {
      try {
        saved = await this.prisma.lead.create({ data: { instanceId, remoteJid: jid, ...data } });
        status = 'created';
      } catch (error) {
        if (error?.code !== 'P2002') throw error;
        saved = await this.prisma.lead.update({
          where: { instanceId_remoteJid: { instanceId, remoteJid: jid } },
          data,
        });
        status = 'updated';
      }
    }

    await this.maybeNotify(saved, settings, params.channel);
    return { status, reason: params.trigger === 'backfill' ? 'backfill' : 'resposta do bot', lead: leadView(saved) };
  }

  private textOf(message: any): string | null {
    if (!message || typeof message !== 'object') return null;
    const inner = message.ephemeralMessage?.message ?? message.viewOnceMessage?.message ?? message;
    const text =
      inner.conversation ||
      inner.extendedTextMessage?.text ||
      inner.imageMessage?.caption ||
      inner.videoMessage?.caption ||
      inner.documentMessage?.caption ||
      inner.documentWithCaptionMessage?.message?.documentMessage?.caption ||
      inner.speechToText ||
      inner.buttonsResponseMessage?.selectedDisplayText ||
      inner.listResponseMessage?.title ||
      null;
    return typeof text === 'string' && text.trim() ? text : null;
  }

  private entryOf(record: any): TranscriptEntry {
    const message = record?.message ?? {};
    const inner = message.ephemeralMessage?.message ?? message.viewOnceMessage?.message ?? message;
    const text = this.textOf(message);
    const type = String(record?.messageType ?? '');
    const audio = type === 'audioMessage' || !!inner.audioMessage;
    let described = text;
    if (!described) {
      if (type === 'imageMessage' || inner.imageMessage) described = '[foto]';
      else if (type === 'videoMessage' || inner.videoMessage || type === 'ptvMessage') described = '[vídeo]';
      else if (type.startsWith('document') || inner.documentMessage) {
        const name =
          inner.documentMessage?.fileName ?? inner.documentWithCaptionMessage?.message?.documentMessage?.fileName;
        described = name ? `[documento ${String(name).slice(0, 60)}]` : '[documento]';
      } else if (type === 'stickerMessage') described = '[figurinha]';
      else if (type === 'locationMessage') described = '[localização]';
      else if (type === 'contactMessage') described = '[contato]';
      else if (audio) described = '[áudio]';
    }
    return {
      fromMe: !!record?.key?.fromMe,
      text: described,
      timestamp: Number(record?.messageTimestamp) || 0,
      untranscribedAudio: audio && !inner.speechToText && !record?.key?.fromMe,
    };
  }

  /** One structured-output call; retries once with the other token parameter or with plain JSON mode. */
  private async extract(
    apiKey: string,
    model: string,
    areas: string[],
    transcript: string,
    lead: any,
    pushName: string | null,
  ) {
    const client = this.openai(apiKey);
    const reasoning = REASONING_MODEL.test(model);
    const messages: any[] = [
      { role: 'system', content: extractionSystemPrompt(areas) },
      { role: 'user', content: extractionUserPrompt(transcript, lead, pushName) },
    ];
    let tokenParam: 'max_tokens' | 'max_completion_tokens' = reasoning ? 'max_completion_tokens' : 'max_tokens';
    let format: any = { type: 'json_schema', json_schema: extractionJsonSchema(areas) };

    for (let attempt = 0; attempt < 3; attempt++) {
      const body: any = {
        model,
        messages,
        response_format: format,
        [tokenParam]: reasoning ? MAX_REASONING_TOKENS : MAX_TOKENS,
      };
      if (!reasoning) body.temperature = 0;
      try {
        const completion: any = await client.chat.completions.create(body, {
          timeout: this.options.timeoutMs ?? OPENAI_TIMEOUT_MS,
        } as any);
        const usage = completion?.usage;
        if (usage) {
          this.logger.log(
            `Lead extraction with ${model}: ${usage.prompt_tokens ?? '?'} in / ${usage.completion_tokens ?? '?'} out tokens`,
          );
        }
        return parseExtraction(completion?.choices?.[0]?.message?.content, areas);
      } catch (error) {
        const status = error?.status ?? error?.response?.status;
        const text = String(error?.message ?? error?.error?.message ?? '');
        const param = error?.param ?? error?.error?.param;
        if (status === 400 && (param === tokenParam || text.includes(`'${tokenParam}'`))) {
          tokenParam = tokenParam === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens';
          continue;
        }
        if (
          status === 400 &&
          format.type === 'json_schema' &&
          /response_format|json_schema/i.test(`${param} ${text}`)
        ) {
          format = { type: 'json_object' };
          messages[0] = {
            ...messages[0],
            content: `${messages[0].content}\n\nResponda com um objeto JSON com as chaves: ${Object.keys(extractionJsonSchema(areas).schema.properties).join(', ')}.`,
          };
          continue;
        }
        throw error;
      }
    }
    return null;
  }

  // ------------------------------------------------------------------------------------------ notification

  /** Tells the team numbers once (notifiedAt is claimed first, so two analyses never notify twice). */
  private async maybeNotify(lead: any, settings: LeadSettingsView, channel: any): Promise<boolean> {
    if (!shouldNotify(lead, settings)) return false;
    const sender = channel ?? null;
    if (typeof sender?.textMessage !== 'function') {
      this.logger.warn('Lead notice not sent: the instance is not loaded');
      return false;
    }

    const claimed = await this.prisma.lead.updateMany({
      where: { id: lead.id, notifiedAt: null },
      data: { notifiedAt: this.now() },
    });
    if (!claimed?.count) return false;

    const client = onlyDigits(phoneOfJid(lead.remoteJid));
    const text = notificationText(lead);
    let sent = 0;
    for (const number of settings.notify.numbers) {
      if (!number || number === client) continue;
      try {
        // Trailing `true`: a chatbot send, so the echo never pauses the bot of that chat
        await sender.textMessage({ number, text, delay: 0, linkPreview: false }, false, true);
        sent++;
      } catch (error) {
        this.logger.error(`Lead notice to a team number failed: ${error?.message ?? error}`);
      }
    }
    if (!sent) {
      await this.prisma.lead.update({ where: { id: lead.id }, data: { notifiedAt: null } }).catch(() => undefined);
    }
    return sent > 0;
  }

  // ------------------------------------------------------------------------------------------ reading

  private listWhere(instanceId: string, query: Record<string, any>, jids?: string[]) {
    const where: Record<string, any> = { instanceId };
    const and: any[] = [];
    const str = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);

    if (str(query.status) && query.status !== 'todos' && query.status !== 'aguardando') {
      if (!(LEAD_STATUSES as readonly string[]).includes(query.status)) {
        throw new LeadsValidationError([`status inválido: use ${LEAD_STATUSES.join(', ')}.`]);
      }
      where.status = query.status;
    }
    const awaiting = query.status === 'aguardando' || query.awaiting === true || query.awaiting === 'true';
    if (awaiting) {
      where.awaitingHumanSince = { not: null };
      if (!where.status) where.status = { in: OPEN_STATUSES };
      else if (!(OPEN_STATUSES as string[]).includes(where.status)) where.id = '__none__';
    }
    if (str(query.area)) where.area = query.area.trim();
    if (str(query.priority)) {
      if (!(LEAD_PRIORITIES as readonly string[]).includes(query.priority)) {
        throw new LeadsValidationError(['prioridade inválida: use alta, normal ou baixa.']);
      }
      where.priority = query.priority;
    }
    if (str(query.since)) {
      const since = new Date(query.since);
      if (!Number.isFinite(since.getTime())) throw new LeadsValidationError(['"since" deve ser uma data ISO 8601.']);
      where.lastMessageAt = { gte: since };
    }
    if (jids?.length) where.remoteJid = { in: jids };

    const search = str(query.search)?.slice(0, 100);
    if (search) {
      const mode = this.mysql ? {} : { mode: 'insensitive' };
      const or: any[] = ['name', 'pushName', 'city', 'summary', 'opposingParty', 'area'].map((field) => ({
        [field]: { contains: search, ...mode },
      }));
      const digits = onlyDigits(search);
      if (digits.length >= 3) or.push({ remoteJid: { contains: digits } });
      and.push({ OR: or });
    }
    if (and.length) where.AND = and;
    return where;
  }

  private orderBy(sort: unknown): any[] {
    switch (sort) {
      case 'recent':
        return [{ lastMessageAt: 'desc' }, { id: 'asc' }];
      case 'waiting':
        return [{ awaitingHumanSince: { sort: 'asc', nulls: 'last' } }, { lastMessageAt: 'desc' }, { id: 'asc' }];
      case 'created':
        return [{ createdAt: 'desc' }, { id: 'asc' }];
      case 'name':
        return [{ name: { sort: 'asc', nulls: 'last' } }, { pushName: 'asc' }, { id: 'asc' }];
      default:
        // Priority alta first, then whoever waits the longest for the team, then the most recent
        return [
          { priorityRank: 'asc' },
          { awaitingHumanSince: { sort: 'asc', nulls: 'last' } },
          { lastMessageAt: 'desc' },
          { id: 'asc' },
        ];
    }
  }

  /** Counts per view of the view bar (same filters, every status). */
  private async counts(where: Record<string, any>) {
    const base = { ...where };
    delete base.status;
    delete base.awaitingHumanSince;
    delete base.id;
    const [groups, awaiting] = await Promise.all([
      this.prisma.lead.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      this.prisma.lead.count({ where: { ...base, status: { in: OPEN_STATUSES }, awaitingHumanSince: { not: null } } }),
    ]);
    const counts: Record<string, number> = { todos: 0, aguardando: Number(awaiting) || 0 };
    for (const status of LEAD_STATUSES) counts[status] = 0;
    for (const group of groups ?? []) {
      const n = Number(group?._count?._all ?? group?._count) || 0;
      counts[group.status] = (counts[group.status] ?? 0) + n;
      counts.todos += n;
    }
    return counts;
  }

  public async list(instanceId: string, query: Record<string, any> = {}, channel?: any) {
    const page = Math.max(1, Math.min(10_000, Number.parseInt(String(query.page ?? 1), 10) || 1));
    const pageSize = Math.max(1, Math.min(100, Number.parseInt(String(query.pageSize ?? query.limit ?? 25), 10) || 25));
    const sort = (SORTS as readonly string[]).includes(query.sort) ? query.sort : 'priority';
    const jids = query.remoteJid ? await this.equivalentJids(channel, String(query.remoteJid)) : undefined;
    const where = this.listWhere(instanceId, query, jids);

    const [total, rows, counts] = await Promise.all([
      this.prisma.lead.count({ where }),
      this.prisma.lead.findMany({ where, orderBy: this.orderBy(sort), skip: (page - 1) * pageSize, take: pageSize }),
      this.counts(where),
    ]);
    return {
      total: Number(total) || 0,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil((Number(total) || 0) / pageSize)),
      sort,
      counts,
      leads: (rows ?? []).map(leadView),
    };
  }

  public async get(instanceId: string, id: string) {
    const row = await this.prisma.lead.findFirst({ where: { id: String(id), instanceId } });
    return row ? leadView(row) : null;
  }

  /** Team edit: every edited field is locked against the AI; a status set here is never changed by the AI. */
  public async update(instanceId: string, id: string, input: Record<string, any>) {
    const errors = validateLeadPatch(input);
    if (errors.length) throw new LeadsValidationError(errors);
    const row = await this.prisma.lead.findFirst({ where: { id: String(id), instanceId } });
    if (!row) return null;

    const data: Record<string, any> = {};
    const locked = new Set(list(row.manualFields));
    for (const field of EDITABLE_FIELDS) {
      if (!(field in input) || input[field] === undefined) continue;
      let value = input[field];
      if (typeof value === 'string') value = value.trim() || null;
      if (field === 'missingInfo') value = (value as string[]).map((item) => item.trim()).filter(Boolean);
      data[field] = value;
      locked.add(field);
    }
    if ('status' in data) {
      data.statusSource = 'manual';
      if (!(OPEN_STATUSES as string[]).includes(data.status)) data.awaitingHumanSince = null;
    }
    if ('priority' in data) {
      data.priorityRank = PRIORITY_RANK[data.priority as keyof typeof PRIORITY_RANK] ?? 1;
      if (!('priorityReason' in data)) data.priorityReason = 'Definida pela equipe';
    }
    data.manualFields = [...locked];

    const saved = await this.prisma.lead.update({ where: { id: row.id }, data });
    return { previous: leadView(row), lead: leadView(saved) };
  }

  public async exportCsv(instanceId: string, query: Record<string, any> = {}) {
    const where = this.listWhere(instanceId, query);
    const sort = (SORTS as readonly string[]).includes(query.sort) ? query.sort : 'priority';
    const rows = await this.prisma.lead.findMany({ where, orderBy: this.orderBy(sort), take: EXPORT_MAX });
    return leadsToCsv((rows ?? []).map(leadView));
  }

  /** The same list as a formatted Excel workbook (sheets "Leads" and "Resumo"), in the order of the panel. */
  public async exportXlsx(instanceId: string, instanceName: string, query: Record<string, any> = {}): Promise<Buffer> {
    const where = this.listWhere(instanceId, query);
    const sort = (SORTS as readonly string[]).includes(query.sort) ? query.sort : 'priority';
    const rows = await this.prisma.lead.findMany({ where, orderBy: this.orderBy(sort), take: EXPORT_MAX });
    return buildXlsx(leadsToXlsxSheets((rows ?? []).map(leadView), { instanceName }), {
      title: `Leads · ${instanceName}`,
    });
  }

  // ------------------------------------------------------------------------------------------ backfill

  public backfillStatus(instanceId: string): BackfillState {
    return (
      this.backfills.get(instanceId) ?? {
        running: false,
        total: 0,
        done: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        errors: 0,
        days: 0,
        startedAt: null,
        finishedAt: null,
      }
    );
  }

  /** Conversations of the last `days` with 3+ client messages and no analysis yet, newest first. */
  private async backfillCandidates(
    instanceId: string,
    instanceName: string,
    days: number,
    max: number,
    settings: LeadSettingsView,
  ) {
    const since = Math.floor(this.now().getTime() / 1000) - days * 86400;
    const mysql = this.mysql;
    const field = (name: string) => (mysql ? `JSON_UNQUOTE(JSON_EXTRACT(\`key\`, '$.${name}'))` : `"key"->>'${name}'`);
    const table = mysql ? '`Message`' : '"Message"';
    const col = (name: string) => (mysql ? `\`${name}\`` : `"${name}"`);
    const sql =
      `SELECT ${field('remoteJid')} AS jid, COUNT(*) AS n, MAX(${col('messageTimestamp')}) AS last ` +
      `FROM ${table} WHERE ${col('instanceId')} = $1 AND ${col('messageTimestamp')} >= $2 ` +
      `AND ${field('fromMe')} = 'false' GROUP BY ${field('remoteJid')} ORDER BY MAX(${col('messageTimestamp')}) DESC LIMIT ${BACKFILL_SCAN_LIMIT}`;
    const rows: any[] =
      (await this.prisma.$queryRawUnsafe(mysql ? sql.replace('$1', '?').replace('$2', '?') : sql, instanceId, since)) ??
      [];

    // LID and phone halves of one conversation are merged (the channel knows the pairs)
    const channel = this.waMonitor?.waInstances?.[instanceName];
    const lids = rows.map((row) => row.jid).filter((jid) => typeof jid === 'string' && jid.endsWith('@lid'));
    const pnOf = new Map<string, string>();
    if (lids.length && typeof channel?.findLidPnPairs === 'function') {
      try {
        for (const pair of await channel.findLidPnPairs(lids)) if (!pnOf.has(pair.lid)) pnOf.set(pair.lid, pair.pn);
      } catch (error) {
        this.logger.verbose(`LID pairs for the backfill failed: ${error?.message ?? error}`);
      }
    }

    const team = new Set(settings.notify.numbers);
    const merged = new Map<string, { jid: string; n: number; last: number }>();
    for (const row of rows) {
      if (typeof row.jid !== 'string' || isGroupLikeJid(row.jid)) continue;
      const jid = pnOf.get(row.jid) ?? row.jid;
      if (team.has(onlyDigits(phoneOfJid(jid)))) continue;
      const current = merged.get(jid) ?? { jid, n: 0, last: 0 };
      current.n += Number(row.n) || 0;
      current.last = Math.max(current.last, Number(row.last) || 0);
      merged.set(jid, current);
    }
    const eligible = [...merged.values()].filter((item) => item.n >= LIMITS.minClientMessages);
    if (!eligible.length) return [];

    const analysed: any[] =
      (await this.prisma.lead.findMany({
        where: { instanceId, remoteJid: { in: eligible.map((item) => item.jid) }, lastExtractedAt: { not: null } },
        select: { remoteJid: true },
      })) ?? [];
    const done = new Set(analysed.map((row) => row.remoteJid));
    return eligible
      .filter((item) => !done.has(item.jid))
      .sort((a, b) => b.last - a.last)
      .slice(0, max)
      .map((item) => item.jid);
  }

  /**
   * Analyses old conversations. `dryRun` only counts them (for the confirmation dialog). Otherwise starts in the
   * background (one run per instance) and returns the count; progress comes from backfillStatus.
   */
  public async backfill(
    instanceId: string,
    instanceName: string,
    input: { days?: number; max?: number; dryRun?: boolean },
  ) {
    const days = Math.max(1, Math.min(60, Math.floor(Number(input?.days ?? 30)) || 30));
    const max = Math.max(1, Math.min(200, Math.floor(Number(input?.max ?? 50)) || 50));
    const settings = await this.getSettings(instanceId);
    if (!settings.enabled)
      throw new LeadsValidationError(['A triagem de leads está desativada nas configurações desta instância.']);
    if (this.backfills.get(instanceId)?.running) {
      throw new LeadsConflictError('Já existe uma análise de conversas anteriores em andamento nesta instância.');
    }

    const creds = await this.credentialsOf(instanceId, settings);
    if (!creds) throw new LeadsValidationError(['A instância não tem credencial OpenAI cadastrada.']);
    const candidates = await this.backfillCandidates(instanceId, instanceName, days, max, settings);
    if (input?.dryRun) return { dryRun: true, days, max, candidates: candidates.length, model: creds.model };

    const state: BackfillState = {
      running: true,
      total: candidates.length,
      done: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      days,
      startedAt: this.now().toISOString(),
      finishedAt: null,
    };
    this.backfills.set(instanceId, state);

    const queue = [...candidates];
    const worker = async () => {
      while (queue.length) {
        const remoteJid = queue.shift() as string;
        try {
          const result = await this.analyzeConversation({
            instanceId,
            instanceName,
            remoteJid,
            apiKey: creds.apiKey,
            model: creds.model,
            trigger: 'backfill',
          });
          if (result.status === 'created') state.created++;
          else if (result.status === 'updated') state.updated++;
          else if (result.status === 'error') state.errors++;
          else state.skipped++;
        } catch (error) {
          state.errors++;
          this.logger.error(`Backfill of a conversation failed: ${error?.message ?? error}`);
        }
        state.done++;
      }
    };
    const run = Promise.all(
      Array.from({ length: Math.min(BACKFILL_CONCURRENCY, candidates.length || 1) }, worker),
    ).finally(() => {
      state.running = false;
      state.finishedAt = this.now().toISOString();
    });
    this.track(run);
    return { started: true, days, max, candidates: candidates.length, model: creds.model, status: state };
  }

  // ------------------------------------------------------------------------------------------ observability

  /** "Leads" line of the observability usage card: new today and qualified in the last 7 days, per instance. */
  public async snapshot(): Promise<
    { instanceId: string; name: string; newToday: number; qualified7d: number; awaiting: number }[]
  > {
    const now = this.now();
    const dayStart = new Date(now.getTime() - 24 * 3600_000);
    const weekStart = new Date(now.getTime() - 7 * 24 * 3600_000);
    const [created, qualified, awaiting] = await Promise.all([
      this.prisma.lead.groupBy({ by: ['instanceId'], where: { createdAt: { gte: dayStart } }, _count: { _all: true } }),
      this.prisma.lead.groupBy({
        by: ['instanceId'],
        where: { status: 'qualificado', updatedAt: { gte: weekStart } },
        _count: { _all: true },
      }),
      this.prisma.lead.groupBy({
        by: ['instanceId'],
        where: { status: { in: OPEN_STATUSES }, awaitingHumanSince: { not: null } },
        _count: { _all: true },
      }),
    ]);
    const count = (rows: any[], id: string) => Number(rows?.find((row) => row.instanceId === id)?._count?._all ?? 0);
    const ids = [
      ...new Set<string>(
        [...(created ?? []), ...(qualified ?? []), ...(awaiting ?? [])].map((row: any) => row.instanceId),
      ),
    ];
    if (!ids.length) return [];
    const instances: any[] =
      (await this.prisma.instance.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })) ?? [];
    return instances
      .map((row) => ({
        instanceId: row.id,
        name: row.name,
        newToday: count(created, row.id),
        qualified7d: count(qualified, row.id),
        awaiting: count(awaiting, row.id),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}
