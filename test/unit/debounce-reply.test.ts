import '../helpers/setup';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ChatbotController } from '@api/integrations/chatbot/chatbot.controller';
import { currentReplyTicket } from '@api/integrations/chatbot/reply-ticket';

import { sleep } from '../helpers/fakes';

/**
 * The debounce gives ONE reply per burst: a message that arrives while the previous reply is still being generated
 * (not sent yet) cancels it and both are answered together. Times are short (tens of ms) and the callback
 * reproduces the real order: model call, then the commit right before the first WhatsApp message.
 */
function harness(options: { modelMs?: number; typingMs?: number } = {}) {
  const controller = new ChatbotController({} as any, {} as any);
  const debounce: Record<string, any> = {};
  const sent: { key: string; text: string; at: number }[] = [];
  const started: string[] = [];
  let active = 0;
  let overlap = false;

  const reply = (key: string) => async (content: string) => {
    active++;
    if (active > 1) overlap = true;
    started.push(content);
    try {
      await sleep(options.modelMs ?? 40);
      const ticket = currentReplyTicket();
      if (ticket?.cancelled) return;
      await sleep(options.typingMs ?? 0);
      if (ticket && !ticket.tryCommit()) return;
      sent.push({ key, text: content, at: Date.now() });
    } finally {
      active--;
    }
  };

  const message = (key: string, text: string, seconds = 0.02) =>
    controller.processDebounce(debounce, text, key, seconds, reply(key));

  return { controller, message, sent, started, overlap: () => overlap };
}

describe('debounce: one reply per customer turn', () => {
  test('messages inside the window are joined', async () => {
    const h = harness();
    h.message('i:a', 'oi');
    h.message('i:a', 'tudo bem?');
    await sleep(30);
    await h.controller.idleReplies();
    assert.deepEqual(
      h.sent.map((item) => item.text),
      ['oi\ntudo bem?'],
    );
  });

  test('a message during the model call cancels the pending reply: one merged answer', async () => {
    const h = harness({ modelMs: 60 });
    h.message('i:a', 'meu plano negou a cirurgia');
    await sleep(40); // window fired, the model is "thinking"
    h.message('i:a', 'o plano é Assim');
    await sleep(30);
    await h.controller.idleReplies();
    assert.deepEqual(
      h.sent.map((item) => item.text),
      ['meu plano negou a cirurgia\no plano é Assim'],
    );
    assert.equal(h.controller.mergedReplies, 1);
  });

  test('a message during the typing delay (before sending) is merged too', async () => {
    const h = harness({ modelMs: 10, typingMs: 60 });
    h.message('i:a', 'primeira');
    await sleep(45);
    h.message('i:a', 'segunda');
    await sleep(30);
    await h.controller.idleReplies();
    assert.deepEqual(
      h.sent.map((item) => item.text),
      ['primeira\nsegunda'],
    );
  });

  test('a message after the reply started sending gets its own reply, strictly after it', async () => {
    const h = harness({ modelMs: 10, typingMs: 0 });
    h.message('i:a', 'primeira');
    await sleep(40); // reply committed
    h.message('i:a', 'segunda');
    await sleep(30);
    await h.controller.idleReplies();
    assert.deepEqual(
      h.sent.map((item) => item.text),
      ['primeira', 'segunda'],
    );
    assert.equal(h.overlap(), false, 'replies of one chat never overlap');
  });

  test('two contacts never share a window or a reply', async () => {
    const h = harness();
    h.message('i:a', 'a1');
    h.message('i:b', 'b1');
    h.message('i:a', 'a2');
    await sleep(30);
    await h.controller.idleReplies();
    assert.deepEqual(h.sent.map((item) => `${item.key}=${item.text}`).sort(), ['i:a=a1\na2', 'i:b=b1']);
  });

  test('the rollback of a cancelled reply runs before the merged reply starts', async () => {
    const controller = new ChatbotController({} as any, {} as any);
    const debounce: Record<string, any> = {};
    const events: string[] = [];
    const callback = async (content: string) => {
      const ticket = currentReplyTicket();
      events.push(`start:${content.replace('\n', '+')}`);
      ticket?.onRollback(() => void events.push(`rollback:${content}`));
      await sleep(40);
      if (ticket?.tryCommit()) events.push(`send:${content.replace('\n', '+')}`);
    };
    controller.processDebounce(debounce, 'a', 'k', 0.01, callback);
    await sleep(25);
    controller.processDebounce(debounce, 'b', 'k', 0.01, callback);
    await sleep(20);
    await controller.idleReplies();
    assert.deepEqual(events, ['start:a', 'rollback:a', 'start:a+b', 'send:a+b']);
  });
});
