import '../helpers/setup';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createBaileysService, INSTANCE_ID } from '../helpers/baileys';

describe('Baileys getMessage (#2705)', () => {
  test('a missing row returns undefined (Baileys must not resend an empty message)', async () => {
    const { service } = createBaileysService();
    assert.equal(await service.getMessage({ id: 'NOPE' }), undefined);
    assert.equal(await service.getMessage({ id: 'NOPE' }, true), undefined);
  });

  test('a failing query returns undefined and logs a warning', async () => {
    const { service, state } = createBaileysService();
    state.failQuery = true;

    assert.equal(await service.getMessage({ id: 'X1' }), undefined);
    assert.equal(await service.getMessage({ id: 'X1' }, true), undefined);
    assert.ok(state.warnings.some((w) => w.includes('getMessage failed for X1')));
  });

  test('a key without id returns undefined without querying', async () => {
    const { service, state } = createBaileysService();
    assert.equal(await service.getMessage({}), undefined);
    assert.equal(await service.getMessage(undefined), undefined);
    assert.equal(state.queries, 0);
  });

  test('a stored row returns its message (or the whole row with full)', async () => {
    const { service, state } = createBaileysService();
    const row = { id: 'r1', instanceId: INSTANCE_ID, key: { id: 'M1' }, message: { conversation: 'oi' } };
    state.rows.push(row);

    assert.deepEqual(await service.getMessage({ id: 'M1' }), { conversation: 'oi' });
    assert.equal(await service.getMessage({ id: 'M1' }, true), row);
  });

  test('a poll keeps its messageSecret as a Buffer', async () => {
    const { service, state } = createBaileysService();
    const secret = Buffer.from('0123456789abcdef0123456789abcdef');
    state.rows.push({
      id: 'r2',
      instanceId: INSTANCE_ID,
      key: { id: 'POLL1' },
      message: {
        pollCreationMessage: { name: 'Enquete', options: [{ optionName: 'A' }] },
        messageContextInfo: { messageSecret: secret.toString('base64') },
      },
    });

    const result: any = await service.getMessage({ id: 'POLL1' });
    assert.ok(Buffer.isBuffer(result.messageContextInfo.messageSecret));
    assert.deepEqual(result.messageContextInfo.messageSecret, secret);
    assert.equal(result.pollCreationMessage.name, 'Enquete');
  });
});
