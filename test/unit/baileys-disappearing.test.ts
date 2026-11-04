import '../helpers/setup';

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import { getConversationMessage } from '@utils/getConversationMessage';

import { createBaileysService, emitsFor, incoming } from '../helpers/baileys';
import { chatbotEmitCalls } from '../helpers/chatbot-emit';

describe('Baileys messages.upsert: disappearing messages and per-message errors (#2773)', () => {
  beforeEach(() => {
    chatbotEmitCalls.length = 0;
  });

  test('a disappearing text (ephemeralMessage) is stored and handed to the bots as plain text (#2773)', async () => {
    const { state, upsert } = createBaileysService();
    const received = incoming({
      ephemeralMessage: {
        message: {
          extendedTextMessage: {
            text: 'Preciso falar com o advogado',
            contextInfo: { expiration: 86400, disappearingMode: { initiator: 0 } },
          },
        },
      },
      messageContextInfo: { deviceListMetadataVersion: 2 },
    });

    await upsert([received]);

    const [stored] = state.created;
    assert.equal(stored.messageType, 'conversation');
    assert.equal(stored.message.conversation, 'Preciso falar com o advogado');
    assert.equal(stored.message.ephemeralMessage, undefined);
    assert.equal(stored.contextInfo.expiration, 86400);
    assert.deepEqual(stored.message.messageContextInfo, { deviceListMetadataVersion: 2 });

    const [emit] = emitsFor(received.key.id);
    assert.equal(getConversationMessage(emit.msg), 'Preciso falar com o advogado');
    assert.deepEqual(state.errors, []);
  });

  test('a disappearing audio is transcribed and a view once image is seen as an image (#2773)', async () => {
    const { state, upsert } = createBaileysService();
    state.openaiSetting = { openaiCredsId: 'creds-1', speechToText: true };

    const audio = incoming({
      ephemeralMessage: { message: { audioMessage: { url: 'https://mmg/x', mimetype: 'audio/ogg', ptt: true } } },
    });
    const image = incoming({
      viewOnceMessageV2: { message: { imageMessage: { url: 'https://mmg/y', mimetype: 'image/jpeg' } } },
    });
    const document = incoming({
      documentWithCaptionMessage: {
        message: { documentMessage: { url: 'https://mmg/z', mimetype: 'application/pdf', caption: 'contrato' } },
      },
    });

    await upsert([audio, image, document]);

    assert.equal(state.transcribed.length, 1);
    assert.ok(state.transcribed[0].message.audioMessage, 'the transcription sees the real audioMessage');

    const [storedAudio, storedImage, storedDocument] = state.created;
    assert.equal(storedAudio.messageType, 'audioMessage');
    assert.equal(storedAudio.message.speechToText, '[audio] áudio transcrito');
    assert.equal(storedImage.messageType, 'imageMessage');
    assert.equal(storedDocument.messageType, 'documentMessage');
    assert.equal(storedDocument.message.documentMessage.caption, 'contrato');
    assert.equal(emitsFor(audio.key.id).length, 1);
    assert.equal(emitsFor(image.key.id).length, 1);
    assert.equal(emitsFor(document.key.id).length, 1);
  });

  test('one message that fails does not drop the rest of the batch; the failure names key.id and type', async () => {
    const { state, upsert } = createBaileysService();
    const bad = incoming({ conversation: 'primeira' });
    const good = incoming({ conversation: 'segunda' });
    state.failCreateFor.add(bad.key.id);

    await upsert([bad, good]);

    assert.deepEqual(
      state.created.map((m) => m.key.id),
      [good.key.id],
    );
    assert.equal(emitsFor(good.key.id).length, 1);
    assert.ok(
      state.errors.some((e) => e.includes(bad.key.id) && e.includes('conversation')),
      JSON.stringify(state.errors),
    );
  });
});
