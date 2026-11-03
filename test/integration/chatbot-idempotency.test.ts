import '../helpers/setup';

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import { ChatbotController } from '@api/integrations/chatbot/chatbot.controller';
import { registerBotMessageId } from '@utils/botMessageRegistry';

import { serverModuleOverrides } from '../helpers/chatbot-emit';
import { nextId, textMsg } from '../helpers/fakes';
import { OpenaiHarness, SKIP_INTEGRATION } from '../helpers/integration';

/**
 * #2737: WhatsApp (and Meta) redeliver the same message id. The real ChatbotController fans the message out to
 * the real OpenAI bot on a real database; a redelivery must not be answered, billed or stored twice, and the
 * human pause (fromMe echoes, bot message registry) must keep working.
 */
describe('Chatbot fan-out: one answer per message id (integration)', { skip: SKIP_INTEGRATION }, () => {
  let h: OpenaiHarness;
  let chatbot: ChatbotController;
  const pending: Promise<unknown>[] = [];

  before(async () => {
    h = await new OpenaiHarness().start();
    // ChatbotController.emit reaches the bots through server.module (stubbed by setup.ts): plug the real OpenAI
    // controller in and keep its (not awaited) promises so each test can wait for them
    serverModuleOverrides.openaiController = {
      emit: (data: any) => {
        const promise = h.controller.emit(data);
        pending.push(promise);
        return promise;
      },
    };
    chatbot = new ChatbotController(h.prisma, h.waMonitor);
  });

  after(async () => {
    delete serverModuleOverrides.openaiController;
    await h?.stop();
  });

  beforeEach(() => {
    h.openai.reset();
  });

  const emit = async (instance: any, msg: any) => {
    await chatbot.emit({ instance, remoteJid: msg.key.remoteJid, msg, pushName: msg.pushName });
    await Promise.all(pending.splice(0));
  };

  test('the same contact message delivered twice is answered once', async () => {
    const t = await h.createTenant();
    const jid = t.contact();
    const msg = textMsg(jid, 'Qual o horário de atendimento?');

    await emit(t.instance, msg);
    await emit(t.instance, structuredClone(msg));

    assert.equal(h.openai.requests.length, 1, 'OpenAI called once');
    assert.deepEqual(t.texts(), ['resposta 1'], 'one answer sent');
    const session = await t.session(jid);
    assert.equal(JSON.parse(session.context as string).history.length, 2, 'question stored once');

    // A new message (new id) is still answered
    await emit(t.instance, textMsg(jid, 'E aos sábados?'));
    assert.equal(h.openai.requests.length, 2);
  });

  test('the same id on another instance is processed by that instance', async () => {
    const a = await h.createTenant();
    const b = await h.createTenant();
    const id = nextId('MSG');

    await emit(a.instance, textMsg(a.contact(), 'oi', { id }));
    await emit(b.instance, textMsg(b.contact(), 'oi', { id }));

    assert.equal(h.openai.requests.length, 2);
  });

  test('a redelivered human message pauses once and never moves the pause', async () => {
    const t = await h.createTenant({ settings: { humanResumeMinutes: 30 } });
    const jid = t.contact();
    await emit(t.instance, textMsg(jid, 'oi'));

    const humanAt = Math.floor(Date.now() / 1000) - 60;
    const human = textMsg(jid, 'Deixa comigo', { fromMe: true, timestamp: humanAt });
    await emit(t.instance, human);

    const paused = await t.session(jid);
    assert.equal(paused.status, 'paused');
    assert.equal((paused.parameters as any).humanLastMessageAt, new Date(humanAt * 1000).toISOString());

    await emit(t.instance, { ...structuredClone(human), messageTimestamp: humanAt + 3000 });
    const after = await t.session(jid);
    assert.equal(after.updatedAt.getTime(), paused.updatedAt.getTime(), 'redelivery wrote nothing');
    assert.deepEqual(after.parameters, paused.parameters);

    await h.waitForStatusEvents(t, 1);
    assert.equal(t.statusEvents().length, 1, 'only one pause notified');

    // The contact stays without an answer during the pause
    await emit(t.instance, textMsg(jid, 'alô?'));
    assert.equal(h.openai.requests.length, 1);
  });

  test('an echo of a bot message is still not a human message', async () => {
    const t = await h.createTenant();
    const jid = t.contact();
    await emit(t.instance, textMsg(jid, 'oi'));

    const botId = nextId('3EB0');
    await registerBotMessageId(t.instance.instanceId, botId);
    await emit(t.instance, textMsg(jid, 'resposta 1', { fromMe: true, id: botId }));
    // and its redelivery
    await emit(t.instance, textMsg(jid, 'resposta 1', { fromMe: true, id: botId }));

    assert.equal((await t.session(jid)).status, 'opened');
    await emit(t.instance, textMsg(jid, 'obrigado'));
    assert.equal(h.openai.requests.length, 2);
  });
});
