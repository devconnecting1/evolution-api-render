import { InstanceDto } from '@api/dto/instance.dto';
import { PrismaRepository } from '@api/repository/repository.service';
import {
  difyController,
  evoaiController,
  evolutionBotController,
  flowiseController,
  n8nController,
  openaiController,
  typebotController,
} from '@api/server.module';
import { WAMonitoringService } from '@api/services/monitor.service';
import { Logger } from '@config/logger.config';
import { IntegrationSession } from '@prisma/client';
import { findBotByTrigger } from '@utils/findBotByTrigger';
import { claimMessageOnce } from '@utils/processedMessageRegistry';

import { mergeReplyMeta, ReplyMeta, ReplyTicket, runWithReplyTicket } from './reply-ticket';

export type EmitData = {
  instance: InstanceDto;
  remoteJid: string;
  msg: any;
  pushName?: string;
};

export interface ChatbotControllerInterface {
  integrationEnabled: boolean;
  botRepository: any;
  settingsRepository: any;
  sessionRepository: any;
  userMessageDebounce: { [key: string]: { message: string; timeoutId: NodeJS.Timeout } };

  createBot(instance: InstanceDto, data: any): Promise<any>;
  findBot(instance: InstanceDto): Promise<any>;
  fetchBot(instance: InstanceDto, botId: string): Promise<any>;
  updateBot(instance: InstanceDto, botId: string, data: any): Promise<any>;
  deleteBot(instance: InstanceDto, botId: string): Promise<any>;

  settings(instance: InstanceDto, data: any): Promise<any>;
  fetchSettings(instance: InstanceDto): Promise<any>;

  changeStatus(instance: InstanceDto, botId: string, status: string): Promise<any>;
  fetchSessions(instance: InstanceDto, botId: string, remoteJid?: string): Promise<any>;
  ignoreJid(instance: InstanceDto, data: any): Promise<any>;

  emit(data: EmitData): Promise<void>;
}

export class ChatbotController {
  public prismaRepository: PrismaRepository;
  public waMonitor: WAMonitoringService;

  public readonly logger = new Logger('ChatbotController');

  constructor(prismaRepository: PrismaRepository, waMonitor: WAMonitoringService) {
    this.prisma = prismaRepository;
    this.monitor = waMonitor;
  }

  public set prisma(prisma: PrismaRepository) {
    this.prismaRepository = prisma;
  }

  public get prisma() {
    return this.prismaRepository;
  }

  public set monitor(waMonitor: WAMonitoringService) {
    this.waMonitor = waMonitor;
  }

  public get monitor() {
    return this.waMonitor;
  }

  public async emit({
    instance,
    remoteJid,
    msg,
    pushName,
    isIntegration = false,
  }: {
    instance: InstanceDto;
    remoteJid: string;
    msg: any;
    pushName?: string;
    isIntegration?: boolean;
  }): Promise<void> {
    // A redelivery of an id already handed to the bots (#2737) must not be answered, billed or stored again.
    // Claimed once here, before the fan-out, so one bot never blocks another of the same instance.
    const keyId = msg?.key?.id;
    if (keyId && !(await claimMessageOnce(instance?.instanceId, keyId))) {
      this.logger.verbose(`Message ${keyId} already handed to the chatbots: redelivery ignored`);
      return;
    }

    const emitData = {
      instance,
      remoteJid,
      msg,
      pushName,
      isIntegration,
    };
    evolutionBotController.emit(emitData);

    typebotController.emit(emitData);

    openaiController.emit(emitData);

    difyController.emit(emitData);

    n8nController.emit(emitData);

    evoaiController.emit(emitData);

    flowiseController.emit(emitData);
  }

  /**
   * Reply being produced per chat key (after the debounce fired): its ticket, the merged content it answers and
   * a promise settled when it is over. See reply-ticket.ts.
   */
  private readonly inflightReplies = new Map<
    string,
    { ticket: ReplyTicket; content: string; meta: ReplyMeta; done: Promise<void> }
  >();

  /** How many replies were cancelled and merged with a newer message (logged, for the "double reply" metric). */
  public mergedReplies = 0;

  /**
   * Debounce of the customer's messages, one window per chat key, and at most ONE reply per burst:
   * - messages inside the window are joined (one line each);
   * - a message that arrives while the reply of the previous window is still being generated or typed (not sent
   *   yet) cancels that reply and is joined to it in a new window, so the customer gets a single answer that
   *   covers all their messages. A reply that already started sending is finished and the new message gets its
   *   own reply, strictly after it (replies of the same chat never overlap).
   * The callback runs inside the ReplyTicket context (currentReplyTicket()).
   */
  public processDebounce(
    userMessageDebounce: any,
    content: string,
    remoteJid: string,
    debounceTime: number,
    callback: any,
    meta: ReplyMeta = {},
  ) {
    const key = remoteJid;
    const pending = userMessageDebounce[key];

    if (pending) {
      pending.message += `\n${content}`;
      pending.meta = mergeReplyMeta(pending.meta, meta);
      this.logger.log(`message debounced for ${key} (${pending.message.split('\n').length} lines)`);
      clearTimeout(pending.timeoutId);
    } else {
      const inflight = this.inflightReplies.get(key);
      let message = content;
      let merged = meta;

      if (inflight?.ticket.cancel()) {
        // Not sent yet: answer both together instead of sending two separate replies
        message = `${inflight.content}\n${content}`;
        merged = mergeReplyMeta(inflight.meta, meta);
        this.mergedReplies++;
        this.logger.log(`New message for ${key} while the reply was being prepared: merged into one reply`);
      }

      userMessageDebounce[key] = { message, timeoutId: null, meta: merged, after: inflight?.done };
    }

    userMessageDebounce[key].timeoutId = setTimeout(() => {
      const window = userMessageDebounce[key];
      delete userMessageDebounce[key];
      const ticket = new ReplyTicket(window.meta ?? {});
      const previous: Promise<void> | undefined = window.after ?? this.inflightReplies.get(key)?.done;
      this.logger.log(`Debounce complete for ${key}: processing ${window.message.split('\n').length} line(s)`);

      const done = (async () => {
        // Replies of one chat never overlap: wait for the previous one (cancelled or still sending its parts)
        if (previous) await previous.catch(() => undefined);
        if (ticket.cancelled) return;
        await runWithReplyTicket(ticket, () => Promise.resolve(callback(window.message)));
        // Cancelled before anything went out: undo what it saved (e.g. the history) before the merged reply runs
        if (ticket.cancelled) await ticket.rollback();
      })()
        .catch((error) => {
          this.logger.error(`Error processing debounced message: ${error?.message || error}`);
        })
        .finally(() => {
          if (this.inflightReplies.get(key)?.ticket === ticket) this.inflightReplies.delete(key);
        });

      this.inflightReplies.set(key, { ticket, content: window.message, meta: window.meta ?? {}, done });
    }, debounceTime * 1000);
  }

  /** Settles when every reply in progress is over (tests and graceful shutdown). */
  public async idleReplies(): Promise<void> {
    while (this.inflightReplies.size) {
      await Promise.all([...this.inflightReplies.values()].map((reply) => reply.done));
    }
  }

  public checkIgnoreJids(ignoreJids: any, remoteJid: string) {
    if (ignoreJids && ignoreJids.length > 0) {
      let ignoreGroups = false;
      let ignoreContacts = false;

      if (ignoreJids.includes('@g.us')) {
        ignoreGroups = true;
      }

      if (ignoreJids.includes('@s.whatsapp.net')) {
        ignoreContacts = true;
      }

      if (ignoreGroups && remoteJid.endsWith('@g.us')) {
        this.logger.warn('Ignoring message from group: ' + remoteJid);
        return true;
      }

      if (ignoreContacts && remoteJid.endsWith('@s.whatsapp.net')) {
        this.logger.warn('Ignoring message from contact: ' + remoteJid);
        return true;
      }

      if (ignoreJids.includes(remoteJid)) {
        this.logger.warn('Ignoring message from jid: ' + remoteJid);
        return true;
      }

      return false;
    }

    return false;
  }

  /**
   * Latest bot session of the chat. `alternativeJids` lets the same chat be found when the contact shows up
   * with another address (e.g. `@lid` vs `@s.whatsapp.net`).
   */
  public async getSession(remoteJid: string, instance: InstanceDto, alternativeJids: string[] = []) {
    const jids = [...new Set([remoteJid, ...alternativeJids].filter(Boolean))];

    let session = await this.prismaRepository.integrationSession.findFirst({
      where: {
        remoteJid: jids.length > 1 ? { in: jids } : remoteJid,
        instanceId: instance.instanceId,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (session) {
      if (session.status !== 'closed' && !session.botId) {
        this.logger.warn('Session is already opened in another integration');
        return null;
      } else if (!session.botId) {
        session = null;
      }
    }

    return session;
  }

  public async findBotTrigger(
    botRepository: any,
    content: string,
    instance: InstanceDto,
    session?: IntegrationSession,
  ) {
    let findBot: any;

    if (!session) {
      findBot = await findBotByTrigger(botRepository, content, instance.instanceId);

      if (!findBot) {
        return null;
      }
    } else {
      findBot = await botRepository.findFirst({
        where: {
          id: session.botId,
        },
      });
    }

    return findBot;
  }
}
