import '../helpers/setup';

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import { Events } from '@api/types/wa.types';

import { createFakeOpenai, nextId, sleep, waitFor } from '../helpers/fakes';
import { OpenaiHarness, SKIP_INTEGRATION } from '../helpers/integration';

/**
 * Settings, fetchSessions (`humanPause`), changeStatus and the `openai.change_status` webhook on a real database,
 * plus the isolation between instances (multi-tenant) of the shared controller/service.
 */
const MIN = 60_000;

describe('OpenAI bot: settings, sessions, changeStatus and webhook (integration)', { skip: SKIP_INTEGRATION }, () => {
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

  describe('settings', () => {
    test('tokenParam and humanResumeMinutes are stored and returned by fetchSettings', async () => {
      const t = await h.createTenant({ settings: { tokenParam: 'max_completion_tokens', humanResumeMinutes: 45 } });
      const settings = await h.controller.fetchSettings(t.instance);
      assert.equal(settings.tokenParam, 'max_completion_tokens');
      assert.equal(settings.humanResumeMinutes, 45);
      assert.equal(settings.fallbackId, null);
    });

    test('a save without the new fields (Manager) keeps them', async () => {
      const t = await h.createTenant({ settings: { tokenParam: 'max_tokens', humanResumeMinutes: 20 } });
      await h.controller.settings(t.instance, {
        openaiCredsId: t.creds.id,
        expire: 0,
        keywordFinish: '#fim',
        delayMessage: 1000,
        unknownMessage: 'Ops',
        listeningFromMe: false,
        stopBotFromMe: true,
        keepOpen: false,
        debounceTime: 0,
        ignoreJids: [],
      });

      const settings = await h.controller.fetchSettings(t.instance);
      assert.equal(settings.keywordFinish, '#fim');
      assert.equal(settings.tokenParam, 'max_tokens');
      assert.equal(settings.humanResumeMinutes, 20);
    });

    test('defaults when the instance has no settings row', async () => {
      const name = `it-${nextId()}`.toLowerCase();
      const row = await h.prisma.instance.create({ data: { name, integration: 'WHATSAPP-BAILEYS' } });
      try {
        const settings = await h.controller.fetchSettings({ instanceName: name });
        assert.equal(settings.tokenParam, 'auto');
        assert.equal(settings.humanResumeMinutes, 0);
      } finally {
        await h.prisma.instance.delete({ where: { id: row.id } });
      }
    });

    test('bot fields: tokenParam / humanResumeMinutes stored on create and update, null inherits', async () => {
      const t = await h.createTenant({ bot: { tokenParam: 'max_tokens', humanResumeMinutes: 5 } });
      assert.equal(t.bot.tokenParam, 'max_tokens');
      assert.equal(t.bot.humanResumeMinutes, 5);

      const updated = await h.controller.updateBot(t.instance, t.bot.id, {
        enabled: true,
        openaiCredsId: t.creds.id,
        botType: 'chatCompletion',
        model: 'gpt-5-mini',
        maxTokens: 2000,
        triggerType: 'all',
        humanResumeMinutes: 15,
      });
      assert.equal(updated.humanResumeMinutes, 15);
      assert.equal(updated.tokenParam, 'max_tokens', 'not sent: kept');

      const inheriting = await h.createTenant({
        settings: { tokenParam: 'max_completion_tokens', humanResumeMinutes: 7 },
      });
      assert.equal(inheriting.bot.tokenParam, null);
      assert.equal(inheriting.bot.humanResumeMinutes, null);

      const jid = inheriting.contact();
      await inheriting.client(jid, 'oi');
      assert.equal(Object.keys(h.openai.requests[0]).includes('max_completion_tokens'), true, 'inherits from settings');
    });
  });

  describe('fetchSessions humanPause', () => {
    test('human, manual, legacy and not paused sessions', async () => {
      const t = await h.createTenant({ settings: { humanResumeMinutes: 30 } });
      const humanJid = t.contact();
      const manualJid = t.contact();
      const legacyJid = t.contact();
      const openedJid = t.contact();

      await t.human(humanJid, 'assumi');
      await t.client(manualJid, 'oi');
      await h.controller.changeStatus(t.instance, { remoteJid: manualJid, status: 'paused' });
      const legacy = await h.prisma.integrationSession.create({
        data: {
          remoteJid: legacyJid,
          sessionId: legacyJid,
          status: 'paused',
          botId: t.bot.id,
          instanceId: t.instance.instanceId,
          type: 'openai',
        },
      });
      await h.ageUpdatedAt(legacy.id, 10 * MIN);
      await t.client(openedJid, 'oi');

      const sessions = await h.controller.fetchSessions(t.instance, t.bot.id);
      const byJid = new Map(sessions.map((session: any) => [session.remoteJid, session]));
      assert.equal(sessions.length, 4);

      const human: any = byJid.get(humanJid);
      assert.equal(human.humanPause.reason, 'human');
      assert.equal(human.humanPause.resumeMinutes, 30);
      assert.equal(human.humanPause.autoResume, true);
      assert.ok(human.humanPause.remainingSeconds > 1790 && human.humanPause.remainingSeconds <= 1800);
      assert.equal(human.humanPause.lastHumanMessageAt, human.parameters.humanLastMessageAt);

      const manual: any = byJid.get(manualJid);
      assert.equal(manual.humanPause.reason, 'manual');
      assert.equal(manual.humanPause.autoResume, false);
      assert.equal(manual.humanPause.resumesAt, null);

      const legacyInfo: any = byJid.get(legacyJid);
      assert.equal(legacyInfo.humanPause.reason, 'legacy');
      assert.ok(legacyInfo.humanPause.remainingSeconds > 1190 && legacyInfo.humanPause.remainingSeconds <= 1200);

      assert.equal((byJid.get(openedJid) as any).humanPause, null);

      const filtered = await h.controller.fetchSessions(t.instance, t.bot.id, humanJid);
      assert.deepEqual(
        filtered.map((session: any) => session.remoteJid),
        [humanJid],
      );
    });

    test('resumeMinutes follows the bot value first', async () => {
      const t = await h.createTenant({ settings: { humanResumeMinutes: 30 }, bot: { humanResumeMinutes: 2 } });
      const jid = t.contact();
      await t.human(jid, 'assumi');
      const [session] = await h.controller.fetchSessions(t.instance, t.bot.id);
      assert.equal(session.humanPause.resumeMinutes, 2);
      assert.ok(session.humanPause.remainingSeconds <= 120);
    });
  });

  describe('openai.change_status webhook', () => {
    test('manual changes: paused, opened, closed and delete', async () => {
      const t = await h.createTenant({ settings: { humanResumeMinutes: 10, keepOpen: true } });
      const jid = t.contact();
      await t.client(jid, 'oi');
      const { id } = await t.session(jid);

      await h.controller.changeStatus(t.instance, { remoteJid: jid, status: 'paused' });
      await h.waitForStatusEvents(t, 1);
      await h.controller.changeStatus(t.instance, { remoteJid: jid, status: 'opened' });
      await h.waitForStatusEvents(t, 2);
      await h.controller.changeStatus(t.instance, { remoteJid: jid, status: 'closed' });
      await h.waitForStatusEvents(t, 3);
      assert.equal((await t.session(jid)).status, 'closed', 'keepOpen: closed, not removed');
      await h.controller.changeStatus(t.instance, { remoteJid: jid, status: 'delete' });
      await h.waitForStatusEvents(t, 4);

      const [paused, opened, closed, deleted] = t.statusEvents();
      for (const event of [paused, opened, closed, deleted]) {
        assert.equal(event.remoteJid, jid);
        assert.equal(event.reason, 'manual');
        assert.deepEqual(event.session, { id, botId: t.bot.id });
      }
      assert.equal(paused.status, 'paused');
      assert.equal(paused.humanPause.reason, 'manual');
      assert.equal(paused.humanPause.autoResume, false);
      assert.equal(opened.status, 'opened');
      assert.equal(opened.humanPause, null);
      assert.equal(closed.status, 'closed');
      assert.equal(deleted.status, 'delete');
      assert.equal((await t.sessions(jid)).length, 0);
      assert.ok(t.wa.webhooks.every((w) => w.event === Events.OPENAI_CHANGE_STATUS));
    });

    test('no webhook for a chat without session, nor for the bot answers', async () => {
      const t = await h.createTenant();
      await h.controller.changeStatus(t.instance, { remoteJid: t.contact(), status: 'opened' });
      await t.client(t.contact(), 'oi');
      await sleep(150);
      assert.deepEqual(t.statusEvents(), []);
    });

    test('a failing webhook never breaks the flow', async () => {
      const t = await h.createTenant();
      t.wa.sendDataWebhook = async () => {
        throw new Error('webhook endpoint down');
      };
      const jid = t.contact();
      await t.client(jid, 'oi');

      await t.human(jid, 'assumi');
      assert.equal((await t.session(jid)).status, 'paused');
      const result = await h.controller.changeStatus(t.instance, { remoteJid: jid, status: 'opened' });
      assert.equal(result.bot.bot.status, 'opened');
      assert.equal((await t.session(jid)).status, 'opened');
    });
  });

  describe('instance isolation (multi-tenant)', () => {
    test('changeStatus only touches the session of its own instance (same contact in two instances)', async () => {
      const a = await h.createTenant();
      const b = await h.createTenant();
      const jid = `55219${String(Date.now() % 100000000).padStart(8, '0')}@s.whatsapp.net`;

      await a.human(jid, 'oi pelo escritório A');
      await b.human(jid, 'oi pelo escritório B');
      const bBefore = await b.session(jid);

      await h.controller.changeStatus(a.instance, { remoteJid: jid, status: 'opened' });

      assert.equal((await a.session(jid)).status, 'opened');
      const bAfter = await b.session(jid);
      assert.equal(bAfter.status, 'paused');
      assert.deepEqual(bAfter.parameters, bBefore.parameters);

      await h.waitForStatusEvents(a, 2);
      await sleep(100);
      assert.equal(a.statusEvents()[1].status, 'opened');
      assert.equal(b.statusEvents().length, 1, 'only the human pause of B');
      assert.equal(a.statusEvents()[1].session.id, (await a.session(jid)).id);
    });

    test('a human pause in one instance does not pause the same contact in another', async () => {
      const a = await h.createTenant();
      const b = await h.createTenant();
      const jid = `55319${String(Date.now() % 100000000).padStart(8, '0')}@s.whatsapp.net`;

      await b.client(jid, 'oi B');
      await a.human(jid, 'atendimento humano em A');
      await b.client(jid, 'continua B');

      assert.equal((await a.session(jid)).status, 'paused');
      assert.equal((await b.session(jid)).status, 'opened');
      assert.equal(b.texts().length, 2);
    });

    test('concurrent messages of two instances use their own OpenAI credentials', async () => {
      const a = await h.createTenant();
      const b = await h.createTenant();
      const openaiA = h.useOpenaiFor(a, createFakeOpenai());
      const openaiB = h.useOpenaiFor(b, createFakeOpenai());

      await Promise.all([
        a.client(a.contact(), 'pergunta do cliente A'),
        b.client(b.contact(), 'pergunta do cliente B'),
      ]);

      const asked = (fake: any) => fake.requests.map((request: any) => request.messages.at(-1).content[0].text);
      assert.deepEqual(asked(openaiA), ['pergunta do cliente A'], 'A was answered with the key of A');
      assert.deepEqual(asked(openaiB), ['pergunta do cliente B'], 'B was answered with the key of B');
    });

    test('debounce windows of two instances are independent (same contact)', async () => {
      const a = await h.createTenant({ settings: { debounceTime: 1 } });
      const b = await h.createTenant({ settings: { debounceTime: 1 } });
      const jid = `55419${String(Date.now() % 100000000).padStart(8, '0')}@s.whatsapp.net`;

      await a.client(jid, 'mensagem para A');
      await b.client(jid, 'mensagem para B');

      await waitFor(() => a.texts().length + b.texts().length >= 2, 8000, 'both answers').catch(() => undefined);
      await sleep(200);

      assert.equal(a.texts().length, 1, 'A answers its own contact');
      assert.equal(b.texts().length, 1, 'B answers its own contact');
      const questions = h.openai.requests.map((request: any) => request.messages.at(-1).content[0].text).sort();
      assert.deepEqual(questions, ['mensagem para A', 'mensagem para B']);
    });
  });
});
