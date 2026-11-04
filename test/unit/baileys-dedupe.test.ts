import '../helpers/setup';

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import { createBaileysService, incoming } from '../helpers/baileys';
import { chatbotEmitCalls } from '../helpers/chatbot-emit';

describe('Baileys messages.upsert: redelivery (#2737)', () => {
  beforeEach(() => {
    chatbotEmitCalls.length = 0;
  });

  test('a redelivered key.id is not stored twice (#2737)', async () => {
    const { state, upsert } = createBaileysService();
    const message = incoming({ conversation: 'oi' });

    await upsert([message]);
    await upsert([{ ...message, key: { ...message.key } }]);

    assert.equal(state.created.filter((m) => m.key.id === message.key.id).length, 1);
  });
});
