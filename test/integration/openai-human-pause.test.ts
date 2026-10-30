import '../helpers/setup';

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import { apiError, sleep, waitFor } from '../helpers/fakes';
import { OpenaiHarness, SKIP_INTEGRATION, UNKNOWN_MESSAGE } from '../helpers/integration';

/**
 * Human takeover of the OpenAI bot, end to end on a real database (scenarios of the PR #1 test plan).
 * The WhatsApp channel and OpenAI are fakes; everything else (controller, service, Prisma, migrations) is real.
 */
const MIN = 60_000;

describe('OpenAI bot: human pause (integration)', { skip: SKIP_INTEGRATION }, () => {
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

  const lastUserText = (request: any) => {
    const content = request.messages.at(-1).content;
    return Array.isArray(content) ? content.map((part: any) => part.text).join(' ') : content;
  };

  test('1) the contact writes and the bot answers', async () => {
    const t = await h.createTenant();
    const jid = t.contact();
    h.openai.reply('Olá! Como posso ajudar?');

    await t.client(jid, 'oi');

    assert.deepEqual(t.texts(), ['Olá! Como posso ajudar?']);
    assert.equal(t.wa.sent[0].data.number, jid.split('@')[0]);
    assert.equal(t.wa.sent[0].fromChatbot, true);

    const request = h.openai.requests[0];
    assert.equal(request.model, 'gpt-4o-mini');
    assert.equal(request.max_tokens, 300);
    assert.equal(request.messages[0].role, 'system');
    assert.equal(lastUserText(request), 'oi');

    const session = await t.session(jid);
    assert.equal(session.status, 'opened');
    assert.equal(session.awaitUser, true);
    assert.equal(session.type, 'openai');
    assert.equal(session.botId, t.bot.id);
    assert.equal(JSON.parse(session.context as string).history.length, 2);
    assert.deepEqual(t.statusEvents(), [], 'no change status webhook for a normal answer');
  });

  test('3/4) a human fromMe pauses the session; the next contact message is ignored without any write', async () => {
    const t = await h.createTenant();
    const jid = t.contact();
    await t.client(jid, 'oi');

    const humanAt = Math.floor(Date.now() / 1000);
    await t.human(jid, 'Oi, aqui é o advogado. Pode deixar que eu respondo.', { timestamp: humanAt });

    const paused = await t.session(jid);
    assert.equal(paused.status, 'paused');
    assert.equal((paused.parameters as any).humanLastMessageAt, new Date(humanAt * 1000).toISOString());

    const requestsBefore = h.openai.requests.length;
    await t.client(jid, 'alô? tem alguém aí?');
    await sleep(100);

    const after = await t.session(jid);
    assert.equal(h.openai.requests.length, requestsBefore, 'OpenAI not called');
    assert.deepEqual(t.texts(), ['resposta 1'], 'nothing else sent');
    assert.equal(after.updatedAt.getTime(), paused.updatedAt.getTime(), 'updatedAt untouched');
    assert.deepEqual(after.parameters, paused.parameters);
    assert.equal(after.status, 'paused');
  });

  test('4b) every human message extends the pause, never backwards; only the transition is notified', async () => {
    const t = await h.createTenant({ settings: { humanResumeMinutes: 30 } });
    const jid = t.contact();
    await t.client(jid, 'oi');

    const first = Math.floor(Date.now() / 1000) - 120;
    await t.human(jid, 'primeira', { timestamp: first });
    await t.human(jid, 'segunda', { timestamp: first + 60 });
    // An old message delivered late (e.g. after a reconnection) must not move the timestamp back
    await t.human(jid, 'atrasada', { timestamp: first - 600 });
    // A timestamp in the future is capped to now
    await t.human(jid, 'futuro', { timestamp: Math.floor(Date.now() / 1000) + 3600 });

    const session = await t.session(jid);
    const last = Date.parse((session.parameters as any).humanLastMessageAt);
    assert.ok(last <= Date.now() && last > Date.now() - 5000, 'future timestamp capped to now');

    await h.waitForStatusEvents(t, 1);
    await sleep(100);
    const events = t.statusEvents();
    assert.equal(events.length, 1, 'only the transition to paused is notified');
    assert.equal(events[0].status, 'paused');
    assert.equal(events[0].reason, 'human');
    assert.equal(events[0].remoteJid, jid);
    assert.deepEqual(events[0].session, { id: session.id, botId: t.bot.id });
    assert.equal(events[0].humanPause.reason, 'human');
    assert.equal(events[0].humanPause.resumeMinutes, 30);
    assert.equal(events[0].humanPause.autoResume, true);
  });

  test('4c) the stored timestamp never moves backwards', async () => {
    const t = await h.createTenant();
    const jid = t.contact();
    await t.client(jid, 'oi');

    const now = Math.floor(Date.now() / 1000);
    await t.human(jid, 'nova', { timestamp: now - 10 });
    await t.human(jid, 'velha', { timestamp: now - 900 });

    const session = await t.session(jid);
    assert.equal((session.parameters as any).humanLastMessageAt, new Date((now - 10) * 1000).toISOString());
  });

  test('5) a human writes before any session exists: a paused session is created and the bot stays out', async () => {
    const t = await h.createTenant();
    const jid = t.contact();

    await t.human(jid, 'Bom dia! Aqui é do escritório.');

    const sessions = await t.sessions(jid);
    assert.equal(sessions.length, 1);
    const [session] = sessions;
    assert.equal(session.status, 'paused');
    assert.equal(session.pushName, null, 'the owner name is not stored as the contact name');
    assert.equal(session.sessionId, jid);
    assert.equal(session.botId, t.bot.id);
    assert.equal(session.type, 'openai');
    assert.ok((session.parameters as any).humanLastMessageAt);

    await t.client(jid, 'bom dia, quero falar sobre meu processo');
    await sleep(100);
    assert.equal(h.openai.requests.length, 0);
    assert.deepEqual(t.wa.sent, []);

    await h.waitForStatusEvents(t, 1);
    assert.equal(t.statusEvents()[0].reason, 'human');
    assert.deepEqual(t.statusEvents()[0].session, { id: session.id, botId: t.bot.id });
  });

  test('6) humanResumeMinutes=1: once expired, the session reopens and answers that very message', async () => {
    const t = await h.createTenant({ settings: { humanResumeMinutes: 1 } });
    const jid = t.contact();
    await t.client(jid, 'oi');
    await t.human(jid, 'deixa comigo');

    // Not expired yet: ignored
    await t.client(jid, 'ainda aí?');
    assert.equal(h.openai.requests.length, 1);

    const { id } = await t.session(jid);
    await h.ageHumanPause(id, 61 * 1000);

    h.openai.reply('Voltei! Em que posso ajudar?');
    await t.client(jid, 'preciso de ajuda com a petição');

    assert.equal(h.openai.requests.length, 2);
    assert.equal(lastUserText(h.openai.requests[1]), 'preciso de ajuda com a petição', 'the same message is answered');
    assert.deepEqual(t.texts(), ['resposta 1', 'Voltei! Em que posso ajudar?']);

    const session = await t.session(jid);
    assert.equal(session.status, 'opened');
    assert.equal((session.parameters as any)?.humanLastMessageAt, undefined, 'timestamp dropped on resume');

    await h.waitForStatusEvents(t, 2);
    const resumed = t.statusEvents()[1];
    assert.equal(resumed.status, 'opened');
    assert.equal(resumed.reason, 'resumed');
    assert.equal(resumed.humanPause, null);

    // Not paused again by the answer itself
    await t.client(jid, 'obrigado');
    assert.equal(h.openai.requests.length, 3);
  });

  test('6b) burst of 2 messages at the resume (no debounce): both are answered', async () => {
    const t = await h.createTenant({ settings: { humanResumeMinutes: 1 } });
    const jid = t.contact();
    await t.human(jid, 'oi, sou eu');
    const { id } = await t.session(jid);
    await h.ageHumanPause(id, 2 * MIN);

    h.openai.reply('resposta A', 'resposta B');
    await Promise.all([t.client(jid, 'mensagem 1'), t.client(jid, 'mensagem 2')]);

    assert.equal(h.openai.requests.length, 2);
    assert.deepEqual(h.openai.requests.map(lastUserText).sort(), ['mensagem 1', 'mensagem 2']);
    assert.deepEqual(t.texts().sort(), ['resposta A', 'resposta B']);
    assert.equal((await t.sessions(jid)).length, 1, 'no duplicated session');
    await h.waitForStatusEvents(t, 2);
    assert.equal(t.statusEvents().filter((e) => e.reason === 'resumed').length, 1, 'resumed once');
  });

  test('6c) burst of 2 messages at the resume (with debounce): one answer covering both', async () => {
    const t = await h.createTenant({ settings: { humanResumeMinutes: 1, debounceTime: 1 } });
    const jid = t.contact();
    await t.human(jid, 'oi, sou eu');
    const { id } = await t.session(jid);
    await h.ageHumanPause(id, 2 * MIN);

    await Promise.all([t.client(jid, 'mensagem 1'), t.client(jid, 'mensagem 2')]);
    await waitFor(() => t.texts().length === 1, 8000, 'debounced answer');
    await sleep(300);

    assert.equal(h.openai.requests.length, 1);
    const text = lastUserText(h.openai.requests[0]);
    assert.ok(text.includes('mensagem 1') && text.includes('mensagem 2'), text);
    assert.equal(t.texts().length, 1);
  });

  test('7) humanResumeMinutes=0 never resumes by itself; changeStatus opened reactivates', async () => {
    const t = await h.createTenant({ settings: { humanResumeMinutes: 0 } });
    const jid = t.contact();
    await t.client(jid, 'oi');
    await t.human(jid, 'assumi');
    const { id } = await t.session(jid);
    await h.ageHumanPause(id, 365 * 24 * 60 * MIN);

    await t.client(jid, 'olá?');
    assert.equal(h.openai.requests.length, 1, 'still paused after a year');

    await h.controller.changeStatus(t.instance, { remoteJid: jid, status: 'opened' });
    const reopened = await t.session(jid);
    assert.equal(reopened.status, 'opened');
    assert.deepEqual(reopened.parameters, {}, 'timestamp cleared');

    await t.client(jid, 'agora sim');
    assert.equal(h.openai.requests.length, 2);
    assert.equal((await t.session(jid)).status, 'opened', 'not paused again by an old timestamp');
  });

  test('7b) a bot with humanResumeMinutes=0 overrides settings > 0', async () => {
    const t = await h.createTenant({ settings: { humanResumeMinutes: 30 }, bot: { humanResumeMinutes: 0 } });
    const jid = t.contact();
    await t.human(jid, 'assumi');
    const { id } = await t.session(jid);
    await h.ageHumanPause(id, 60 * MIN);

    await t.client(jid, 'olá?');
    assert.equal(h.openai.requests.length, 0);
    assert.equal((await t.session(jid)).status, 'paused');
  });

  test('8) a fromMe echo of a message sent by the bot does not pause (nor feed the bot)', async () => {
    const t = await h.createTenant({ settings: { listeningFromMe: true } });
    const jid = t.contact();
    await t.client(jid, 'oi');
    const botMessage = t.wa.sent[0];

    await t.human(jid, botMessage.data.text, { id: botMessage.id });
    await sleep(100);

    const session = await t.session(jid);
    assert.equal(session.status, 'opened');
    assert.equal((session.parameters as any)?.humanLastMessageAt, undefined);
    assert.equal(h.openai.requests.length, 1, 'the echo is not sent to OpenAI');
    assert.deepEqual(t.statusEvents(), []);
  });

  test('8b) with stopBotFromMe off a human message does not pause', async () => {
    const t = await h.createTenant({ settings: { stopBotFromMe: false } });
    const jid = t.contact();
    await t.client(jid, 'oi');
    await t.human(jid, 'eu respondo também');

    assert.equal((await t.session(jid)).status, 'opened');
    await t.client(jid, 'ok');
    assert.equal(h.openai.requests.length, 2);
  });

  test('9) OpenAI error: the contact only gets unknownMessage', async () => {
    const t = await h.createTenant();
    const jid = t.contact();
    h.openai.reply(apiError(500, 'The server had an error while processing your request. req_abc123'));

    await t.client(jid, 'oi');

    assert.deepEqual(t.texts(), [UNKNOWN_MESSAGE]);
    assert.equal((await t.session(jid)).status, 'opened');
  });

  test('9b) OpenAI error without unknownMessage: nothing is sent', async () => {
    const t = await h.createTenant({ settings: { unknownMessage: '' } });
    const jid = t.contact();
    h.openai.reply(apiError(429, 'Rate limit reached for gpt-4o-mini'));

    await t.client(jid, 'oi');
    assert.deepEqual(t.wa.sent, []);
  });

  test('11) the human writes during the debounce window: the contact message is discarded', async () => {
    const t = await h.createTenant({ settings: { debounceTime: 1 } });

    // a) no session yet: the human creates a paused one during the window
    const jid = t.contact();
    await t.client(jid, 'oi, preciso de ajuda');
    await t.human(jid, 'oi! eu te ajudo');

    // b) existing session
    const jid2 = t.contact();
    h.openai.reply('primeira resposta');
    await t.client(jid2, 'oi');
    await waitFor(() => t.texts().length === 1, 5000, 'first answer');
    await t.client(jid2, 'e agora?');
    await t.human(jid2, 'agora sou eu');

    await sleep(1600);
    assert.equal(h.openai.requests.length, 1, 'only the answer before the human took over');
    assert.deepEqual(t.texts(), ['primeira resposta']);
    assert.equal((await t.session(jid)).status, 'paused');
    assert.equal((await t.session(jid2)).status, 'paused');
    assert.equal((await t.sessions(jid)).length, 1);
  });

  test('12) the human writes while splitMessages parts are being sent: the remaining parts are discarded', async () => {
    const t = await h.createTenant({ settings: { splitMessages: true } });
    const jid = t.contact();
    h.openai.reply('Parte 1\n\nParte 2\n\nParte 3');

    const answering = t.client(jid, 'me explica tudo');
    await waitFor(() => t.texts().length === 1, 5000, 'first part');
    await t.human(jid, 'deixa que eu explico');
    await answering;

    assert.deepEqual(t.texts(), ['Parte 1']);
    assert.equal((await t.session(jid)).status, 'paused');
  });

  test('12b) a late OpenAI answer (the human wrote meanwhile) is discarded and the session stays paused', async () => {
    const t = await h.createTenant();
    const jid = t.contact();
    await t.client(jid, 'oi');

    let release: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let thinking = false;
    h.openai.reply(async () => {
      thinking = true;
      await gate;
      return h.openai.completion('resposta que chegou tarde');
    });

    const answering = t.client(jid, 'qual o prazo?');
    await waitFor(() => thinking, 5000, 'OpenAI request in flight');
    await t.human(jid, 'o prazo é amanhã, eu cuido disso');
    release();
    await answering;

    assert.deepEqual(t.texts(), ['resposta 1']);
    const session = await t.session(jid);
    assert.equal(session.status, 'paused');
    assert.ok((session.parameters as any).humanLastMessageAt);
  });

  test('13) legacy paused session (no parameters) with X>0 resumes through updatedAt; with X=0 it does not', async () => {
    const t = await h.createTenant({ settings: { humanResumeMinutes: 1 } });
    const jid = t.contact();
    const legacy = await h.prisma.integrationSession.create({
      data: {
        remoteJid: jid,
        sessionId: jid,
        status: 'paused',
        awaitUser: false,
        botId: t.bot.id,
        instanceId: t.instance.instanceId,
        type: 'openai',
      },
    });

    await t.client(jid, 'oi');
    assert.equal(h.openai.requests.length, 0, 'paused just now: not expired');

    await h.ageUpdatedAt(legacy.id, 2 * MIN);
    await t.client(jid, 'oi de novo');
    assert.equal(h.openai.requests.length, 1);
    assert.equal(lastUserText(h.openai.requests[0]), 'oi de novo');
    assert.equal((await t.session(jid)).status, 'opened');

    const t0 = await h.createTenant({ settings: { humanResumeMinutes: 0 } });
    const legacy0 = await h.prisma.integrationSession.create({
      data: {
        remoteJid: jid,
        sessionId: jid,
        status: 'paused',
        botId: t0.bot.id,
        instanceId: t0.instance.instanceId,
        type: 'openai',
      },
    });
    await h.ageUpdatedAt(legacy0.id, 24 * 60 * MIN);
    await t0.client(jid, 'oi');
    assert.equal(h.openai.requests.length, 1);
    assert.equal((await t0.session(jid)).status, 'paused');
  });

  test('14) a manual pause (changeStatus paused) is never lifted by humanResumeMinutes', async () => {
    const t = await h.createTenant({ settings: { humanResumeMinutes: 1 } });
    const jid = t.contact();
    await t.client(jid, 'oi');

    await h.controller.changeStatus(t.instance, { remoteJid: jid, status: 'paused' });
    const paused = await t.session(jid);
    assert.equal(paused.status, 'paused');
    assert.deepEqual(paused.parameters, { manualPause: true });

    await h.ageUpdatedAt(paused.id, 60 * MIN);
    await t.client(jid, 'olá?');
    assert.equal(h.openai.requests.length, 1, 'still paused');

    // A human message on top of a manual pause keeps it manual
    await t.human(jid, 'estou acompanhando');
    await h.ageHumanPause(paused.id, 60 * MIN);
    await t.client(jid, 'olá??');
    assert.equal(h.openai.requests.length, 1, 'still paused');

    await h.controller.changeStatus(t.instance, { remoteJid: jid, status: 'opened' });
    assert.deepEqual((await t.session(jid)).parameters, {});
    await t.client(jid, 'voltou?');
    assert.equal(h.openai.requests.length, 2);
  });

  test('keywordFinish during a pause closes the session (keepOpen=false removes it)', async () => {
    const t = await h.createTenant();
    const jid = t.contact();
    await t.human(jid, 'oi');
    assert.equal((await t.sessions(jid)).length, 1);

    await t.client(jid, '#SAIR');
    assert.equal((await t.sessions(jid)).length, 0);
    assert.equal(h.openai.requests.length, 0);
  });
});
