import '../helpers/setup';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isBotMessageId } from '@utils/botMessageRegistry';

import { createBaileysService, INSTANCE_ID } from '../helpers/baileys';

/** #2664: the automatic call reply (msgCall) only goes out when the call is rejected (rejectCall). */
describe('Baileys incoming call', () => {
  const offer = () => ({ id: 'CALL-1', from: '5511987654321@s.whatsapp.net', status: 'offer' });

  test('rejectCall off: no rejection and no message, even with a msgCall text', async () => {
    const { service, state } = createBaileysService();
    await service.callHandle(offer(), { rejectCall: false, msgCall: 'Não atendemos ligações.' });

    assert.equal(state.rejected.length, 0);
    assert.equal(state.sent.length, 0);
  });

  test('rejectCall on with msgCall: rejects and answers with an id registered as a bot message', async () => {
    const { service, state } = createBaileysService();
    await service.callHandle(offer(), { rejectCall: true, msgCall: 'Não atendemos ligações.' });

    assert.deepEqual(state.rejected, [['CALL-1', '5511987654321@s.whatsapp.net']]);
    assert.equal(state.sent.length, 1);
    assert.equal(state.sent[0].content.text, 'Não atendemos ligações.');
    assert.equal(await isBotMessageId(INSTANCE_ID, state.sent[0].options.messageId), true, 'never pauses the bot');
  });

  test('rejectCall on with an empty msgCall: rejects without a message', async () => {
    const { service, state } = createBaileysService();
    await service.callHandle(offer(), { rejectCall: true, msgCall: '   ' });

    assert.equal(state.rejected.length, 1);
    assert.equal(state.sent.length, 0);
  });

  test('only offers are handled', async () => {
    const { service, state } = createBaileysService();
    await service.callHandle({ ...offer(), status: 'terminate' }, { rejectCall: true, msgCall: 'x' });

    assert.equal(state.rejected.length, 0);
    assert.equal(state.sent.length, 0);
  });
});
