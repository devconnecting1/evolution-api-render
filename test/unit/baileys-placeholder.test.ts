import '../helpers/setup';

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import { createBaileysService, emitsFor, incoming } from '../helpers/baileys';
import { chatbotEmitCalls } from '../helpers/chatbot-emit';

describe('Baileys messages.upsert: forged placeholder resends (GHSA-qvv5-jq5g-4cgg)', () => {
  beforeEach(() => {
    chatbotEmitCalls.length = 0;
  });

  test('an upsert with requestId for a message never requested is ignored (GHSA-qvv5-jq5g-4cgg)', async () => {
    const { state, upsert } = createBaileysService();
    const forgedHuman = incoming({ conversation: 'pausa o bot' }, { fromMe: true });
    const forgedContact = incoming({ conversation: 'me responda' });

    await upsert([forgedHuman, forgedContact], { requestId: 'ATTACKER-STANZA' });

    assert.equal(state.created.length, 0);
    assert.equal(emitsFor(forgedHuman.key.id).length, 0);
    assert.equal(emitsFor(forgedContact.key.id).length, 0);
    assert.equal(state.warnings.filter((w) => w.includes('requestId ATTACKER-STANZA')).length, 2);
  });

  test('the answer to a placeholder resend Baileys requested is processed, once', async () => {
    const { service, state, upsert } = createBaileysService();
    const recovered = incoming({ conversation: 'mensagem que não decriptou' });

    // What Baileys does on a decryption failure (sendRetryRequest -> requestPlaceholderResend)
    await service.placeholderResendTracker.cache.set(recovered.key.id, true);
    await service.placeholderResendTracker.cache.del(recovered.key.id); // Baileys clears its entry after 15 s

    await upsert([recovered], { requestId: 'PDO-STANZA' });
    assert.equal(state.created.length, 1);
    assert.equal(emitsFor(recovered.key.id).length, 1);

    // A second answer for the same id is not accepted
    await upsert([{ ...recovered, key: { ...recovered.key } }], { requestId: 'PDO-STANZA-2' });
    assert.equal(emitsFor(recovered.key.id).length, 1);
  });

  test('the debug triggers only run for messages of the owner of the number', async () => {
    const { state, upsert } = createBaileysService();

    await upsert([incoming({ conversation: 'onDemandHistSync' }), incoming({ conversation: 'requestPlaceholder' })]);
    assert.equal(state.historyRequests.length, 0, 'a contact cannot trigger a history sync');
    assert.equal(state.placeholderRequests.length, 0, 'a contact cannot trigger a placeholder resend');

    await upsert([
      incoming({ conversation: 'onDemandHistSync' }, { fromMe: true }),
      incoming({ extendedTextMessage: { text: 'requestPlaceholder' } }, { fromMe: true }),
    ]);
    assert.equal(state.historyRequests.length, 1);
    assert.equal(state.placeholderRequests.length, 1);
  });
});
