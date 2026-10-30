import '../helpers/setup';

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import { nextId, waitFor } from '../helpers/fakes';
import { OpenaiHarness, SKIP_INTEGRATION } from '../helpers/integration';
import { plainPdf } from '../helpers/pdf';

/**
 * Media options and conversation window of the OpenAI bot on a real database: migration defaults, bot > settings
 * precedence through the controller, and the messages the model receives for each media type.
 */
const historyOf = (session: any) =>
  (typeof session.context === 'string' ? JSON.parse(session.context) : session.context).history;

const BASE_SETTINGS = {
  expire: 0,
  keywordFinish: '#sair',
  delayMessage: 0,
  unknownMessage: 'Ops',
  listeningFromMe: false,
  stopBotFromMe: true,
  keepOpen: false,
  debounceTime: 0,
  ignoreJids: [],
};

describe('OpenAI bot: media and history window (integration)', { skip: SKIP_INTEGRATION }, () => {
  let h: OpenaiHarness;
  const transcriptionModels: string[] = [];

  before(async () => {
    h = await new OpenaiHarness().start();
    h.service.requestTranscription = async (_audio: Buffer, model: string) => {
      transcriptionModels.push(model);
      return 'meu nome é Carlos';
    };
  });

  after(async () => {
    await h?.stop();
  });

  beforeEach(() => {
    h.openai.reset();
    transcriptionModels.length = 0;
  });

  const lastUserContent = () => h.openai.requests.at(-1).messages.at(-1).content;

  test('a settings row created without the new fields gets the migration defaults', async () => {
    const t = await h.createTenant();
    const row = await h.prisma.openaiSetting.findFirst({ where: { instanceId: t.instance.instanceId } });
    assert.equal(row.transcribeAudio, true);
    assert.equal(row.transcriptionModel, 'gpt-transcribe');
    assert.equal(row.maxAudioSeconds, 300);
    assert.equal(row.readImages, true);
    assert.equal(row.readDocuments, true);
    assert.equal(row.maxDocumentMB, 10);
    assert.equal(row.historyMessages, 10);

    // Bot fields are null: inherit
    assert.equal(t.bot.transcribeAudio, null);
    assert.equal(t.bot.historyMessages, null);
  });

  test('settings: stored, returned by fetchSettings, kept by a save without them; defaults without a row', async () => {
    const t = await h.createTenant({
      settings: {
        transcribeAudio: false,
        transcriptionModel: 'whisper-1',
        maxAudioSeconds: 0,
        readImages: false,
        readDocuments: false,
        maxDocumentMB: 5,
        historyMessages: 40,
      },
    });
    await h.controller.settings(t.instance, { ...BASE_SETTINGS, openaiCredsId: t.creds.id });

    const settings = await h.controller.fetchSettings(t.instance);
    assert.equal(settings.transcribeAudio, false);
    assert.equal(settings.transcriptionModel, 'whisper-1');
    assert.equal(settings.maxAudioSeconds, 0);
    assert.equal(settings.readImages, false);
    assert.equal(settings.readDocuments, false);
    assert.equal(settings.maxDocumentMB, 5);
    assert.equal(settings.historyMessages, 40);

    const name = `it-${nextId()}`.toLowerCase();
    const row = await h.prisma.instance.create({ data: { name, integration: 'WHATSAPP-BAILEYS' } });
    try {
      const defaults = await h.controller.fetchSettings({ instanceName: name });
      assert.equal(defaults.transcriptionModel, 'gpt-transcribe');
      assert.equal(defaults.historyMessages, 10);
      assert.equal(defaults.readImages, true);
    } finally {
      await h.prisma.instance.delete({ where: { id: row.id } });
    }
  });

  test('bot fields: stored on create and update (false/0 are values), absent keeps them', async () => {
    const t = await h.createTenant({ bot: { readImages: false, maxAudioSeconds: 0, historyMessages: 30 } });
    assert.equal(t.bot.readImages, false);
    assert.equal(t.bot.maxAudioSeconds, 0);
    assert.equal(t.bot.historyMessages, 30);

    const updated = await h.controller.updateBot(t.instance, t.bot.id, {
      enabled: true,
      openaiCredsId: t.creds.id,
      botType: 'chatCompletion',
      model: 'gpt-6-luna',
      maxTokens: 2000,
      triggerType: 'all',
      transcriptionModel: 'whisper-1',
    });
    assert.equal(updated.transcriptionModel, 'whisper-1');
    assert.equal(updated.readImages, false, 'not sent: kept');
    assert.equal(updated.historyMessages, 30, 'not sent: kept');
  });

  test('audio: transcribed with the model of the settings, or described when the bot turns it off', async () => {
    const t = await h.createTenant({ settings: { transcriptionModel: 'whisper-1' } });
    const jid = t.contact();
    const audio = (id: string) => ({
      key: { id, remoteJid: jid, fromMe: false },
      pushName: 'Carlos',
      message: { audioMessage: { seconds: 8, ptt: true }, base64: Buffer.from('ogg').toString('base64') },
      messageType: 'audioMessage',
    });
    await h.controller.emit({ instance: t.instance, remoteJid: jid, msg: audio(nextId('AUD')) });
    await waitFor(() => h.openai.requests.length === 1, 5000, 'completion');
    assert.deepEqual(transcriptionModels, ['whisper-1']);
    assert.deepEqual(lastUserContent(), [{ type: 'text', text: 'meu nome é Carlos' }]);

    const off = await h.createTenant({ bot: { transcribeAudio: false } });
    const offJid = off.contact();
    await h.controller.emit({
      instance: off.instance,
      remoteJid: offJid,
      msg: { ...audio(nextId('AUD')), key: { id: nextId('AUD'), remoteJid: offJid, fromMe: false } },
    });
    await waitFor(() => h.openai.requests.length === 2, 5000, 'completion');
    assert.equal(transcriptionModels.length, 1, 'not transcribed');
    assert.deepEqual(lastUserContent(), [{ type: 'text', text: '[o contato enviou um áudio]' }]);
  });

  test('sticker, location, contact and video reach the model as sentences (through the controller)', async () => {
    const t = await h.createTenant();
    const jid = t.contact();
    const send = (message: any) =>
      h.controller.emit({
        instance: t.instance,
        remoteJid: jid,
        msg: { key: { id: nextId('M'), remoteJid: jid, fromMe: false }, pushName: 'Cliente', message },
      });

    await send({ stickerMessage: {} });
    await send({ locationMessage: { degreesLatitude: -23.55, degreesLongitude: -46.63, name: 'Escritório' } });
    await send({ contactMessage: { displayName: 'Maria Souza' } });
    await send({ videoMessage: { caption: 'o acidente' } });

    assert.deepEqual(
      h.openai.requests.map((request) => request.messages.at(-1).content),
      [
        [{ type: 'text', text: '[figurinha]' }],
        [{ type: 'text', text: '[localização: -23.55, -46.63 - Escritório]' }],
        [{ type: 'text', text: '[contato compartilhado: Maria Souza]' }],
        [{ type: 'text', text: '[o contato enviou um vídeo]\no acidente' }],
      ],
    );
  });

  test('PDF sent as file input, docx described; session.context never stores base64', async () => {
    const t = await h.createTenant();
    const jid = t.contact();
    const pdf = plainPdf(2).toString('base64');
    const doc = (fileName: string, mimetype: string, base64: string) => ({
      key: { id: nextId('DOC'), remoteJid: jid, fromMe: false },
      pushName: 'Cliente',
      message: { documentMessage: { fileName, mimetype, fileLength: 1000 }, base64 },
      messageType: 'documentMessage',
    });

    await h.controller.emit({ instance: t.instance, remoteJid: jid, msg: doc('contrato.pdf', 'application/pdf', pdf) });
    assert.equal(lastUserContent()[0].type, 'file');
    assert.equal(lastUserContent()[0].file.file_data, `data:application/pdf;base64,${pdf}`);

    await h.controller.emit({
      instance: t.instance,
      remoteJid: jid,
      msg: doc('peticao.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'AAAA'),
    });
    assert.deepEqual(lastUserContent(), [{ type: 'text', text: '[o contato enviou o documento peticao.docx (DOCX)]' }]);

    const session = await t.session(jid);
    const context = JSON.stringify(session.context);
    assert.ok(!context.includes(pdf), 'no base64 in session.context');
    assert.ok(context.includes('[documento: contrato.pdf]'));
  });

  test('history window: bot historyMessages keeps the name said at the start of a long triage', async () => {
    const t = await h.createTenant({ settings: { historyMessages: 10 }, bot: { historyMessages: 40 } });
    const jid = t.contact();
    await t.client(jid, 'Meu nome é Carlos');
    for (let index = 0; index < 12; index++) await t.client(jid, `resposta da triagem ${index}`);

    const sent = h.openai.requests.at(-1).messages;
    assert.ok(
      sent.some((message: any) => JSON.stringify(message.content).includes('Meu nome é Carlos')),
      'the first message is still in the window',
    );

    const session = await t.session(jid);
    assert.equal(historyOf(session).length, 26);

    // With the default window (10) it would have dropped out
    const short = await h.createTenant();
    const shortJid = short.contact();
    await short.client(shortJid, 'Meu nome é Carlos');
    for (let index = 0; index < 12; index++) await short.client(shortJid, `resposta da triagem ${index}`);
    const shortSent = h.openai.requests.at(-1).messages;
    assert.ok(!shortSent.some((message: any) => JSON.stringify(message.content).includes('Meu nome é Carlos')));
    assert.equal(historyOf(await short.session(shortJid)).length, 10);
  });
});
