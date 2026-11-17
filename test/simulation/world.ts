/**
 * The simulated world: fictitious office instances wired to the REAL chatbot path
 *   ChatbotController.emit (dedupe) → OpenaiController.emit (pause, groups, debounce) → OpenaiService.process
 *   (limits, media, prompt, guard, hand-over) → sendMessageWhatsApp → channel
 * with an in-memory database, a channel that behaves like Baileys before the chatbot emit (edits and deletions
 * never reach the bots, `@lid` is swapped for the phone when known, groups pass through as with the default
 * `groupsIgnore` off), echoes of the bot's own sends (fromMe) and a transcript per contact.
 */
import { ChatbotController } from '@api/integrations/chatbot/chatbot.controller';
import { OpenaiController } from '@api/integrations/chatbot/openai/controllers/openai.controller';
import { OpenaiService } from '@api/integrations/chatbot/openai/services/openai.service';
import { UsageService } from '@api/services/usage.service';
import { configService } from '@config/env.config';
import { registerBotMessageId } from '@utils/botMessageRegistry';
import { defaultWeek } from '@utils/usageLimits';

import { serverModuleOverrides } from '../helpers/chatbot-emit';
import { VirtualClock } from './clock';
import { OFFICE, SYSTEM_PROMPT } from './office';
import { createSimPrisma } from './sim-prisma';

export type TranscriptEvent = {
  who: 'customer' | 'bot' | 'team';
  text: string;
  at: number;
  /** Customer: what the channel did with it. Bot: 'reply' | 'notice' | 'fallback'. */
  kind: string;
  delivered?: boolean;
  id?: string;
};

export type OfficeInstance = {
  name: string;
  instanceId: string;
  handoffTool: boolean;
  hoursMode: 'inside' | 'always';
  outsideHoursMessage: string | null;
  wa: any;
};

export const UNKNOWN_MESSAGE = 'Desculpe, tive um problema. A equipe vai falar com você.';
export const OUTSIDE_HOURS_MESSAGE =
  'Olá! Nosso atendimento é de segunda a sexta, das 9h às 18h. Assim que abrirmos, a equipe responde por aqui.';
export const DEBOUNCE_SECONDS = 8;

export class World {
  readonly prisma: any;
  readonly service: any;
  readonly controller: any;
  readonly chatbot: ChatbotController;
  readonly instances: OfficeInstance[] = [];
  /** Transcript per chat (key: instanceId|jid). */
  readonly transcripts = new Map<string, TranscriptEvent[]>();
  /** Messages each team number received (hand-over notices). */
  readonly teamInbox: { instanceId: string; number: string; text: string; at: number }[] = [];
  /** Every send to a customer chat, to detect cross-talk. */
  readonly sends: { instanceId: string; jid: string; text: string; at: number }[] = [];
  private msgCounter = 0;
  private sendCounter = 0;

  constructor(
    readonly clock: VirtualClock,
    model: any,
    options: { apiKey?: string; model?: string; realModel?: boolean } = {},
  ) {
    this.prisma = createSimPrisma(options.apiKey ?? 'sk-sim-not-real');
    const waInstances: Record<string, any> = {};
    const leads = {
      getSettings: async () => ({ notify: { enabled: true, numbers: OFFICE.teamNumbers, on: 'ambos' } }),
      afterBotReply: () => undefined,
      recordHumanReply: () => undefined,
    };
    const usage = new UsageService(this.prisma, { cacheTtlMs: 0 });
    this.service = new OpenaiService({ waInstances } as any, this.prisma, configService, usage, leads as any);
    if (!options.realModel) this.service.initClient = () => model;
    else this.service.initClient = (apiKey: string) => model(apiKey);
    this.controller = new OpenaiController(this.service, this.prisma, { waInstances } as any);
    this.chatbot = new ChatbotController(this.prisma, { waInstances } as any);
    serverModuleOverrides.openaiController = { emit: (data: any) => this.controller.emit(data) };
    this.modelName = options.model ?? 'sim-triage';
    this.waInstances = waInstances;
  }

  private readonly modelName: string;
  private readonly waInstances: Record<string, any>;

  /** Creates an office instance (bot + settings + limits) and its channel. */
  async addInstance(config: { handoffTool: boolean; hoursMode: 'inside' | 'always' }): Promise<OfficeInstance> {
    const index = this.instances.length;
    const name = `escritorio-sim-${index}`;
    const instanceId = `inst-sim-${index}`;
    const wa = this.createChannel(name, instanceId);
    this.waInstances[name] = wa;

    await this.prisma.openaiBot.create({
      data: {
        id: `bot-sim-${index}`,
        enabled: true,
        botType: 'chatCompletion',
        model: this.modelName,
        openaiCredsId: 'creds-sim',
        instanceId,
        triggerType: 'all',
        systemMessages: [SYSTEM_PROMPT],
        assistantMessages: [],
        userMessages: [],
        maxTokens: 800,
        keywordFinish: '#sair',
        stopBotFromMe: true,
        listeningFromMe: false,
        debounceTime: DEBOUNCE_SECONDS,
        splitMessages: false,
        timePerChar: 50,
        expire: 0,
      },
    });
    await this.prisma.openaiSetting.create({
      data: {
        instanceId,
        openaiCredsId: 'creds-sim',
        ignoreJids: [],
        stopBotFromMe: true,
        listeningFromMe: false,
        debounceTime: DEBOUNCE_SECONDS,
        keywordFinish: '#sair',
        unknownMessage: UNKNOWN_MESSAGE,
        ethicsProfile: 'advocacia',
        handoffTool: config.handoffTool,
        readImages: true,
        readDocuments: true,
        transcribeAudio: false,
        historyMessages: 30,
        humanResumeMinutes: 0,
        timePerChar: 50,
      },
    });
    const outsideHoursMessage = config.hoursMode === 'inside' ? OUTSIDE_HOURS_MESSAGE : null;
    await this.prisma.instanceLimits.upsert({
      where: { instanceId },
      create: {
        instanceId,
        overLimitAction: 'continue',
        alertPercent: 80,
        businessHours: { enabled: true, mode: config.hoursMode, timezone: 'America/Sao_Paulo', week: defaultWeek() },
        outsideHoursMessage,
      },
      update: {},
    });

    const office: OfficeInstance = { name, instanceId, wa, outsideHoursMessage, ...config };
    this.instances.push(office);
    return office;
  }

  transcript(office: OfficeInstance, jid: string): TranscriptEvent[] {
    const key = `${office.instanceId}|${jid}`;
    let list = this.transcripts.get(key);
    if (!list) this.transcripts.set(key, (list = []));
    return list;
  }

  private createChannel(instanceName: string, instanceId: string) {
    const record = async (data: any, kind: string, fromChatbot: boolean) => {
      const id = `3EB0SIM${++this.sendCounter}`;
      if (fromChatbot) await registerBotMessageId(instanceId, id);
      const number = String(data.number);
      const jid = number.includes('@') ? number : `${number}@s.whatsapp.net`;
      const text = String(data.text ?? data.caption ?? '');
      const office = this.instances.find((item) => item.instanceId === instanceId);
      if (office && OFFICE.teamNumbers.includes(number)) {
        this.teamInbox.push({ instanceId, number, text, at: this.clock.now() });
      } else if (office) {
        const botKind =
          text === office.outsideHoursMessage ? 'notice' : text === UNKNOWN_MESSAGE ? 'fallback' : 'reply';
        this.transcript(office, jid).push({ who: 'bot', text, at: this.clock.now(), kind: botKind, id });
        this.sends.push({ instanceId, jid, text, at: this.clock.now() });
        // The channel echoes every message the number sends (messages.upsert fromMe)
        setTimeout(() => {
          void this.chatbot
            .emit({
              instance: { instanceName, instanceId },
              remoteJid: jid,
              msg: {
                key: { id, remoteJid: jid, fromMe: true },
                pushName: 'Você',
                message: { conversation: text },
                messageType: 'conversation',
                messageTimestamp: Math.floor(this.clock.now() / 1000),
              },
              pushName: 'Você',
            })
            .catch(() => undefined);
        }, 50);
      }
      return { key: { id, remoteJid: jid, fromMe: true } };
    };
    return {
      instanceName,
      instanceId,
      integration: 'WHATSAPP-BAILEYS',
      localSettings: { alwaysOnline: false },
      client: {
        presenceSubscribe: async () => undefined,
        sendPresenceUpdate: async () => undefined,
      },
      textMessage: (data: any, ...args: any[]) => record(data, 'text', args[1] === true),
      mediaMessage: (data: any, ...args: any[]) => record(data, 'media', args[2] === true),
      audioWhatsapp: (data: any, ...args: any[]) => record(data, 'audio', args[2] === true),
      sendDataWebhook: async () => undefined,
      getBase64FromMediaMessage: async () => null,
    };
  }

  nextMessageId(): string {
    return `SIM${String(++this.msgCounter).padStart(7, '0')}`;
  }

  /**
   * A message arriving from WhatsApp (customer or the team's phone), through the channel rules. `chatJid` is the
   * chat in the transcript (the phone JID of the contact, or the group).
   */
  async receive(office: OfficeInstance, chatJid: string, msg: any, meta: { kind: string; who?: 'customer' | 'team' }) {
    const who = meta.who ?? 'customer';
    const message = msg.message ?? {};
    const text =
      message.conversation ??
      message.extendedTextMessage?.text ??
      message.speechToText ??
      message.imageMessage?.caption ??
      message.documentMessage?.fileName ??
      (message.stickerMessage
        ? '[figurinha]'
        : message.reactionMessage
          ? `[reação ${message.reactionMessage.text}]`
          : '');
    // Baileys: protocol messages (deletion), edits and encrypted edits are never handed to the bots
    const filtered = !!(message.protocolMessage || message.editedMessage || message.secretEncryptedMessage);
    this.transcript(office, chatJid).push({
      who,
      text: String(text),
      at: this.clock.now(),
      kind: meta.kind,
      delivered: !filtered,
      id: msg.key?.id,
    });
    if (filtered) return;
    const key = { ...msg.key };
    if (String(key.remoteJid).includes('@lid') && key.remoteJidAlt) key.remoteJid = key.remoteJidAlt;
    const raw = { ...msg, key, messageTimestamp: msg.messageTimestamp ?? Math.floor(this.clock.now() / 1000) };
    await this.chatbot.emit({
      instance: { instanceName: office.name, instanceId: office.instanceId },
      remoteJid: key.remoteJid,
      msg: raw,
      pushName: raw.pushName,
    });
  }

  /** Session of a chat (any address of it). */
  async session(office: OfficeInstance, jids: string[]) {
    return this.prisma.integrationSession.findFirst({
      where: { instanceId: office.instanceId, remoteJid: { in: jids } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async idle(): Promise<void> {
    await this.controller.idleReplies();
  }
}
