import '../helpers/setup';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { unwrapMessageContent } from '@utils/unwrapMessageContent';

describe('unwrapMessageContent (#2773)', () => {
  test('a disappearing text is unwrapped and keeps the top level messageContextInfo', () => {
    const message: any = {
      ephemeralMessage: {
        message: { extendedTextMessage: { text: 'oi', contextInfo: { expiration: 604800 } } },
      },
      messageContextInfo: { messageSecret: 'abc' },
    };

    assert.deepEqual(unwrapMessageContent(message), {
      extendedTextMessage: { text: 'oi', contextInfo: { expiration: 604800 } },
      messageContextInfo: { messageSecret: 'abc' },
    });
  });

  test('the inner messageContextInfo wins over the outer one', () => {
    const message: any = {
      viewOnceMessageV2: { message: { imageMessage: { url: 'u' }, messageContextInfo: { messageSecret: 'inner' } } },
      messageContextInfo: { messageSecret: 'outer' },
    };
    assert.deepEqual(unwrapMessageContent(message).messageContextInfo, { messageSecret: 'inner' });
  });

  test('nested wrappers and documentWithCaptionMessage are unwrapped', () => {
    const message: any = {
      ephemeralMessage: {
        message: { documentWithCaptionMessage: { message: { documentMessage: { caption: 'contrato' } } } },
      },
    };
    assert.deepEqual(unwrapMessageContent(message), { documentMessage: { caption: 'contrato' } });
  });

  test('plain messages are returned as they are', () => {
    const plain: any = { conversation: 'oi' };
    assert.equal(unwrapMessageContent(plain), plain);
    assert.equal(unwrapMessageContent(null), null);
    assert.equal(unwrapMessageContent(undefined), undefined);
  });

  test('an empty wrapper keeps the original message', () => {
    const message: any = { ephemeralMessage: {} };
    assert.equal(unwrapMessageContent(message), message);
  });
});
