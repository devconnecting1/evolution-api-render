import '../helpers/setup';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { OpenaiController } from '@api/integrations/chatbot/openai/controllers/openai.controller';
import { OpenaiService } from '@api/integrations/chatbot/openai/services/openai.service';
import { configService } from '@config/env.config';
import { describeQuotedMessage, stripQuotedContext, withQuotedContext } from '@utils/quotedContext';

/**
 * #2078: a reply to an older message tells the AI what is being answered. #1872: a contact known only by its
 * @lid (no remoteJidAlt) still finds its session.
 */
const reply = (quotedMessage: any, extra: Record<string, any> = {}) => ({
  key: { id: 'R1', remoteJid: '5511987654321@s.whatsapp.net', fromMe: false },
  message: { conversation: 'sim, esse mesmo' },
  // Baileys messageRaw: contextInfo of the content, at the top level
  contextInfo: { stanzaId: 'Q1', participant: '5511900000000@s.whatsapp.net', quotedMessage, ...extra },
});

describe('describeQuotedMessage / withQuotedContext (#2078)', () => {
  test('a text quote becomes one line before the content', () => {
    const msg = reply({ conversation: 'Qual o horário de atendimento?' });

    assert.equal(describeQuotedMessage(msg), '[respondendo a: "Qual o horário de atendimento?"]');
    assert.equal(
      withQuotedContext('sim, esse mesmo', msg),
      '[respondendo a: "Qual o horário de atendimento?"]\nsim, esse mesmo',
    );
  });

  test('extendedTextMessage, wrappers and newlines: the quote stays on its own line', () => {
    const msg = reply({ ephemeralMessage: { message: { extendedTextMessage: { text: 'linha 1\n\nlinha   2' } } } });
    assert.equal(describeQuotedMessage(msg), '[respondendo a: "linha 1 linha 2"]');
  });

  test('a long quote is cut at ~200 characters', () => {
    const quote = describeQuotedMessage(reply({ conversation: 'a'.repeat(500) }));
    assert.equal(quote, `[respondendo a: "${'a'.repeat(200)}…"]`);
  });

  test('media quotes get a short label (with the caption when there is one)', () => {
    assert.equal(
      describeQuotedMessage(reply({ imageMessage: { mimetype: 'image/jpeg' } })),
      '[respondendo a uma foto]',
    );
    assert.equal(
      describeQuotedMessage(reply({ imageMessage: { caption: 'meu RG' } })),
      '[respondendo a uma foto: "meu RG"]',
    );
    assert.equal(describeQuotedMessage(reply({ audioMessage: { seconds: 3 } })), '[respondendo a um áudio]');
    assert.equal(
      describeQuotedMessage(reply({ documentMessage: { fileName: 'a.pdf' } })),
      '[respondendo a um documento]',
    );
    assert.equal(describeQuotedMessage(reply({ videoMessage: {} })), '[respondendo a um vídeo]');
    assert.equal(describeQuotedMessage(reply({ stickerMessage: {} })), '[respondendo a uma figurinha]');
    assert.equal(describeQuotedMessage(reply({ reactionMessage: {} })), '[respondendo a uma mensagem anterior]');
  });

  test('only the id of the quoted message (Cloud API): generic label', () => {
    const msg = { key: { id: 'C1' }, message: { conversation: 'ok' }, contextInfo: { stanzaId: 'wamid.X' } };
    assert.equal(describeQuotedMessage(msg), '[respondendo a uma mensagem anterior]');
  });

  test('contextInfo inside the content (raw WAMessage) is found too', () => {
    const msg = {
      key: { id: 'W1' },
      message: {
        extendedTextMessage: { text: 'ok', contextInfo: { stanzaId: 'Q', quotedMessage: { conversation: 'oi?' } } },
      },
    };
    assert.equal(describeQuotedMessage(msg), '[respondendo a: "oi?"]');
  });

  test('no quote: forwarded or ad messages and plain messages are untouched', () => {
    const forwarded = { message: { conversation: 'x' }, contextInfo: { isForwarded: true, forwardingScore: 1 } };
    const ad = { message: { conversation: 'x' }, contextInfo: { externalAdReply: { body: 'anúncio' } } };
    assert.equal(describeQuotedMessage(forwarded), undefined);
    assert.equal(describeQuotedMessage(ad), undefined);
    assert.equal(withQuotedContext('oi', { message: { conversation: 'oi' } }), 'oi');
  });

  test('content that is not text (e.g. a reaction) is returned as is', () => {
    const msg = reply({ conversation: 'x' });
    assert.equal(withQuotedContext(undefined, msg), undefined);
    assert.equal(withQuotedContext('', msg), '');
  });

  test('a media line of the content stays intact on its own line', () => {
    const msg = reply({ conversation: 'manda a foto' });
    assert.equal(
      withQuotedContext('imageMessage|R1|aqui', msg),
      '[respondendo a: "manda a foto"]\nimageMessage|R1|aqui',
    );
  });

  test('stripQuotedContext removes only the quote lines (finish keyword check)', () => {
    assert.equal(stripQuotedContext('[respondendo a: "tchau?"]\n#sair'), '#sair');
    assert.equal(stripQuotedContext('[respondendo a uma foto]\nok\n[respondendo a: "x"]\nsim'), 'ok\nsim');
    assert.equal(stripQuotedContext('sem citação'), 'sem citação');
  });
});

describe('OpenAI controller: content for the bot vs. content for the trigger', () => {
  const controller: any = new OpenaiController(
    new OpenaiService({ waInstances: {} } as any, {} as any, configService),
    {} as any,
    { waInstances: {} } as any,
  );

  test('the trigger sees what the customer typed; the bot also gets the quote', () => {
    const msg = reply({ conversation: 'Qual o valor da consulta?' });

    assert.equal(controller.getConversationContent(msg), 'sim, esse mesmo');
    assert.equal(
      controller.getBotContent('sim, esse mesmo', msg),
      '[respondendo a: "Qual o valor da consulta?"]\nsim, esse mesmo',
    );
  });
});

describe('resolveSessionJids: @lid without remoteJidAlt (#1872)', () => {
  const make = (lidMapping?: any) =>
    new OpenaiController(
      new OpenaiService({ waInstances: {} } as any, {} as any, configService),
      {} as any,
      { waInstances: { unit: { client: { signalRepository: { lidMapping } } } } } as any,
    ) as any;

  const instance = { instanceName: 'unit', instanceId: 'inst-1' };
  const lidMsg = { key: { id: 'L1', remoteJid: '123456789012345@lid', fromMe: false } };

  test('only the LID (no mapping known): the LID itself, no empty values', async () => {
    const jids = await make({ getPNForLID: async () => null }).resolveSessionJids(
      instance,
      '123456789012345@lid',
      lidMsg,
    );
    assert.deepEqual(jids, ['123456789012345@lid']);
  });

  test('no lidMapping on the socket at all: still the LID', async () => {
    const jids = await make(undefined).resolveSessionJids(instance, '123456789012345@lid', lidMsg);
    assert.deepEqual(jids, ['123456789012345@lid']);
  });

  test('a mapping that throws is ignored', async () => {
    const jids = await make({
      getPNForLID: async () => {
        throw new Error('no mapping');
      },
    }).resolveSessionJids(instance, '123456789012345@lid', lidMsg);
    assert.deepEqual(jids, ['123456789012345@lid']);
  });

  test('a known mapping adds the phone number JID', async () => {
    const jids = await make({ getPNForLID: async () => '5511987654321:12@s.whatsapp.net' }).resolveSessionJids(
      instance,
      '123456789012345@lid',
      lidMsg,
    );
    assert.deepEqual(jids, ['123456789012345@lid', '5511987654321@s.whatsapp.net']);
  });
});
