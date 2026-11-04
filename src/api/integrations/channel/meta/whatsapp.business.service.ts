import { NumberBusiness } from '@api/dto/chat.dto';
import {
  ContactMessage,
  MediaMessage,
  Options,
  SendAudioDto,
  SendButtonsDto,
  SendContactDto,
  SendListDto,
  SendLocationDto,
  SendMediaDto,
  SendReactionDto,
  SendTemplateDto,
  SendTextDto,
} from '@api/dto/sendMessage.dto';
import * as s3Service from '@api/integrations/storage/s3/libs/minio.server';
import { ProviderFiles } from '@api/provider/sessions';
import { PrismaRepository } from '@api/repository/repository.service';
import { chatbotController } from '@api/server.module';
import { CacheService } from '@api/services/cache.service';
import { ChannelStartupService } from '@api/services/channel.service';
import { Events, wa } from '@api/types/wa.types';
import { AudioConverter, Chatwoot, ConfigService, Database, Openai, S3, WaBusiness } from '@config/env.config';
import { BadRequestException, InternalServerErrorException } from '@exceptions';
import { detectAudioFormat, detectAudioFormatFromBase64 } from '@utils/audioFormat';
import { isBotMessageId, registerBotMessageId } from '@utils/botMessageRegistry';
import { createJid } from '@utils/createJid';
import { status } from '@utils/renderStatus';
import { sendTelemetry } from '@utils/sendTelemetry';
import axios from 'axios';
import { arrayUnique, isURL } from 'class-validator';
import EventEmitter2 from 'eventemitter2';
import FormData from 'form-data';
import mimeTypes from 'mime-types';
import { join } from 'path';

export class BusinessStartupService extends ChannelStartupService {
  constructor(
    public readonly configService: ConfigService,
    public readonly eventEmitter: EventEmitter2,
    public readonly prismaRepository: PrismaRepository,
    public readonly cache: CacheService,
    public readonly chatwootCache: CacheService,
    public readonly baileysCache: CacheService,
    private readonly providerFiles: ProviderFiles,
  ) {
    super(configService, eventEmitter, prismaRepository, chatwootCache);
  }

  public stateConnection: wa.StateConnection = { state: 'open' };

  public phoneNumber: string;
  public mobile: boolean;

  public get connectionStatus() {
    return this.stateConnection;
  }

  public async closeClient() {
    this.stateConnection = { state: 'close' };
  }

  public get qrCode(): wa.QrCode {
    return {
      pairingCode: this.instance.qrcode?.pairingCode,
      code: this.instance.qrcode?.code,
      base64: this.instance.qrcode?.base64,
      count: this.instance.qrcode?.count,
    };
  }

  public async logoutInstance() {
    await this.closeClient();
  }

  private isMediaMessage(message: any) {
    return message.document || message.image || message.audio || message.video;
  }

  private async post(message: any, params: string) {
    try {
      let urlServer = this.configService.get<WaBusiness>('WA_BUSINESS').URL;
      const version = this.configService.get<WaBusiness>('WA_BUSINESS').VERSION;
      urlServer = `${urlServer}/${version}/${this.number}/${params}`;
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` };
      const result = await axios.post(urlServer, message, { headers });
      return result.data;
    } catch (e) {
      return e.response?.data?.error;
    }
  }

  public async profilePicture(number: string) {
    const jid = createJid(number);

    return {
      wuid: jid,
      profilePictureUrl: null,
    };
  }

  public async getProfileName() {
    return null;
  }

  public async profilePictureUrl() {
    return null;
  }

  public async getProfileStatus() {
    return null;
  }

  public async setWhatsappBusinessProfile(data: NumberBusiness): Promise<any> {
    const content = {
      messaging_product: 'whatsapp',
      about: data.about,
      address: data.address,
      description: data.description,
      vertical: data.vertical,
      email: data.email,
      websites: data.websites,
      profile_picture_handle: data.profilehandle,
    };
    return await this.post(content, 'whatsapp_business_profile');
  }

  public async connectToWhatsapp(data?: any): Promise<any> {
    if (!data) return;

    const change = typeof data === 'object' ? data.entry?.[0]?.changes?.[0] : undefined;
    const content = change?.value;
    const field: string | undefined = change?.field;

    if (!content || typeof content !== 'object') {
      this.logger.verbose('Meta webhook without change value ignored');
      return;
    }

    try {
      if (field === 'smb_app_state_sync' || field === 'history') {
        // Coexistence contact/history sync: not stored by this channel
        this.logger.verbose(`Meta webhook field ${field} ignored`);
        return;
      }

      if (field === 'smb_message_echoes') {
        // Coexistence: messages the owner sent with the WhatsApp Business app (or a companion device)
        await this.loadChatwoot();
        await this.messageEchoesHandle(content);
        return;
      }

      const sender = Array.isArray(content.messages) ? content.messages[0]?.from : undefined;
      const recipient = Array.isArray(content.statuses) ? content.statuses[0]?.recipient_id : undefined;

      if (!sender && !recipient) {
        // Unknown fields (e.g. account_update) or payloads without messages/statuses
        this.logger.verbose(`Meta webhook field ${field ?? 'unknown'} without messages or statuses ignored`);
        return;
      }

      this.loadChatwoot();

      this.eventHandler(content);

      this.phoneNumber = createJid(String(sender ?? recipient));
    } catch (error) {
      this.logger.error(error);
      throw new InternalServerErrorException(error?.toString());
    }
  }

  private async downloadMediaMessage(message: any) {
    try {
      const id = message[message.type].id;
      let urlServer = this.configService.get<WaBusiness>('WA_BUSINESS').URL;
      const version = this.configService.get<WaBusiness>('WA_BUSINESS').VERSION;
      urlServer = `${urlServer}/${version}/${id}`;
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` };

      // Primeiro, obtenha a URL do arquivo
      let result = await axios.get(urlServer, { headers });

      // Depois, baixe o arquivo usando a URL retornada
      result = await axios.get(result.data.url, {
        headers: { Authorization: `Bearer ${this.token}` }, // Use apenas o token de autorização para download
        responseType: 'arraybuffer',
      });

      return result.data;
    } catch (e) {
      this.logger.error(`Error downloading media: ${e}`);
      throw e;
    }
  }

  private messageMediaJson(received: any) {
    const message = received.messages[0];
    let content: any = message.type + 'Message';
    content = { [content]: message[message.type] };
    if (message.context) {
      content = { ...content, contextInfo: { stanzaId: message.context.id } };
    }
    return content;
  }

  private messageAudioJson(received: any) {
    const message = received.messages[0];
    let content: any = {
      audioMessage: {
        ...message.audio,
        ptt: message.audio.voice || false, // Define se é mensagem de voz
      },
    };
    if (message.context) {
      content = { ...content, contextInfo: { stanzaId: message.context.id } };
    }
    return content;
  }

  private messageInteractiveJson(received: any) {
    const message = received.messages[0];
    let content: any = { conversation: message.interactive[message.interactive.type].title };
    message.context ? (content = { ...content, contextInfo: { stanzaId: message.context.id } }) : content;
    return content;
  }

  private messageButtonJson(received: any) {
    const message = received.messages[0];
    let content: any = { conversation: received.messages[0].button?.text };
    message.context ? (content = { ...content, contextInfo: { stanzaId: message.context.id } }) : content;
    return content;
  }

  private messageReactionJson(received: any) {
    const message = received.messages[0];
    let content: any = {
      reactionMessage: {
        key: {
          id: message.reaction.message_id,
        },
        text: message.reaction.emoji,
      },
    };
    message.context ? (content = { ...content, contextInfo: { stanzaId: message.context.id } }) : content;
    return content;
  }

  private messageTextJson(received: any) {
    // Verificar que received y received.messages existen
    if (!received || !received.messages || received.messages.length === 0) {
      this.logger.error('Error: received object or messages array is undefined or empty');
      return null;
    }

    const message = received.messages[0];
    let content: any;

    // Verificar si es un mensaje de tipo sticker, location u otro tipo que no tiene text
    if (!message.text) {
      // Si no hay texto, manejamos diferente según el tipo de mensaje
      if (message.type === 'sticker') {
        content = { stickerMessage: {} };
      } else if (message.type === 'location') {
        content = {
          locationMessage: {
            degreesLatitude: message.location?.latitude,
            degreesLongitude: message.location?.longitude,
            name: message.location?.name,
            address: message.location?.address,
          },
        };
      } else {
        // Para otros tipos de mensajes sin texto, creamos un contenido genérico
        this.logger.log(`Mensaje de tipo ${message.type} sin campo text`);
        content = { [message.type + 'Message']: message[message.type] || {} };
      }

      // Añadir contexto si existe
      if (message.context) {
        content = { ...content, contextInfo: { stanzaId: message.context.id } };
      }

      return content;
    }

    // Si el mensaje tiene texto, procesamos normalmente
    if (!received.metadata || !received.metadata.phone_number_id) {
      this.logger.error('Error: metadata or phone_number_id is undefined');
      return null;
    }

    if (message.from === received.metadata.phone_number_id) {
      content = {
        extendedTextMessage: { text: message.text.body },
      };
      if (message.context) {
        content = { ...content, contextInfo: { stanzaId: message.context.id } };
      }
    } else {
      content = { conversation: message.text.body };
      if (message.context) {
        content = { ...content, contextInfo: { stanzaId: message.context.id } };
      }
    }

    return content;
  }

  private messageLocationJson(received: any) {
    const message = received.messages[0];
    let content: any = {
      locationMessage: {
        degreesLatitude: message.location.latitude,
        degreesLongitude: message.location.longitude,
        name: message.location?.name,
        address: message.location?.address,
      },
    };
    message.context ? (content = { ...content, contextInfo: { stanzaId: message.context.id } }) : content;
    return content;
  }

  private messageContactsJson(received: any) {
    const message = received.messages[0];
    let content: any = {};

    const vcard = (contact: any) => {
      let result =
        'BEGIN:VCARD\n' +
        'VERSION:3.0\n' +
        `N:${contact.name.formatted_name}\n` +
        `FN:${contact.name.formatted_name}\n`;

      if (contact.org) {
        result += `ORG:${contact.org.company};\n`;
      }

      if (contact.emails) {
        result += `EMAIL:${contact.emails[0].email}\n`;
      }

      if (contact.urls) {
        result += `URL:${contact.urls[0].url}\n`;
      }

      if (!contact.phones[0]?.wa_id) {
        contact.phones[0].wa_id = createJid(contact.phones[0].phone);
      }

      result +=
        `item1.TEL;waid=${contact.phones[0]?.wa_id}:${contact.phones[0].phone}\n` +
        'item1.X-ABLabel:Celular\n' +
        'END:VCARD';

      return result;
    };

    if (message.contacts.length === 1) {
      content.contactMessage = {
        displayName: message.contacts[0].name.formatted_name,
        vcard: vcard(message.contacts[0]),
      };
    } else {
      content.contactsArrayMessage = {
        displayName: `${message.length} contacts`,
        contacts: message.map((contact) => {
          return {
            displayName: contact.name.formatted_name,
            vcard: vcard(contact),
          };
        }),
      };
    }
    message.context ? (content = { ...content, contextInfo: { stanzaId: message.context.id } }) : content;
    return content;
  }

  private renderMessageType(type: string) {
    let messageType: string;

    switch (type) {
      case 'text':
        messageType = 'conversation';
        break;
      case 'image':
        messageType = 'imageMessage';
        break;
      case 'video':
        messageType = 'videoMessage';
        break;
      case 'audio':
        messageType = 'audioMessage';
        break;
      case 'document':
        messageType = 'documentMessage';
        break;
      case 'template':
        messageType = 'conversation';
        break;
      case 'location':
        messageType = 'locationMessage';
        break;
      case 'sticker':
        messageType = 'stickerMessage';
        break;
      default:
        messageType = 'conversation';
        break;
    }

    return messageType;
  }

  protected async messageHandle(received: any, database: Database, settings: any) {
    try {
      let messageRaw: any;
      let pushName: any;

      // Status webhooks bring `contacts` without `profile` (#2704/#2710): reading it must not abort the statuses
      if (received.contacts) pushName = received.contacts?.[0]?.profile?.name;

      if (received.messages) {
        const message = received.messages[0]; // Añadir esta línea para definir message

        const key = {
          id: message.id,
          // From the message itself: this.phoneNumber is shared by every change of the webhook and may already
          // belong to another contact when several changes arrive together
          remoteJid: createJid(String(message.from)),
          fromMe: message.from === received.metadata.phone_number_id,
        };

        if (message.type === 'sticker') {
          this.logger.log('Procesando mensaje de tipo sticker');
          messageRaw = {
            key,
            pushName,
            message: {
              stickerMessage: message.sticker || {},
            },
            messageType: 'stickerMessage',
            messageTimestamp: parseInt(message.timestamp) as number,
            source: 'unknown',
            instanceId: this.instanceId,
          };
        } else if (this.isMediaMessage(message)) {
          const messageContent =
            message.type === 'audio' ? this.messageAudioJson(received) : this.messageMediaJson(received);

          messageRaw = {
            key,
            pushName,
            message: messageContent,
            contextInfo: messageContent?.contextInfo,
            messageType: this.renderMessageType(received.messages[0].type),
            messageTimestamp: parseInt(received.messages[0].timestamp) as number,
            source: 'unknown',
            instanceId: this.instanceId,
          };

          if (this.configService.get<S3>('S3').ENABLE) {
            try {
              const message: any = received;

              // Verificação adicional para garantir que há conteúdo de mídia real
              const hasRealMedia = this.hasValidMediaContent(messageRaw);

              if (!hasRealMedia) {
                this.logger.warn('Message detected as media but contains no valid media content');
              } else {
                const id = message.messages[0][message.messages[0].type].id;
                let urlServer = this.configService.get<WaBusiness>('WA_BUSINESS').URL;
                const version = this.configService.get<WaBusiness>('WA_BUSINESS').VERSION;
                urlServer = `${urlServer}/${version}/${id}`;
                const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` };
                const result = await axios.get(urlServer, { headers });

                const buffer = await axios.get(result.data.url, {
                  headers: { Authorization: `Bearer ${this.token}` }, // Use apenas o token de autorização para download
                  responseType: 'arraybuffer',
                });

                let mediaType;

                if (message.messages[0].document) {
                  mediaType = 'document';
                } else if (message.messages[0].image) {
                  mediaType = 'image';
                } else if (message.messages[0].audio) {
                  mediaType = 'audio';
                } else {
                  mediaType = 'video';
                }

                if (mediaType == 'video' && !this.configService.get<S3>('S3').SAVE_VIDEO) {
                  this.logger?.info?.('Video upload attempted but is disabled by configuration.');
                  return {
                    success: false,
                    message:
                      'Video upload is currently disabled. Please contact support if you need this feature enabled.',
                  };
                }

                const mimetype = result.data?.mime_type || result.headers['content-type'];

                const contentDisposition = result.headers['content-disposition'];
                let fileName = `${message.messages[0].id}.${mimetype.split('/')[1]}`;
                if (contentDisposition) {
                  const match = contentDisposition.match(/filename="(.+?)"/);
                  if (match) {
                    fileName = match[1];
                  }
                }

                // Para áudio, garantir extensão correta baseada no mimetype
                if (mediaType === 'audio') {
                  if (mimetype.includes('ogg')) {
                    fileName = `${message.messages[0].id}.ogg`;
                  } else if (mimetype.includes('mp3')) {
                    fileName = `${message.messages[0].id}.mp3`;
                  } else if (mimetype.includes('m4a')) {
                    fileName = `${message.messages[0].id}.m4a`;
                  }
                }

                const size = result.headers['content-length'] || buffer.data.byteLength;

                const fullName = join(`${this.instance.id}`, key.remoteJid, mediaType, fileName);

                await s3Service.uploadFile(fullName, buffer.data, size, {
                  'Content-Type': mimetype,
                });

                const createdMessage = await this.prismaRepository.message.create({
                  data: messageRaw,
                });

                await this.prismaRepository.media.create({
                  data: {
                    messageId: createdMessage.id,
                    instanceId: this.instanceId,
                    type: mediaType,
                    fileName: fullName,
                    mimetype,
                  },
                });

                const mediaUrl = await s3Service.getObjectUrl(fullName);

                messageRaw.message.mediaUrl = mediaUrl;
                if (this.localWebhook.enabled && this.localWebhook.webhookBase64) {
                  messageRaw.message.base64 = buffer.data.toString('base64');
                }

                // Processar OpenAI speech-to-text para áudio após o mediaUrl estar disponível
                if (this.configService.get<Openai>('OPENAI').ENABLED && mediaType === 'audio') {
                  const openAiDefaultSettings = await this.prismaRepository.openaiSetting.findFirst({
                    where: {
                      instanceId: this.instanceId,
                    },
                    include: {
                      OpenaiCreds: true,
                    },
                  });

                  if (
                    openAiDefaultSettings &&
                    openAiDefaultSettings.openaiCredsId &&
                    openAiDefaultSettings.speechToText
                  ) {
                    try {
                      // speechToText(msg, instance) reads the audio from msg.message.mediaUrl
                      messageRaw.message.speechToText = `[audio] ${await this.openaiService.speechToText(
                        {
                          message: {
                            mediaUrl: messageRaw.message.mediaUrl,
                            ...messageRaw,
                          },
                        },
                        this,
                      )}`;
                    } catch (speechError) {
                      this.logger.error(`Error processing speech-to-text: ${speechError}`);
                    }
                  }
                }
              }
            } catch (error) {
              this.logger.error(['Error on upload file to minio', error?.message, error?.stack]);
            }
          } else {
            if (this.localWebhook.enabled && this.localWebhook.webhookBase64) {
              const buffer = await this.downloadMediaMessage(received?.messages[0]);
              messageRaw.message.base64 = buffer.toString('base64');
            }

            // Processar OpenAI speech-to-text para áudio mesmo sem S3
            if (this.configService.get<Openai>('OPENAI').ENABLED && message.type === 'audio') {
              let openAiBase64 = messageRaw.message.base64;
              if (!openAiBase64) {
                const buffer = await this.downloadMediaMessage(received?.messages[0]);
                openAiBase64 = buffer.toString('base64');
              }

              const openAiDefaultSettings = await this.prismaRepository.openaiSetting.findFirst({
                where: {
                  instanceId: this.instanceId,
                },
                include: {
                  OpenaiCreds: true,
                },
              });

              if (openAiDefaultSettings && openAiDefaultSettings.openaiCredsId && openAiDefaultSettings.speechToText) {
                try {
                  // speechToText(msg, instance) reads the audio from msg.message.base64
                  messageRaw.message.speechToText = `[audio] ${await this.openaiService.speechToText(
                    {
                      message: {
                        base64: openAiBase64,
                        ...messageRaw,
                      },
                    },
                    this,
                  )}`;
                } catch (speechError) {
                  this.logger.error(`Error processing speech-to-text: ${speechError}`);
                }
              }
            }
          }
        } else if (received?.messages[0].interactive) {
          messageRaw = {
            key,
            pushName,
            message: {
              ...this.messageInteractiveJson(received),
            },
            contextInfo: this.messageInteractiveJson(received)?.contextInfo,
            messageType: 'interactiveMessage',
            messageTimestamp: parseInt(received.messages[0].timestamp) as number,
            source: 'unknown',
            instanceId: this.instanceId,
          };
        } else if (received?.messages[0].button) {
          messageRaw = {
            key,
            pushName,
            message: {
              ...this.messageButtonJson(received),
            },
            contextInfo: this.messageButtonJson(received)?.contextInfo,
            messageType: 'buttonMessage',
            messageTimestamp: parseInt(received.messages[0].timestamp) as number,
            source: 'unknown',
            instanceId: this.instanceId,
          };
        } else if (received?.messages[0].reaction) {
          messageRaw = {
            key,
            pushName,
            message: {
              ...this.messageReactionJson(received),
            },
            contextInfo: this.messageReactionJson(received)?.contextInfo,
            messageType: 'reactionMessage',
            messageTimestamp: parseInt(received.messages[0].timestamp) as number,
            source: 'unknown',
            instanceId: this.instanceId,
          };
        } else if (received?.messages[0].contacts) {
          messageRaw = {
            key,
            pushName,
            message: {
              ...this.messageContactsJson(received),
            },
            contextInfo: this.messageContactsJson(received)?.contextInfo,
            messageType: 'contactMessage',
            messageTimestamp: parseInt(received.messages[0].timestamp) as number,
            source: 'unknown',
            instanceId: this.instanceId,
          };
        } else {
          messageRaw = {
            key,
            pushName,
            message: this.messageTextJson(received),
            contextInfo: this.messageTextJson(received)?.contextInfo,
            messageType: this.renderMessageType(received.messages[0].type),
            messageTimestamp: parseInt(received.messages[0].timestamp) as number,
            source: 'unknown',
            instanceId: this.instanceId,
          };
        }

        if (this.localSettings.readMessages) {
          // await this.client.readMessages([received.key]);
        }

        this.logger.log(messageRaw);

        sendTelemetry(`received.message.${messageRaw.messageType ?? 'unknown'}`);

        this.sendDataWebhook(Events.MESSAGES_UPSERT, messageRaw);

        await this.emitToChatbots(messageRaw);

        if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED && this.localChatwoot?.enabled) {
          const chatwootSentMessage = await this.chatwootService.eventWhatsapp(
            Events.MESSAGES_UPSERT,
            { instanceName: this.instance.name, instanceId: this.instanceId },
            messageRaw,
          );

          if (chatwootSentMessage?.id) {
            messageRaw.chatwootMessageId = chatwootSentMessage.id;
            messageRaw.chatwootInboxId = chatwootSentMessage.id;
            messageRaw.chatwootConversationId = chatwootSentMessage.id;
          }
        }

        if (!this.isMediaMessage(message) && message.type !== 'sticker') {
          await this.prismaRepository.message.create({
            data: messageRaw,
          });
        }

        const contact = await this.prismaRepository.contact.findFirst({
          where: { instanceId: this.instanceId, remoteJid: key.remoteJid },
        });

        // `profile.phone` does not exist in the Meta payload: the contact is the chat of the message
        const contactRaw: any = {
          remoteJid: key.remoteJid,
          pushName,
          // profilePicUrl: '',
          instanceId: this.instanceId,
        };

        if (contactRaw.remoteJid === 'status@broadcast') {
          return;
        }

        if (contact) {
          const contactRaw: any = {
            remoteJid: key.remoteJid,
            pushName,
            // profilePicUrl: '',
            instanceId: this.instanceId,
          };

          this.sendDataWebhook(Events.CONTACTS_UPDATE, contactRaw);

          if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED && this.localChatwoot?.enabled) {
            await this.chatwootService.eventWhatsapp(
              Events.CONTACTS_UPDATE,
              { instanceName: this.instance.name, instanceId: this.instanceId },
              contactRaw,
            );
          }

          await this.prismaRepository.contact.updateMany({
            where: { remoteJid: contact.remoteJid, instanceId: this.instanceId },
            data: contactRaw,
          });
          return;
        }

        this.sendDataWebhook(Events.CONTACTS_UPSERT, contactRaw);

        await this.prismaRepository.contact
          .create({ data: contactRaw })
          .catch((error) => this.logger.warn(`Contact not created for ${key.id}: ${error?.message}`));
      }
      if (received.statuses) {
        for await (const item of received.statuses) {
          const key = {
            id: item.id,
            remoteJid: item.recipient_id ? createJid(String(item.recipient_id)) : this.phoneNumber,
            fromMe: this.phoneNumber === received.metadata.phone_number_id,
          };
          // `continue`, not `return`: one status must not drop the rest of the batch (#2700)
          if (settings?.groups_ignore && key.remoteJid.includes('@g.us')) {
            continue;
          }
          if (key.remoteJid !== 'status@broadcast' && !key?.remoteJid?.match(/(:\d+)/)) {
            const findMessage = await this.prismaRepository.message.findFirst({
              where: {
                instanceId: this.instanceId,
                key: {
                  path: ['id'],
                  equals: key.id,
                },
              },
            });

            if (!findMessage) {
              continue;
            }

            if (item.message === null && item.status === undefined) {
              this.sendDataWebhook(Events.MESSAGES_DELETE, key);

              const message: any = {
                messageId: findMessage.id,
                keyId: key.id,
                remoteJid: key.remoteJid,
                fromMe: key.fromMe,
                participant: key?.remoteJid,
                status: 'DELETED',
                instanceId: this.instanceId,
              };

              await this.prismaRepository.messageUpdate.create({
                data: message,
              });

              if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED && this.localChatwoot?.enabled) {
                this.chatwootService.eventWhatsapp(
                  Events.MESSAGES_DELETE,
                  { instanceName: this.instance.name, instanceId: this.instanceId },
                  { key: key },
                );
              }

              continue;
            }

            const message: any = {
              messageId: findMessage.id,
              keyId: key.id,
              remoteJid: key.remoteJid,
              fromMe: key.fromMe,
              participant: key?.remoteJid,
              status: item.status.toUpperCase(),
              instanceId: this.instanceId,
            };

            // Why Meta did not deliver (e.g. 131047 outside the 24 h window, #2486): webhook only, no new column
            const errors = this.summarizeStatusErrors(item.errors);
            const payload = errors ? { ...message, errors } : message;

            this.sendDataWebhook(Events.MESSAGES_UPDATE, payload);

            await this.prismaRepository.messageUpdate.create({
              data: message,
            });

            if (findMessage.webhookUrl) {
              await axios.post(findMessage.webhookUrl, payload);
            }
          }
        }
      }
    } catch (error) {
      this.logger.error(error);
    }
  }

  /**
   * The `errors` of a Meta status (`statuses[].errors`), kept small for the webhook: at most 3 entries with
   * code, title, message and details, each text cut at 300 characters. Undefined when there is none.
   */
  private summarizeStatusErrors(errors: any): { code?: number; title?: string; message?: string; details?: string }[] {
    if (!Array.isArray(errors) || errors.length === 0) return undefined;

    const cut = (value: any) => (typeof value === 'string' && value.length > 0 ? value.slice(0, 300) : undefined);

    return errors.slice(0, 3).map((error: any) => ({
      code: typeof error?.code === 'number' ? error.code : Number(error?.code) || undefined,
      title: cut(error?.title),
      message: cut(error?.message),
      details: cut(error?.error_data?.details),
    }));
  }

  /**
   * Brazilian mobile numbers may come with or without the ninth digit (e.g. the `wa_id` of a received message
   * and the `to` of an app echo) and createJid keeps the ninth digit for some area codes. Returns the other
   * form, so a chatbot session created from either side is found.
   */
  private alternativeBrazilianJid(jid: string): string | undefined {
    const match = /^55(\d{2})(9?)(\d{8})@s\.whatsapp\.net$/.exec(jid ?? '');
    if (!match) return undefined;

    const [, ddd, ninthDigit, local] = match;
    // Landlines (2-5) have no ninth digit form
    if (!/^[6-9]/.test(local)) return undefined;

    return ninthDigit ? `55${ddd}${local}@s.whatsapp.net` : `55${ddd}9${local}@s.whatsapp.net`;
  }

  /** Hands a message to the chatbots, adding the alternative Brazilian form of the chat as `key.remoteJidAlt`. */
  private async emitToChatbots(messageRaw: any) {
    const remoteJidAlt = this.alternativeBrazilianJid(messageRaw.key.remoteJid);

    await chatbotController.emit({
      instance: { instanceName: this.instance.name, instanceId: this.instanceId },
      remoteJid: messageRaw.key.remoteJid,
      msg: remoteJidAlt ? { ...messageRaw, key: { ...messageRaw.key, remoteJidAlt } } : messageRaw,
      pushName: messageRaw.pushName,
    });
  }

  /** Content of an app echo in the same shape used for received messages (media is not downloaded). */
  private messageEchoJson(echo: any): { type: string; messageType: string; content: any } | null {
    // An edit echo carries the new content in `edit.message`
    const source = echo.type === 'edit' && echo.edit?.message ? echo.edit.message : echo;
    const type: string = source?.type;

    if (!type) return null;

    const payload = source[type];
    let content: any;
    let messageType = this.renderMessageType(type);

    switch (type) {
      case 'text':
        content = { conversation: payload?.body ?? '' };
        break;
      case 'audio':
        content = { audioMessage: { ...payload, ptt: payload?.voice || false } };
        break;
      case 'location':
        content = {
          locationMessage: {
            degreesLatitude: payload?.latitude,
            degreesLongitude: payload?.longitude,
            name: payload?.name,
            address: payload?.address,
          },
        };
        break;
      case 'reaction':
        content = { reactionMessage: { key: { id: payload?.message_id }, text: payload?.emoji } };
        messageType = 'reactionMessage';
        break;
      default:
        // image, video, document, sticker and others: keep the Meta object (id, mime_type, caption...)
        content = { [`${type}Message`]: payload || {} };
        break;
    }

    const stanzaId = source.context?.id ?? echo.context?.id;
    if (stanzaId) content = { ...content, contextInfo: { stanzaId } };

    return { type, messageType, content };
  }

  /**
   * Coexistence (WhatsApp Business app + Cloud API on the same number): `smb_message_echoes` reports the messages
   * the owner sent with the app or a companion device. Messages sent through the Cloud API are not echoed. Each
   * echo is handled like a message typed on the phone in Baileys: MESSAGES_UPSERT with `fromMe: true`, Chatwoot
   * as an outgoing message and the chatbots, which pause the session (human takeover).
   */
  private async messageEchoesHandle(received: any) {
    const echoes: any[] = Array.isArray(received?.message_echoes) ? received.message_echoes : [];

    if (echoes.length === 0) {
      this.logger.verbose('Meta webhook smb_message_echoes without message_echoes ignored');
      return;
    }

    for (const echo of echoes) {
      try {
        await this.messageEchoHandle(echo);
      } catch (error) {
        this.logger.error(['Error handling message echo', error?.message, error?.stack]);
      }
    }
  }

  private async messageEchoHandle(echo: any) {
    if (!echo?.id || !echo?.to) {
      this.logger.verbose('Message echo without id or recipient ignored');
      return;
    }

    if (await isBotMessageId(this.instanceId, echo.id)) {
      // Defensive: a send of the API itself echoed back is not a human message
      this.logger.verbose(`Message echo ${echo.id} sent by a chatbot ignored`);
      return;
    }

    const existing = await this.prismaRepository.message.findFirst({
      where: { instanceId: this.instanceId, key: { path: ['id'], equals: echo.id } },
      select: { id: true },
    });

    if (existing) {
      // Meta redelivered the same echo
      this.logger.verbose(`Message echo ${echo.id} already handled`);
      return;
    }

    if (echo.type === 'revoke') {
      // A message deleted in the app: nothing new was written
      this.logger.verbose(`Message echo ${echo.id} (revoke) ignored`);
      return;
    }

    const parsed = this.messageEchoJson(echo);

    if (!parsed) {
      this.logger.verbose(`Message echo ${echo.id} without type ignored`);
      return;
    }

    const timestamp = Number(echo.timestamp);

    const messageRaw: any = {
      // remoteJid is the contact (the echo goes from the business number to the contact)
      key: { id: echo.id, remoteJid: createJid(String(echo.to)), fromMe: true },
      pushName: '',
      message: parsed.content,
      contextInfo: parsed.content?.contextInfo,
      messageType: parsed.messageType,
      messageTimestamp: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Math.round(Date.now() / 1000),
      source: 'unknown',
      instanceId: this.instanceId,
      status: status[2],
    };

    this.logger.log(messageRaw);

    this.sendDataWebhook(Events.MESSAGES_UPSERT, messageRaw);

    await this.emitToChatbots(messageRaw);

    if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED && this.localChatwoot?.enabled) {
      try {
        const chatwootSentMessage = await this.chatwootService.eventWhatsapp(
          Events.MESSAGES_UPSERT,
          { instanceName: this.instance.name, instanceId: this.instanceId },
          messageRaw,
        );

        if (chatwootSentMessage?.id) {
          messageRaw.chatwootMessageId = chatwootSentMessage.id;
          messageRaw.chatwootInboxId = chatwootSentMessage.inbox_id;
          messageRaw.chatwootConversationId = chatwootSentMessage.conversation_id;
        }
      } catch (error) {
        this.logger.error(['Error sending message echo to Chatwoot', error?.message]);
      }
    }

    if (this.configService.get<Database>('DATABASE').SAVE_DATA.NEW_MESSAGE) {
      await this.prismaRepository.message.create({
        data: messageRaw,
      });
    }
  }

  private convertMessageToRaw(message: any, content: any) {
    let convertMessage: any;

    if (message?.conversation) {
      if (content?.context?.message_id) {
        convertMessage = {
          ...message,
          contextInfo: { stanzaId: content.context.message_id },
        };
        return convertMessage;
      }
      convertMessage = message;
      return convertMessage;
    }

    if (message?.mediaType === 'image') {
      if (content?.context?.message_id) {
        convertMessage = {
          imageMessage: message,
          contextInfo: { stanzaId: content.context.message_id },
        };
        return convertMessage;
      }
      return {
        imageMessage: message,
      };
    }

    if (message?.mediaType === 'video') {
      if (content?.context?.message_id) {
        convertMessage = {
          videoMessage: message,
          contextInfo: { stanzaId: content.context.message_id },
        };
        return convertMessage;
      }
      return {
        videoMessage: message,
      };
    }

    if (message?.mediaType === 'audio') {
      if (content?.context?.message_id) {
        convertMessage = {
          audioMessage: message,
          contextInfo: { stanzaId: content.context.message_id },
        };
        return convertMessage;
      }
      return {
        audioMessage: message,
      };
    }

    if (message?.mediaType === 'document') {
      if (content?.context?.message_id) {
        convertMessage = {
          documentMessage: message,
          contextInfo: { stanzaId: content.context.message_id },
        };
        return convertMessage;
      }
      return {
        documentMessage: message,
      };
    }

    return message;
  }

  protected async eventHandler(content: any) {
    try {
      // Registro para depuración
      this.logger.log('Contenido recibido en eventHandler:');
      this.logger.log(JSON.stringify(content, null, 2));

      const database = this.configService.get<Database>('DATABASE');
      const settings = await this.findSettings();

      // Si hay mensajes, verificar primero el tipo
      if (content.messages && content.messages.length > 0) {
        const message = content.messages[0];
        this.logger.log(`Tipo de mensaje recibido: ${message.type}`);

        // Verificamos el tipo de mensaje antes de procesarlo
        if (
          message.type === 'text' ||
          message.type === 'image' ||
          message.type === 'video' ||
          message.type === 'audio' ||
          message.type === 'document' ||
          message.type === 'sticker' ||
          message.type === 'location' ||
          message.type === 'contacts' ||
          message.type === 'interactive' ||
          message.type === 'button' ||
          message.type === 'reaction'
        ) {
          // Procesar el mensaje normalmente
          this.messageHandle(content, database, settings);
        } else {
          this.logger.warn(`Tipo de mensaje no reconocido: ${message.type}`);
        }
      } else if (content.statuses) {
        // Procesar actualizaciones de estado
        this.messageHandle(content, database, settings);
      } else {
        this.logger.warn('No se encontraron mensajes ni estados en el contenido recibido');
      }
    } catch (error) {
      this.logger.error('Error en eventHandler:');
      this.logger.error(error);
    }
  }

  protected async sendMessageWithTyping(
    number: string,
    message: any,
    options?: Options,
    isIntegration = false,
    fromChatbot = false,
  ) {
    try {
      let quoted: any;
      let webhookUrl: any;
      if (options?.quoted) {
        const m = options?.quoted;

        const msg = m?.key;

        if (!msg) {
          throw 'Message not found';
        }

        quoted = msg;
      }
      if (options?.webhookUrl) {
        webhookUrl = options.webhookUrl;
      }

      let content: any;
      const messageSent = await (async () => {
        if (message['reactionMessage']) {
          content = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            type: 'reaction',
            to: number.replace(/\D/g, ''),
            reaction: {
              message_id: message['reactionMessage']['key']['id'],
              emoji: message['reactionMessage']['text'],
            },
          };
          quoted ? (content.context = { message_id: quoted.id }) : content;
          return await this.post(content, 'messages');
        }
        if (message['locationMessage']) {
          content = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            type: 'location',
            to: number.replace(/\D/g, ''),
            location: {
              longitude: message['locationMessage']['degreesLongitude'],
              latitude: message['locationMessage']['degreesLatitude'],
              name: message['locationMessage']['name'],
              address: message['locationMessage']['address'],
            },
          };
          quoted ? (content.context = { message_id: quoted.id }) : content;
          return await this.post(content, 'messages');
        }
        if (message['contacts']) {
          content = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            type: 'contacts',
            to: number.replace(/\D/g, ''),
            contacts: message['contacts'],
          };
          quoted ? (content.context = { message_id: quoted.id }) : content;
          message = message['message'];
          return await this.post(content, 'messages');
        }
        if (message['conversation']) {
          content = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            type: 'text',
            to: number.replace(/\D/g, ''),
            text: {
              body: message['conversation'],
              preview_url: Boolean(options?.linkPreview),
            },
          };
          quoted ? (content.context = { message_id: quoted.id }) : content;
          return await this.post(content, 'messages');
        }
        if (message['media']) {
          const isImage = message['mimetype']?.startsWith('image/');

          content = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            type: message['mediaType'],
            to: number.replace(/\D/g, ''),
            [message['mediaType']]: {
              [message['type']]: message['id'],
              ...(message['mediaType'] !== 'audio' &&
                message['mediaType'] !== 'video' &&
                message['fileName'] &&
                !isImage && { filename: message['fileName'] }),
              ...(message['mediaType'] !== 'audio' && message['caption'] && { caption: message['caption'] }),
              // OGG/Opus audio goes as a voice note (#2719)
              ...(message['mediaType'] === 'audio' &&
                String(message['mimetype'] ?? '').startsWith('audio/ogg') && { voice: true }),
            },
          };
          quoted ? (content.context = { message_id: quoted.id }) : content;
          return await this.post(content, 'messages');
        }
        if (message['audio']) {
          content = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            type: 'audio',
            to: number.replace(/\D/g, ''),
            audio: {
              [message['type']]: message['id'],
            },
          };
          quoted ? (content.context = { message_id: quoted.id }) : content;
          return await this.post(content, 'messages');
        }
        if (message['buttons']) {
          content = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: number.replace(/\D/g, ''),
            type: 'interactive',
            interactive: {
              type: 'button',
              body: {
                text: message['text'] || 'Select',
              },
              // description/footer of /message/sendButtons used to be dropped (#2723)
              ...(message['footer'] && { footer: { text: message['footer'] } }),
              action: {
                buttons: message['buttons'],
              },
            },
          };
          quoted ? (content.context = { message_id: quoted.id }) : content;
          let formattedText = '';
          for (const item of message['buttons']) {
            formattedText += `▶️ ${item.reply?.title}\n`;
          }
          message = { conversation: `${message['text'] || 'Select'}\n` + formattedText };
          return await this.post(content, 'messages');
        }
        if (message['listMessage']) {
          content = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: number.replace(/\D/g, ''),
            type: 'interactive',
            interactive: {
              type: 'list',
              header: {
                type: 'text',
                text: message['listMessage']['title'],
              },
              body: {
                text: message['listMessage']['description'],
              },
              footer: {
                text: message['listMessage']['footerText'],
              },
              action: {
                button: message['listMessage']['buttonText'],
                sections: message['listMessage']['sections'],
              },
            },
          };
          quoted ? (content.context = { message_id: quoted.id }) : content;
          let formattedText = '';
          for (const section of message['listMessage']['sections']) {
            formattedText += `${section?.title}\n`;
            for (const row of section.rows) {
              formattedText += `${row?.title}\n`;
            }
          }
          message = { conversation: `${message['listMessage']['title']}\n` + formattedText };
          return await this.post(content, 'messages');
        }
        if (message['template']) {
          content = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: number.replace(/\D/g, ''),
            type: 'template',
            template: {
              name: message['template']['name'],
              language: {
                code: message['template']['language'] || 'en_US',
              },
              components: message['template']['components'],
            },
          };
          quoted ? (content.context = { message_id: quoted.id }) : content;
          message = { conversation: `▶️${message['template']['name']}◀️` };
          return await this.post(content, 'messages');
        }
      })();

      if (messageSent?.error_data || messageSent.message) {
        this.logger.error(messageSent);
        return messageSent;
      }

      // The Cloud API assigns the id (wamid) on send, so it cannot be registered beforehand like in Baileys.
      // There is no race: the API never echoes its own sends (smb_message_echoes only reports app messages),
      // this only guards paths that may hand a chatbot message back to the chatbots (e.g. the Chatwoot emit).
      if (fromChatbot && messageSent?.messages?.[0]?.id) {
        await registerBotMessageId(this.instanceId, messageSent.messages[0].id);
      }

      const messageRaw: any = {
        key: { fromMe: true, id: messageSent?.messages[0]?.id, remoteJid: createJid(number) },
        message: this.convertMessageToRaw(message, content),
        messageType: this.renderMessageType(content.type),
        messageTimestamp: (messageSent?.messages[0]?.timestamp as number) || Math.round(new Date().getTime() / 1000),
        instanceId: this.instanceId,
        webhookUrl,
        status: status[1],
        source: 'unknown',
      };

      this.logger.log(messageRaw);

      this.sendDataWebhook(Events.SEND_MESSAGE, messageRaw);

      if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED && this.localChatwoot?.enabled && !isIntegration) {
        this.chatwootService.eventWhatsapp(
          Events.SEND_MESSAGE,
          { instanceName: this.instance.name, instanceId: this.instanceId },
          messageRaw,
        );
      }

      if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED && this.localChatwoot?.enabled && isIntegration)
        await chatbotController.emit({
          instance: { instanceName: this.instance.name, instanceId: this.instanceId },
          remoteJid: messageRaw.key.remoteJid,
          msg: messageRaw,
          pushName: messageRaw.pushName,
        });

      await this.prismaRepository.message.create({
        data: messageRaw,
      });

      return messageRaw;
    } catch (error) {
      this.logger.error(error);
      throw new BadRequestException(error.toString());
    }
  }

  // Send Message Controller
  public async textMessage(data: SendTextDto, isIntegration = false, fromChatbot = false) {
    const res = await this.sendMessageWithTyping(
      data.number,
      {
        conversation: data.text,
      },
      {
        delay: data?.delay,
        presence: 'composing',
        quoted: data?.quoted,
        linkPreview: data?.linkPreview,
        mentionsEveryOne: data?.mentionsEveryOne,
        mentioned: data?.mentioned,
      },
      isIntegration,
      fromChatbot,
    );
    return res;
  }

  private async getIdMedia(mediaMessage: any, isFile = false) {
    try {
      const formData = new FormData();

      if (isFile === false) {
        if (isURL(mediaMessage.media)) {
          const response = await axios.get(mediaMessage.media, { responseType: 'arraybuffer' });
          const buffer = Buffer.from(response.data, 'base64');
          formData.append('file', buffer, {
            filename: mediaMessage.fileName || 'media',
            contentType: mediaMessage.mimetype,
          });
        } else {
          const buffer = Buffer.from(mediaMessage.media, 'base64');
          formData.append('file', buffer, {
            filename: mediaMessage.fileName || 'media',
            contentType: mediaMessage.mimetype,
          });
        }
      } else {
        formData.append('file', mediaMessage.media.buffer, {
          filename: mediaMessage.media.originalname,
          contentType: mediaMessage.media.mimetype,
        });
      }

      const mimetype = mediaMessage.mimetype || mediaMessage.media.mimetype;

      formData.append('typeFile', mimetype);
      formData.append('messaging_product', 'whatsapp');

      const token = this.token;

      const headers = { Authorization: `Bearer ${token}` };
      const url = `${this.configService.get<WaBusiness>('WA_BUSINESS').URL}/${
        this.configService.get<WaBusiness>('WA_BUSINESS').VERSION
      }/${this.number}/media`;

      const res = await axios.post(url, formData, { headers });
      return res.data.id;
    } catch (error) {
      this.logger.error(error.response.data);
      throw new InternalServerErrorException(error?.toString() || error);
    }
  }

  protected async prepareMediaMessage(mediaMessage: MediaMessage) {
    try {
      if (mediaMessage.mediatype === 'document' && !mediaMessage.fileName) {
        const regex = new RegExp(/.*\/(.+?)\./);
        const arrayMatch = regex.exec(mediaMessage.media);
        mediaMessage.fileName = arrayMatch[1];
      }

      if (mediaMessage.mediatype === 'image' && !mediaMessage.fileName) {
        mediaMessage.fileName = 'image.png';
      }

      if (mediaMessage.mediatype === 'video' && !mediaMessage.fileName) {
        mediaMessage.fileName = 'video.mp4';
      }

      let mimetype: string | false;

      const prepareMedia: any = {
        caption: mediaMessage?.caption,
        fileName: mediaMessage.fileName,
        mediaType: mediaMessage.mediatype,
        media: mediaMessage.media,
        gifPlayback: false,
      };

      if (isURL(mediaMessage.media)) {
        mimetype = mimeTypes.lookup(mediaMessage.media);
        prepareMedia.id = mediaMessage.media;
        prepareMedia.type = 'link';
      } else {
        mimetype = mimeTypes.lookup(mediaMessage.fileName);
        const id = await this.getIdMedia(prepareMedia);
        prepareMedia.id = id;
        prepareMedia.type = 'id';
      }

      prepareMedia.mimetype = mimetype;

      return prepareMedia;
    } catch (error) {
      this.logger.error(error);
      throw new InternalServerErrorException(error?.toString() || error);
    }
  }

  public async mediaMessage(data: SendMediaDto, file?: any, isIntegration = false, fromChatbot = false) {
    const mediaData: SendMediaDto = { ...data };

    if (file) mediaData.media = file.buffer.toString('base64');

    const message = await this.prepareMediaMessage(mediaData);

    const mediaSent = await this.sendMessageWithTyping(
      data.number,
      { ...message },
      {
        delay: data?.delay,
        presence: 'composing',
        quoted: data?.quoted,
        linkPreview: data?.linkPreview,
        mentionsEveryOne: data?.mentionsEveryOne,
        mentioned: data?.mentioned,
      },
      isIntegration,
      fromChatbot,
    );

    return mediaSent;
  }

  public async processAudio(audio: string, number: string, file: any) {
    number = number.replace(/\D/g, '');
    const hash = `${number}-${new Date().getTime()}`;

    const audioConverterConfig = this.configService.get<AudioConverter>('AUDIO_CONVERTER');
    if (audioConverterConfig.API_URL) {
      this.logger.verbose('Using audio converter API');
      const formData = new FormData();

      if (file) {
        formData.append('file', file.buffer, {
          filename: file.originalname,
          contentType: file.mimetype,
        });
      } else if (isURL(audio)) {
        formData.append('url', audio);
      } else {
        formData.append('base64', audio);
      }

      formData.append('format', 'mp3');

      const response = await axios.post(audioConverterConfig.API_URL, formData, {
        headers: {
          ...formData.getHeaders(),
          apikey: audioConverterConfig.API_KEY,
        },
      });

      const audioConverter = response?.data?.audio || response?.data?.url;

      if (!audioConverter) {
        throw new InternalServerErrorException('Failed to convert audio');
      }

      const prepareMedia: any = {
        fileName: `${hash}.mp3`,
        mediaType: 'audio',
        media: audioConverter,
        mimetype: 'audio/mpeg',
      };

      const id = await this.getIdMedia(prepareMedia);
      prepareMedia.id = id;
      prepareMedia.type = 'id';

      this.logger.verbose('Audio converted');
      return prepareMedia;
    } else {
      let mimetype: string | false;

      const prepareMedia: any = {
        fileName: `${hash}.mp3`,
        mediaType: 'audio',
        media: audio,
      };

      if (isURL(audio)) {
        mimetype = mimeTypes.lookup(audio);
        prepareMedia.id = audio;
        prepareMedia.type = 'link';
      } else if (audio && !file) {
        // The real format, not always ".mp3": Meta derives the type from the name (#2719)
        const format = detectAudioFormatFromBase64(audio) ?? { mimetype: 'audio/mpeg', extension: 'mp3' };
        prepareMedia.fileName = `${hash}.${format.extension}`;
        prepareMedia.mimetype = format.mimetype;
        mimetype = format.mimetype;
        const id = await this.getIdMedia(prepareMedia);
        prepareMedia.id = id;
        prepareMedia.type = 'id';
      } else if (file) {
        prepareMedia.media = file;
        const id = await this.getIdMedia(prepareMedia, true);
        prepareMedia.id = id;
        prepareMedia.type = 'id';
        mimetype = file.mimetype || detectAudioFormat(file.buffer)?.mimetype;
      }

      prepareMedia.mimetype = mimetype;

      return prepareMedia;
    }
  }

  public async audioWhatsapp(data: SendAudioDto, file?: any, isIntegration = false, fromChatbot = false) {
    const message = await this.processAudio(data.audio, data.number, file);

    const audioSent = await this.sendMessageWithTyping(
      data.number,
      { ...message },
      {
        delay: data?.delay,
        presence: 'composing',
        quoted: data?.quoted,
        linkPreview: data?.linkPreview,
        mentionsEveryOne: data?.mentionsEveryOne,
        mentioned: data?.mentioned,
      },
      isIntegration,
      fromChatbot,
    );

    return audioSent;
  }

  public async buttonMessage(data: SendButtonsDto, isIntegration = false, fromChatbot = false) {
    const embeddedMedia: any = {};

    const btnItems = {
      text: data.buttons.map((btn) => btn.displayText),
      ids: data.buttons.map((btn) => btn.id),
    };

    if (!arrayUnique(btnItems.text) || !arrayUnique(btnItems.ids)) {
      throw new BadRequestException('Button texts cannot be repeated', 'Button IDs cannot be repeated.');
    }

    return await this.sendMessageWithTyping(
      data.number,
      {
        text: !embeddedMedia?.mediaKey ? [data.title, data.description].filter(Boolean).join('\n\n') : undefined,
        footer: data?.footer || undefined,
        buttons: data.buttons.map((button) => {
          return {
            type: 'reply',
            reply: {
              title: button.displayText,
              id: button.id,
            },
          };
        }),
        [embeddedMedia?.mediaKey]: embeddedMedia?.message,
      },
      {
        delay: data?.delay,
        presence: 'composing',
        quoted: data?.quoted,
        linkPreview: data?.linkPreview,
        mentionsEveryOne: data?.mentionsEveryOne,
        mentioned: data?.mentioned,
      },
      isIntegration,
      fromChatbot,
    );
  }

  public async locationMessage(data: SendLocationDto) {
    return await this.sendMessageWithTyping(
      data.number,
      {
        locationMessage: {
          degreesLatitude: data.latitude,
          degreesLongitude: data.longitude,
          name: data?.name,
          address: data?.address,
        },
      },
      {
        delay: data?.delay,
        presence: 'composing',
        quoted: data?.quoted,
        linkPreview: data?.linkPreview,
        mentionsEveryOne: data?.mentionsEveryOne,
        mentioned: data?.mentioned,
      },
    );
  }

  public async listMessage(data: SendListDto, isIntegration = false, fromChatbot = false) {
    const sectionsItems = {
      title: data.sections.map((list) => list.title),
    };

    if (!arrayUnique(sectionsItems.title)) {
      throw new BadRequestException('Section tiles cannot be repeated');
    }

    const sendData: any = {
      listMessage: {
        title: data.title,
        description: data.description,
        footerText: data?.footerText,
        buttonText: data?.buttonText,
        sections: data.sections.map((section) => {
          return {
            title: section.title,
            rows: section.rows.map((row) => {
              return {
                title: row.title,
                description: row.description.substring(0, 72),
                id: row.rowId,
              };
            }),
          };
        }),
      },
    };

    return await this.sendMessageWithTyping(
      data.number,
      sendData,
      {
        delay: data?.delay,
        presence: 'composing',
        quoted: data?.quoted,
        linkPreview: data?.linkPreview,
        mentionsEveryOne: data?.mentionsEveryOne,
        mentioned: data?.mentioned,
      },
      isIntegration,
      fromChatbot,
    );
  }

  public async templateMessage(data: SendTemplateDto, isIntegration = false) {
    const res = await this.sendMessageWithTyping(
      data.number,
      {
        template: {
          name: data.name,
          language: data.language,
          components: data.components,
        },
      },
      {
        delay: data?.delay,
        presence: 'composing',
        quoted: data?.quoted,
        linkPreview: data?.linkPreview,
        mentionsEveryOne: data?.mentionsEveryOne,
        mentioned: data?.mentioned,
        webhookUrl: data?.webhookUrl,
      },
      isIntegration,
    );
    return res;
  }

  public async contactMessage(data: SendContactDto) {
    const message: any = {};

    const vcard = (contact: ContactMessage) => {
      let result = 'BEGIN:VCARD\n' + 'VERSION:3.0\n' + `N:${contact.fullName}\n` + `FN:${contact.fullName}\n`;

      if (contact.organization) {
        result += `ORG:${contact.organization};\n`;
      }

      if (contact.email) {
        result += `EMAIL:${contact.email}\n`;
      }

      if (contact.url) {
        result += `URL:${contact.url}\n`;
      }

      if (!contact.wuid) {
        contact.wuid = createJid(contact.phoneNumber);
      }

      result += `item1.TEL;waid=${contact.wuid}:${contact.phoneNumber}\n` + 'item1.X-ABLabel:Celular\n' + 'END:VCARD';

      return result;
    };

    if (data.contact.length === 1) {
      message.contact = {
        displayName: data.contact[0].fullName,
        vcard: vcard(data.contact[0]),
      };
    } else {
      message.contactsArrayMessage = {
        displayName: `${data.contact.length} contacts`,
        contacts: data.contact.map((contact) => {
          return {
            displayName: contact.fullName,
            vcard: vcard(contact),
          };
        }),
      };
    }
    return await this.sendMessageWithTyping(
      data.number,
      {
        contacts: data.contact.map((contact) => {
          return {
            name: { formatted_name: contact.fullName, first_name: contact.fullName },
            phones: [{ phone: contact.phoneNumber }],
            urls: [{ url: contact.url }],
            emails: [{ email: contact.email }],
            org: { company: contact.organization },
          };
        }),
        message,
      },
      {
        delay: data?.delay,
        presence: 'composing',
        quoted: data?.quoted,
        linkPreview: data?.linkPreview,
        mentionsEveryOne: data?.mentionsEveryOne,
        mentioned: data?.mentioned,
      },
    );
  }

  public async reactionMessage(data: SendReactionDto) {
    return await this.sendMessageWithTyping(data.key.remoteJid, {
      reactionMessage: {
        key: data.key,
        text: data.reaction,
      },
    });
  }

  public async getBase64FromMediaMessage(data: any) {
    try {
      const msg = data.message;
      const messageType = msg.messageType.includes('Message') ? msg.messageType : msg.messageType + 'Message';
      const mediaMessage = msg.message[messageType];

      if (!msg.message?.base64) {
        const buffer = await this.downloadMediaMessage({ type: messageType, ...msg.message });
        msg.message.base64 = buffer.toString('base64');
      }

      return {
        mediaType: msg.messageType,
        fileName: mediaMessage?.fileName || mediaMessage?.filename,
        caption: mediaMessage?.caption,
        size: {
          fileLength: mediaMessage?.fileLength,
          height: mediaMessage?.fileLength,
          width: mediaMessage?.width,
        },
        mimetype: mediaMessage?.mime_type,
        base64: msg.message.base64,
      };
    } catch (error) {
      this.logger.error(error);
      throw new BadRequestException(error.toString());
    }
  }

  public async deleteMessage() {
    throw new BadRequestException('Method not available on WhatsApp Business API');
  }

  // methods not available on WhatsApp Business API
  public async mediaSticker() {
    throw new BadRequestException('Method not available on WhatsApp Business API');
  }
  public async pollMessage() {
    throw new BadRequestException('Method not available on WhatsApp Business API');
  }
  public async statusMessage() {
    throw new BadRequestException('Method not available on WhatsApp Business API');
  }
  public async reloadConnection() {
    throw new BadRequestException('Method not available on WhatsApp Business API');
  }
  public async whatsappNumber() {
    throw new BadRequestException('Method not available on WhatsApp Business API');
  }
  public async markMessageAsRead() {
    throw new BadRequestException('Method not available on WhatsApp Business API');
  }
  public async archiveChat() {
    throw new BadRequestException('Method not available on WhatsApp Business API');
  }
  public async markChatUnread() {
    throw new BadRequestException('Method not available on WhatsApp Business API');
  }
  public async fetchProfile() {
    throw new BadRequestException('Method not available on WhatsApp Business API');
  }
  public async offerCall() {
    throw new BadRequestException('Method not available on WhatsApp Business API');
  }
  public async sendPresence() {
    throw new BadRequestException('Method not available on WhatsApp Business API');
  }
  public async setPresence() {
    throw new BadRequestException('Method not available on WhatsApp Business API');
  }
  public async fetchPrivacySettings() {
    throw new BadRequestException('Method not available on WhatsApp Business API');
  }
  public async updatePrivacySettings() {
    throw new BadRequestException('Method not available on WhatsApp Business API');
  }
  public async fetchBusinessProfile() {
    throw new BadRequestException('Method not available on WhatsApp Business API');
  }
  public async updateProfileName() {
    throw new BadRequestException('Method not available on WhatsApp Business API');
  }
  public async updateProfileStatus() {
    throw new BadRequestException('Method not available on WhatsApp Business API');
  }
  public async updateProfilePicture() {
    throw new BadRequestException('Method not available on WhatsApp Business API');
  }
  public async removeProfilePicture() {
    throw new BadRequestException('Method not available on WhatsApp Business API');
  }
  public async blockUser() {
    throw new BadRequestException('Method not available on WhatsApp Business API');
  }
  public async updateMessage() {
    throw new BadRequestException('Method not available on WhatsApp Business API');
  }
  public async createGroup() {
    throw new BadRequestException('Method not available on WhatsApp Business API');
  }
  public async updateGroupPicture() {
    throw new BadRequestException('Method not available on WhatsApp Business API');
  }
  public async updateGroupSubject() {
    throw new BadRequestException('Method not available on WhatsApp Business API');
  }
  public async updateGroupDescription() {
    throw new BadRequestException('Method not available on WhatsApp Business API');
  }
  public async findGroup() {
    throw new BadRequestException('Method not available on WhatsApp Business API');
  }
  public async fetchAllGroups() {
    throw new BadRequestException('Method not available on WhatsApp Business API');
  }
  public async inviteCode() {
    throw new BadRequestException('Method not available on WhatsApp Business API');
  }
  public async inviteInfo() {
    throw new BadRequestException('Method not available on WhatsApp Business API');
  }
  public async sendInvite() {
    throw new BadRequestException('Method not available on WhatsApp Business API');
  }
  public async acceptInviteCode() {
    throw new BadRequestException('Method not available on WhatsApp Business API');
  }
  public async revokeInviteCode() {
    throw new BadRequestException('Method not available on WhatsApp Business API');
  }
  public async findParticipants() {
    throw new BadRequestException('Method not available on WhatsApp Business API');
  }
  public async updateGParticipant() {
    throw new BadRequestException('Method not available on WhatsApp Business API');
  }
  public async updateGSetting() {
    throw new BadRequestException('Method not available on WhatsApp Business API');
  }
  public async toggleEphemeral() {
    throw new BadRequestException('Method not available on WhatsApp Business API');
  }
  public async leaveGroup() {
    throw new BadRequestException('Method not available on WhatsApp Business API');
  }
  public async fetchLabels() {
    throw new BadRequestException('Method not available on WhatsApp Business API');
  }
  public async handleLabel() {
    throw new BadRequestException('Method not available on WhatsApp Business API');
  }
  public async receiveMobileCode() {
    throw new BadRequestException('Method not available on WhatsApp Business API');
  }
  public async fakeCall() {
    throw new BadRequestException('Method not available on WhatsApp Business API');
  }
}
