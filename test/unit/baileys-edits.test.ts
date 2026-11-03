import '../helpers/setup';

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import { proto } from 'baileys';

import { createBaileysService, emitsFor, incoming, INSTANCE_ID } from '../helpers/baileys';
import { chatbotEmitCalls } from '../helpers/chatbot-emit';

/**
 * #2672: only a MESSAGE_EDIT protocol message is an edit. It updates the stored message and is never handed to
 * the chatbots as a new message; other protocol messages (revoke, disappearing setting...) touch nothing.
 */
const Type = proto.Message.ProtocolMessage.Type;
const ORIGINAL = { id: 'ORIGINAL-1', remoteJid: '5511987654321@s.whatsapp.net', fromMe: false };

describe('Baileys messages.upsert: edits and other protocol messages (#2672)', () => {
  let ctx: ReturnType<typeof createBaileysService>;

  beforeEach(() => {
    chatbotEmitCalls.length = 0;
    ctx = createBaileysService();
    ctx.state.rows.push({
      id: 'row-original',
      instanceId: INSTANCE_ID,
      key: ORIGINAL,
      message: { conversation: 'oi' },
    });
  });

  const messageUpdates = () => ctx.state.updates.filter((u) => u.model === 'message');
  const edited = () => ctx.state.webhooks.filter((w) => w.event === 'messages.edited');

  test('a MESSAGE_EDIT updates the stored message and is not a new message for the bots', async () => {
    const edit = incoming({
      protocolMessage: { type: Type.MESSAGE_EDIT, key: ORIGINAL, editedMessage: { conversation: 'oi, corrigido' } },
    });

    await ctx.upsert([edit]);

    const [update] = messageUpdates();
    assert.equal(update.args.where.id, 'row-original');
    assert.deepEqual(update.args.data.message, { conversation: 'oi, corrigido' });
    assert.equal(update.args.data.status, 'EDITED');
    assert.equal(edited().length, 1);
    assert.equal(emitsFor(edit.key.id).length, 0, 'the AI does not answer an edit');
    assert.equal(ctx.state.created.length, 0);
  });

  test('an edit inside the editedMessage wrapper is handled the same way', async () => {
    const edit = incoming({
      editedMessage: {
        message: {
          protocolMessage: { type: Type.MESSAGE_EDIT, key: ORIGINAL, editedMessage: { conversation: 'editado' } },
        },
      },
    });

    await ctx.upsert([edit]);

    assert.deepEqual(messageUpdates()[0].args.data.message, { conversation: 'editado' });
    assert.equal(emitsFor(edit.key.id).length, 0);
    assert.equal(ctx.state.created.length, 0);
  });

  test('an editedMessage wrapper without protocol message is still not a new message', async () => {
    const edit = incoming({ editedMessage: { message: { conversation: 'conteúdo editado' } } });

    await ctx.upsert([edit]);

    assert.equal(emitsFor(edit.key.id).length, 0);
    assert.equal(ctx.state.created.length, 0);
  });

  test('an edit without readable content does not wipe the stored message', async () => {
    await ctx.upsert([incoming({ protocolMessage: { type: Type.MESSAGE_EDIT, key: ORIGINAL } })]);

    assert.equal(messageUpdates().length, 0);
  });

  for (const [name, type] of [
    ['REVOKE (delete for everyone)', Type.REVOKE],
    ['EPHEMERAL_SETTING (disappearing messages turned on)', Type.EPHEMERAL_SETTING],
  ] as const) {
    test(`${name} is not an edit and reaches nothing`, async () => {
      const message = incoming({ protocolMessage: { type, key: ORIGINAL, ephemeralExpiration: 86400 } });

      await ctx.upsert([message]);

      assert.equal(messageUpdates().length, 0, 'stored message untouched');
      assert.equal(edited().length, 0, 'no messages.edited webhook');
      assert.equal(emitsFor(message.key.id).length, 0);
      assert.equal(ctx.state.created.length, 0);
    });
  }
});
