import { PrismaRepository } from '@api/repository/repository.service';
import { AgendaService } from '@api/services/agenda.service';
import { LeadsService } from '@api/services/leads.service';
import { WAMonitoringService } from '@api/services/monitor.service';
import { UsageGate, UsageService } from '@api/services/usage.service';
import { Integration } from '@api/types/wa.types';
import { ConfigService, Language, Openai as OpenaiConfig } from '@config/env.config';
import { IntegrationSession, OpenaiBot, OpenaiSetting } from '@prisma/client';
import { ethicsSystemPrompt } from '@utils/ethics';
import { hasHumanWrittenSince, isHumanPaused } from '@utils/humanPause';
import { openaiHealthRegistry } from '@utils/openai-health';
import {
  countPdfPages,
  describeDocument,
  describeLongAudio,
  documentHistoryPlaceholder,
  DocumentInfo,
  FALLBACK_TRANSCRIPTION_MODEL,
  getAudioSeconds,
  getDocumentInfo,
  getDocumentMessage,
  MAX_PDF_PAGES,
  MEDIA_TEXT,
  normalizeMimetype,
  OpenaiMediaOptions,
  resolveOpenaiMediaOptions,
  withCaption,
} from '@utils/openaiMedia';
import { getProcessAiContext } from '@utils/processos/aiContext';
import { stripQuotedContext } from '@utils/quotedContext';
import { sendTelemetry } from '@utils/sendTelemetry';
import axios from 'axios';
import { downloadMediaMessage } from 'baileys';
import FormData from 'form-data';
import OpenAI, { toFile } from 'openai';
import P from 'pino';

import { BaseChatbotService } from '../../base-chatbot.service';
import {
  buildAgendaContext,
  contactJidsOf,
  isToolsUnsupportedError,
  modelsWithoutTools,
  runToolLoop,
} from '../agenda-ai';

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

type MediaTokenType =
  | 'audioMessage'
  | 'imageMessage'
  | 'videoMessage'
  | 'documentMessage'
  | 'documentWithCaptionMessage';

/** A media line of the content built by getConversationMessage: "<type>|<message id or media url>|<caption>". */
type MediaToken = { type: MediaTokenType; id: string; caption: string };

const MEDIA_TOKEN_REGEX =
  /^(audioMessage|imageMessage|videoMessage|documentWithCaptionMessage|documentMessage)\|([^|]*)(?:\|([\s\S]*))?$/;

/** What the customer's message turns into before it is sent to OpenAI. Media is loaded once, here. */
type UserSegment =
  | { kind: 'text'; text: string }
  | { kind: 'image'; caption: string; image: { base64: string; mimetype: string } | null }
  | { kind: 'pdf'; info: DocumentInfo; base64: string };

/**
 * OpenAI service that extends the common BaseChatbotService
 * Handles both Assistant API and ChatCompletion API
 */
export class OpenaiService extends BaseChatbotService<OpenaiBot, OpenaiSetting> {
  /** "Plano e limites": counts every answer and enforces business hours and caps (shared with the REST routes). */
  protected readonly usage: UsageService;
  /** "Leads (triagem)": each answered conversation may be analysed in the background (never delays the answer). */
  public leads: LeadsService | null;

  constructor(
    waMonitor: WAMonitoringService,
    prismaRepository: PrismaRepository,
    configService: ConfigService,
    usage?: UsageService,
    leads?: LeadsService | null,
    /** "Agenda" (optional): tools for the AI and the replies to reminders, only where the agenda is on. */
    protected readonly agenda?: AgendaService,
  ) {
    super(waMonitor, prismaRepository, 'OpenaiService', configService);
    this.usage = usage ?? new UsageService(prismaRepository);
    this.leads = leads ?? null;
  }

  /**
   * Return the bot type for OpenAI
   */
  protected getBotType(): string {
    return 'openai';
  }

  /**
   * OpenAI client for the provided API key. Each request uses its own client: this service is shared by every
   * instance, so a client kept on the service could be replaced by a concurrent request of another instance
   * (answering with the credentials, and on the account, of the wrong customer).
   */
  protected initClient(apiKey: string): OpenAI {
    return new OpenAI({ apiKey });
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

      // Message types without any text (e.g. reactions) are not answered
      if (typeof content !== 'string') {
        this.logger.log(`Message without text content for ${remoteJid}: not sent to OpenAI`);
        return;
      }

      // "Agenda": "1" / "2" right after a reminder (no OpenAI call, not counted as an answer)
      const reminderReply = await this.agenda
        ?.handleReminderReply(instance.instanceId, contactJidsOf(remoteJid, msg), stripQuotedContext(content))
        .catch((error) => {
          this.logger.error(`Agenda reply check failed: ${error?.message ?? error}`);
          return null;
        });
      if (reminderReply?.reply) {
        await this.sendMessageWhatsApp(instance, remoteJid, reminderReply.reply, settings, false);
        return;
      }
      if (reminderReply?.note) content = `${content}\n${reminderReply.note}`;

      // "Plano e limites": business hours and caps, before anything is sent to OpenAI (transcription included).
      // The finish keyword still works while the AI is off.
      const gate = await this.usage.checkBeforeAnswer(instance.instanceId, remoteJid);
      if (!gate.allow && !this.isFinishKeyword(content, settings)) {
        if (reminderReply?.fallback) {
          await this.sendMessageWhatsApp(instance, remoteJid, reminderReply.fallback, settings, false);
          return;
        }
        await this.handleBlockedAnswer(instance, remoteJid, session, settings, gate);
        return;
      }
      if (gate.overage) {
        this.logger.log(`Monthly franchise of instance ${instance.instanceName} exceeded: answering (excedente)`);
      }

      // Get the OpenAI credentials
      const creds = await this.prismaRepository.openaiCreds.findUnique({
        where: { id: openaiBot.openaiCredsId },
      });

      if (!creds) {
        this.logger.error(`OpenAI credentials not found. CredsId: ${openaiBot.openaiCredsId}`);
        return;
      }

      // Audio is transcribed (or described) and unreadable media described before anything else, so the finish
      // keyword and the model see plain text
      const media = resolveOpenaiMediaOptions(openaiBot, settings);
      const prepared = await this.prepareMediaContent(instance, content, msg, media, creds.apiKey);

      if (prepared === null) {
        this.logger.error('Failed to transcribe audio');
        await this.sendErrorFallback(instance, remoteJid, settings, session);
        return;
      }

      content = prepared;

      // Handle keyword finish
      const keywordFinish = settings?.keywordFinish || '';
      // The quote line added for the model (#2078) is not part of what the customer typed
      const normalizedContent = stripQuotedContext(content).toLowerCase().trim();
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

    const creds = await this.prismaRepository.openaiCreds.findUnique({
      where: { id: openaiBot.openaiCredsId },
    });

    if (!creds) {
      this.logger.error(`OpenAI credentials not found in sendMessageToBot. CredsId: ${openaiBot.openaiCredsId}`);
      return;
    }

    const client = this.initClient(creds.apiKey);

    try {
      let message: string;

      // Handle different bot types
      if (openaiBot.botType === 'assistant') {
        this.logger.log('Processing with Assistant API');
        message = await this.processAssistantMessage(
          client,
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
          client,
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

      // Send the response. One answer of the plan per reply (all its split parts), only when something went out
      if (message) {
        this.logger.log('Sending message to WhatsApp');
        const sent = await this.sendMessageWhatsApp(instance, remoteJid, message, settings, true);
        if (sent > 0) {
          await this.usage.recordAnswer(instance.instanceId, remoteJid);
          // Not an answer of the plan: a background analysis of the conversation for the team (never sent to the client)
          this.leads?.afterBotReply({
            instance,
            instanceId: instance.instanceId,
            instanceName: instance.instanceName,
            remoteJid,
            pushName,
            apiKey: creds.apiKey,
            model: openaiBot.model,
          });
        }
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
    } finally {
      // The turn is over (answer, discarded answer or fallback): offline again unless alwaysOnline (#2469/#2537)
      await this.sendUnavailablePresence(instance);
    }
  }

  private isFinishKeyword(content: string, settings: OpenaiSetting): boolean {
    const keywordFinish = settings?.keywordFinish || '';
    return keywordFinish.length > 0 && stripQuotedContext(content).toLowerCase().trim() === keywordFinish.toLowerCase();
  }

  /**
   * The AI does not answer (outside business hours or over a cap). At most one notice per contact per day
   * (outsideHoursMessage / overLimitMessage), never while the team is talking to the contact. Not counted.
   */
  private async handleBlockedAnswer(
    instance: any,
    remoteJid: string,
    session: IntegrationSession,
    settings: OpenaiSetting,
    gate: UsageGate,
  ): Promise<void> {
    this.logger.log(`Not answering ${remoteJid} (instance ${instance.instanceName}): ${gate.reason}`);
    if (session && isHumanPaused(session)) return;
    if (!gate.notice) return;

    const text = gate.notice === 'hours' ? gate.limits?.outsideHoursMessage : gate.limits?.overLimitMessage;
    if (!text) return;
    if (!(await this.usage.claimNotice(instance.instanceId, remoteJid, gate.notice, gate.day))) return;

    try {
      await this.sendMessageWhatsApp(instance, remoteJid, text, settings, false);
    } catch (error) {
      this.logger.error(`Could not send the ${gate.notice} notice to ${remoteJid}: ${error?.message ?? error}`);
    }
  }

  /**
   * Process message using the OpenAI Assistant API
   */
  private async processAssistantMessage(
    client: OpenAI,
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
      content: fromMe
        ? [{ type: 'text', text: content }]
        : await this.buildAssistantContent(client, instance, content, msg),
    };

    // Get thread ID from session or create new thread
    let threadId = session.sessionId;

    // Create a new thread if one doesn't exist or invalid format
    // A session created by the human takeover keeps the chat JID as sessionId (not a thread id)
    if (!threadId || threadId === remoteJid || threadId.includes('@')) {
      const newThread = await client.beta.threads.create();
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
    await client.beta.threads.messages.create(threadId, messageData);

    if (fromMe) {
      sendTelemetry('/message/sendText');
      return '';
    }

    // Run the assistant
    const runAssistant = await client.beta.threads.runs.create(threadId, {
      assistant_id: openaiBot.assistantId,
    });

    if (instance.integration === Integration.WHATSAPP_BAILEYS) {
      await instance.client.presenceSubscribe(remoteJid);
      await instance.client.sendPresenceUpdate('composing', remoteJid);
    }

    // Wait for the assistant to complete
    let response: Awaited<ReturnType<typeof this.getAIResponse>>;
    try {
      response = await this.getAIResponse(
        client,
        threadId,
        runAssistant.id,
        openaiBot.functionUrl,
        remoteJid,
        pushName,
      );
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
    client: OpenAI,
    instance: any,
    openaiBot: OpenaiBot,
    remoteJid: string,
    content: string,
    msg?: any,
    settings?: OpenaiSetting,
    currentSession?: IntegrationSession,
  ): Promise<string> {
    this.logger.log('Starting processChatCompletionMessage');

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

    // How many previous messages the model sees (bot > settings > 10)
    const historyLimit = resolveOpenaiMediaOptions(openaiBot, settings).historyMessages;
    let conversationHistory = [];

    if (session && session.context) {
      try {
        const sessionData =
          typeof session.context === 'string' ? JSON.parse(session.context as string) : session.context;

        // Strip image blocks saved by older versions (raw base64 / invalid WhatsApp URLs that make
        // every following request fail with "400 Failed to download file")
        conversationHistory = (sessionData.history || [])
          .map((message) => this.stripMediaFromMessage(message))
          .slice(-historyLimit);
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

    // Fixed messages of the bot. Blank entries (the panel saves "" for an empty field) are not sent: an empty
    // "user"/"assistant" turn before the conversation only confuses the model
    const filled = (list: unknown): string[] =>
      (Array.isArray(list) ? list : []).filter((item): item is string => typeof item === 'string' && !!item.trim());

    // Ethics profile of the instance (e.g. the OAB rules of a law office): first, above the prompt of the client
    const ethics = ethicsSystemPrompt((settings as any)?.ethicsProfile);
    const messagesSystem: any[] = [
      ...(ethics ? [{ role: 'system', content: ethics }] : []),
      ...filled(openaiBot.systemMessages).map((message) => ({ role: 'system', content: message })),
    ];
    const messagesAssistant: any[] = filled(openaiBot.assistantMessages).map((message) => ({
      role: 'assistant',
      content: message,
    }));
    const messagesUser: any[] = filled(openaiBot.userMessages).map((message) => ({ role: 'user', content: message }));

    // Prepare current message (images as data URLs, PDFs as file inputs)
    const media = resolveOpenaiMediaOptions(openaiBot, settings);
    const messageData: any = {
      role: 'user',
      content: await this.buildChatCompletionContent(instance, content, msg, media),
    };

    // "Processos": dates of the last updates of THIS contact's monitored processes (opt-in, never saved in history)
    const processContext = await getProcessAiContext(instance.instanceId, remoteJid, stripQuotedContext(content));

    // Combine all messages: system messages, pre-defined messages, conversation history, and current message
    const messages: any[] = [
      ...messagesSystem,
      ...messagesAssistant,
      ...messagesUser,
      ...conversationHistory,
      ...(processContext ? [{ role: 'system', content: processContext }] : []),
      messageData,
    ];

    this.logger.log(
      `Final messages payload: ${JSON.stringify(messages.map((message) => this.stripMediaFromMessage(message)))}`,
    );

    if (instance.integration === Integration.WHATSAPP_BAILEYS) {
      this.logger.log('Setting typing indicator');
      await instance.client.presenceSubscribe(remoteJid);
      await instance.client.sendPresenceUpdate('composing', remoteJid);
    }

    // Send the request to OpenAI
    try {
      this.logger.log('Sending request to OpenAI API');
      const completions = await this.createAnswerCompletion(
        client,
        instance,
        openaiBot,
        remoteJid,
        messages,
        tokenParam,
        msg,
      );

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
      // (images and documents are replaced by a text placeholder so base64 never lands in session.context)
      conversationHistory.push(this.stripMediaFromMessage(messages[messages.length - 1]));
      conversationHistory.push({
        role: 'assistant',
        content: responseContent,
      });

      // Limit history length to avoid token limits (keep the last `historyMessages` messages)
      if (conversationHistory.length > historyLimit) {
        conversationHistory = conversationHistory.slice(conversationHistory.length - historyLimit);
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
    client: OpenAI,
    threadId: string,
    runId: string,
    functionUrl: string | null,
    remoteJid: string,
    pushName: string,
  ) {
    let status = await client.beta.threads.runs.retrieve(runId, { thread_id: threadId });

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
      status = await client.beta.threads.runs.retrieve(runId, { thread_id: threadId });

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

        await client.beta.threads.runs.submitToolOutputs(runId, {
          thread_id: threadId,
          tool_outputs: toolOutputs,
        });
      }

      maxRetries--;
    }

    if (status.status === 'completed') {
      const messages = await client.beta.threads.messages.list(threadId);
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
   * Transcription of an audio message (/v1/audio/transcriptions). Also used by the channels (settings.speechToText)
   * and by other bots. Without `options` the credentials and the model come from the instance OpenAI settings;
   * the OpenAI bot passes the key of its own credentials and its resolved `transcriptionModel`.
   * If OpenAI rejects the model, whisper-1 is tried once.
   */
  public async speechToText(
    msg: any,
    instance: any,
    options: { apiKey?: string; model?: string } = {},
  ): Promise<string | null> {
    let apiKey = options.apiKey;
    let model = options.model;

    if (!apiKey || !model) {
      const settings = await this.prismaRepository.openaiSetting.findFirst({
        where: {
          instanceId: instance.instanceId,
        },
      });

      if (!apiKey) {
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

        apiKey = creds?.apiKey || this.configService.get<OpenaiConfig>('OPENAI').API_KEY_GLOBAL;
      }

      model = model || resolveOpenaiMediaOptions(null, settings).transcriptionModel;
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

    try {
      return await this.requestTranscription(audio, model, lang, apiKey);
    } catch (error) {
      if (model === FALLBACK_TRANSCRIPTION_MODEL || !this.isModelRejectedError(error)) {
        throw error;
      }

      this.logger.warn(
        `Transcription model '${model}' was rejected by OpenAI (${
          error?.response?.status ?? error?.status
        }); retrying once with '${FALLBACK_TRANSCRIPTION_MODEL}'. Check transcriptionModel in the OpenAI settings.`,
      );
      return await this.requestTranscription(audio, FALLBACK_TRANSCRIPTION_MODEL, lang, apiKey);
    }
  }

  /** One call to /v1/audio/transcriptions. */
  protected async requestTranscription(
    audio: Buffer,
    model: string,
    language: string,
    apiKey: string,
  ): Promise<string | null> {
    const formData = new FormData();
    formData.append('file', audio, 'audio.ogg');
    formData.append('model', model);
    formData.append('language', language);

    const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
        Authorization: `Bearer ${apiKey}`,
      },
    });

    return response?.data?.text;
  }

  /** Whether OpenAI rejected the requested model (unknown, not available or not allowed for this endpoint). */
  private isModelRejectedError(error: any): boolean {
    const status = error?.response?.status ?? error?.status;
    if (status !== 400 && status !== 404) return false;

    const body = error?.response?.data?.error ?? error?.error ?? {};
    const code = String(body?.code ?? error?.code ?? '');
    const param = String(body?.param ?? error?.param ?? '');
    const message = String(body?.message ?? error?.message ?? '');

    return code === 'model_not_found' || param === 'model' || /model/i.test(message);
  }

  /**
   * Content of the customer's message as text for the finish keyword and the model, following the media options:
   * the audio of this message is transcribed (or described when off / too long), images described when
   * `readImages` is off, documents described unless they are a PDF the model may read (that line is kept and the
   * PDF is loaded when the request is built). Returns null when the audio could not be transcribed.
   */
  protected async prepareMediaContent(
    instance: any,
    content: string,
    msg: any,
    media: OpenaiMediaOptions,
    apiKey: string,
  ): Promise<string | null> {
    const lines = content.split('\n');

    for (let index = 0; index < lines.length; index++) {
      const token = this.parseMediaToken(lines[index]);
      if (!token) continue;

      const current = this.isCurrentMedia(token, msg);

      if (token.type === 'audioMessage') {
        if (!current) {
          // An earlier audio of a debounced burst: only the last message can be downloaded
          lines[index] = MEDIA_TEXT.audio;
          continue;
        }

        if (!media.transcribeAudio) {
          this.logger.log('Audio transcription is off (transcribeAudio): sending a description to the model');
          lines[index] = MEDIA_TEXT.audio;
          continue;
        }

        const seconds = getAudioSeconds(msg);
        if (media.maxAudioSeconds > 0 && seconds !== undefined && seconds > media.maxAudioSeconds) {
          this.logger.log(
            `Audio of ${seconds}s is longer than maxAudioSeconds (${media.maxAudioSeconds}): not transcribed`,
          );
          lines[index] = describeLongAudio(seconds);
          continue;
        }

        this.logger.log(`Detected audio message, transcribing with ${media.transcriptionModel}`);
        const transcription = await this.speechToText(msg, instance, {
          apiKey,
          model: media.transcriptionModel,
        }).catch((error) => {
          this.logOpenaiError('speechToText', error);
          return null;
        });

        if (!transcription) return null;

        // Only the size: the content of the conversation is not logged
        this.logger.log(`Audio transcribed (${transcription.length} characters)`);
        lines[index] = transcription;
      } else if (token.type === 'imageMessage') {
        if (!media.readImages) {
          lines[index] = withCaption(MEDIA_TEXT.image, token.caption);
        }
      } else if (token.type === 'videoMessage') {
        lines[index] = withCaption(MEDIA_TEXT.video, token.caption);
      } else {
        const info = getDocumentInfo(current ? msg : null, token.caption);
        const maxBytes = media.maxDocumentMB * 1024 * 1024;
        const readable =
          current && media.readDocuments && info.isPdf && !(info.sizeBytes !== undefined && info.sizeBytes > maxBytes);

        if (!readable) {
          lines[index] = describeDocument(info);
        }
      }
    }

    return lines.join('\n');
  }

  private parseMediaToken(line: string): MediaToken | null {
    const match = MEDIA_TOKEN_REGEX.exec(line);
    if (!match) return null;
    return { type: match[1] as MediaTokenType, id: match[2], caption: (match[3] ?? '').trim() };
  }

  /**
   * Whether the media line belongs to `msg`, the message handed to process() (with debounce, the last one of the
   * burst): only that media can be downloaded.
   */
  private isCurrentMedia(token: MediaToken, msg: any): boolean {
    const message = msg?.message;
    if (!message || !token.id) return false;
    if (token.id !== msg?.key?.id && token.id !== message.mediaUrl) return false;

    switch (token.type) {
      case 'audioMessage':
        return !!message.audioMessage;
      case 'imageMessage':
        return !!message.imageMessage;
      case 'videoMessage':
        return !!message.videoMessage;
      default:
        return !!getDocumentMessage(msg);
    }
  }

  /**
   * The customer's message split into text, images and PDFs, with the media already loaded. PDFs are only loaded
   * when `readPdf` (Chat Completions); otherwise they are described.
   */
  private async buildUserSegments(
    instance: any,
    content: string,
    msg: any,
    options: { readPdf: boolean; maxDocumentMB: number },
  ): Promise<UserSegment[]> {
    const segments: UserSegment[] = [];
    const pushText = (text: string) => {
      const last = segments[segments.length - 1];
      if (last?.kind === 'text') last.text = `${last.text}\n${text}`;
      else segments.push({ kind: 'text', text });
    };

    for (const line of content.split('\n')) {
      const token = this.parseMediaToken(line);

      if (token?.type === 'imageMessage') {
        const image = this.isCurrentMedia(token, msg) ? await this.loadImageForOpenai(instance, msg, line) : null;
        segments.push({ kind: 'image', caption: token.caption, image });
      } else if (token?.type === 'documentMessage' || token?.type === 'documentWithCaptionMessage') {
        const current = this.isCurrentMedia(token, msg);
        const info = getDocumentInfo(current ? msg : null, token.caption);

        if (!current || !info.isPdf) {
          pushText(describeDocument(info));
        } else if (!options.readPdf) {
          this.logger.log('PDF not read in assistant mode (the Assistants API has no file input in messages)');
          pushText(describeDocument(info));
        } else {
          const pdf = await this.loadPdfForOpenai(instance, msg, line, info, options.maxDocumentMB);
          if ('base64' in pdf) segments.push({ kind: 'pdf', info, base64: pdf.base64 });
          else pushText(describeDocument(info, pdf.details));
        }
      } else {
        pushText(line);
      }
    }

    return segments;
  }

  /** Content parts of the customer's message for Chat Completions. */
  private async buildChatCompletionContent(
    instance: any,
    content: string,
    msg: any,
    media: OpenaiMediaOptions,
  ): Promise<any[]> {
    const segments = await this.buildUserSegments(instance, content, msg, {
      readPdf: media.readDocuments,
      maxDocumentMB: media.maxDocumentMB,
    });
    const parts: any[] = [];

    for (const segment of segments) {
      if (segment.kind === 'text') {
        parts.push({ type: 'text', text: segment.text });
      } else if (segment.kind === 'image') {
        // WhatsApp CDN URLs and bare base64 are rejected by OpenAI ("400 Failed to download file"): data URL
        if (segment.image) {
          if (segment.caption) parts.push({ type: 'text', text: segment.caption });
          parts.push({
            type: 'image_url',
            image_url: { url: `data:${segment.image.mimetype};base64,${segment.image.base64}` },
          });
        } else {
          parts.push({ type: 'text', text: this.withImageUnavailableNote(segment.caption) });
        }
      } else {
        if (segment.info.caption) parts.push({ type: 'text', text: segment.info.caption });
        parts.push({
          type: 'file',
          file: {
            filename: segment.info.fileName || 'documento.pdf',
            file_data: `data:application/pdf;base64,${segment.base64}`,
          },
        });
      }
    }

    return this.mergeTextParts(parts.length ? parts : [{ type: 'text', text: content }]);
  }

  /**
   * Content parts of the customer's message for the Assistants API. It only accepts external URLs in image_url (no
   * data URLs), so images are uploaded as 'vision' files and referenced by image_file.
   */
  private async buildAssistantContent(client: OpenAI, instance: any, content: string, msg: any): Promise<any[]> {
    const segments = await this.buildUserSegments(instance, content, msg, { readPdf: false, maxDocumentMB: 0 });
    const parts: any[] = [];

    for (const segment of segments) {
      if (segment.kind === 'text') {
        parts.push({ type: 'text', text: segment.text });
      } else if (segment.kind === 'image') {
        let fileId: string | null = null;

        if (segment.image) {
          try {
            const extension = segment.image.mimetype.split('/')[1] || 'jpg';
            const file = await client.files.create({
              file: await toFile(Buffer.from(segment.image.base64, 'base64'), `image.${extension}`, {
                type: segment.image.mimetype,
              }),
              purpose: 'vision',
            });
            fileId = file.id;
          } catch (error) {
            this.logOpenaiError('processAssistantMessage.uploadImage', error);
          }
        }

        if (fileId) {
          parts.push({ type: 'text', text: segment.caption || IMAGE_HISTORY_PLACEHOLDER });
          parts.push({ type: 'image_file', image_file: { file_id: fileId } });
        } else {
          parts.push({ type: 'text', text: this.withImageUnavailableNote(segment.caption) });
        }
      }
    }

    return this.mergeTextParts(parts.length ? parts : [{ type: 'text', text: content }]);
  }

  /** Adjacent text parts joined in one. */
  private mergeTextParts(parts: any[]): any[] {
    return parts.reduce((merged: any[], part) => {
      const last = merged[merged.length - 1];
      if (part.type === 'text' && last?.type === 'text') {
        merged[merged.length - 1] = { type: 'text', text: `${last.text}\n${part.text}` };
      } else {
        merged.push(part);
      }
      return merged;
    }, []);
  }

  /**
   * Call Chat Completions; if the model rejects the PDF file input (400), retry once with each document replaced
   * by its description, so the customer still gets an answer.
   */
  private async createChatCompletionWithFiles(
    client: OpenAI,
    openaiBot: OpenaiBot,
    messages: any[],
    tokenParam: { mode: TokenParamMode; param: TokenParamName },
    extra: Record<string, any> = {},
  ) {
    try {
      return await this.createChatCompletion(client, openaiBot, messages, tokenParam, extra);
    } catch (error) {
      const current = messages[messages.length - 1];
      const hasFiles = Array.isArray(current?.content) && current.content.some((part: any) => part?.type === 'file');
      if (!hasFiles || !this.isFileInputRejectedError(error)) throw error;

      this.logger.warn(
        `Model ${openaiBot.model} rejected the PDF file input (${error?.status ?? error?.response?.status}: ` +
          `${error?.message}); retrying once with the document described as text`,
      );

      messages[messages.length - 1] = {
        ...current,
        content: this.mergeTextParts(
          current.content.map((part: any) =>
            part?.type === 'file'
              ? {
                  type: 'text',
                  text: describeDocument({ fileName: part.file?.filename, typeLabel: 'PDF', isPdf: true }),
                }
              : part,
          ),
        ),
      };

      return await this.createChatCompletion(client, openaiBot, messages, tokenParam, extra);
    }
  }

  /**
   * The completion of one answer. With the agenda of the instance on, the agenda tools (and a short system note)
   * are offered in a bounded tool loop; a model that rejects tools is remembered and answered without them.
   */
  private async createAnswerCompletion(
    client: OpenAI,
    instance: any,
    openaiBot: OpenaiBot,
    remoteJid: string,
    messages: any[],
    tokenParam: { mode: TokenParamMode; param: TokenParamName },
    msg?: any,
  ) {
    const agenda = await buildAgendaContext(this.agenda, instance?.instanceId, remoteJid, {
      msg,
      pushName: msg?.pushName,
      model: openaiBot.model,
    }).catch((error) => {
      this.logger.error(`Agenda tools unavailable: ${error?.message ?? error}`);
      return null;
    });
    if (!agenda) return this.createChatCompletionWithFiles(client, openaiBot, messages, tokenParam);

    const firstOther = messages.findIndex((message) => message?.role !== 'system');
    const withNote = [...messages];
    withNote.splice(firstOther < 0 ? withNote.length : firstOther, 0, { role: 'system', content: agenda.systemPrompt });
    try {
      const { completion, calls } = await runToolLoop(withNote, agenda, (convo, extra) =>
        this.createChatCompletionWithFiles(client, openaiBot, convo, tokenParam, extra),
      );
      if (calls.length) this.logger.log(`Agenda tools used for ${remoteJid}: ${calls.join(', ')}`);
      return completion;
    } catch (error) {
      if (!isToolsUnsupportedError(error)) throw error;
      if (openaiBot.model) modelsWithoutTools.add(openaiBot.model);
      this.logger.warn(`Model ${openaiBot.model} does not accept tools: answering without the agenda tools`);
      return this.createChatCompletionWithFiles(client, openaiBot, messages, tokenParam);
    }
  }

  /** A 400 of OpenAI about the file input (model without PDF support, invalid or unreadable file). */
  private isFileInputRejectedError(error: any): boolean {
    const status = error?.status ?? error?.response?.status;
    if (status !== 400) return false;
    if (this.isUnsupportedTokenParamError(error, 'max_tokens')) return false;
    if (this.isUnsupportedTokenParamError(error, 'max_completion_tokens')) return false;

    const body = error?.error ?? error?.response?.data?.error ?? {};
    const text = [error?.message, body?.message, body?.param, error?.param, body?.code, error?.code]
      .filter(Boolean)
      .join(' ');

    return /file|pdf|document/i.test(text);
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
    client: OpenAI,
    openaiBot: OpenaiBot,
    messages: any[],
    tokenParam: { mode: TokenParamMode; param: TokenParamName },
    extra: Record<string, any> = {},
  ) {
    // Saúde da chave do cliente (só em memória): cada resposta real diz se a chave funciona ou por que falhou
    try {
      const completion = await this.requestChatCompletion(client, openaiBot, messages, tokenParam, extra);
      openaiHealthRegistry.recordOk(openaiBot.openaiCredsId, openaiBot.model);
      return completion;
    } catch (error) {
      openaiHealthRegistry.recordError(openaiBot.openaiCredsId, error, openaiBot.model);
      throw error;
    }
  }

  private async requestChatCompletion(
    client: OpenAI,
    openaiBot: OpenaiBot,
    messages: any[],
    tokenParam: { mode: TokenParamMode; param: TokenParamName },
    extra: Record<string, any> = {},
  ) {
    const maxTokens = openaiBot.maxTokens || 500;
    const buildParams = (param: TokenParamName) => {
      const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = { ...extra, model: openaiBot.model, messages };
      params[param] = maxTokens;
      return params;
    };

    try {
      return await client.chat.completions.create(buildParams(tokenParam.param));
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

      const completion = await client.chat.completions.create(buildParams(fallbackParam));

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

  private withImageUnavailableNote(caption: string): string {
    return caption ? `${caption}\n${IMAGE_UNAVAILABLE_NOTE}` : IMAGE_UNAVAILABLE_NOTE;
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
      normalizeMimetype(message?.imageMessage?.mimetype ?? message?.imageMessage?.mime_type) || 'image/jpeg';

    const media = await this.loadMediaForOpenai(instance, msg, content, {
      declaredMimetype,
      maxBytes: MAX_IMAGE_BYTES,
      isExpectedMimetype: (mimetype) => mimetype.startsWith('image/'),
      label: 'image',
    });

    if (!media) {
      this.logger.error(
        `Image for message ${msg?.key?.id ?? 'unknown'} could not be obtained; continuing with text only`,
      );
    }

    return media;
  }

  /**
   * The customer's PDF as base64, if it is within `maxDocumentMB` and MAX_PDF_PAGES. Otherwise `details` says why
   * it is described instead (undefined: the generic description). Its content is never logged.
   */
  private async loadPdfForOpenai(
    instance: any,
    msg: any,
    content: string,
    info: DocumentInfo,
    maxDocumentMB: number,
  ): Promise<{ base64: string } | { details?: string }> {
    const maxBytes = maxDocumentMB * 1024 * 1024;
    const pdf = await this.loadMediaForOpenai(instance, msg, content, {
      declaredMimetype: 'application/pdf',
      maxBytes,
      isExpectedMimetype: (mimetype) => mimetype === 'application/pdf',
      label: 'document',
    });

    if (!pdf) {
      this.logger.warn(`PDF of message ${msg?.key?.id ?? 'unknown'} could not be obtained; describing it instead`);
      return {};
    }

    const bytes = Buffer.from(pdf.base64, 'base64');

    if (bytes.length > maxBytes) {
      this.logger.log(`PDF of ${bytes.length} bytes is larger than maxDocumentMB (${maxDocumentMB}): not sent`);
      return {};
    }

    if (bytes.subarray(0, 1024).indexOf('%PDF-') < 0) {
      this.logger.warn(`Document ${info.fileName ?? ''} declared as PDF is not a PDF file: not sent`);
      return {};
    }

    const pages = countPdfPages(bytes);
    if (pages !== null && pages > MAX_PDF_PAGES) {
      this.logger.log(`PDF with ${pages} pages is longer than ${MAX_PDF_PAGES} pages: not sent`);
      return { details: `${pages} páginas` };
    }

    this.logger.log(`Sending PDF to the model (${bytes.length} bytes, ${pages ?? 'unknown'} pages)`);
    return { base64: pdf.base64 };
  }

  /**
   * Raw bytes (base64) and mimetype of the media of `msg`: base64 already in the payload, then the channel
   * download (Baileys / Cloud API getBase64FromMediaMessage), then a public http(s) mediaUrl (S3 / MinIO).
   */
  private async loadMediaForOpenai(
    instance: any,
    msg: any,
    content: string,
    options: {
      declaredMimetype: string;
      maxBytes: number;
      isExpectedMimetype: (mimetype: string) => boolean;
      label: string;
    },
  ): Promise<{ base64: string; mimetype: string } | null> {
    const message = msg?.message;
    const { declaredMimetype } = options;

    // 1. base64 already in the payload (with or without a data: prefix)
    if (typeof message?.base64 === 'string' && message.base64.length > 0) {
      const dataUrl = /^data:([^;,]+)?(?:;base64)?,/i.exec(message.base64);
      if (dataUrl) {
        return {
          base64: message.base64.slice(dataUrl[0].length),
          mimetype: normalizeMimetype(dataUrl[1]) || declaredMimetype,
        };
      }
      return { base64: message.base64, mimetype: declaredMimetype };
    }

    // 2. Download through the channel. Shallow copies keep the original message untouched.
    if (message && typeof instance?.getBase64FromMediaMessage === 'function') {
      try {
        const media = await instance.getBase64FromMediaMessage({ message: { ...msg, message: { ...message } } });
        if (media?.base64) {
          return { base64: media.base64, mimetype: normalizeMimetype(media.mimetype) || declaredMimetype };
        }
      } catch (error) {
        this.logger.warn(`Could not download ${options.label} through the channel: ${error?.message || error}`);
      }
    }

    // 3. Public URL (S3 / MinIO). With S3 enabled the content also carries the media URL.
    const contentUrl = MEDIA_TOKEN_REGEX.exec(content)?.[2];
    const url = [message?.mediaUrl, contentUrl].find(
      (candidate) => typeof candidate === 'string' && /^https?:\/\//i.test(candidate),
    );

    if (url) {
      try {
        const response = await axios.get(url, {
          responseType: 'arraybuffer',
          timeout: 20000,
          maxContentLength: options.maxBytes,
        });
        const headerMimetype = normalizeMimetype(response.headers?.['content-type']);
        return {
          base64: Buffer.from(response.data).toString('base64'),
          mimetype: headerMimetype && options.isExpectedMimetype(headerMimetype) ? headerMimetype : declaredMimetype,
        };
      } catch (error) {
        this.logger.warn(`Could not download ${options.label} from mediaUrl: ${error?.message || error}`);
      }
    }

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
   * Copy of a chat message with image and document blocks replaced by a short text placeholder,
   * so base64 payloads never reach session.context (or the logs).
   */
  private stripMediaFromMessage(message: any): any {
    if (!message || !Array.isArray(message.content)) {
      return message;
    }

    return {
      ...message,
      content: message.content.map((part: any) => {
        if (part?.type === 'image_url' || part?.type === 'image_file') {
          return { type: 'text', text: IMAGE_HISTORY_PLACEHOLDER };
        }
        if (part?.type === 'file') {
          return { type: 'text', text: documentHistoryPlaceholder(part.file?.filename) };
        }
        return part;
      }),
    };
  }
}
