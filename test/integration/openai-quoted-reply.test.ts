import '../helpers/setup';

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import { textMsg, waitFor } from '../helpers/fakes';
import { OpenaiHarness, SKIP_INTEGRATION } from '../helpers/integration';

/**
 * #2078 end to end on a real database: a reply to an older message reaches OpenAI with
 * `[respondendo a: "..."]`, through the debounce merge and into the stored history, and the finish keyword
 * still works when it is sent as a reply.
 */
describe('OpenAI bot: quoted replies (integration)', { skip: SKIP_INTEGRATION }, () => {
  let h: OpenaiHarness;

  before(async () => {
    h = await new OpenaiHarness().start();
  });

  after(async () => {
    await h?.stop();
  });

  beforeEach(() => {
    h.openai.reset();
  });

  const userText = (request: any) => {
    const content = request.messages.at(-1).content;
    return Array.isArray(content) ? content.map((part: any) => part.text).join('\n') : content;
  };

  const quoting = (remoteJid: string, text: string, quoted: any) => ({
    ...textMsg(remoteJid, text),
    contextInfo: { stanzaId: 'QUOTED-1', participant: remoteJid, quotedMessage: quoted },
  });

  test('a reply carries the quoted text to the model and into the history', async () => {
    const t = await h.createTenant();
    const jid = t.contact();

    await h.controller.emit({
      instance: t.instance,
      remoteJid: jid,
      msg: quoting(jid, 'pode ser amanhã?', { conversation: 'Temos horário na quinta às 14h.' }),
    });

    assert.equal(
      userText(h.openai.requests[0]),
      '[respondendo a: "Temos horário na quinta às 14h."]\npode ser amanhã?',
    );
    assert.equal(t.texts().length, 1);

    const history = JSON.parse((await t.session(jid)).context as string).history;
    assert.match(JSON.stringify(history[0]), /respondendo a: \\"Temos horário na quinta às 14h.\\"/);
  });

  test('debounce: each message keeps its own quote, merged in order', async () => {
    const t = await h.createTenant({ settings: { debounceTime: 1 } });
    const jid = t.contact();

    await t.client(jid, 'oi');
    await h.controller.emit({
      instance: t.instance,
      remoteJid: jid,
      msg: quoting(jid, 'essa aqui', { imageMessage: { caption: 'boleto de outubro' } }),
    });

    await waitFor(() => t.texts().length === 1, 8000, 'debounced answer');

    assert.equal(h.openai.requests.length, 1);
    assert.equal(userText(h.openai.requests[0]), 'oi\n[respondendo a uma foto: "boleto de outubro"]\nessa aqui');
  });

  test('the finish keyword sent as a reply still ends the session (no OpenAI call)', async () => {
    const t = await h.createTenant();
    const jid = t.contact();
    await t.client(jid, 'oi');
    const requests = h.openai.requests.length;

    await h.controller.emit({
      instance: t.instance,
      remoteJid: jid,
      msg: quoting(jid, '#sair', { conversation: 'Posso ajudar em algo mais?' }),
    });

    assert.equal(h.openai.requests.length, requests);
    assert.equal(await t.session(jid), null, 'keepOpen off: the session is removed');
  });
});
