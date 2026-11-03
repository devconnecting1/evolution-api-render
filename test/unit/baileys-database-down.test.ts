import '../helpers/setup';

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import { getMessageStoreFailures, resetMessageStoreFailures } from '@utils/messageStoreFailures';

import { createBaileysService, emitsFor, incoming } from '../helpers/baileys';
import { chatbotEmitCalls } from '../helpers/chatbot-emit';

/**
 * #2714: with the database unreachable (Neon waking up, P1001) a message used to vanish without a trace: no
 * webhook, no answer and a generic log. Now the failure is loud (key.id + Prisma code), counted for the
 * observability card, and the message still reaches the chatbots.
 */
describe('Baileys: database errors do not drop incoming messages in silence (#2714)', () => {
  beforeEach(() => {
    chatbotEmitCalls.length = 0;
    resetMessageStoreFailures();
  });

  test('the insert fails with P1001: logged with key.id and code, counted, and the bots still get it', async () => {
    const { state, upsert } = createBaileysService();
    const message = incoming({ conversation: 'Bom dia, preciso de ajuda' });
    state.failCreateFor.add(message.key.id);
    state.failCreateCode = 'P1001';

    await upsert([message]);

    assert.equal(emitsFor(message.key.id).length, 1, 'the chatbots still get the message');
    assert.ok(
      state.errors.some((e) => e.includes(message.key.id) && e.includes('P1001') && e.includes('not stored')),
      JSON.stringify(state.errors),
    );
    const failures = getMessageStoreFailures();
    assert.equal(failures.count, 1);
    assert.equal(failures.lastCode, 'P1001');
  });

  test('settings unreadable: the event batch is handled with the cached settings instead of being dropped', async () => {
    const { service, state } = createBaileysService();
    let processEvents: (events: any) => void;
    service.client.ev.process = (handler: any) => {
      processEvents = handler;
    };
    service.findSettings = async () => {
      throw Object.assign(new Error("Can't reach database server"), { code: 'P1001' });
    };
    Object.assign(service.localSettings, { rejectCall: true, msgCall: '' });

    service.eventHandler();
    processEvents({ call: [{ id: 'CALL-9', from: '5511987654321@s.whatsapp.net', status: 'offer' }] });
    await service.eventProcessingQueue;

    assert.equal(state.rejected.length, 1, 'the call was handled with the cached settings');
    assert.ok(state.errors.some((e) => e.includes('P1001') && e.includes('cached settings')));
  });
});
