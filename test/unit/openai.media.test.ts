import '../helpers/setup';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { OpenaiController } from '@api/integrations/chatbot/openai/controllers/openai.controller';
import { OpenaiService } from '@api/integrations/chatbot/openai/services/openai.service';
import { configService } from '@config/env.config';
import { getConversationMessage } from '@utils/getConversationMessage';
import {
  countPdfPages,
  describeDocument,
  describeOpenaiMessage,
  getDocumentInfo,
  OPENAI_MEDIA_DEFAULTS,
  resolveOpenaiMediaOptions,
} from '@utils/openaiMedia';

import {
  apiError,
  createFakeOpenai,
  createFakeWaInstance,
  imageMsg,
  nextId,
  texts,
  useFakeOpenai,
} from '../helpers/fakes';
import { objectStreamPdf, plainPdf } from '../helpers/pdf';
import { createPrismaMock } from '../helpers/prisma-mock';

const REMOTE_JID = '5511912345678@s.whatsapp.net';
const UNKNOWN = 'Desculpe, tive um problema. Um atendente vai falar com você.';
const AUDIO = Buffer.from('fake-ogg-bytes').toString('base64');

/** One service wired to fakes, with an opened session for REMOTE_JID; transcriptions are recorded, not sent. */
function setup(
  options: { bot?: Record<string, any>; settings?: Record<string, any>; session?: Record<string, any> } = {},
) {
  const instanceId = nextId('inst');
  const waInstance = createFakeWaInstance('media', instanceId);
  const session = {
    id: nextId('sess'),
    remoteJid: REMOTE_JID,
    sessionId: REMOTE_JID,
    instanceId,
    botId: 'bot-1',
    type: 'openai',
    status: 'opened',
    awaitUser: false,
    parameters: null,
    context: null,
    ...options.session,
  };
  const prisma = createPrismaMock([session]);
  const service: any = new OpenaiService({ waInstances: { media: waInstance } } as any, prisma, configService);
  const openai = createFakeOpenai();
  useFakeOpenai(service, openai);

  // /v1/audio/transcriptions: answers queued in `transcriptions` (string, or an error to throw)
  const transcriptionCalls: { model: string; apiKey: string; bytes: number }[] = [];
  const transcriptions: any[] = [];
  service.requestTranscription = async (audio: Buffer, model: string, _lang: string, apiKey: string) => {
    transcriptionCalls.push({ model, apiKey, bytes: audio.length });
    const answer = transcriptions.shift() ?? 'transcrição do áudio';
    if (answer instanceof Error || typeof answer === 'object') throw answer;
    return answer;
  };

  const bot: any = {
    id: 'bot-1',
    botType: 'chatCompletion',
    openaiCredsId: 'creds-1',
    model: `gpt-6-luna-${nextId()}`,
    maxTokens: 300,
    tokenParam: 'max_completion_tokens',
    systemMessages: ['Você é a assistente do escritório.'],
    assistantMessages: [],
    userMessages: [],
    ...options.bot,
  };
  const settings: any = {
    unknownMessage: UNKNOWN,
    keywordFinish: '#sair',
    splitMessages: false,
    timePerChar: 0,
    delayMessage: 0,
    ...options.settings,
  };

  const ask = (content: string, msg?: any) =>
    service.process(
      waInstance,
      REMOTE_JID,
      bot,
      structuredClone(prisma.sessions.get(session.id) ?? null),
      settings,
      content,
      'Cliente',
      msg,
    );

  const lastUserContent = () => openai.requests.at(-1).messages.at(-1).content;
  const savedHistory = () => JSON.parse(prisma.sessions.get(session.id).context).history;

  return {
    service,
    prisma,
    waInstance,
    openai,
    bot,
    settings,
    session,
    ask,
    transcriptionCalls,
    transcriptions,
    lastUserContent,
    savedHistory,
  };
}

const audioMsg = (options: { seconds?: number; id?: string } = {}) => ({
  key: { id: options.id ?? nextId('AUD'), remoteJid: REMOTE_JID, fromMe: false },
  message: {
    audioMessage: {
      mimetype: 'audio/ogg; codecs=opus',
      ptt: true,
      ...(options.seconds ? { seconds: options.seconds } : {}),
    },
    base64: AUDIO,
  },
  messageType: 'audioMessage',
});

const documentMsg = (options: {
  fileName?: string;
  mimetype?: string;
  caption?: string;
  fileLength?: number;
  base64?: string;
  withCaptionWrapper?: boolean;
}) => {
  const document = {
    ...(options.fileName ? { fileName: options.fileName } : {}),
    mimetype: options.mimetype ?? 'application/pdf',
    ...(options.caption ? { caption: options.caption } : {}),
    ...(options.fileLength !== undefined ? { fileLength: options.fileLength } : {}),
  };
  const msg: any = {
    key: { id: nextId('DOC'), remoteJid: REMOTE_JID, fromMe: false },
    message: options.withCaptionWrapper
      ? { documentWithCaptionMessage: { message: { documentMessage: document } } }
      : { documentMessage: document },
    messageType: options.withCaptionWrapper ? 'documentWithCaptionMessage' : 'documentMessage',
  };
  if (options.base64) msg.message.base64 = options.base64;
  return msg;
};

/** Error of /v1/audio/transcriptions as axios throws it. */
const axiosError = (status: number, error: Record<string, any>) =>
  Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data: { error } } });

describe('openaiMedia: option resolution (bot > settings > default)', () => {
  test('defaults keep the previous behaviour (audio and images on, 10 messages of history)', () => {
    assert.deepEqual(resolveOpenaiMediaOptions(null, null), {
      transcribeAudio: true,
      transcriptionModel: 'gpt-transcribe',
      maxAudioSeconds: 300,
      readImages: true,
      readDocuments: true,
      maxDocumentMB: 10,
      historyMessages: 10,
    });
    assert.deepEqual(resolveOpenaiMediaOptions({}, {}), { ...OPENAI_MEDIA_DEFAULTS });
  });

  test('bot value wins, null/undefined on the bot inherits the settings, false and 0 are values', () => {
    const settings = {
      transcribeAudio: true,
      transcriptionModel: 'whisper-1',
      maxAudioSeconds: 120,
      readImages: true,
      readDocuments: true,
      maxDocumentMB: 5,
      historyMessages: 30,
    };
    assert.deepEqual(
      resolveOpenaiMediaOptions(
        {
          transcribeAudio: false,
          transcriptionModel: null,
          maxAudioSeconds: 0,
          readImages: false,
          readDocuments: undefined,
          maxDocumentMB: null,
          historyMessages: 40,
        },
        settings,
      ),
      {
        transcribeAudio: false,
        transcriptionModel: 'whisper-1',
        maxAudioSeconds: 0,
        readImages: false,
        readDocuments: true,
        maxDocumentMB: 5,
        historyMessages: 40,
      },
    );
  });

  test('invalid values are ignored and limits are clamped (history 2..100, documents 1..32 MB)', () => {
    const options = resolveOpenaiMediaOptions(
      { transcriptionModel: '  ', historyMessages: 1, maxDocumentMB: 500, transcribeAudio: 'yes' },
      { historyMessages: 7, transcriptionModel: ' gpt-transcribe ' },
    );
    assert.equal(options.historyMessages, 2);
    assert.equal(options.maxDocumentMB, 32);
    assert.equal(options.transcriptionModel, 'gpt-transcribe');
    assert.equal(options.transcribeAudio, true);
    assert.equal(resolveOpenaiMediaOptions({ historyMessages: 500 }, null).historyMessages, 100);
  });
});

describe('openaiMedia: messages the model cannot read become clear sentences', () => {
  const msgWith = (message: any, extra: any = {}) => ({ key: { id: 'X' }, message, ...extra });

  test('video (with caption, video note, view once)', () => {
    assert.equal(
      describeOpenaiMessage(msgWith({ videoMessage: { caption: 'veja o acidente' } })),
      '[o contato enviou um vídeo]\nveja o acidente',
    );
    assert.equal(describeOpenaiMessage(msgWith({ ptvMessage: {} })), '[o contato enviou um vídeo]');
    assert.equal(
      describeOpenaiMessage(msgWith({ viewOnceMessageV2: { message: { videoMessage: {} } } })),
      '[o contato enviou um vídeo]',
    );
  });

  test('sticker', () => {
    assert.equal(describeOpenaiMessage(msgWith({ stickerMessage: { mimetype: 'image/webp' } })), '[figurinha]');
  });

  test('location with latitude and longitude, plus name and address when present', () => {
    assert.equal(
      describeOpenaiMessage(msgWith({ locationMessage: { degreesLatitude: -23.5613, degreesLongitude: -46.6565 } })),
      '[localização: -23.5613, -46.6565]',
    );
    assert.equal(
      describeOpenaiMessage(
        msgWith({
          locationMessage: {
            degreesLatitude: -23.56130001,
            degreesLongitude: -46.6565,
            name: 'Fórum João Mendes',
            address: 'Praça João Mendes, s/n - Centro, São Paulo',
          },
        }),
      ),
      '[localização: -23.5613, -46.6565 - Fórum João Mendes - Praça João Mendes, s/n - Centro, São Paulo]',
    );
  });

  test('shared contact (Baileys displayName, vCard FN, several contacts)', () => {
    assert.equal(
      describeOpenaiMessage(msgWith({ contactMessage: { displayName: 'Maria Souza', vcard: 'BEGIN:VCARD' } })),
      '[contato compartilhado: Maria Souza]',
    );
    assert.equal(
      describeOpenaiMessage(
        msgWith({ contactMessage: { vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN:João Lima\nEND:VCARD' } }),
      ),
      '[contato compartilhado: João Lima]',
    );
    assert.equal(
      describeOpenaiMessage(
        msgWith({ contactsArrayMessage: { contacts: [{ displayName: 'Ana' }, { displayName: 'Bruno' }] } }),
      ),
      '[contatos compartilhados: Ana, Bruno]',
    );
  });

  test('text, audio, image and documents keep the regular content', () => {
    for (const message of [
      { conversation: 'oi' },
      { audioMessage: {} },
      { imageMessage: {} },
      { documentMessage: { fileName: 'a.pdf' } },
    ]) {
      assert.equal(describeOpenaiMessage(msgWith(message)), undefined, JSON.stringify(message));
    }
  });

  test('the OpenAI controller uses them; getConversationMessage (every other bot) is unchanged', () => {
    const controller: any = new OpenaiController({} as any, {} as any, {} as any);
    const sticker = msgWith({ stickerMessage: {} });
    const location = msgWith({ locationMessage: { degreesLatitude: -23.5, degreesLongitude: -46.6 } });
    const contact = msgWith({ contactMessage: { displayName: 'Maria' } });
    const video = msgWith({ videoMessage: { caption: 'oi' } });

    assert.equal(controller.getConversationContent(sticker), '[figurinha]');
    assert.equal(controller.getConversationContent(location), '[localização: -23.5, -46.6]');
    assert.equal(controller.getConversationContent(contact), '[contato compartilhado: Maria]');
    assert.equal(controller.getConversationContent(video), '[o contato enviou um vídeo]\noi');
    assert.equal(controller.getConversationContent(msgWith({ conversation: 'bom dia' })), 'bom dia');

    // Before: the sticker reached the model as the literal text "unknown"
    assert.equal(getConversationMessage(sticker), 'unknown');
    assert.equal(getConversationMessage(location), '-23.5');
    assert.equal(getConversationMessage(contact), 'Maria');
    assert.equal(getConversationMessage(video), 'videoMessage|X|oi');
  });
});

describe('openaiMedia: documents and PDF pages', () => {
  test('document info from Baileys and Cloud API fields; description with name and type', () => {
    const baileys = getDocumentInfo(
      documentMsg({
        fileName: 'Petição inicial.docx',
        mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        caption: 'segue',
        fileLength: 2048,
      }),
    );
    assert.equal(baileys.isPdf, false);
    assert.equal(describeDocument(baileys), '[o contato enviou o documento Petição inicial.docx (DOCX)]\nsegue');

    const cloud = getDocumentInfo({
      message: { documentMessage: { filename: 'RG.pdf', mime_type: 'application/pdf', id: '123' } },
    });
    assert.equal(cloud.isPdf, true);
    assert.equal(cloud.fileName, 'RG.pdf');
    assert.equal(describeDocument(cloud), '[o contato enviou o documento RG.pdf (PDF)]');

    assert.equal(describeDocument(getDocumentInfo(null, 'legenda')), '[o contato enviou um documento]\nlegenda');
    assert.equal(
      describeDocument(getDocumentInfo({ message: { documentMessage: { mimetype: 'text/csv' } } })),
      '[o contato enviou um documento (CSV)]',
    );
  });

  test('countPdfPages: page tree /Count, page objects, compressed object streams, not a PDF', () => {
    assert.equal(countPdfPages(plainPdf(3)), 3);
    assert.equal(countPdfPages(plainPdf(4, { withCount: false })), 4);
    assert.equal(countPdfPages(objectStreamPdf(25)), 25);
    assert.equal(countPdfPages(objectStreamPdf(7, { withCount: false })), 7);
    assert.equal(countPdfPages(Buffer.from('PK\u0003\u0004 not a pdf')), null);
    assert.equal(countPdfPages(Buffer.from('%PDF-1.7\n(no page tree)')), null);
  });
});

describe('OpenaiService: audio', { concurrency: true }, () => {
  test('transcribed with the configured model (default gpt-transcribe) and the bot credentials', async () => {
    const t = setup();
    const msg = audioMsg({ seconds: 20 });
    await t.ask(`audioMessage|${msg.key.id}`, msg);

    assert.deepEqual(
      t.transcriptionCalls.map((call) => call.model),
      ['gpt-transcribe'],
    );
    assert.equal(t.transcriptionCalls[0].apiKey, 'sk-test-not-real');
    assert.deepEqual(t.lastUserContent(), [{ type: 'text', text: 'transcrição do áudio' }]);
  });

  test('bot transcriptionModel wins over settings', async () => {
    const t = setup({ bot: { transcriptionModel: 'whisper-1' }, settings: { transcriptionModel: 'gpt-transcribe' } });
    const msg = audioMsg();
    await t.ask(`audioMessage|${msg.key.id}`, msg);
    assert.deepEqual(
      t.transcriptionCalls.map((call) => call.model),
      ['whisper-1'],
    );
  });

  for (const [label, error] of [
    ['400 model_not_found', axiosError(400, { code: 'model_not_found', message: "The model 'x' does not exist" })],
    ['404', axiosError(404, { message: 'The model gpt-transcribe does not exist or you do not have access to it.' })],
    ['400 param model', axiosError(400, { param: 'model', message: 'Invalid model' })],
  ] as const) {
    test(`model rejected (${label}): retries once with whisper-1`, async () => {
      const t = setup();
      t.transcriptions.push(error, 'texto pelo whisper');
      const msg = audioMsg();
      await t.ask(`audioMessage|${msg.key.id}`, msg);

      assert.deepEqual(
        t.transcriptionCalls.map((call) => call.model),
        ['gpt-transcribe', 'whisper-1'],
      );
      assert.deepEqual(t.lastUserContent(), [{ type: 'text', text: 'texto pelo whisper' }]);
    });
  }

  test('other transcription errors are not retried: unknownMessage, no completion', async () => {
    const t = setup();
    t.transcriptions.push(axiosError(500, { message: 'server error' }));
    const msg = audioMsg();
    await t.ask(`audioMessage|${msg.key.id}`, msg);

    assert.equal(t.transcriptionCalls.length, 1);
    assert.equal(t.openai.requests.length, 0);
    assert.deepEqual(texts(t.waInstance), [UNKNOWN]);
  });

  test('whisper-1 rejected too: one retry only, then unknownMessage', async () => {
    const t = setup();
    const rejected = axiosError(404, { code: 'model_not_found', message: 'model' });
    t.transcriptions.push(rejected, rejected, 'nunca');
    const msg = audioMsg();
    await t.ask(`audioMessage|${msg.key.id}`, msg);
    assert.equal(t.transcriptionCalls.length, 2);
    assert.deepEqual(texts(t.waInstance), [UNKNOWN]);
  });

  test('transcribeAudio off (settings or bot): not transcribed, the model is told an audio arrived', async () => {
    for (const options of [{ settings: { transcribeAudio: false } }, { bot: { transcribeAudio: false } }]) {
      const t = setup(options);
      const msg = audioMsg();
      await t.ask(`audioMessage|${msg.key.id}`, msg);
      assert.equal(t.transcriptionCalls.length, 0);
      assert.deepEqual(t.lastUserContent(), [{ type: 'text', text: '[o contato enviou um áudio]' }]);
    }
  });

  test('bot transcribeAudio true overrides settings false', async () => {
    const t = setup({ bot: { transcribeAudio: true }, settings: { transcribeAudio: false } });
    const msg = audioMsg();
    await t.ask(`audioMessage|${msg.key.id}`, msg);
    assert.equal(t.transcriptionCalls.length, 1);
  });

  test('audio longer than maxAudioSeconds (WhatsApp seconds) is not transcribed', async () => {
    const t = setup();
    const msg = audioMsg({ seconds: 301 });
    await t.ask(`audioMessage|${msg.key.id}`, msg);
    assert.equal(t.transcriptionCalls.length, 0);
    assert.deepEqual(t.lastUserContent(), [
      { type: 'text', text: '[o contato enviou um áudio de 6 min; a equipe vai ouvir]' },
    ]);

    const limited = setup({ settings: { maxAudioSeconds: 60 } });
    const short = audioMsg({ seconds: 60 });
    await limited.ask(`audioMessage|${short.key.id}`, short);
    assert.equal(limited.transcriptionCalls.length, 1, 'exactly the limit is transcribed');
  });

  test('maxAudioSeconds 0 = no limit; unknown duration (Cloud API) is transcribed', async () => {
    const t = setup({ bot: { maxAudioSeconds: 0 } });
    const msg = audioMsg({ seconds: 3600 });
    await t.ask(`audioMessage|${msg.key.id}`, msg);
    assert.equal(t.transcriptionCalls.length, 1);

    const cloud = setup();
    const noSeconds = audioMsg();
    await cloud.ask(`audioMessage|${noSeconds.key.id}`, noSeconds);
    assert.equal(cloud.transcriptionCalls.length, 1);
  });

  test('debounced burst: an earlier audio is described, only the current message is downloaded', async () => {
    const t = setup();
    const msg = audioMsg();
    await t.ask(`audioMessage|OLDER\noi\naudioMessage|${msg.key.id}`, msg);
    assert.equal(t.transcriptionCalls.length, 1);
    assert.deepEqual(t.lastUserContent(), [
      { type: 'text', text: '[o contato enviou um áudio]\noi\ntranscrição do áudio' },
    ]);
  });
});

describe('OpenaiService: images and other media', { concurrency: true }, () => {
  const PNG = Buffer.from('fake-png').toString('base64');

  test('readImages off: the image is described with its caption, never downloaded', async () => {
    const t = setup({ settings: { readImages: false } });
    let downloads = 0;
    t.waInstance.getBase64FromMediaMessage = async () => {
      downloads++;
      return { base64: PNG, mimetype: 'image/png' };
    };
    const msg = imageMsg(REMOTE_JID, { caption: 'meu RG' });
    await t.ask(`imageMessage|${msg.key.id}|meu RG`, msg);

    assert.equal(downloads, 0);
    assert.deepEqual(t.lastUserContent(), [{ type: 'text', text: '[o contato enviou uma imagem]\nmeu RG' }]);
  });

  test('bot readImages true overrides settings false (image sent as data URL)', async () => {
    const t = setup({ bot: { readImages: true }, settings: { readImages: false } });
    const msg = imageMsg(REMOTE_JID, { base64: PNG, mimetype: 'image/png' });
    await t.ask(`imageMessage|${msg.key.id}`, msg);
    assert.deepEqual(t.lastUserContent(), [{ type: 'image_url', image_url: { url: `data:image/png;base64,${PNG}` } }]);
  });

  test('video content reaching the service is described (caption kept)', async () => {
    const t = setup();
    await t.ask('videoMessage|VID1|olha o vídeo', { key: { id: 'VID1' }, message: { videoMessage: {} } });
    assert.deepEqual(t.lastUserContent(), [{ type: 'text', text: '[o contato enviou um vídeo]\nolha o vídeo' }]);
  });

  test('sticker, location and contact sentences reach the model as they are', async () => {
    for (const text of ['[figurinha]', '[localização: -23.5, -46.6]', '[contato compartilhado: Maria]']) {
      const t = setup();
      await t.ask(text, { key: { id: 'X' }, message: {} });
      assert.deepEqual(t.lastUserContent(), [{ type: 'text', text }]);
    }
  });

  test('message without any text (undefined content) is not sent to OpenAI', async () => {
    const t = setup();
    await t.ask(undefined as any, { key: { id: 'X' }, message: { reactionMessage: {} } });
    assert.equal(t.openai.requests.length, 0);
    assert.deepEqual(t.waInstance.sent, []);
  });
});

describe('OpenaiService: documents', { concurrency: true }, () => {
  const PDF = plainPdf(3).toString('base64');

  test('PDF within the limit is sent as a file input; history and logs keep only a placeholder', async () => {
    const t = setup();
    const msg = documentMsg({ fileName: 'contrato.pdf', caption: 'meu contrato', fileLength: 4000, base64: PDF });
    await t.ask(`documentMessage|${msg.key.id}|meu contrato`, msg);

    assert.deepEqual(t.lastUserContent(), [
      { type: 'text', text: 'meu contrato' },
      { type: 'file', file: { filename: 'contrato.pdf', file_data: `data:application/pdf;base64,${PDF}` } },
    ]);

    const saved = t.savedHistory();
    assert.ok(!JSON.stringify(saved).includes(PDF), 'no base64 in session.context');
    assert.deepEqual(saved.at(-2).content, [
      { type: 'text', text: 'meu contrato' },
      { type: 'text', text: '[documento: contrato.pdf]' },
    ]);

    // What is logged as "Final messages payload"
    const logged = JSON.stringify(t.service.stripMediaFromMessage({ role: 'user', content: t.lastUserContent() }));
    assert.ok(!logged.includes(PDF));
  });

  test('documentWithCaptionMessage (Baileys) PDF downloaded through the channel', async () => {
    const t = setup();
    t.waInstance.media = { base64: PDF, mimetype: 'application/pdf' };
    const msg = documentMsg({ fileName: 'laudo.pdf', caption: 'laudo', withCaptionWrapper: true });
    await t.ask(`documentWithCaptionMessage|${msg.key.id}|laudo`, msg);
    assert.equal(t.lastUserContent()[1].type, 'file');
    assert.equal(t.lastUserContent()[1].file.filename, 'laudo.pdf');
  });

  test('PDF larger than maxDocumentMB (declared size): described, never downloaded', async () => {
    const t = setup({ settings: { maxDocumentMB: 10 } });
    let downloads = 0;
    t.waInstance.getBase64FromMediaMessage = async () => {
      downloads++;
      return { base64: PDF, mimetype: 'application/pdf' };
    };
    const msg = documentMsg({ fileName: 'processo.pdf', fileLength: 11 * 1024 * 1024 });
    await t.ask(`documentMessage|${msg.key.id}`, msg);

    assert.equal(downloads, 0);
    assert.deepEqual(t.lastUserContent(), [
      { type: 'text', text: '[o contato enviou o documento processo.pdf (PDF)]' },
    ]);
  });

  test('PDF larger than maxDocumentMB after the download (no declared size, Cloud API): described', async () => {
    const t = setup({ bot: { maxDocumentMB: 1 }, settings: { maxDocumentMB: 10 } });
    const big = Buffer.concat([plainPdf(1), Buffer.alloc(1024 * 1024 + 10, 32)]).toString('base64');
    const msg = {
      key: { id: nextId('DOC'), remoteJid: REMOTE_JID },
      message: { documentMessage: { filename: 'grande.pdf', mime_type: 'application/pdf' }, base64: big },
    };
    await t.ask(`documentMessage|${msg.key.id}`, msg);
    assert.deepEqual(t.lastUserContent(), [{ type: 'text', text: '[o contato enviou o documento grande.pdf (PDF)]' }]);
  });

  test(`PDF with more than 20 pages is described with its page count`, async () => {
    const t = setup();
    const msg = documentMsg({ fileName: 'autos.pdf', base64: objectStreamPdf(25).toString('base64') });
    await t.ask(`documentMessage|${msg.key.id}`, msg);
    assert.deepEqual(t.lastUserContent(), [
      { type: 'text', text: '[o contato enviou o documento autos.pdf (PDF, 25 páginas)]' },
    ]);
  });

  test('readDocuments off: even a small PDF is described', async () => {
    const t = setup({ bot: { readDocuments: false } });
    const msg = documentMsg({ fileName: 'rg.pdf', caption: 'meu RG', base64: PDF });
    await t.ask(`documentMessage|${msg.key.id}|meu RG`, msg);
    assert.deepEqual(t.lastUserContent(), [
      { type: 'text', text: '[o contato enviou o documento rg.pdf (PDF)]\nmeu RG' },
    ]);
  });

  test('other document types (doc, docx, xlsx) are described with name and type', async () => {
    const cases = [
      ['procuracao.doc', 'application/msword', 'DOC'],
      ['peticao.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'DOCX'],
      ['calculos.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'XLSX'],
    ];
    for (const [fileName, mimetype, label] of cases) {
      const t = setup();
      const msg = documentMsg({ fileName, mimetype, caption: 'segue', base64: 'AAAA' });
      await t.ask(`documentMessage|${msg.key.id}|segue`, msg);
      assert.deepEqual(t.lastUserContent(), [
        { type: 'text', text: `[o contato enviou o documento ${fileName} (${label})]\nsegue` },
      ]);
    }
  });

  test('a file declared as PDF that is not a PDF is described', async () => {
    const t = setup();
    const msg = documentMsg({ fileName: 'falso.pdf', base64: Buffer.from('<html>').toString('base64') });
    await t.ask(`documentMessage|${msg.key.id}`, msg);
    assert.deepEqual(t.lastUserContent(), [{ type: 'text', text: '[o contato enviou o documento falso.pdf (PDF)]' }]);
  });

  test('model rejects the PDF input (400): retried once with the document described, answer sent', async () => {
    const t = setup();
    t.openai.reply(apiError(400, "Invalid content type. 'file' is not supported with this model."), 'li a descrição');
    const msg = documentMsg({ fileName: 'contrato.pdf', caption: 'veja', base64: PDF });
    await t.ask(`documentMessage|${msg.key.id}|veja`, msg);

    assert.equal(t.openai.requests.length, 2);
    assert.equal(t.openai.requests[0].messages.at(-1).content[1].type, 'file');
    assert.deepEqual(t.openai.requests[1].messages.at(-1).content, [
      { type: 'text', text: 'veja\n[o contato enviou o documento contrato.pdf (PDF)]' },
    ]);
    assert.deepEqual(texts(t.waInstance), ['li a descrição']);
  });

  test('assistant mode: PDFs are described (no file input in thread messages)', async () => {
    const t = setup({ bot: { botType: 'assistant', assistantId: 'asst_1' }, session: { sessionId: 'thread_1' } });
    const threadMessages: any[] = [];
    t.openai.beta.threads.messages.create = async (_thread: string, data: any) => void threadMessages.push(data);
    t.openai.beta.threads.messages.list = async () => ({
      data: [{ content: [{ type: 'text', text: { value: 'ok' } }] }],
    });
    const msg = documentMsg({ fileName: 'contrato.pdf', base64: PDF });
    await t.ask(`documentMessage|${msg.key.id}`, msg);

    assert.deepEqual(threadMessages[0].content, [
      { type: 'text', text: '[o contato enviou o documento contrato.pdf (PDF)]' },
    ]);
  });
});

describe('OpenaiService: conversation window (historyMessages)', { concurrency: true }, () => {
  const history = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user',
      content: `m${index + 1}`,
    }));

  /** Previous messages sent to the model (between the system prompt and the current message). */
  const previous = (t: ReturnType<typeof setup>) => t.openai.requests.at(-1).messages.slice(1, -1);

  test('default: 10 previous messages sent and 10 stored (same as before)', async () => {
    const t = setup({ session: { context: JSON.stringify({ history: history(30) }) } });
    await t.ask('qual o meu nome?');

    assert.deepEqual(
      previous(t).map((m: any) => m.content),
      history(30)
        .slice(-10)
        .map((m) => m.content),
    );
    const saved = t.savedHistory();
    assert.equal(saved.length, 10);
    assert.deepEqual(saved.at(-1), { role: 'assistant', content: 'resposta 1' });
  });

  test('bot historyMessages 40 wins over settings: the whole 30-message history is sent', async () => {
    const t = setup({
      bot: { historyMessages: 40 },
      settings: { historyMessages: 10 },
      session: { context: JSON.stringify({ history: history(30) }) },
    });
    await t.ask('qual o meu nome?');
    assert.equal(previous(t).length, 30);
    assert.equal(previous(t)[0].content, 'm1', 'the first message (where the name was said) is still there');
    assert.equal(t.savedHistory().length, 32);
  });

  test('settings value is inherited when the bot has none; the window keeps sliding', async () => {
    const t = setup({
      settings: { historyMessages: 4 },
      session: { context: JSON.stringify({ history: history(3) }) },
    });
    await t.ask('a');
    assert.equal(previous(t).length, 3);
    assert.equal(t.savedHistory().length, 4);
    await t.ask('b');
    assert.equal(previous(t).length, 4);
    assert.deepEqual(
      t.savedHistory().map((m: any) => (typeof m.content === 'string' ? m.content : m.content[0].text)),
      ['a', 'resposta 1', 'b', 'resposta 2'],
    );
  });

  test('out-of-range values are clamped to 2..100', async () => {
    const t = setup({ bot: { historyMessages: 1 }, session: { context: JSON.stringify({ history: history(8) }) } });
    await t.ask('oi');
    assert.equal(previous(t).length, 2);
    assert.equal(t.savedHistory().length, 2);
  });
});
