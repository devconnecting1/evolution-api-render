import { PrismaRepository } from '@api/repository/repository.service';
import { WAMonitoringService } from '@api/services/monitor.service';
import { Integration } from '@api/types/wa.types';
import { ConfigService, Language, Openai as OpenaiConfig } from '@config/env.config';
import { IntegrationSession, OpenaiBot, OpenaiSetting } from '@prisma/client';
import { hasHumanWrittenSince, isHumanPaused } from '@utils/humanPause';
import { sendTelemetry } from '@utils/sendTelemetry';
import axios from 'axios';
import { downloadMediaMessage } from 'baileys';
import FormData from 'form-data';
import OpenAI, { toFile } from 'openai';
import P from 'pino';

import { BaseChatbotService } from '../../base-chatbot.service';

type TokenParamName = 'max_tokens' | 'max_completion_tokens';
type TokenParamMode = 'auto' | TokenParamName;

/**
 * Models that reject `max_tokens` and require `max_completion_tokens`
 * (o-series reasoning models, gpt-5.x, gpt-6.x), optionally fine-tuned ("ft:").
 */
const MAX_COMPLETION_TOKENS_MODEL_REGEX = /^(ft:)?(o\d|gpt-5|gpt-6)/i;

/**
 * Token parameter that worked for a given model in "auto" mode, learned after
 * OpenAI rejected the other one. Process-wide, shared by every instance.
 */
const learnedTokenParamByModel = new Map<string, TokenParamName>();

/** Errors already logged in full, to avoid duplicated stack traces when rethrown. */
const loggedOpenaiErrors = new WeakSet<object>();

/** Text stored in place of an image in the conversation history / logs. */
const IMAGE_HISTORY_PLACEHOLDER = '[imagem]';
/** Note sent to the model when the customer's image could not be downloaded. */
const IMAGE_UNAVAILABLE_NOTE = '[imagem não pôde ser processada]';
/** OpenAI rejects images larger than 20 MB. */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * OpenAI service that extends the common BaseChatbotService
 * Handles both Assistant API and ChatCompletion API
 */
export class OpenaiService extends BaseChatbotService<OpenaiBot, OpenaiSetting> {
  protected client: OpenAI;

  constructor(waMonitor: WAMonitoringService, prismaRepository: PrismaRepository, configService: ConfigService) {
    super(waMonitor, prismaRepository, 'OpenaiService', configService);
  }

  /**
   * Return the bot type for OpenAI
   */
  protected getBotType(): string {
    return 'openai';
  }

  /**
   * Initialize the OpenAI client with the provided API key
   */
  protected initClient(apiKey: string) {
    this.client = new OpenAI({ apiKey });
    return this.client;
  }

  /**
   * Process a message based on the bot type (assistant or chat completion)
   */
  public async process(
    instance: any,
    remoteJid: string,
    openaiBot: OpenaiBot,
    session: IntegrationSession,
    settings: OpenaiSetting,
    content: string,
    pushName?: string,
    msg?: any,
  ): Promise<void> {
    try {
      this.logger.log(`Starting process for remoteJid: ${remoteJid}, bot type: ${openaiBot.botType}`);

      // Handle audio message transcription
      if (content.startsWith('audioMessage|') && msg) {
        this.logger.log('Detected audio message, attempting to transcribe');

        // Get OpenAI credentials for transcription
        const creds = await this.prismaRepository.openaiCreds.findUnique({
          where: { id: openaiBot.openaiCredsId },
        });

        if (!creds) {
          this.logger.error(`OpenAI credentials not found. CredsId: ${openaiBot.openaiCredsId}`);
          return;
        }

        // Initialize OpenAI client for transcription
        this.initClient(creds.apiKey);

        // Transcribe the audio
        const transcription = await this.speechToText(msg, instance).catch((error) => {
          this.logOpenaiError('speechToText', error);
          return null;
        });

        if (transcription) {
          this.logger.log(`Audio transcribed: ${transcription}`);
          // Replace the audio message identifier with the transcription
          content = transcription;
        } else {
          this.logger.error('Failed to transcribe audio');
          await this.sendErrorFallback(instance, remoteJid, settings, session);
          return;
        }
      } else {
        // Get the OpenAI credentials
        const creds = await this.prismaRepository.openaiCreds.findUnique({
          where: { id: openaiBot.openaiCredsId },
        });

        if (!creds) {
          this.logger.error(`OpenAI credentials not found. CredsId: ${openaiBot.openaiCredsId}`);
          return;
        }

        // Initialize OpenAI client
        this.initClient(creds.apiKey);
      }

      // Handle keyword finish
      const keywordFinish = settings?.keywordFinish || '';
      const normalizedContent = content.toLowerCase().trim();
      if (keywordFinish.length > 0 && normalizedContent === keywordFinish.toLowerCase()) {
        if (!session) return;

        if (settings?.keepOpen) {
          await this.prismaRepository.integrationSession.update({
            where: {
              id: session.id,
            },
            data: {
              status: 'closed',
            },
          });
        } else {
          await this.prismaRepository.integrationSession.delete({
            where: {
              id: session.id,
            },
          });
        }

        await sendTelemetry('/openai/session/finish');
        return;
      }

      // If session is new or doesn't exist
      if (!session) {
        const data = {
          remoteJid,
          pushName,
          botId: openaiBot.id,
        };

        const createSession = await this.createNewSession(
          { instanceName: instance.instanceName, instanceId: instance.instanceId },
          data,
          this.getBotType(),
        );

        await this.initNewSession(
          instance,
          remoteJid,
          openaiBot,
          settings,
          createSession.session,
          content,
          pushName,
          msg,
        );

        await sendTelemetry('/openai/session/start');
        return;
      }

      // Pause/resume is decided in the controller emit, which reopens an expired human pause before calling
      // process() so the same message is answered. A session still paused here must not be answered.
      if (isHumanPaused(session)) {
        this.logger.log(`Session ${session.id} is paused, not answering ${remoteJid}`);
        return;
      }

      // Process with the appropriate API based on bot type
      await this.sendMessageToBot(instance, session, settings, openaiBot, remoteJid, pushName || '', content, msg);
    } catch (error) {
      this.logger.error(`Error in process: ${error.message || JSON.stringify(error)}`);
      return;
    }
  }

  /**
   * Send message to OpenAI - this handles both Assistant API and ChatCompletion API
   */
  protected async sendMessageToBot(
    instance: any,
    session: IntegrationSession,
    settings: OpenaiSetting,
    openaiBot: OpenaiBot,
    remoteJid: string,
    pushName: string,
    content: string,
    msg?: any,
  ): Promise<void> {
    this.logger.log(`Sending message to bot for remoteJid: ${remoteJid}, bot type: ${openaiBot.botType}`);

    if (!this.client) {
      this.logger.log('Client not initialized, initializing now');
      const creds = await this.prismaRepository.openaiCreds.findUnique({
        where: { id: openaiBot.openaiCredsId },
      });

      if (!creds) {
        this.logger.error(`OpenAI credentials not found in sendMessageToBot. CredsId: ${openaiBot.openaiCredsId}`);
        return;
      }

      this.initClient(creds.apiKey);
    }

    try {
      let message: string;

      // Handle different bot types
      if (openaiBot.botType === 'assistant') {
        this.logger.log('Processing with Assistant API');
        message = await this.processAssistantMessage(
          instance,
          session,
          openaiBot,
          remoteJid,
          pushName,
          false, // Not fromMe
          content,
          msg,
        );
      } else {
        this.logger.log('Processing with ChatCompletion API');
        message = await this.processChatCompletionMessage(
          instance,
          openaiBot,
          remoteJid,
          content,
          msg,
          settings,
          session,
        );
      }

      this.logger.log(`Got response from OpenAI: ${message?.substring(0, 50)}${message?.length > 50 ? '...' : ''}`);

      // The model may take long: a human may have taken over (or the session was closed) meanwhile
      if (message) {
        const currentSession = await this.prismaRepository.integrationSession.findUnique({
          where: { id: session.id },
        });
        const humanWrote = hasHumanWrittenSince(session, currentSession);

        if (!currentSession || currentSession.status !== 'opened' || humanWrote) {
          this.logger.warn(
            `Discarding OpenAI response for ${remoteJid}: ${
              humanWrote ? 'a human replied meanwhile' : `session ${currentSession?.status ?? 'removed'}`
            }`,
          );

          // Something reopened the session after the human paused it (e.g. the assistant run update): restore it
          if (humanWrote && currentSession?.status === 'opened') {
            await this.prismaRepository.integrationSession.update({
              where: { id: session.id },
              data: { status: 'paused' },
            });
          }

          return;
        }
      }

      // Send the response
      if (message) {
        this.logger.log('Sending message to WhatsApp');
        await this.sendMessageWhatsApp(instance, remoteJid, message, settings, true);
      } else {
        this.logger.error('No message to send to WhatsApp');
      }

      // Update session status, without reopening a session paused or closed while the answer was being sent
      await this.prismaRepository.integrationSession.updateMany({
        where: {
          id: session.id,
          status: 'opened',
        },
        data: {
          awaitUser: true,
        },
      });
    } catch (error) {
      // Never forward the raw error to the customer: log everything, send only the configured fallback
      this.logOpenaiError('sendMessageToBot', error);
      await this.sendErrorFallback(instance, remoteJid, settings, session);
      return;
    }
  }

  /**
   * Process message using the OpenAI Assistant API
   */
  private async processAssistantMessage(
    instance: any,
    session: IntegrationSession,
    openaiBot: OpenaiBot,
    remoteJid: string,
    pushName: string,
    fromMe: boolean,
    content: string,
    msg?: any,
  ): Promise<string> {
    const messageData: any = {
      role: fromMe ? 'assistant' : 'user',
      content: [{ type: 'text', text: content }],
    };

    // Handle image messages. The Assistants API only accepts external URLs in image_url
    // (no data URLs), so the image is uploaded as a 'vision' file and referenced by image_file.
    if (this.isImageMessage(content)) {
      const caption = this.getImageCaption(content);
      const image = await this.loadImageForOpenai(instance, msg, content);
      let fileId: string | null = null;

      if (image) {
        try {
          const extension = image.mimetype.split('/')[1] || 'jpg';
          const file = await this.client.files.create({
            file: await toFile(Buffer.from(image.base64, 'base64'), `image.${extension}`, { type: image.mimetype }),
            purpose: 'vision',
          });
          fileId = file.id;
        } catch (error) {
          this.logOpenaiError('processAssistantMessage.uploadImage', error);
        }
      }

      messageData.content = fileId
        ? [
            { type: 'text', text: caption || IMAGE_HISTORY_PLACEHOLDER },
            { type: 'image_file', image_file: { file_id: fileId } },
          ]
        : [{ type: 'text', text: this.withImageUnavailableNote(caption) }];
    }

    // Get thread ID from session or create new thread
    let threadId = session.sessionId;

    // Create a new thread if one doesn't exist or invalid format
    // A session created by the human takeover keeps the chat JID as sessionId (not a thread id)
    if (!threadId || threadId === remoteJid || threadId.includes('@')) {
      const newThread = await this.client.beta.threads.create();
      threadId = newThread.id;

      // Save the new thread ID to the session
      await this.prismaRepository.integrationSession.update({
        where: {
          id: session.id,
        },
        data: {
          sessionId: threadId,
        },
      });
      this.logger.log(`Created new thread ID: ${threadId} for session: ${session.id}`);
    }

    // Add message to thread
    await this.client.beta.threads.messages.create(threadId, messageData);

    if (fromMe) {
      sendTelemetry('/message/sendText');
      return '';
    }

    // Run the assistant
    const runAssistant = await this.client.beta.threads.runs.create(threadId, {
      assistant_id: openaiBot.assistantId,
    });

    if (instance.integration === Integration.WHATSAPP_BAILEYS) {
      await instance.client.presenceSubscribe(remoteJid);
      await instance.client.sendPresenceUpdate('composing', remoteJid);
    }

    // Wait for the assistant to complete
    let response: Awaited<ReturnType<typeof this.getAIResponse>>;
    try {
      response = await this.getAIResponse(threadId, runAssistant.id, openaiBot.functionUrl, remoteJid, pushName);
    } finally {
      if (instance.integration === Integration.WHATSAPP_BAILEYS) {
        await instance.client.sendPresenceUpdate('paused', remoteJid).catch(() => undefined);
      }
    }

    // Extract the response text safely with type checking
    let responseText = '';
    try {
      const messages = response?.data || [];
      if (messages.length > 0) {
        const messageContent = messages[0]?.content || [];
        if (messageContent.length > 0) {
          const textContent = messageContent[0];
          if (textContent && 'text' in textContent && textContent.text && 'value' in textContent.text) {
            responseText = textContent.text.value;
          }
        }
      }
    } catch (error) {
      this.logger.error(`Error extracting response text: ${error}`);
    }

    if (!responseText) {
      throw new Error(`Assistant run ${runAssistant.id} on thread ${threadId} returned no text content`);
    }

    // Update session with the thread ID to ensure continuity
    await this.prismaRepository.integrationSession.update({
      where: {
        id: session.id,
      },
      data: {
        awaitUser: true,
        sessionId: threadId, // Ensure thread ID is saved consistently (status is left as is: a human may have paused it)
      },
    });

    return responseText;
  }

  /**
   * Process message using the OpenAI ChatCompletion API
   */
  private async processChatCompletionMessage(
    instance: any,
    openaiBot: OpenaiBot,
    remoteJid: string,
    content: string,
    msg?: any,
    settings?: OpenaiSetting,
    currentSession?: IntegrationSession,
  ): Promise<string> {
    this.logger.log('Starting processChatCompletionMessage');

    // Check if client is initialized
    if (!this.client) {
      this.logger.log('Client not initialized in processChatCompletionMessage, initializing now');
      const creds = await this.prismaRepository.openaiCreds.findUnique({
        where: { id: openaiBot.openaiCredsId },
      });

      if (!creds) {
        throw new Error(`OpenAI credentials not found. CredsId: ${openaiBot.openaiCredsId}`);
      }

      this.initClient(creds.apiKey);
    }

    // Check if model is defined
    if (!openaiBot.model) {
      throw new Error(`OpenAI model not configured for bot ${openaiBot.id}`);
    }

    const tokenParam = this.resolveTokenParam(openaiBot, settings);
    this.logger.log(
      `Using model: ${openaiBot.model}, tokenParam: ${tokenParam.mode} -> ${tokenParam.param}=${openaiBot.maxTokens || 500}`,
    );

    // Get existing conversation history from the session (by id: the chat may show up as @lid or @s.whatsapp.net)
    const session = await this.prismaRepository.integrationSession.findFirst({
      where: currentSession?.id
        ? { id: currentSession.id }
        : {
            remoteJid,
            botId: openaiBot.id,
            status: 'opened',
          },
    });

    let conversationHistory = [];

    if (session && session.context) {
      try {
        const sessionData =
          typeof session.context === 'string' ? JSON.parse(session.context as string) : session.context;

        // Strip image blocks saved by older versions (raw base64 / invalid WhatsApp URLs that make
        // every following request fail with "400 Failed to download file")
        conversationHistory = (sessionData.history || []).map((message) => this.stripImagesFromMessage(message));
        this.logger.log(`Retrieved conversation history from session, ${conversationHistory.length} messages`);
      } catch (error) {
        this.logger.error(`Error parsing session context: ${error.message}`);
        // Continue with empty history if we can't parse the session data
        conversationHistory = [];
      }
    }

    // Log bot data
    this.logger.log(`Bot data - systemMessages: ${JSON.stringify(openaiBot.systemMessages || [])}`);
    this.logger.log(`Bot data - assistantMessages: ${JSON.stringify(openaiBot.assistantMessages || [])}`);
    this.logger.log(`Bot data - userMessages: ${JSON.stringify(openaiBot.userMessages || [])}`);

    // Prepare system messages
    const systemMessages: any = openaiBot.systemMessages || [];
    const messagesSystem: any[] = systemMessages.map((message) => {
      return {
        role: 'system',
        content: message,
      };
    });

    // Prepare assistant messages
    const assistantMessages: any = openaiBot.assistantMessages || [];
    const messagesAssistant: any[] = assistantMessages.map((message) => {
      return {
        role: 'assistant',
        content: message,
      };
    });

    // Prepare user messages
    const userMessages: any = openaiBot.userMessages || [];
    const messagesUser: any[] = userMessages.map((message) => {
      return {
        role: 'user',
        content: message,
      };
    });

    // Prepare current message
    const messageData: any = {
      role: 'user',
      content: [{ type: 'text', text: content }],
    };

    // Handle image messages: send the image inline as a data URL (WhatsApp CDN URLs and
    // bare base64 are rejected by OpenAI with "400 Failed to download file")
    if (this.isImageMessage(content)) {
      this.logger.log('Found image message');
      const caption = this.getImageCaption(content);
      const image = await this.loadImageForOpenai(instance, msg, content);

      messageData.content = image
        ? [
            ...(caption ? [{ type: 'text', text: caption }] : []),
            { type: 'image_url', image_url: { url: `data:${image.mimetype};base64,${image.base64}` } },
          ]
        : [{ type: 'text', text: this.withImageUnavailableNote(caption) }];
    }

    // Combine all messages: system messages, pre-defined messages, conversation history, and current message
    const messages: any[] = [
      ...messagesSystem,
      ...messagesAssistant,
      ...messagesUser,
      ...conversationHistory,
      messageData,
    ];

    this.logger.log(
      `Final messages payload: ${JSON.stringify(messages.map((message) => this.stripImagesFromMessage(message)))}`,
    );

    if (instance.integration === Integration.WHATSAPP_BAILEYS) {
      this.logger.log('Setting typing indicator');
      await instance.client.presenceSubscribe(remoteJid);
      await instance.client.sendPresenceUpdate('composing', remoteJid);
    }

    // Send the request to OpenAI
    try {
      this.logger.log('Sending request to OpenAI API');
      const completions = await this.createChatCompletion(openaiBot, messages, tokenParam);

      if (instance.integration === Integration.WHATSAPP_BAILEYS) {
        await instance.client.sendPresenceUpdate('paused', remoteJid);
      }

      const responseContent = completions.choices?.[0]?.message?.content;
      this.logger.log(`Received response from OpenAI: ${JSON.stringify(completions.choices?.[0])}`);

      if (!responseContent) {
        // e.g. reasoning models that spend the whole token budget (finish_reason "length") or a refusal
        throw new Error(
          `OpenAI returned empty content (model: ${openaiBot.model}, finish_reason: ` +
            `${completions.choices?.[0]?.finish_reason ?? 'unknown'})`,
        );
      }

      // Add the current exchange to the conversation history and update the session
      // (images are replaced by a text placeholder so base64 never lands in session.context)
      conversationHistory.push(this.stripImagesFromMessage(messageData));
      conversationHistory.push({
        role: 'assistant',
        content: responseContent,
      });

      // Limit history length to avoid token limits (keep last 10 messages)
      if (conversationHistory.length > 10) {
        conversationHistory = conversationHistory.slice(conversationHistory.length - 10);
      }

      // Save the updated conversation history to the session
      if (session) {
        await this.prismaRepository.integrationSession.update({
          where: { id: session.id },
          data: {
            context: JSON.stringify({
              history: conversationHistory,
            }),
          },
        });
        this.logger.log(`Updated session with conversation history, now ${conversationHistory.length} messages`);
      }

      return responseContent;
    } catch (error) {
      this.logOpenaiError('processChatCompletionMessage', error);

      if (instance.integration === Integration.WHATSAPP_BAILEYS) {
        await instance.client.sendPresenceUpdate('paused', remoteJid).catch(() => undefined);
      }

      // Let sendMessageToBot decide what (if anything) the customer receives
      throw error;
    }
  }

  /**
   * Wait for and retrieve the AI response
   */
  private async getAIResponse(
    threadId: string,
    runId: string,
    functionUrl: string | null,
    remoteJid: string,
    pushName: string,
  ) {
    let status = await this.client.beta.threads.runs.retrieve(threadId, runId);

    let maxRetries = 60; // 1 minute with 1s intervals
    const checkInterval = 1000; // 1 second

    while (
      status.status !== 'completed' &&
      status.status !== 'failed' &&
      status.status !== 'cancelled' &&
      status.status !== 'expired' &&
      maxRetries > 0
    ) {
      await new Promise((resolve) => setTimeout(resolve, checkInterval));
      status = await this.client.beta.threads.runs.retrieve(threadId, runId);

      // Handle tool calls
      if (status.status === 'requires_action' && status.required_action?.type === 'submit_tool_outputs') {
        const toolCalls = status.required_action.submit_tool_outputs.tool_calls;
        const toolOutputs = [];

        for (const toolCall of toolCalls) {
          if (functionUrl) {
            try {
              const payloadData = JSON.parse(toolCall.function.arguments);

              // Add context
              payloadData.remoteJid = remoteJid;
              payloadData.pushName = pushName;

              const response = await axios.post(functionUrl, {
                functionName: toolCall.function.name,
                functionArguments: payloadData,
              });

              toolOutputs.push({
                tool_call_id: toolCall.id,
                output: JSON.stringify(response.data),
              });
            } catch (error) {
              this.logger.error(`Error calling function: ${error}`);
              toolOutputs.push({
                tool_call_id: toolCall.id,
                output: JSON.stringify({ error: 'Function call failed' }),
              });
            }
          } else {
            toolOutputs.push({
              tool_call_id: toolCall.id,
              output: JSON.stringify({ error: 'No function URL configured' }),
            });
          }
        }

        await this.client.beta.threads.runs.submitToolOutputs(threadId, runId, {
          tool_outputs: toolOutputs,
        });
      }

      maxRetries--;
    }

    if (status.status === 'completed') {
      const messages = await this.client.beta.threads.messages.list(threadId);
      return messages;
    } else {
      this.logger.error(
        `Assistant run ${runId} did not complete. Status: ${status.status}, last_error: ${JSON.stringify(
          status.last_error ?? null,
        )}, incomplete_details: ${JSON.stringify(status.incomplete_details ?? null)}`,
      );
      throw new Error(`Assistant run ${runId} ended with status: ${status.status}`);
    }
  }

  protected isImageMessage(content: string): boolean {
    return content.includes('imageMessage');
  }

  /**
   * Implementation of speech-to-text transcription for audio messages
   */
  public async speechToText(msg: any, instance: any): Promise<string | null> {
    const settings = await this.prismaRepository.openaiSetting.findFirst({
      where: {
        instanceId: instance.instanceId,
      },
    });

    if (!settings) {
      this.logger.error(`OpenAI settings not found. InstanceId: ${instance.instanceId}`);
      return null;
    }

    const creds = await this.prismaRepository.openaiCreds.findUnique({
      where: { id: settings.openaiCredsId },
    });

    if (!creds) {
      this.logger.error(`OpenAI credentials not found. CredsId: ${settings.openaiCredsId}`);
      return null;
    }

    let audio: Buffer;

    if (msg.message.mediaUrl) {
      audio = await axios.get(msg.message.mediaUrl, { responseType: 'arraybuffer' }).then((response) => {
        return Buffer.from(response.data, 'binary');
      });
    } else if (msg.message.base64) {
      audio = Buffer.from(msg.message.base64, 'base64');
    } else {
      // Fallback for raw WhatsApp audio messages that need downloadMediaMessage
      audio = await downloadMediaMessage(
        { key: msg.key, message: msg?.message },
        'buffer',
        {},
        {
          logger: P({ level: 'error' }) as any,
          reuploadRequest: instance,
        },
      );
    }

    const lang = this.configService.get<Language>('LANGUAGE').includes('pt')
      ? 'pt'
      : this.configService.get<Language>('LANGUAGE');

    const formData = new FormData();
    formData.append('file', audio, 'audio.ogg');
    formData.append('model', 'whisper-1');
    formData.append('language', lang);

    const apiKey = creds?.apiKey || this.configService.get<OpenaiConfig>('OPENAI').API_KEY_GLOBAL;

    const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
        Authorization: `Bearer ${apiKey}`,
      },
    });

    return response?.data?.text;
  }

  /**
   * Resolve which token limit parameter to send to the Chat Completions API.
   * Precedence: bot.tokenParam -> settings.tokenParam -> 'auto'.
   */
  private resolveTokenParam(
    openaiBot: OpenaiBot,
    settings?: OpenaiSetting,
  ): { mode: TokenParamMode; param: TokenParamName } {
    const configured = openaiBot.tokenParam ?? settings?.tokenParam ?? 'auto';
    const mode: TokenParamMode =
      configured === 'max_tokens' || configured === 'max_completion_tokens' ? configured : 'auto';

    if (mode !== 'auto') {
      return { mode, param: mode };
    }

    const model = openaiBot.model || '';
    const learned = learnedTokenParamByModel.get(model);
    if (learned) {
      return { mode, param: learned };
    }

    return {
      mode,
      param: MAX_COMPLETION_TOKENS_MODEL_REGEX.test(model) ? 'max_completion_tokens' : 'max_tokens',
    };
  }

  /**
   * Call the Chat Completions API with the resolved token parameter. If OpenAI rejects
   * that parameter (400 "Unsupported parameter"), retry exactly once with the other one.
   * In "auto" mode the working parameter is remembered per model; in forced mode it is not.
   */
  private async createChatCompletion(
    openaiBot: OpenaiBot,
    messages: any[],
    tokenParam: { mode: TokenParamMode; param: TokenParamName },
  ) {
    const maxTokens = openaiBot.maxTokens || 500;
    const buildParams = (param: TokenParamName) => {
      const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = { model: openaiBot.model, messages };
      params[param] = maxTokens;
      return params;
    };

    try {
      return await this.client.chat.completions.create(buildParams(tokenParam.param));
    } catch (error) {
      if (!this.isUnsupportedTokenParamError(error, tokenParam.param)) {
        throw error;
      }

      const fallbackParam: TokenParamName = tokenParam.param === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens';

      if (tokenParam.mode === 'auto') {
        this.logger.warn(
          `Model ${openaiBot.model} rejected '${tokenParam.param}', retrying once with '${fallbackParam}'`,
        );
      } else {
        this.logger.warn(
          `Forced tokenParam '${tokenParam.mode}' was rejected by model ${openaiBot.model} ` +
            `(bot ${openaiBot.id}); retrying once with '${fallbackParam}'. ` +
            `Consider setting tokenParam to 'auto' for this bot/settings.`,
        );
      }

      const completion = await this.client.chat.completions.create(buildParams(fallbackParam));

      if (tokenParam.mode === 'auto' && openaiBot.model) {
        learnedTokenParamByModel.set(openaiBot.model, fallbackParam);
        this.logger.log(`Learned tokenParam '${fallbackParam}' for model ${openaiBot.model}`);
      }

      return completion;
    }
  }

  /**
   * Whether an OpenAI error is a 400 rejecting the given token limit parameter.
   */
  private isUnsupportedTokenParamError(error: any, param: TokenParamName): boolean {
    const status = error?.status ?? error?.response?.status;
    if (status !== 400) return false;

    const errorParam = error?.param ?? error?.error?.param ?? error?.response?.data?.error?.param;
    if (errorParam === 'max_tokens' || errorParam === 'max_completion_tokens') {
      return errorParam === param;
    }

    const message = String(error?.message ?? error?.error?.message ?? error?.response?.data?.error?.message ?? '');
    return /unsupported (parameter|value)/i.test(message) && message.includes(`'${param}'`);
  }

  /**
   * Log every detail of an OpenAI / HTTP error (status, code, param, type, request id, body).
   * Each error object is logged in full only once, even if it is rethrown and caught again.
   */
  private logOpenaiError(context: string, error: any): void {
    if (error && typeof error === 'object') {
      if (loggedOpenaiErrors.has(error)) {
        this.logger.error(`[${context}] OpenAI error (already logged): ${error?.message}`);
        return;
      }
      loggedOpenaiErrors.add(error);
    }

    const details = {
      name: error?.name,
      message: error?.message ?? String(error),
      status: error?.status ?? error?.response?.status,
      code: error?.code,
      param: error?.param,
      type: error?.type,
      requestId: error?.request_id,
      error: error?.error,
      responseData: error?.response?.data,
    };

    this.logger.error(`[${context}] OpenAI error: ${JSON.stringify(details)}`);
    if (error?.stack) {
      this.logger.error(error.stack);
    }
  }

  /**
   * What the customer receives when the bot could not produce an answer.
   * Policy: only `settings.unknownMessage` when it is a non-empty string; otherwise nothing.
   * Raw error messages are never sent. Skipped when the session is no longer open
   * (e.g. paused/closed while OpenAI was being called).
   */
  private async sendErrorFallback(
    instance: any,
    remoteJid: string,
    settings: OpenaiSetting,
    session?: IntegrationSession,
  ): Promise<void> {
    try {
      const fallback = typeof settings?.unknownMessage === 'string' ? settings.unknownMessage.trim() : '';
      if (!fallback) {
        this.logger.warn(`No unknownMessage configured, nothing sent to ${remoteJid} after OpenAI failure`);
        return;
      }

      if (session?.id) {
        const current = await this.prismaRepository.integrationSession.findUnique({ where: { id: session.id } });
        if (!current || current.status !== 'opened') {
          this.logger.warn(
            `Session ${session.id} is ${current?.status ?? 'gone'}, not sending unknownMessage to ${remoteJid}`,
          );
          return;
        }
      }

      await this.sendMessageWhatsApp(instance, remoteJid, fallback, settings, true);
    } catch (error) {
      this.logger.error(`Error sending unknownMessage fallback: ${error?.message || JSON.stringify(error)}`);
    }
  }

  /**
   * Caption of an "imageMessage|<id or url>|<caption>" content string ('' when there is none).
   */
  private getImageCaption(content: string): string {
    if (!content.startsWith('imageMessage|')) {
      return content.trim();
    }

    return content.split('|').slice(2).join('|').trim();
  }

  private withImageUnavailableNote(caption: string): string {
    return caption ? `${caption}\n${IMAGE_UNAVAILABLE_NOTE}` : IMAGE_UNAVAILABLE_NOTE;
  }

  private normalizeMimetype(mimetype: unknown): string | undefined {
    if (typeof mimetype !== 'string') return undefined;
    const normalized = mimetype.split(';')[0].trim().toLowerCase();
    return normalized || undefined;
  }

  /**
   * Get the raw bytes (base64) and mimetype of the customer's image, in this order:
   * 1. base64 already present in the payload (webhook base64 enabled);
   * 2. download through the channel (Baileys / Cloud API getBase64FromMediaMessage);
   * 3. download from a public http(s) mediaUrl (S3 / MinIO).
   * Returns null (and logs) when the image cannot be obtained.
   */
  private async loadImageForOpenai(
    instance: any,
    msg: any,
    content: string,
  ): Promise<{ base64: string; mimetype: string } | null> {
    const message = msg?.message;
    const declaredMimetype =
      this.normalizeMimetype(message?.imageMessage?.mimetype ?? message?.imageMessage?.mime_type) || 'image/jpeg';

    // 1. base64 already in the payload (with or without a data: prefix)
    if (typeof message?.base64 === 'string' && message.base64.length > 0) {
      const dataUrl = /^data:([^;,]+)?(?:;base64)?,/i.exec(message.base64);
      if (dataUrl) {
        return {
          base64: message.base64.slice(dataUrl[0].length),
          mimetype: this.normalizeMimetype(dataUrl[1]) || declaredMimetype,
        };
      }
      return { base64: message.base64, mimetype: declaredMimetype };
    }

    // 2. Download through the channel. Shallow copies keep the original message untouched.
    if (message && typeof instance?.getBase64FromMediaMessage === 'function') {
      try {
        const media = await instance.getBase64FromMediaMessage({ message: { ...msg, message: { ...message } } });
        if (media?.base64) {
          return { base64: media.base64, mimetype: this.normalizeMimetype(media.mimetype) || declaredMimetype };
        }
      } catch (error) {
        this.logger.warn(`Could not download image through the channel: ${error?.message || error}`);
      }
    }

    // 3. Public URL (S3 / MinIO). With S3 enabled the content also carries the media URL.
    const contentUrl = content.startsWith('imageMessage|') ? content.split('|')[1] : undefined;
    const url = [message?.mediaUrl, contentUrl].find(
      (candidate) => typeof candidate === 'string' && /^https?:\/\//i.test(candidate),
    );

    if (url) {
      try {
        const response = await axios.get(url, {
          responseType: 'arraybuffer',
          timeout: 20000,
          maxContentLength: MAX_IMAGE_BYTES,
        });
        const headerMimetype = this.normalizeMimetype(response.headers?.['content-type']);
        return {
          base64: Buffer.from(response.data).toString('base64'),
          mimetype: headerMimetype?.startsWith('image/') ? headerMimetype : declaredMimetype,
        };
      } catch (error) {
        this.logger.warn(`Could not download image from mediaUrl: ${error?.message || error}`);
      }
    }

    this.logger.error(
      `Image for message ${msg?.key?.id ?? 'unknown'} could not be obtained; continuing with text only`,
    );
    return null;
  }

  /**
   * Stop sending the remaining parts of an answer (splitMessages / media) once a human took over the chat.
   */
  protected async shouldStopSending(instance: any, remoteJid: string): Promise<boolean> {
    const session = await this.prismaRepository.integrationSession.findFirst({
      where: { instanceId: instance?.instanceId, remoteJid, type: this.getBotType() },
      orderBy: { createdAt: 'desc' },
    });

    return isHumanPaused(session);
  }

  /**
   * Copy of a chat message with image blocks replaced by a short text placeholder,
   * so base64 payloads never reach session.context (or the logs).
   */
  private stripImagesFromMessage(message: any): any {
    if (!message || !Array.isArray(message.content)) {
      return message;
    }

    return {
      ...message,
      content: message.content.map((part: any) =>
        part?.type === 'image_url' || part?.type === 'image_file'
          ? { type: 'text', text: IMAGE_HISTORY_PLACEHOLDER }
          : part,
      ),
    };
  }
}
