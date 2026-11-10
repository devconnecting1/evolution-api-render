import { InstanceDto } from '@api/dto/instance.dto';
import { OpenaiCredsDto, OpenaiDto } from '@api/integrations/chatbot/openai/dto/openai.dto';
import { OpenaiService } from '@api/integrations/chatbot/openai/services/openai.service';
import { PrismaRepository } from '@api/repository/repository.service';
import { WAMonitoringService } from '@api/services/monitor.service';
import { Events } from '@api/types/wa.types';
import { configService, Openai } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { BadRequestException } from '@exceptions';
import { IntegrationSession, OpenaiBot } from '@prisma/client';
import { getConversationMessage } from '@utils/getConversationMessage';
import { describeHumanPause, resolveHumanResumeMinutes } from '@utils/humanPause';
import { describeOpenaiMessage, OPENAI_MEDIA_DEFAULTS, resolveOpenaiMediaOptions } from '@utils/openaiMedia';
import { withQuotedContext } from '@utils/quotedContext';
import OpenAI from 'openai';

import { BaseChatbotController } from '../../base-chatbot.controller';

export class OpenaiController extends BaseChatbotController<OpenaiBot, OpenaiDto> {
  constructor(
    private readonly openaiService: OpenaiService,
    prismaRepository: PrismaRepository,
    waMonitor: WAMonitoringService,
  ) {
    super(prismaRepository, waMonitor);

    this.botRepository = this.prismaRepository.openaiBot;
    this.settingsRepository = this.prismaRepository.openaiSetting;
    this.sessionRepository = this.prismaRepository.integrationSession;
    this.credsRepository = this.prismaRepository.openaiCreds;
  }

  public readonly logger = new Logger('OpenaiController');
  protected readonly integrationName = 'Openai';

  integrationEnabled = configService.get<Openai>('OPENAI').ENABLED;
  botRepository: any;
  settingsRepository: any;
  sessionRepository: any;
  userMessageDebounce: { [key: string]: { message: string; timeoutId: NodeJS.Timeout } } = {};
  private client: OpenAI;
  private credsRepository: any;

  protected getFallbackBotId(settings: any): string | undefined {
    return settings?.openaiIdFallback;
  }

  protected getFallbackFieldName(): string {
    return 'openaiIdFallback';
  }

  protected getIntegrationType(): string {
    return 'openai';
  }

  // Human takeover (pause on human fromMe, paused session creation, resume after humanResumeMinutes)
  /** "Leads (triagem)": the team answered, so the lead of this chat no longer waits for the team. */
  protected onHumanReply(instance: InstanceDto, remoteJids: string[], at: Date): void {
    this.openaiService.leads?.recordHumanReply(instance.instanceId, remoteJids, at);
  }

  protected supportsHumanPause(): boolean {
    return true;
  }

  // Webhook `openai.change_status` on pause (human or manual) and resume
  protected getChangeStatusEvent(): Events | null {
    return Events.OPENAI_CHANGE_STATUS;
  }

  // Bot value, then settings value, then default
  protected getAdditionalMergedSettings(bot: any, settings: any): Record<string, any> {
    return {
      tokenParam: bot?.tokenParam ?? settings?.tokenParam ?? 'auto',
      ethicsProfile: settings?.ethicsProfile ?? 'none',
      ...resolveOpenaiMediaOptions(bot, settings),
    };
  }

  // Video, sticker, location and shared contact reach the model as a clear sentence (other bots keep the raw text)
  protected getConversationContent(msg: any): string {
    return describeOpenaiMessage(msg) ?? getConversationMessage(msg);
  }

  // A reply to an older message tells the model what is being answered (#2078): `[respondendo a: "..."]`
  protected getBotContent(content: string, msg: any): string {
    return withQuotedContext(content, msg);
  }

  protected getAdditionalBotData(data: OpenaiDto): Record<string, any> {
    return {
      openaiCredsId: data.openaiCredsId,
      botType: data.botType,
      assistantId: data.assistantId,
      functionUrl: data.functionUrl,
      model: data.model,
      systemMessages: data.systemMessages,
      assistantMessages: data.assistantMessages,
      userMessages: data.userMessages,
      maxTokens: data.maxTokens,
      tokenParam: data.tokenParam,
      humanResumeMinutes: data.humanResumeMinutes,
      transcribeAudio: data.transcribeAudio,
      transcriptionModel: data.transcriptionModel,
      maxAudioSeconds: data.maxAudioSeconds,
      readImages: data.readImages,
      readDocuments: data.readDocuments,
      maxDocumentMB: data.maxDocumentMB,
      historyMessages: data.historyMessages,
    };
  }

  // Implementation for bot-specific updates
  protected getAdditionalUpdateFields(data: OpenaiDto): Record<string, any> {
    return {
      openaiCredsId: data.openaiCredsId,
      botType: data.botType,
      assistantId: data.assistantId,
      functionUrl: data.functionUrl,
      model: data.model,
      systemMessages: data.systemMessages,
      assistantMessages: data.assistantMessages,
      userMessages: data.userMessages,
      maxTokens: data.maxTokens,
      tokenParam: data.tokenParam,
      humanResumeMinutes: data.humanResumeMinutes,
      transcribeAudio: data.transcribeAudio,
      transcriptionModel: data.transcriptionModel,
      maxAudioSeconds: data.maxAudioSeconds,
      readImages: data.readImages,
      readDocuments: data.readDocuments,
      maxDocumentMB: data.maxDocumentMB,
      historyMessages: data.historyMessages,
    };
  }

  // Implementation for bot-specific duplicate validation on update
  protected async validateNoDuplicatesOnUpdate(botId: string, instanceId: string, data: OpenaiDto): Promise<void> {
    let whereDuplication: any = {
      id: {
        not: botId,
      },
      instanceId: instanceId,
    };

    if (data.botType === 'assistant') {
      if (!data.assistantId) throw new Error('Assistant ID is required');

      whereDuplication = {
        ...whereDuplication,
        assistantId: data.assistantId,
        botType: data.botType,
      };
    } else if (data.botType === 'chatCompletion') {
      if (!data.model) throw new Error('Model is required');
      if (!data.maxTokens) throw new Error('Max tokens is required');

      whereDuplication = {
        ...whereDuplication,
        model: data.model,
        maxTokens: data.maxTokens,
        botType: data.botType,
      };
    } else {
      throw new Error('Bot type is required');
    }

    const checkDuplicate = await this.botRepository.findFirst({
      where: whereDuplication,
    });

    if (checkDuplicate) {
      throw new Error('OpenAI Bot already exists');
    }
  }

  // Override createBot to handle OpenAI-specific credential logic
  public async createBot(instance: InstanceDto, data: OpenaiDto) {
    if (!this.integrationEnabled) throw new BadRequestException('Openai is disabled');

    const instanceId = await this.prismaRepository.instance
      .findFirst({
        where: {
          name: instance.instanceName,
        },
      })
      .then((instance) => instance.id);

    // OpenAI specific validation
    let whereDuplication: any = {
      instanceId: instanceId,
    };

    if (data.botType === 'assistant') {
      if (!data.assistantId) throw new Error('Assistant ID is required');

      whereDuplication = {
        ...whereDuplication,
        assistantId: data.assistantId,
        botType: data.botType,
      };
    } else if (data.botType === 'chatCompletion') {
      if (!data.model) throw new Error('Model is required');
      if (!data.maxTokens) throw new Error('Max tokens is required');

      whereDuplication = {
        ...whereDuplication,
        model: data.model,
        maxTokens: data.maxTokens,
        botType: data.botType,
      };
    } else {
      throw new Error('Bot type is required');
    }

    const checkDuplicate = await this.botRepository.findFirst({
      where: whereDuplication,
    });

    if (checkDuplicate) {
      throw new Error('Openai Bot already exists');
    }

    // Check if settings exist and create them if not
    const existingSettings = await this.settingsRepository.findFirst({
      where: {
        instanceId: instanceId,
      },
    });

    if (!existingSettings) {
      // Create default settings with the OpenAI credentials
      await this.settings(instance, {
        openaiCredsId: data.openaiCredsId,
        expire: data.expire || 300,
        keywordFinish: data.keywordFinish || 'bye',
        delayMessage: data.delayMessage || 1000,
        unknownMessage:
          data.unknownMessage ||
          'Desculpe, tive um problema para responder agora. Alguém da equipe vai falar com você em breve.',
        listeningFromMe: data.listeningFromMe !== undefined ? data.listeningFromMe : true,
        stopBotFromMe: data.stopBotFromMe !== undefined ? data.stopBotFromMe : true,
        keepOpen: data.keepOpen !== undefined ? data.keepOpen : false,
        debounceTime: data.debounceTime || 1,
        ignoreJids: data.ignoreJids || [],
        speechToText: false,
        tokenParam: 'auto',
        humanResumeMinutes: 0,
        ...OPENAI_MEDIA_DEFAULTS,
      });
    } else if (!existingSettings.openaiCredsId && data.openaiCredsId) {
      // Update settings with OpenAI credentials if they're missing
      await this.settingsRepository.update({
        where: {
          id: existingSettings.id,
        },
        data: {
          OpenaiCreds: {
            connect: {
              id: data.openaiCredsId,
            },
          },
        },
      });
    }

    // Let the base class handle the rest of the bot creation process
    return super.createBot(instance, data);
  }

  // Process OpenAI-specific bot logic
  protected async processBot(
    instance: any,
    remoteJid: string,
    bot: OpenaiBot,
    session: IntegrationSession,
    settings: any,
    content: string,
    pushName?: string,
    msg?: any,
  ) {
    await this.openaiService.process(instance, remoteJid, bot, session, settings, content, pushName, msg);
  }

  // Credentials - OpenAI specific functionality
  public async createOpenaiCreds(instance: InstanceDto, data: OpenaiCredsDto) {
    if (!this.integrationEnabled) throw new BadRequestException('Openai is disabled');

    const instanceId = await this.prismaRepository.instance
      .findFirst({
        where: {
          name: instance.instanceName,
        },
      })
      .then((instance) => instance.id);

    if (!data.apiKey) throw new BadRequestException('API Key is required');
    if (!data.name) throw new BadRequestException('Name is required');

    // Check if API key already exists
    const existingApiKey = await this.credsRepository.findFirst({
      where: {
        apiKey: data.apiKey,
      },
    });

    if (existingApiKey) {
      throw new BadRequestException('This API key is already registered. Please use a different API key.');
    }

    // Check if name already exists for this instance
    const existingName = await this.credsRepository.findFirst({
      where: {
        name: data.name,
        instanceId: instanceId,
      },
    });

    if (existingName) {
      throw new BadRequestException('This credential name is already in use. Please choose a different name.');
    }

    try {
      const creds = await this.credsRepository.create({
        data: {
          name: data.name,
          apiKey: data.apiKey,
          instanceId: instanceId,
        },
      });

      return creds;
    } catch (error) {
      this.logger.error(error);
      throw new Error('Error creating openai creds');
    }
  }

  public async findOpenaiCreds(instance: InstanceDto) {
    if (!this.integrationEnabled) throw new BadRequestException('Openai is disabled');

    const instanceId = await this.prismaRepository.instance
      .findFirst({
        where: {
          name: instance.instanceName,
        },
      })
      .then((instance) => instance.id);

    const creds = await this.credsRepository.findMany({
      where: {
        instanceId: instanceId,
      },
      include: {
        OpenaiAssistant: true,
      },
    });

    return creds;
  }

  public async deleteCreds(instance: InstanceDto, openaiCredsId: string) {
    if (!this.integrationEnabled) throw new BadRequestException('Openai is disabled');

    const instanceId = await this.prismaRepository.instance
      .findFirst({
        where: {
          name: instance.instanceName,
        },
      })
      .then((instance) => instance.id);

    const creds = await this.credsRepository.findFirst({
      where: {
        id: openaiCredsId,
      },
    });

    if (!creds) {
      throw new Error('Openai Creds not found');
    }

    if (creds.instanceId !== instanceId) {
      throw new Error('Openai Creds not found');
    }

    try {
      await this.credsRepository.delete({
        where: {
          id: openaiCredsId,
        },
      });

      return { openaiCreds: { id: openaiCredsId } };
    } catch (error) {
      this.logger.error(error);
      throw new Error('Error deleting openai creds');
    }
  }

  // Override the settings method to handle the OpenAI credentials
  public async settings(instance: InstanceDto, data: any) {
    if (!this.integrationEnabled) throw new BadRequestException('Openai is disabled');

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

      // Convert keywordFinish to string if it's an array
      const keywordFinish = data.keywordFinish;

      // Additional OpenAI-specific fields
      const settingsData = {
        expire: data.expire,
        keywordFinish,
        delayMessage: data.delayMessage,
        unknownMessage: data.unknownMessage,
        listeningFromMe: data.listeningFromMe,
        stopBotFromMe: data.stopBotFromMe,
        keepOpen: data.keepOpen,
        debounceTime: data.debounceTime,
        ignoreJids: data.ignoreJids,
        splitMessages: data.splitMessages,
        timePerChar: data.timePerChar,
        openaiIdFallback: data.fallbackId ?? data.openaiIdFallback, // docs send openaiIdFallback
        OpenaiCreds: data.openaiCredsId
          ? {
              connect: {
                id: data.openaiCredsId,
              },
            }
          : undefined,
        speechToText: data.speechToText,
        tokenParam: data.tokenParam,
        humanResumeMinutes: data.humanResumeMinutes,
        transcribeAudio: data.transcribeAudio,
        transcriptionModel: data.transcriptionModel,
        maxAudioSeconds: data.maxAudioSeconds,
        readImages: data.readImages,
        readDocuments: data.readDocuments,
        maxDocumentMB: data.maxDocumentMB,
        historyMessages: data.historyMessages,
        ethicsProfile: data.ethicsProfile,
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
          fallbackId: settings.openaiIdFallback,
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
          fallbackId: settings.openaiIdFallback,
        };
      }
    } catch (error) {
      this.logger.error(error);
      throw new Error('Error setting default settings');
    }
  }

  // Expose the OpenAI-specific defaults even when no settings row exists yet
  public async fetchSettings(instance: InstanceDto) {
    const settings = await super.fetchSettings(instance);

    return {
      ...settings,
      tokenParam: settings?.tokenParam ?? 'auto',
      humanResumeMinutes: settings?.humanResumeMinutes ?? 0,
      ethicsProfile: settings?.ethicsProfile ?? 'none',
      ...resolveOpenaiMediaOptions(null, settings),
    };
  }

  // Sessions plus `humanPause`: the state of the human takeover pause of each one (null when not paused)
  public async fetchSessions(instance: InstanceDto, botId: string, remoteJid?: string) {
    const sessions = await super.fetchSessions(instance, botId, remoteJid);

    if (!Array.isArray(sessions) || sessions.length === 0) return sessions;

    try {
      const botIds = [...new Set<string>(sessions.map((session) => session.botId).filter(Boolean))];

      // Bots and settings are read once for the whole list, not once per session
      const [bots, settings] = await Promise.all([
        this.botRepository.findMany({
          where: { id: { in: botIds } },
          select: { id: true, humanResumeMinutes: true },
        }),
        this.settingsRepository.findFirst({ where: { instanceId: sessions[0].instanceId } }),
      ]);

      const botsById = new Map<string, any>(bots.map((bot: any) => [bot.id, bot]));
      const now = Date.now();

      return sessions.map((session) => ({
        ...session,
        humanPause: describeHumanPause(session, resolveHumanResumeMinutes(botsById.get(session.botId), settings), now),
      }));
    } catch (error) {
      // The extra field is informative: never fail the listing because of it
      this.logger.error(error);
      return sessions;
    }
  }

  // Models - OpenAI specific functionality
  public async getModels(instance: InstanceDto, openaiCredsId?: string) {
    if (!this.integrationEnabled) throw new BadRequestException('Openai is disabled');

    const instanceId = await this.prismaRepository.instance
      .findFirst({
        where: {
          name: instance.instanceName,
        },
      })
      .then((instance) => instance.id);

    if (!instanceId) throw new Error('Instance not found');

    let apiKey: string;

    if (openaiCredsId) {
      // Use specific credential ID if provided
      const creds = await this.credsRepository.findFirst({
        where: {
          id: openaiCredsId,
          instanceId: instanceId, // Ensure the credential belongs to this instance
        },
      });

      if (!creds) throw new Error('OpenAI credentials not found for the provided ID');

      apiKey = creds.apiKey;
    } else {
      // Use default credentials from settings if no ID provided
      const defaultSettings = await this.settingsRepository.findFirst({
        where: {
          instanceId: instanceId,
        },
        include: {
          OpenaiCreds: true,
        },
      });

      if (!defaultSettings) throw new Error('Settings not found');

      if (!defaultSettings.OpenaiCreds)
        throw new Error(
          'OpenAI credentials not found. Please create credentials and associate them with the settings.',
        );

      apiKey = defaultSettings.OpenaiCreds.apiKey;
    }

    try {
      this.client = new OpenAI({ apiKey });

      const models: any = await this.client.models.list();

      return models?.body?.data;
    } catch (error) {
      this.logger.error(error);
      throw new Error('Error fetching models');
    }
  }
}
