import '../helpers/setup';

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import { configService } from '@config/env.config';
import { DisconnectReason } from 'baileys';

import { createBaileysService, emitsFor, incoming, INSTANCE_ID } from '../helpers/baileys';
import { chatbotEmitCalls } from '../helpers/chatbot-emit';

/**
 * Hardening phase 4 of the Baileys channel: read receipts by chat (not by id), S3 media problems that only skip
 * that media (#2768), encrypted edits kept away from the bots (#2545/#2617), getBase64FromMediaMessage without a
 * message (#2550), the 401 after a stream:error 515 (#2498/#2437) and the zombie socket (#2403/#2257/#2443).
 */
const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('Baileys messages.upsert: read receipts are decided by remoteJid', () => {
  let ctx: ReturnType<typeof createBaileysService>;
  let read: any[];

  beforeEach(() => {
    chatbotEmitCalls.length = 0;
    ctx = createBaileysService();
    read = [];
    ctx.service.client.readMessages = async (keys: any[]) => void read.push(...keys);
  });

  test('readMessages marks a chat message as read, but never a status', async () => {
    ctx.service.localSettings.readMessages = true;
    const chat = incoming({ conversation: 'oi' });
    const status = incoming({ conversation: 'meu status' }, { remoteJid: 'status@broadcast', participant: 'x' });

    await ctx.upsert([chat, status]);

    assert.deepEqual(
      read.map((key) => key.id),
      [chat.key.id],
    );
  });

  test('readStatus marks a status as read, but not a chat message', async () => {
    ctx.service.localSettings.readStatus = true;
    const chat = incoming({ conversation: 'oi' });
    const status = incoming({ conversation: 'meu status' }, { remoteJid: 'status@broadcast', participant: 'x' });

    await ctx.upsert([chat, status]);

    assert.deepEqual(
      read.map((key) => key.id),
      [status.key.id],
    );
  });

  test('production settings (both off) read nothing', async () => {
    await ctx.upsert([incoming({ conversation: 'oi' })]);
    assert.deepEqual(read, []);
  });
});

describe('Baileys messages.upsert: S3 media problems skip only that media (#2768)', () => {
  let ctx: ReturnType<typeof createBaileysService>;

  beforeEach(() => {
    chatbotEmitCalls.length = 0;
    ctx = createBaileysService();
    const s3 = { ENABLE: true, SAVE_VIDEO: false };
    ctx.service.configService = { get: (key: string) => (key === 'S3' ? s3 : configService.get(key as any)) };
    ctx.service.hasValidMediaContent = () => true;
  });

  const upserted = () => ctx.state.webhooks.filter((w) => w.event === 'messages.upsert').map((w) => w.data.key.id);

  test('a video with SAVE_VIDEO off no longer drops the rest of the batch', async () => {
    const video = incoming({ videoMessage: { mimetype: 'video/mp4', url: 'https://mmg/x' } });
    const text = incoming({ conversation: 'depois do vídeo' });

    await ctx.upsert([video, text]);

    assert.deepEqual(upserted(), [video.key.id, text.key.id]);
    assert.equal(emitsFor(video.key.id).length, 1, 'the video itself still reaches the bots');
    assert.equal(emitsFor(text.key.id).length, 1);
    assert.equal(ctx.state.created.length, 2);
  });

  test('media without downloadable content (null) is skipped and the message goes on', async () => {
    ctx.service.getBase64FromMediaMessage = async () => null;
    const image = incoming({ imageMessage: { mimetype: 'image/jpeg', url: 'https://mmg/y' } });
    const text = incoming({ conversation: 'oi' });

    await ctx.upsert([image, text]);

    assert.deepEqual(upserted(), [image.key.id, text.key.id]);
    assert.equal(emitsFor(image.key.id).length, 1);
    assert.equal(emitsFor(text.key.id).length, 1);
  });

  test('an upload error is logged and the message still reaches the webhook and the bots', async () => {
    ctx.service.getBase64FromMediaMessage = async () => {
      throw new Error('download failed');
    };
    const image = incoming({ imageMessage: { mimetype: 'image/jpeg', url: 'https://mmg/z' } });

    await ctx.upsert([image]);

    assert.deepEqual(upserted(), [image.key.id]);
    assert.equal(emitsFor(image.key.id).length, 1);
    assert.ok(ctx.state.errors.some((e) => e.includes('Error on upload file to minio')));
  });
});

describe('Baileys messages.upsert: encrypted edits (secretEncryptedMessage, #2545/#2617)', () => {
  beforeEach(() => {
    chatbotEmitCalls.length = 0;
  });

  test('is stored and sent to the webhook as today, but never handed to the bots', async () => {
    const ctx = createBaileysService();
    const edit = incoming({
      secretEncryptedMessage: {
        targetMessageKey: { id: 'ORIGINAL-1', remoteJid: '5511987654321@s.whatsapp.net', fromMe: false },
        encPayload: Buffer.from('cifrado'),
        encIv: Buffer.from('iv'),
        secretEncType: 2,
      },
    });
    const text = incoming({ conversation: 'oi' });

    await ctx.upsert([edit, text]);

    assert.equal(emitsFor(edit.key.id).length, 0, 'the bot does not see an empty/unknown message');
    assert.equal(emitsFor(text.key.id).length, 1);
    assert.ok(ctx.state.created.some((m) => m.key.id === edit.key.id && m.messageType === 'secretEncryptedMessage'));
    assert.ok(ctx.state.webhooks.some((w) => w.event === 'messages.upsert' && w.data.key.id === edit.key.id));
  });
});

describe('Baileys getBase64FromMediaMessage without a message body (#2550)', () => {
  const rejection = async (promise: Promise<any>) => {
    try {
      await promise;
    } catch (error) {
      return error;
    }
    assert.fail('expected a rejection');
  };

  test('unknown message (not in the payload nor in the database): 400 "Mensagem não encontrada"', async () => {
    const { service } = createBaileysService();
    const error = await rejection(service.getBase64FromMediaMessage({ message: { key: { id: 'NOPE' } } }));

    assert.equal(error.status, 400);
    assert.deepEqual(error.message, ['Mensagem não encontrada']);
  });

  test('a stored row without message is also "Mensagem não encontrada", not a TypeError', async () => {
    const { service, state } = createBaileysService();
    state.rows.push({ id: 'r1', instanceId: INSTANCE_ID, key: { id: 'EMPTY' }, message: null });

    const error = await rejection(service.getBase64FromMediaMessage({ message: { key: { id: 'EMPTY' } } }));

    assert.deepEqual(error.message, ['Mensagem não encontrada']);
  });

  test('the database fallback is unwrapped (ephemeralMessage) before looking for the media', async () => {
    const { service, state } = createBaileysService();
    state.rows.push({
      id: 'r2',
      instanceId: INSTANCE_ID,
      key: { id: 'EPH' },
      message: { ephemeralMessage: { message: { conversation: 'texto' } } },
    });

    const error = await rejection(service.getBase64FromMediaMessage({ message: { key: { id: 'EPH' } } }));

    assert.deepEqual(error.message, ['The message is not of the media type']);
  });

  test('a wrapper without inner message (viewOnceMessageV2: {}) does not crash', async () => {
    const { service } = createBaileysService();
    const error = await rejection(
      service.getBase64FromMediaMessage({ message: { key: { id: 'V1' }, message: { viewOnceMessageV2: {} } } }),
    );

    assert.equal(error.status, 400);
    assert.deepEqual(error.message, ['The message is not of the media type']);
  });

  test('a wrapper holding only messageContextInfo has no media: null', async () => {
    const { service } = createBaileysService();
    const result = await service.getBase64FromMediaMessage({
      message: { key: { id: 'C1' }, message: { ephemeralMessage: { message: { messageContextInfo: {} } } } },
    });

    assert.equal(result, null);
  });
});

describe('Baileys connectionUpdate: 401 right after a stream:error 515 (#2498/#2437)', () => {
  let ctx: ReturnType<typeof createBaileysService>;
  let reconnects: number;
  let logouts: number;
  let ended: number;

  beforeEach(() => {
    ctx = createBaileysService();
    reconnects = 0;
    logouts = 0;
    ended = 0;
    ctx.service.connectToWhatsapp = async () => void reconnects++;
    ctx.service.eventEmitter.on('logout.instance', () => void logouts++);
    ctx.service.client.ws = { close: () => undefined };
    ctx.service.client.end = () => void ended++;
  });

  const close = (statusCode: number) =>
    ctx.service.connectionUpdate({ connection: 'close', lastDisconnect: { error: { output: { statusCode } } } });

  test('a 401 within 30 s of a 515 reconnects instead of logging out', async () => {
    await close(DisconnectReason.restartRequired);
    assert.equal(reconnects, 1, '515 always reconnects');

    await close(DisconnectReason.loggedOut);

    assert.equal(reconnects, 2);
    assert.equal(logouts, 0);
    assert.equal(ended, 0);
    assert.equal(
      ctx.state.updates.filter((u) => u.model === 'instance' && u.args.data.connectionStatus === 'close').length,
      0,
    );
  });

  test('only one rescue per 515: a second 401 logs out', async () => {
    await close(DisconnectReason.restartRequired);
    await close(DisconnectReason.loggedOut);
    await close(DisconnectReason.loggedOut);

    assert.equal(reconnects, 2);
    assert.equal(logouts, 1);
  });

  test('an isolated 401 keeps the logout flow', async () => {
    await close(DisconnectReason.loggedOut);

    assert.equal(reconnects, 0);
    assert.equal(logouts, 1);
    assert.equal(ended, 1);
    const [update] = ctx.state.updates.filter((u) => u.model === 'instance');
    assert.equal(update.args.data.connectionStatus, 'close');
    assert.equal(update.args.data.disconnectionReasonCode, 401);
  });

  test('a 401 more than 30 s after the 515 is a real logout', async () => {
    await close(DisconnectReason.restartRequired);
    ctx.service.lastStream515At = Date.now() - 31_000;

    await close(DisconnectReason.loggedOut);

    assert.equal(reconnects, 1);
    assert.equal(logouts, 1);
  });

  test('a 403 (forbidden) after a 515 is not rescued', async () => {
    await close(DisconnectReason.restartRequired);
    await close(DisconnectReason.forbidden);

    assert.equal(reconnects, 1);
    assert.equal(logouts, 1);
  });
});

describe('Baileys send: "Connection Closed" while the state is open reconnects once (#2403/#2257/#2443)', () => {
  let ctx: ReturnType<typeof createBaileysService>;
  let reconnects: number;
  let closed: string[];
  let unsubscribed: number;

  beforeEach(() => {
    ctx = createBaileysService();
    reconnects = 0;
    closed = [];
    unsubscribed = 0;
    ctx.service.connectToWhatsapp = async () => void reconnects++;
    ctx.service.whatsappNumber = async ({ numbers }: any) => [
      { exists: true, jid: `${numbers[0]}@s.whatsapp.net`, number: numbers[0] },
    ];
    ctx.service.stateConnection = { state: 'open' };
    ctx.service.unsubscribeEvents = () => void unsubscribed++;
    ctx.service.client.ws = { close: () => void closed.push('ws') };
    ctx.service.client.end = () => void closed.push('end');
  });

  const failSendsWith = (message: string) => {
    ctx.service.client.sendMessage = async () => {
      throw new Error(message);
    };
  };

  const send = () => ctx.service.textMessage({ number: '5511987654321', text: 'oi' }).catch((error: any) => error);

  test('reconnects once, detaching and closing the stale socket first', async () => {
    failSendsWith('Connection Closed');

    const error = await send();
    await tick();

    assert.equal(error.status, 400, 'the send itself still fails with 400');
    assert.equal(reconnects, 1);
    assert.equal(unsubscribed, 1);
    assert.deepEqual(closed, ['ws', 'end']);
  });

  test('at most once per minute, even if the state reads "open" again', async () => {
    failSendsWith('Connection Closed');

    await send();
    await tick();
    ctx.service.stateConnection = { state: 'open' };
    await send();
    await tick();

    assert.equal(reconnects, 1);

    ctx.service.lastZombieReconnectAt = Date.now() - 61_000;
    await send();
    await tick();

    assert.equal(reconnects, 2);
  });

  test('not while connecting or closed, and not for other errors', async () => {
    failSendsWith('Connection Closed');
    ctx.service.stateConnection = { state: 'connecting' };
    await send();
    ctx.service.stateConnection = { state: 'close' };
    await send();

    ctx.service.stateConnection = { state: 'open' };
    failSendsWith('Timed Out');
    await send();
    await tick();

    assert.equal(reconnects, 0);
  });

  test('a reconnect already running is not started again', async () => {
    failSendsWith('Connection Closed');
    let release: () => void;
    ctx.service.connectToWhatsapp = () => {
      reconnects++;
      return new Promise<void>((resolve) => (release = resolve));
    };

    await send();
    ctx.service.stateConnection = { state: 'open' };
    ctx.service.lastZombieReconnectAt = 0;
    await send();
    release!();
    await tick();

    assert.equal(reconnects, 1);
  });
});
