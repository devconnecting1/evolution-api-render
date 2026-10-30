import { IgnoreJidDto } from '@api/dto/chatbot.dto';
import { InstanceDto } from '@api/dto/instance.dto';
import { PrismaRepository } from '@api/repository/repository.service';
import { WAMonitoringService } from '@api/services/monitor.service';
import { Events } from '@api/types/wa.types';
import { Logger } from '@config/logger.config';
import { BadRequestException } from '@exceptions';
import { TriggerOperator, TriggerType } from '@prisma/client';
import { isBotMessageId } from '@utils/botMessageRegistry';
import { getConversationMessage } from '@utils/getConversationMessage';
import {
  describeHumanPause,
  getHumanLastMessageAt,
  isHumanPaused,
  isHumanPauseExpired,
  isManualPause,
  resolveHumanResumeMinutes,
  withHumanLastMessageAt,
  withManualPause,
  withoutHumanLastMessageAt,
} from '@utils/humanPause';
import { jidNormalizedUser } from 'baileys';

import { BaseChatbotDto } from './base-chatbot.dto';
import { ChatbotController, ChatbotControllerInterface, EmitData } from './chatbot.controller';

// Common settings interface for all chatbot integrations
export interface ChatbotSettings {
  expire: number;
  keywordFinish: string;
  delayMessage: number;
  unknownMessage: string;
  listeningFromMe: boolean;
  stopBotFromMe: boolean;
  keepOpen: boolean;
  debounceTime: number;
  ignoreJids: string[];
  splitMessages: boolean;
  timePerChar: number;
  [key: string]: any;
}

// Common bot properties for all chatbot integrations
export interface BaseBotData {
  enabled?: boolean;
  description: string;
  expire?: number;
  keywordFinish?: string;
  delayMessage?: number;
  unknownMessage?: string;
  listeningFromMe?: boolean;
  stopBotFromMe?: boolean;
  keepOpen?: boolean;
  debounceTime?: number;
  triggerType: string | TriggerType;
  triggerOperator?: string | TriggerOperator;
  triggerValue?: string;
  ignoreJids?: string[];
  splitMessages?: boolean;
  timePerChar?: number;
  [key: string]: any;
}

export abstract class BaseChatbotController<BotType = any, BotData extends BaseChatbotDto = BaseChatbotDto>
  extends ChatbotController
  implements ChatbotControllerInterface
{
  public readonly logger: Logger;

  integrationEnabled: boolean;
  botRepository: any;
  settingsRepository: any;
  sessionRepository: any;
  userMessageDebounce: { [key: string]: { message: string; timeoutId: NodeJS.Timeout } } = {};

  // Name of the integration, to be set by the derived class
  protected abstract readonly integrationName: string;

  // Method to process bot-specific logic
  protected abstract processBot(
    waInstance: any,
    remoteJid: string,
    bot: BotType,
    session: any,
    settings: ChatbotSettings,
    content: string,
    pushName?: string,
    msg?: any,
  ): Promise<void>;

  // Method to get the fallback bot ID from settings
  protected abstract getFallbackBotId(settings: any): string | undefined;

  constructor(prismaRepository: PrismaRepository, waMonitor: WAMonitoringService) {
    super(prismaRepository, waMonitor);

    this.sessionRepository = this.prismaRepository.integrationSession;
  }

  // Base create bot implementation
  public async createBot(instance: InstanceDto, data: BotData) {
    if (!this.integrationEnabled) throw new BadRequestException(`${this.integrationName} is disabled`);

    const instanceId = await this.prismaRepository.instance
      .findFirst({
        where: {
          name: instance.instanceName,
        },
      })
      .then((instance) => instance.id);

    // Set default settings if not provided
    if (
      !data.expire ||
      !data.keywordFinish ||
      !data.delayMessage ||
      !data.unknownMessage ||
      !data.listeningFromMe ||
      !data.stopBotFromMe ||
      !data.keepOpen ||
      !data.debounceTime ||
      !data.ignoreJids ||
      !data.splitMessages ||
      !data.timePerChar
    ) {
      const defaultSettingCheck = await this.settingsRepository.findFirst({
        where: {
          instanceId: instanceId,
        },
      });

      if (data.expire === undefined || data.expire === null) data.expire = defaultSettingCheck?.expire;
      if (data.keywordFinish === undefined || data.keywordFinish === null)
        data.keywordFinish = defaultSettingCheck?.keywordFinish;
      if (data.delayMessage === undefined || data.delayMessage === null)
        data.delayMessage = defaultSettingCheck?.delayMessage;
      if (data.unknownMessage === undefined || data.unknownMessage === null)
        data.unknownMessage = defaultSettingCheck?.unknownMessage;
      if (data.listeningFromMe === undefined || data.listeningFromMe === null)
        data.listeningFromMe = defaultSettingCheck?.listeningFromMe;
      if (data.stopBotFromMe === undefined || data.stopBotFromMe === null)
        data.stopBotFromMe = defaultSettingCheck?.stopBotFromMe;
      if (data.keepOpen === undefined || data.keepOpen === null) data.keepOpen = defaultSettingCheck?.keepOpen;
      if (data.debounceTime === undefined || data.debounceTime === null)
        data.debounceTime = defaultSettingCheck?.debounceTime;
      if (data.ignoreJids === undefined || data.ignoreJids === null) data.ignoreJids = defaultSettingCheck?.ignoreJids;
      if (data.splitMessages === undefined || data.splitMessages === null)
        data.splitMessages = defaultSettingCheck?.splitMessages ?? false;
      if (data.timePerChar === undefined || data.timePerChar === null)
        data.timePerChar = defaultSettingCheck?.timePerChar ?? 0;

      if (!defaultSettingCheck) {
        await this.settings(instance, {
          expire: data.expire,
          keywordFinish: data.keywordFinish,
          delayMessage: data.delayMessage,
          unknownMessage: data.unknownMessage,
          listeningFromMe: data.listeningFromMe,
          stopBotFromMe: data.stopBotFromMe,
          keepOpen: data.keepOpen,
          debounceTime: data.debounceTime,
          ignoreJids: data.ignoreJids,
          splitMessages: data.splitMessages,
          timePerChar: data.timePerChar,
        });
      }
    }

    const checkTriggerAll = await this.botRepository.findFirst({
      where: {
        enabled: true,
        triggerType: 'all',
        instanceId: instanceId,
      },
    });

    if (checkTriggerAll && data.triggerType === 'all') {
      throw new Error(
        `You already have a ${this.integrationName} with an "All" trigger, you cannot have more bots while it is active`,
      );
    }

    // Check for trigger keyword duplicates
    if (data.triggerType === 'keyword') {
      if (!data.triggerOperator || !data.triggerValue) {
        throw new Error('Trigger operator and value are required');
      }

      const checkDuplicate = await this.botRepository.findFirst({
        where: {
          triggerOperator: data.triggerOperator,
          triggerValue: data.triggerValue,
          instanceId: instanceId,
        },
      });

      if (checkDuplicate) {
        throw new Error('Trigger already exists');
      }
    }

    // Check for trigger advanced duplicates
    if (data.triggerType === 'advanced') {
      if (!data.triggerValue) {
        throw new Error('Trigger value is required');
      }

      const checkDuplicate = await this.botRepository.findFirst({
        where: {
          triggerValue: data.triggerValue,
          instanceId: instanceId,
        },
      });

      if (checkDuplicate) {
        throw new Error('Trigger already exists');
      }
    }

    // Derived classes should implement the specific duplicate checking before calling this method
    // and add bot-specific fields to the data object

    try {
      const botData = {
        enabled: data?.enabled,
        description: data.description,
        expire: data.expire,
        keywordFinish: data.keywordFinish,
        delayMessage: data.delayMessage,
        unknownMessage: data.unknownMessage,
        listeningFromMe: data.listeningFromMe,
        stopBotFromMe: data.stopBotFromMe,
        keepOpen: data.keepOpen,
        debounceTime: data.debounceTime,
        instanceId: instanceId,
        triggerType: data.triggerType,
        triggerOperator: data.triggerOperator,
        triggerValue: data.triggerValue,
        ignoreJids: data.ignoreJids,
        splitMessages: data.splitMessages,
        timePerChar: data.timePerChar,
        ...this.getAdditionalBotData(data),
      };

      const bot = await this.botRepository.create({
        data: botData,
      });

      return bot;
    } catch (error) {
      this.logger.error(error);
      throw new Error(`Error creating ${this.integrationName}`);
    }
  }

  // Additional fields needed for specific bot types
  protected abstract getAdditionalBotData(data: BotData): Record<string, any>;

  // Common implementation for findBot
  public async findBot(instance: InstanceDto) {
    if (!this.integrationEnabled) throw new BadRequestException(`${this.integrationName} is disabled`);

    const instanceId = await this.prismaRepository.instance
      .findFirst({
        where: {
          name: instance.instanceName,
        },
      })
      .then((instance) => instance.id);

    try {
      const bots = await this.botRepository.findMany({
        where: {
          instanceId: instanceId,
        },
      });

      return bots;
    } catch (error) {
      this.logger.error(error);
      throw new Error(`Error finding ${this.integrationName}`);
    }
  }

  // Common implementation for fetchBot
  public async fetchBot(instance: InstanceDto, botId: string) {
    if (!this.integrationEnabled) throw new BadRequestException(`${this.integrationName} is disabled`);

    try {
      const bot = await this.botRepository.findUnique({
        where: {
          id: botId,
        },
      });

      if (!bot) {
        return null;
      }

      return bot;
    } catch (error) {
      this.logger.error(error);
      throw new Error(`Error fetching ${this.integrationName}`);
    }
  }

  // Common implementation for settings
  public async settings(instance: InstanceDto, data: any) {
    if (!this.integrationEnabled) throw new BadRequestException(`${this.integrationName} is disabled`);

    try {
      const instanceId = await this.prismaRepository.instance
        .findFirst({
          where: {
            name: instance.instanceName,
          },
        })
        .then((instance) => instance.id);

      const existingSettings = await this.settingsRepository.findFirst({
        where: {
          instanceId: instanceId,
        },
      });

      // Get the name of the fallback field for this integration type
      const fallbackFieldName = this.getFallbackFieldName();

      const settingsData = {
        expire: data.expire,
        keywordFinish: data.keywordFinish,
        delayMessage: data.delayMessage,
        unknownMessage: data.unknownMessage,
        listeningFromMe: data.listeningFromMe,
        stopBotFromMe: data.stopBotFromMe,
        keepOpen: data.keepOpen,
        debounceTime: data.debounceTime,
        ignoreJids: data.ignoreJids,
        splitMessages: data.splitMessages,
        timePerChar: data.timePerChar,
        [fallbackFieldName]: data.fallbackId, // Use the correct field name dynamically
      };

      if (existingSettings) {
        const settings = await this.settingsRepository.update({
          where: {
            id: existingSettings.id,
          },
          data: settingsData,
        });

        // Map the specific fallback field to a generic 'fallbackId' in the response
        return {
          ...settings,
          fallbackId: settings[fallbackFieldName],
        };
      } else {
        const settings = await this.settingsRepository.create({
          data: {
            ...settingsData,
            Instance: {
              connect: {
                id: instanceId,
              },
            },
          },
        });

        // Map the specific fallback field to a generic 'fallbackId' in the response
        return {
          ...settings,
          fallbackId: settings[fallbackFieldName],
        };
      }
    } catch (error) {
      this.logger.error(error);
      throw new Error('Error setting default settings');
    }
  }

  // Abstract method to get the field name for the fallback ID
  protected abstract getFallbackFieldName(): string;

  // Abstract method to get the integration type (dify, n8n, evoai, etc.)
  protected abstract getIntegrationType(): string;

  // Common implementation for fetchSettings
  public async fetchSettings(instance: InstanceDto) {
    if (!this.integrationEnabled) throw new BadRequestException(`${this.integrationName} is disabled`);

    try {
      const instanceId = await this.prismaRepository.instance
        .findFirst({
          where: {
            name: instance.instanceName,
          },
        })
        .then((instance) => instance.id);

      const settings = await this.settingsRepository.findFirst({
        where: {
          instanceId: instanceId,
        },
        include: {
          Fallback: true,
        },
      });

      // Get the name of the fallback field for this integration type
      const fallbackFieldName = this.getFallbackFieldName();

      if (!settings) {
        return {
          expire: 300,
          keywordFinish: 'bye',
          delayMessage: 1000,
          unknownMessage: 'Sorry, I dont understand',
          listeningFromMe: true,
          stopBotFromMe: true,
          keepOpen: false,
          debounceTime: 1,
          ignoreJids: [],
          splitMessages: false,
          timePerChar: 0,
          fallbackId: '',
          fallback: null,
        };
      }

      // Return with standardized fallbackId field
      return {
        ...settings,
        fallbackId: settings[fallbackFieldName],
        fallback: settings.Fallback,
      };
    } catch (error) {
      this.logger.error(error);
      throw new Error('Error fetching settings');
    }
  }

  // Common implementation for changeStatus
  public async changeStatus(instance: InstanceDto, data: any) {
    if (!this.integrationEnabled) throw new BadRequestException(`${this.integrationName} is disabled`);

    try {
      const instanceId = await this.prismaRepository.instance
        .findFirst({
          where: {
            name: instance.instanceName,
          },
        })
        .then((instance) => instance.id);

      const defaultSettingCheck = await this.settingsRepository.findFirst({
        where: {
          instanceId,
        },
      });

      const remoteJid = data.remoteJid;
      const status = data.status;
      // The route only carries instanceName: scope the session to this instance
      const session = await this.getSession(remoteJid, { ...instance, instanceId });

      if (this.integrationName === 'Typebot') {
        const typebotData = {
          remoteJid: remoteJid,
          status: status,
          session,
        };
        this.waMonitor.waInstances[instance.instanceName].sendDataWebhook(Events.TYPEBOT_CHANGE_STATUS, typebotData);
      }

      if (status === 'delete') {
        await this.sessionRepository.deleteMany({
          where: {
            instanceId: instanceId,
            remoteJid: remoteJid,
            botId: { not: null },
          },
        });

        this.notifyStatusChange(instance, session, () => ({
          remoteJid,
          status,
          reason: 'manual',
          session,
          humanPause: null,
        }));

        return { bot: { remoteJid: remoteJid, status: status } };
      }

      if (status === 'closed') {
        if (defaultSettingCheck?.keepOpen) {
          await this.sessionRepository.updateMany({
            where: {
              instanceId: instanceId,
              remoteJid: remoteJid,
              botId: { not: null },
            },
            data: {
              status: 'closed',
            },
          });
        } else {
          await this.sessionRepository.deleteMany({
            where: {
              instanceId: instanceId,
              remoteJid: remoteJid,
              botId: { not: null },
            },
          });
        }

        this.notifyStatusChange(instance, session, () => ({
          remoteJid,
          status,
          reason: 'manual',
          session,
          humanPause: null,
        }));

        return { bot: { ...instance, bot: { remoteJid: remoteJid, status: status } } };
      } else {
        const where = {
          instanceId: instanceId,
          remoteJid: remoteJid,
          botId: { not: null },
        };

        const updated = await this.sessionRepository.updateMany({
          where,
          data: {
            status: status,
          },
        });

        // A manual status change ends any human-takeover timer: 'opened' must not be re-paused by an old
        // timestamp and a manual 'paused' must only be lifted manually.
        await this.applyManualStatus(where, status);

        this.notifyStatusChange(instance, session, async () => {
          // Reload: applyManualStatus changed the parameters the pause state is read from
          const fresh = await this.sessionRepository.findUnique({ where: { id: session.id } });
          const bot = fresh?.botId ? await this.botRepository.findFirst({ where: { id: fresh.botId } }) : null;

          return {
            remoteJid,
            status,
            reason: 'manual',
            session,
            humanPause: describeHumanPause(fresh, resolveHumanResumeMinutes(bot, defaultSettingCheck)),
          };
        });

        const botData = {
          remoteJid: remoteJid,
          status: status,
          session: updated,
        };

        return { bot: { ...instance, bot: botData } };
      }
    } catch (error) {
      this.logger.error(error);
      throw new Error(`Error changing ${this.integrationName} status`);
    }
  }

  // Common implementation for fetchSessions
  public async fetchSessions(instance: InstanceDto, botId: string, remoteJid?: string) {
    if (!this.integrationEnabled) throw new BadRequestException(`${this.integrationName} is disabled`);

    try {
      const instanceId = await this.prismaRepository.instance
        .findFirst({
          where: {
            name: instance.instanceName,
          },
        })
        .then((instance) => instance.id);

      const bot = await this.botRepository.findFirst({
        where: {
          id: botId,
        },
      });

      if (bot && bot.instanceId !== instanceId) {
        throw new Error(`${this.integrationName} not found`);
      }

      // Get the integration type (dify, n8n, evoai, etc.)
      const integrationType = this.getIntegrationType();

      return await this.sessionRepository.findMany({
        where: {
          instanceId: instanceId,
          remoteJid,
          botId: bot ? botId : { not: null },
          type: integrationType,
        },
      });
    } catch (error) {
      this.logger.error(error);
      throw new Error('Error fetching sessions');
    }
  }

  // Common implementation for ignoreJid
  public async ignoreJid(instance: InstanceDto, data: IgnoreJidDto) {
    if (!this.integrationEnabled) throw new BadRequestException(`${this.integrationName} is disabled`);

    try {
      const instanceId = await this.prismaRepository.instance
        .findFirst({
          where: {
            name: instance.instanceName,
          },
        })
        .then((instance) => instance.id);

      const settings = await this.settingsRepository.findFirst({
        where: {
          instanceId: instanceId,
        },
      });

      if (!settings) {
        throw new Error('Settings not found');
      }

      let ignoreJids: any = settings?.ignoreJids || [];

      if (data.action === 'add') {
        if (ignoreJids.includes(data.remoteJid)) return { ignoreJids: ignoreJids };

        ignoreJids.push(data.remoteJid);
      } else {
        ignoreJids = ignoreJids.filter((jid) => jid !== data.remoteJid);
      }

      const updateSettings = await this.settingsRepository.update({
        where: {
          id: settings.id,
        },
        data: {
          ignoreJids: ignoreJids,
        },
      });

      return {
        ignoreJids: updateSettings.ignoreJids,
      };
    } catch (error) {
      this.logger.error(error);
      throw new Error('Error setting default settings');
    }
  }

  // Base implementation for updateBot
  public async updateBot(instance: InstanceDto, botId: string, data: BotData) {
    if (!this.integrationEnabled) throw new BadRequestException(`${this.integrationName} is disabled`);

    try {
      const instanceId = await this.prismaRepository.instance
        .findFirst({
          where: {
            name: instance.instanceName,
          },
        })
        .then((instance) => instance.id);

      const bot = await this.botRepository.findFirst({
        where: {
          id: botId,
        },
      });

      if (!bot) {
        throw new Error(`${this.integrationName} not found`);
      }

      if (bot.instanceId !== instanceId) {
        throw new Error(`${this.integrationName} not found`);
      }

      // Check for "all" trigger type conflicts
      if (data.triggerType === 'all') {
        const checkTriggerAll = await this.botRepository.findFirst({
          where: {
            enabled: true,
            triggerType: 'all',
            id: {
              not: botId,
            },
            instanceId: instanceId,
          },
        });

        if (checkTriggerAll) {
          throw new Error(
            `You already have a ${this.integrationName} with an "All" trigger, you cannot have more bots while it is active`,
          );
        }
      }

      // Let subclasses check for integration-specific duplicates
      await this.validateNoDuplicatesOnUpdate(botId, instanceId, data);

      // Check for keyword trigger duplicates
      if (data.triggerType === 'keyword') {
        if (!data.triggerOperator || !data.triggerValue) {
          throw new Error('Trigger operator and value are required');
        }

        const checkDuplicate = await this.botRepository.findFirst({
          where: {
            triggerOperator: data.triggerOperator,
            triggerValue: data.triggerValue,
            id: { not: botId },
            instanceId: instanceId,
          },
        });

        if (checkDuplicate) {
          throw new Error('Trigger already exists');
        }
      }

      // Check for advanced trigger duplicates
      if (data.triggerType === 'advanced') {
        if (!data.triggerValue) {
          throw new Error('Trigger value is required');
        }

        const checkDuplicate = await this.botRepository.findFirst({
          where: {
            triggerValue: data.triggerValue,
            id: { not: botId },
            instanceId: instanceId,
          },
        });

        if (checkDuplicate) {
          throw new Error('Trigger already exists');
        }
      }

      // Combine common fields with bot-specific fields
      const updateData = {
        enabled: data?.enabled,
        description: data.description,
        expire: data.expire,
        keywordFinish: data.keywordFinish,
        delayMessage: data.delayMessage,
        unknownMessage: data.unknownMessage,
        listeningFromMe: data.listeningFromMe,
        stopBotFromMe: data.stopBotFromMe,
        keepOpen: data.keepOpen,
        debounceTime: data.debounceTime,
        instanceId: instanceId,
        triggerType: data.triggerType,
        triggerOperator: data.triggerOperator,
        triggerValue: data.triggerValue,
        ignoreJids: data.ignoreJids,
        splitMessages: data.splitMessages,
        timePerChar: data.timePerChar,
        ...this.getAdditionalUpdateFields(data),
      };

      const updatedBot = await this.botRepository.update({
        where: {
          id: botId,
        },
        data: updateData,
      });

      return updatedBot;
    } catch (error) {
      this.logger.error(error);
      throw new Error(`Error updating ${this.integrationName}`);
    }
  }

  // Abstract method for validating bot-specific duplicates on update
  protected abstract validateNoDuplicatesOnUpdate(botId: string, instanceId: string, data: BotData): Promise<void>;

  // Abstract method for getting additional fields for update
  protected abstract getAdditionalUpdateFields(data: BotData): Record<string, any>;

  // Base implementation for deleteBot
  public async deleteBot(instance: InstanceDto, botId: string) {
    if (!this.integrationEnabled) throw new BadRequestException(`${this.integrationName} is disabled`);

    try {
      const instanceId = await this.prismaRepository.instance
        .findFirst({
          where: {
            name: instance.instanceName,
          },
        })
        .then((instance) => instance.id);

      const bot = await this.botRepository.findFirst({
        where: {
          id: botId,
        },
      });

      if (!bot) {
        throw new Error(`${this.integrationName} not found`);
      }

      if (bot.instanceId !== instanceId) {
        throw new Error(`${this.integrationName} not found`);
      }

      await this.prismaRepository.integrationSession.deleteMany({
        where: {
          botId: botId,
        },
      });

      await this.botRepository.delete({
        where: {
          id: botId,
        },
      });

      return { bot: { id: botId } };
    } catch (error) {
      this.logger.error(error);
      throw new Error(`Error deleting ${this.integrationName} bot`);
    }
  }

  /** Webhook event sent when the status of a session of this integration changes by pause or resume. */
  protected getChangeStatusEvent(): Events | null {
    return null;
  }

  /**
   * Sends the change status webhook of the integration, if it has one. Fire and forget: the payload is built and
   * delivered in the background and a failure is only logged, so it can never break or delay the bot flow.
   * Sessions of other integrations (or none) are not reported.
   */
  private notifyStatusChange(
    instance: InstanceDto,
    session: any,
    build: () => Record<string, any> | Promise<Record<string, any>>,
  ): void {
    const event = this.getChangeStatusEvent();
    if (!event || !session || !this.isOwnSession(session)) return;

    void (async () => {
      try {
        const waInstance = this.waMonitor.waInstances[instance.instanceName];
        if (!waInstance) return;

        const data = await build();

        await waInstance.sendDataWebhook(event, {
          ...data,
          session: data.session ? { id: data.session.id, botId: data.session.botId ?? null } : null,
        });
      } catch (error) {
        this.logger.error(`Could not send ${event} webhook: ${error?.message || error}`);
      }
    })();
  }

  /**
   * Whether this integration implements the full human takeover flow: a human `fromMe` message pauses the
   * session (creating a paused one when the chat has none), the time of the last human message is kept in
   * `parameters.humanLastMessageAt`, and the session resumes by itself after `humanResumeMinutes` (> 0).
   *
   * Other integrations keep the legacy behaviour (pause only an existing session, their services decide what
   * to do with paused sessions, e.g. Typebot restarts them after `expire`).
   */
  protected supportsHumanPause(): boolean {
    return false;
  }

  /**
   * Text of the incoming message handed to the trigger and to the bot. Integrations may describe message types
   * they cannot read (e.g. the OpenAI bot turns a sticker or a location into a clear sentence for the model).
   */
  protected getConversationContent(msg: any): string {
    return getConversationMessage(msg);
  }

  /** Integration-specific values added to the merged settings handed to processBot. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected getAdditionalMergedSettings(bot: any, settings: any): Record<string, any> {
    return {};
  }

  private humanPauseLocks = new Map<string, Promise<void>>();

  /** Serialises the human takeover handling per chat so quick consecutive messages do not race. */
  private async runExclusive(key: string, task: () => Promise<void>): Promise<void> {
    const previous = this.humanPauseLocks.get(key) ?? Promise.resolve();
    const current = previous.then(task, task);
    const tail = current.catch(() => undefined);

    this.humanPauseLocks.set(key, tail);

    try {
      await current;
    } finally {
      if (this.humanPauseLocks.get(key) === tail) this.humanPauseLocks.delete(key);
    }
  }

  /**
   * Every address the chat may be stored under. Baileys already swaps `@lid` for `remoteJidAlt` before the emit
   * when it is known; when it is not, try the LID mapping so a session stored as `@s.whatsapp.net` is still found.
   */
  protected async resolveSessionJids(instance: InstanceDto, remoteJid: string, msg: any): Promise<string[]> {
    const jids = new Set<string>(
      [remoteJid, msg?.key?.remoteJid, msg?.key?.remoteJidAlt].filter(
        (jid) => typeof jid === 'string' && jid.length > 0,
      ),
    );

    const lidMapping = this.waMonitor.waInstances[instance.instanceName]?.client?.signalRepository?.lidMapping;

    if (typeof lidMapping?.getPNForLID === 'function') {
      for (const jid of [...jids]) {
        if (!jid.endsWith('@lid')) continue;

        try {
          const pn = await lidMapping.getPNForLID(jid);
          if (pn) jids.add(jidNormalizedUser(pn));
        } catch (error) {
          this.logger.verbose(`Could not resolve PN for ${jid}: ${error?.message || error}`);
        }
      }
    }

    return [...jids];
  }

  private preferredJid(remoteJid: string, sessionJids: string[]): string {
    return sessionJids.find((jid) => jid.endsWith('@s.whatsapp.net')) ?? remoteJid;
  }

  private isOwnSession(session: any): boolean {
    return !session?.type || session.type === this.getIntegrationType();
  }

  /**
   * When the human wrote: the message timestamp (messages delivered late after a reconnection keep their real
   * time), never in the future.
   */
  private humanMessageDate(msg: any): Date {
    const now = Date.now();
    const timestamp = Number(msg?.messageTimestamp) * 1000;

    return new Date(Number.isFinite(timestamp) && timestamp > 0 ? Math.min(timestamp, now) : now);
  }

  /**
   * A human (the owner of the number) wrote in the chat: pause the session and record the time, extending the
   * pause on every human message. When the chat has no session yet, create one already paused so the bot does
   * not answer the contact over the human.
   */
  private async pauseForHumanMessage(
    instance: InstanceDto,
    remoteJid: string,
    sessionJids: string[],
    session: any,
    bot: any,
    resumeMinutes: number,
    msg?: any,
  ): Promise<void> {
    await this.runExclusive(`${instance.instanceId}:${this.preferredJid(remoteJid, sessionJids)}`, async () => {
      const now = this.humanMessageDate(msg);

      // Re-read inside the lock: a concurrent human message may have created or updated the session
      const current = session
        ? await this.sessionRepository.findUnique({ where: { id: session.id } })
        : await this.getSession(remoteJid, instance, sessionJids);

      if (current) {
        // Finished conversations stay finished; sessions of other integrations are theirs to handle
        if (current.status === 'closed' || !this.isOwnSession(current)) return;

        const paused = await this.sessionRepository.update({
          where: { id: current.id },
          data: {
            status: 'paused',
            // Never move the timestamp backwards (an old message delivered late, e.g. after a reconnection)
            parameters: withHumanLastMessageAt(
              current.parameters,
              new Date(Math.max(now.getTime(), getHumanLastMessageAt(current) ?? 0)),
            ),
          },
        });

        this.logger.log(`Human message in ${remoteJid}: ${this.integrationName} session ${current.id} paused`);
        // Only the transition is notified; later human messages just move resumesAt (see fetchSessions)
        if (!isHumanPaused(current)) this.notifyHumanPause(instance, paused, resumeMinutes);
        return;
      }

      // The session existed when the message arrived but was removed meanwhile (e.g. finish keyword)
      if (session) return;

      // getSession() also returns null when another integration holds the chat; never compete with it
      const latest = await this.sessionRepository.findFirst({
        where: {
          remoteJid: { in: sessionJids },
          instanceId: instance.instanceId,
        },
        orderBy: { createdAt: 'desc' },
      });

      if (latest && latest.status !== 'closed') {
        this.logger.log(`Human message in ${remoteJid}: chat is held by another integration, nothing to pause`);
        return;
      }

      const jid = this.preferredJid(remoteJid, sessionJids);

      const created = await this.sessionRepository.create({
        data: {
          remoteJid: jid,
          pushName: null, // pushName of a fromMe message is the owner's name, not the contact's
          sessionId: jid,
          status: 'paused',
          awaitUser: false,
          botId: bot.id,
          instanceId: instance.instanceId,
          type: this.getIntegrationType(),
          parameters: withHumanLastMessageAt(null, now),
        },
      });

      this.logger.log(`Human message in ${remoteJid}: created paused ${this.integrationName} session ${created.id}`);
      this.notifyHumanPause(instance, created, resumeMinutes);
    });
  }

  private notifyHumanPause(instance: InstanceDto, session: any, resumeMinutes: number): void {
    this.notifyStatusChange(instance, session, () => ({
      remoteJid: session.remoteJid,
      status: 'paused',
      reason: 'human',
      session,
      humanPause: describeHumanPause(session, resumeMinutes),
    }));
  }

  /** Reopens a human-paused session, dropping the timestamp. Returns null when it changed meanwhile. */
  private async resumeHumanPausedSession(instance: InstanceDto, session: any): Promise<any> {
    const result = await this.sessionRepository.updateMany({
      where: { id: session.id, status: session.status },
      data: {
        status: 'opened',
        awaitUser: true,
        parameters: withoutHumanLastMessageAt(session.parameters),
      },
    });

    if (!result?.count) return null;

    this.logger.log(
      `Human pause expired for ${session.remoteJid}: ${this.integrationName} session ${session.id} resumed`,
    );

    const resumed = await this.sessionRepository.findUnique({ where: { id: session.id } });

    this.notifyStatusChange(instance, session, () => ({
      remoteJid: session.remoteJid,
      status: 'opened',
      reason: 'resumed',
      session,
      humanPause: null,
    }));

    return resumed;
  }

  private async applyManualStatus(where: Record<string, any>, status: string) {
    const sessions = await this.sessionRepository.findMany({ where });

    for (const session of sessions) {
      if (status === 'paused') {
        await this.sessionRepository.update({
          where: { id: session.id },
          data: { parameters: withManualPause(session.parameters) },
        });
        continue;
      }

      if (getHumanLastMessageAt(session) === null && !isManualPause(session)) continue;

      await this.sessionRepository.update({
        where: { id: session.id },
        data: { parameters: withoutHumanLastMessageAt(session.parameters) },
      });
    }
  }

  /**
   * Session state right before answering a debounced message: the stale copy captured when the first message
   * arrived may no longer be valid (paused by a human, closed or removed during the debounce window).
   */
  private async reloadSessionAfterDebounce(
    instance: InstanceDto,
    remoteJid: string,
    sessionJids: string[],
    session: any,
  ): Promise<{ skip: boolean; session: any; reason?: string }> {
    if (session) {
      const fresh = await this.sessionRepository.findUnique({ where: { id: session.id } });

      if (!fresh) return { skip: true, session: null, reason: 'session removed' };
      if (fresh.status === 'closed') return { skip: true, session: null, reason: 'session closed' };
      if (this.supportsHumanPause() && isHumanPaused(fresh)) {
        return { skip: true, session: null, reason: 'session paused by a human' };
      }

      return { skip: false, session: fresh };
    }

    if (!this.supportsHumanPause()) return { skip: false, session: null };

    // A session may have been created during the window: a paused one by a human message, or an opened one by
    // a previous answer still in flight (reuse it instead of creating a duplicate)
    const fresh = await this.getSession(remoteJid, instance, sessionJids);

    if (fresh && this.isOwnSession(fresh)) {
      if (isHumanPaused(fresh)) return { skip: true, session: null, reason: 'session paused by a human' };
      if (fresh.status === 'closed') return { skip: true, session: null, reason: 'session closed' };

      return { skip: false, session: fresh };
    }

    return { skip: false, session: null };
  }

  // Base implementation for emit
  public async emit({ instance, remoteJid, msg }: EmitData) {
    if (!this.integrationEnabled) return;

    try {
      const key = (msg?.key ?? {}) as {
        id: string;
        remoteJid: string;
        fromMe: boolean;
        participant: string;
      };

      // Echo of a message sent by a chatbot: it is neither input for a bot (avoids loops when listeningFromMe
      // is on) nor human activity (must not pause anything)
      if (key.fromMe && (await isBotMessageId(instance.instanceId, key.id))) return;

      const settings = await this.settingsRepository.findFirst({
        where: {
          instanceId: instance.instanceId,
        },
      });

      if (this.checkIgnoreJids(settings?.ignoreJids, remoteJid)) return;

      const sessionJids = await this.resolveSessionJids(instance, remoteJid, msg);

      let session = await this.getSession(remoteJid, instance, sessionJids);

      const content = this.getConversationContent(msg);

      // Find a bot for this message
      let findBot: any = await this.findBotTrigger(this.botRepository, content, instance, session);

      // If no bot is found, try to use fallback
      if (!findBot) {
        // Get the fallback ID for this integration type
        const fallbackId = this.getFallbackBotId(settings);

        if (fallbackId) {
          const findFallback = await this.botRepository.findFirst({
            where: {
              id: fallbackId,
            },
          });

          findBot = findFallback;
        } else {
          return;
        }
      }

      // If we still don't have a bot, return
      if (!findBot) {
        return;
      }

      // Collect settings with fallbacks to default settings
      let expire = findBot.expire;
      let keywordFinish = findBot.keywordFinish;
      let delayMessage = findBot.delayMessage;
      let unknownMessage = findBot.unknownMessage;
      let listeningFromMe = findBot.listeningFromMe;
      let stopBotFromMe = findBot.stopBotFromMe;
      let keepOpen = findBot.keepOpen;
      let debounceTime = findBot.debounceTime;
      let ignoreJids = findBot.ignoreJids;
      let splitMessages = findBot.splitMessages;
      let timePerChar = findBot.timePerChar;

      if (expire === undefined || expire === null) expire = settings?.expire;
      if (keywordFinish === undefined || keywordFinish === null) keywordFinish = settings?.keywordFinish;
      if (delayMessage === undefined || delayMessage === null) delayMessage = settings?.delayMessage;
      if (unknownMessage === undefined || unknownMessage === null) unknownMessage = settings?.unknownMessage;
      if (listeningFromMe === undefined || listeningFromMe === null) listeningFromMe = settings?.listeningFromMe;
      if (stopBotFromMe === undefined || stopBotFromMe === null) stopBotFromMe = settings?.stopBotFromMe;
      if (keepOpen === undefined || keepOpen === null) keepOpen = settings?.keepOpen;
      if (debounceTime === undefined || debounceTime === null) debounceTime = settings?.debounceTime;
      if (ignoreJids === undefined || ignoreJids === null) ignoreJids = settings?.ignoreJids;
      if (splitMessages === undefined || splitMessages === null) splitMessages = settings?.splitMessages ?? false;
      if (timePerChar === undefined || timePerChar === null) timePerChar = settings?.timePerChar ?? 0;

      // Bot value, then settings value, then 0 (only manual resume)
      const humanResumeMinutes = resolveHumanResumeMinutes(findBot, settings);

      // Human takeover: a fromMe message that was not sent by a bot was written by the owner of the number
      if (stopBotFromMe && key.fromMe && this.supportsHumanPause()) {
        await this.pauseForHumanMessage(instance, remoteJid, sessionJids, session, findBot, humanResumeMinutes, msg);
        return;
      }

      // Legacy handling of stopping the bot if message is from me
      if (stopBotFromMe && key.fromMe && session) {
        await this.prismaRepository.integrationSession.update({
          where: {
            id: session.id,
          },
          data: {
            status: 'paused',
          },
        });

        if (this.integrationName === 'Typebot') {
          const typebotData = {
            remoteJid: remoteJid,
            status: 'paused',
            session,
          };
          this.waMonitor.waInstances[instance.instanceName].sendDataWebhook(Events.TYPEBOT_CHANGE_STATUS, typebotData);
        }

        return;
      }

      // Skip if not listening to messages from me
      if (!listeningFromMe && key.fromMe) {
        return;
      }

      // Skip if session exists but not awaiting user input
      if (session && session.status === 'closed') {
        return;
      }

      // Merged settings
      const mergedSettings = {
        ...settings,
        expire,
        keywordFinish,
        delayMessage,
        unknownMessage,
        listeningFromMe,
        stopBotFromMe,
        keepOpen,
        debounceTime,
        ignoreJids,
        splitMessages,
        timePerChar,
        humanResumeMinutes,
        ...this.getAdditionalMergedSettings(findBot, settings),
      };

      // Human takeover in progress: stay silent until it expires or someone reopens the session
      if (this.supportsHumanPause() && session && isHumanPaused(session)) {
        const normalizedContent = (content || '').toLowerCase().trim();
        const isFinishKeyword = !!keywordFinish && normalizedContent === String(keywordFinish).toLowerCase();

        if (isFinishKeyword) {
          // Keep the finish keyword flow: the service closes/removes the session (no debounce, it is final)
          await this.processBot(
            this.waMonitor.waInstances[instance.instanceName],
            remoteJid,
            findBot,
            session,
            mergedSettings,
            content,
            msg?.pushName,
            msg,
          );
          return;
        }

        // No database write here: any update would also bump updatedAt
        if (!isHumanPauseExpired(session, humanResumeMinutes)) return;

        let resumed = await this.resumeHumanPausedSession(instance, session);

        if (!resumed) {
          // Another message of the same burst resumed it first: answer this one too (it joins the debounce)
          const current = await this.sessionRepository.findUnique({ where: { id: session.id } });
          if (!current || isHumanPaused(current) || current.status !== 'opened') return;
          resumed = current;
        }

        // Answer this very message
        session = resumed;
      }

      // Process with debounce if needed
      if (debounceTime && debounceTime > 0) {
        // One window per chat of each instance: the controller is shared by every instance, and the same contact
        // writing to two instances must not have its messages merged and answered by only one of them
        const debounceKey = `${instance.instanceId}:${remoteJid}`;

        this.processDebounce(this.userMessageDebounce, content, debounceKey, debounceTime, async (debouncedContent) => {
          const reloaded = await this.reloadSessionAfterDebounce(instance, remoteJid, sessionJids, session);

          if (reloaded.skip) {
            this.logger.log(`Discarding debounced message for ${remoteJid}: ${reloaded.reason}`);
            return;
          }

          await this.processBot(
            this.waMonitor.waInstances[instance.instanceName],
            remoteJid,
            findBot,
            reloaded.session,
            mergedSettings,
            debouncedContent,
            msg?.pushName,
            msg,
          );
        });
      } else {
        await this.processBot(
          this.waMonitor.waInstances[instance.instanceName],
          remoteJid,
          findBot,
          session,
          mergedSettings,
          content,
          msg?.pushName,
          msg,
        );
      }
    } catch (error) {
      this.logger.error(error);
    }
  }
}
