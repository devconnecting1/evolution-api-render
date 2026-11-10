import '../helpers/setup';

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { setProcessAiContextProvider } from '@utils/processos/aiContext';

import { waitFor } from '../helpers/fakes';
import { OpenaiHarness, SKIP_INTEGRATION } from '../helpers/integration';

/** The OpenAI bot receives the "Processos" block only when the contact asks about a process, never saved in history. */
describe('Processos: AI context in the OpenAI bot (integration)', { skip: SKIP_INTEGRATION }, () => {
  let h: OpenaiHarness;
  const asked: string[] = [];

  before(async () => {
    h = await new OpenaiHarness().start();
    setProcessAiContextProvider(async (_instanceId, remoteJid) => {
      asked.push(remoteJid);
      return remoteJid.startsWith('5511900000001')
        ? 'Contexto do escritório: Processo nº X: atualizações registradas em 08/11/2026.'
        : null;
    });
  });

  after(async () => {
    setProcessAiContextProvider(null);
    await h?.stop();
  });

  test('block added right before the question of the linked contact; not for other topics; not stored', async () => {
    const t = await h.createTenant();
    const jid = '5511900000001@s.whatsapp.net';
    h.openai.reply('Houve uma atualização em 08/11/2026. Posso encaminhar ao advogado?', 'Atendemos das 9h às 18h.');

    await t.client(jid, 'Oi, tem novidade no meu processo?');
    await waitFor(() => h.openai.requests.length >= 1, 5000, 'first completion');
    const messages = h.openai.requests[0].messages;
    assert.equal(messages.at(-2).role, 'system');
    assert.match(messages.at(-2).content, /Processo nº X/);
    assert.equal(messages.at(-1).role, 'user');

    await waitFor(async () => (await t.texts()).length >= 1, 5000, 'answer sent');
    await t.client(jid, 'Qual o horário de vocês?');
    await waitFor(() => h.openai.requests.length >= 2, 5000, 'second completion');
    const second = h.openai.requests[1].messages;
    assert.equal(
      second.filter((m: any) => /Contexto do escritório/.test(String(m.content))).length,
      0,
      'not in history',
    );
    assert.equal(asked.length, 1, 'provider only called when the text asks about a process');
  });
});
