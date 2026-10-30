import '../helpers/setup';

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import { MetaController } from '@api/integrations/channel/meta/meta.controller';
import { BusinessStartupService } from '@api/integrations/channel/meta/whatsapp.business.service';
import { configService } from '@config/env.config';
import { isBotMessageId, registerBotMessageId } from '@utils/botMessageRegistry';
import EventEmitter2 from 'eventemitter2';

import { chatbotEmitCalls } from '../helpers/chatbot-emit';
import { sleep, waitFor } from '../helpers/fakes';

/**
 * Cloud API (WHATSAPP-BUSINESS) webhook handling with Coexistence echoes, with a mocked Prisma (no database):
 * the payloads Meta sends must never throw, echoes of the owner reach the chatbots as fromMe messages and the
 * contact of each message is kept even when several changes come in the same POST.
 */
const INSTANCE_ID = 'inst-cloud-1';
const PHONE_NUMBER_ID = 'PNID-1';
const metadata = { display_phone_number: '15550000000', phone_number_id: PHONE_NUMBER_ID };

const wrap = (field: string, value: any) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'WABA-1', changes: [{ field, value: { messaging_product: 'whatsapp', ...value } }] }],
});

const textMessageChange = (from: string, id: string, body: string) => ({
  field: 'messages',
  value: {
    messaging_product: 'whatsapp',
    metadata,
    contacts: [{ profile: { name: `Contato ${from}` }, wa_id: from }],
    messages: [{ from, id, timestamp: '1761750000', type: 'text', text: { body } }],
  },
});

const echo = (
  id: string,
  to: string,
  extra: Record<string, any> = { type: 'text', text: { body: 'Sou eu, humano' } },
) =>
  wrap('smb_message_echoes', {
    metadata,
    message_echoes: [{ from: '15550000000', to, id, timestamp: '1761750100', ...extra }],
  });

describe('Cloud API webhook (mocked Prisma)', () => {
  const createdMessages: any[] = [];
  const serviceErrors: any[] = [];
  const controllerErrors: any[] = [];
  const unhandled: any[] = [];
  const webhooks: { event: string; data: any }[] = [];
  let service: any;
  let controller: any;
  let delayLookups = false;

  const onUnhandled = (reason: any) => void unhandled.push(reason);

  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_target, op: string) => async (args: any) => {
          if (name === 'message' && op === 'create') createdMessages.push(args.data);
          if (name === 'instance' && op === 'findFirst') {
            if (delayLookups) await sleep(5);
            return { name: 'cloud', id: INSTANCE_ID };
          }
          if (name === 'message' && op === 'findFirst') {
            const echoId = args?.where?.key?.path ? args.where.key.equals : undefined;
            if (echoId) return createdMessages.some((m) => m?.key?.id === echoId) ? { id: 'already-saved' } : null;
            return { id: 'msg-db-1', webhookUrl: null };
          }
          if (op === 'create') return { id: 'row-1', ...(args?.data ?? {}) };
          return null;
        },
      },
    );

  const emitsFor = (id: string) => chatbotEmitCalls.filter((call) => call.msg?.key?.id === id);

  /** Posts a payload like Meta does and waits for the (not awaited) processing to settle. */
  const post = async (payload: any) => {
    const result = await controller.receiveWebhook(payload);
    await sleep(60);
    return result;
  };

  before(() => {
    process.on('unhandledRejection', onUnhandled);

    const prisma: any = new Proxy({}, { get: (_target, name: string) => model(name) });
    const cache: any = { get: async () => null, set: async () => undefined, hSet: async () => undefined };

    service = new BusinessStartupService(configService, new EventEmitter2(), prisma, cache, cache, cache, {} as any);
    service.setInstance({
      instanceName: 'cloud',
      instanceId: INSTANCE_ID,
      integration: 'WHATSAPP-BUSINESS',
      number: PHONE_NUMBER_ID,
      token: 'not-a-real-token',
    });
    service.findSettings = async () => {
      if (delayLookups) await sleep(20);
      return { groups_ignore: false };
    };
    service.sendDataWebhook = (event: string, data: any) => void webhooks.push({ event, data });
    service.logger.error = (value: any) => void serviceErrors.push(value);

    controller = new MetaController(prisma, { waInstances: { cloud: service } } as any);
    controller.logger.error = (value: any) => void controllerErrors.push(value);
  });

  after(() => {
    process.off('unhandledRejection', onUnhandled);
  });

  beforeEach(() => {
    delayLookups = false;
  });

  const payloads: Record<string, any> = {
    'messages (text)': wrap('messages', {
      metadata,
      contacts: [{ profile: { name: 'Cliente' }, wa_id: '5511987654321' }],
      messages: [
        { from: '5511987654321', id: 'wamid.IN1', timestamp: '1761750000', type: 'text', text: { body: 'oi' } },
      ],
    }),
    statuses: wrap('messages', {
      metadata,
      statuses: [{ id: 'wamid.OUT1', status: 'delivered', timestamp: '1761750001', recipient_id: '5511987654321' }],
    }),
    'smb_message_echoes (text)': echo('wamid.ECHO1', '5511987654321'),
    'smb_message_echoes (image, formatted number)': echo('wamid.ECHO2', '+55 (31) 98765-4321', {
      type: 'image',
      image: { id: 'MEDIA1', mime_type: 'image/jpeg', sha256: 'x', caption: 'foto' },
    }),
    'smb_message_echoes (revoke)': echo('wamid.ECHO3', '5511987654321', {
      type: 'revoke',
      revoke: { original_message_id: 'wamid.ECHO1' },
    }),
    'smb_message_echoes (no echoes)': wrap('smb_message_echoes', { metadata }),
    'smb_message_echoes (no id)': wrap('smb_message_echoes', { metadata, message_echoes: [{ to: '5511987654321' }] }),
    smb_app_state_sync: wrap('smb_app_state_sync', {
      metadata,
      state_sync: [
        {
          type: 'contact',
          contact: { full_name: 'X', phone_number: '5511987654321' },
          action: 'add',
          metadata: { timestamp: '1' },
        },
      ],
    }),
    history: wrap('history', {
      metadata,
      history: [{ metadata: { phase: 0, chunk_order: 1, progress: 100 }, threads: [] }],
    }),
    account_update: wrap('account_update', { event: 'PARTNER_ADDED' }),
    'unknown field': wrap('some_new_field', { metadata, foo: 1 }),
    'entry without changes': { object: 'whatsapp_business_account', entry: [{ id: 'WABA-1' }] },
    'no entry': { object: 'whatsapp_business_account' },
  };

  for (const [name, payload] of Object.entries(payloads)) {
    test(`${name}: answers success and never throws or logs an error`, async () => {
      const errorsBefore = [serviceErrors.length, controllerErrors.length];
      const result = await post(payload);

      assert.deepEqual(result, { status: 'success' });
      assert.deepEqual(
        [serviceErrors.length, controllerErrors.length],
        errorsBefore,
        JSON.stringify(serviceErrors.at(-1)),
      );
    });
  }

  test('connectToWhatsapp with a non-object (instance creation path) does not throw', async () => {
    await service.connectToWhatsapp(PHONE_NUMBER_ID);
    await service.connectToWhatsapp(undefined);
  });

  test('received message reaches the chatbots as fromMe=false; status updates do not', () => {
    const [inbound] = emitsFor('wamid.IN1');
    assert.equal(inbound.msg.key.fromMe, false);
    assert.equal(inbound.instance.instanceId, INSTANCE_ID);
    assert.equal(emitsFor('wamid.OUT1').length, 0);
  });

  test('text echo reaches the chatbots as fromMe=true, in the same chat as the contact', () => {
    const [inbound] = emitsFor('wamid.IN1');
    const echoes = emitsFor('wamid.ECHO1');

    assert.equal(echoes.length, 1);
    const [textEcho] = echoes;
    assert.equal(textEcho.msg.key.fromMe, true);
    assert.equal(textEcho.remoteJid, inbound.remoteJid);
    assert.equal(textEcho.msg.message.conversation, 'Sou eu, humano');
    assert.equal(textEcho.msg.messageTimestamp, 1761750100);
    assert.deepEqual(textEcho.instance, { instanceName: 'cloud', instanceId: INSTANCE_ID });
  });

  test('image echo keeps the caption and carries the alternative Brazilian jid', () => {
    const [imageEcho] = emitsFor('wamid.ECHO2');
    assert.equal(imageEcho.msg.key.fromMe, true);
    assert.equal(imageEcho.msg.messageType, 'imageMessage');
    assert.equal(imageEcho.msg.message.imageMessage.caption, 'foto');
    assert.match(imageEcho.remoteJid, /^5531(9?)87654321@s\.whatsapp\.net$/);
    assert.match(imageEcho.msg.key.remoteJidAlt, /^5531(9?)87654321@s\.whatsapp\.net$/);
    assert.notEqual(imageEcho.msg.key.remoteJidAlt, imageEcho.remoteJid);
  });

  test('revoke echoes are not handed to the chatbots', () => {
    assert.equal(emitsFor('wamid.ECHO3').length, 0);
  });

  test('echo is sent as MESSAGES_UPSERT fromMe=true and saved without remoteJidAlt in the key', () => {
    assert.ok(
      webhooks.some((w) => w.event === 'messages.upsert' && w.data.key.id === 'wamid.ECHO1' && w.data.key.fromMe),
    );
    const saved = createdMessages.find((m) => m.key.id === 'wamid.ECHO1');
    assert.equal(saved.source, 'unknown');
    assert.ok(!createdMessages.some((m) => 'remoteJidAlt' in m.key));
  });

  test('an echo redelivered by Meta is ignored', async () => {
    await post(echo('wamid.ECHO1', '5511987654321'));
    assert.equal(emitsFor('wamid.ECHO1').length, 1);
  });

  test('an echo of a message sent by the bot is ignored', async () => {
    await registerBotMessageId(INSTANCE_ID, 'wamid.BOT1');
    await post(echo('wamid.BOT1', '5511987654321'));
    assert.equal(emitsFor('wamid.BOT1').length, 0);
  });

  test('two changes in the same POST keep their own contact', async () => {
    delayLookups = true; // slow lookups would expose a contact shared between changes
    await controller.receiveWebhook({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WABA-1',
          changes: [
            textMessageChange('5511911111111', 'wamid.A', 'sou A'),
            textMessageChange('5521922222222', 'wamid.B', 'sou B'),
          ],
        },
      ],
    });

    const [a] = await waitFor(() => (emitsFor('wamid.A').length ? emitsFor('wamid.A') : null), 3000, 'wamid.A');
    const [b] = await waitFor(() => (emitsFor('wamid.B').length ? emitsFor('wamid.B') : null), 3000, 'wamid.B');

    assert.match(a.remoteJid, /^5511(9?)11111111@s\.whatsapp\.net$/);
    assert.match(b.remoteJid, /^5521(9?)22222222@s\.whatsapp\.net$/);
    assert.equal(a.msg.message.conversation, 'sou A');
    assert.equal(b.msg.message.conversation, 'sou B');
  });

  test('textMessage flagged fromChatbot registers the returned wamid; a plain send does not', async () => {
    service.post = async () => ({ messaging_product: 'whatsapp', messages: [{ id: 'wamid.SENT1' }] });
    await service.textMessage({ number: '5511987654321', text: 'resposta do bot' }, false, true);
    assert.equal(await isBotMessageId(INSTANCE_ID, 'wamid.SENT1'), true);

    service.post = async () => ({ messaging_product: 'whatsapp', messages: [{ id: 'wamid.SENT2' }] });
    await service.textMessage({ number: '5511987654321', text: 'envio manual pela API' });
    assert.equal(await isBotMessageId(INSTANCE_ID, 'wamid.SENT2'), false);
  });

  test('no unhandled rejections', () => {
    assert.deepEqual(unhandled, []);
  });
});
