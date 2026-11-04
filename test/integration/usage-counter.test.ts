import '../helpers/setup';

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import { UsageService } from '@api/services/usage.service';
import { zonedParts } from '@utils/usageLimits';

import { sleep, textMsg, waitFor } from '../helpers/fakes';
import { OpenaiHarness, SKIP_INTEGRATION } from '../helpers/integration';

/**
 * "Plano e limites" on a real PostgreSQL: the migration, the atomic upsert-increment under concurrency and the
 * counting through the real controller emit (debounced bursts, human messages, bot echoes).
 */
describe('usage counters (integration)', { skip: SKIP_INTEGRATION }, () => {
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

  const today = () => zonedParts(new Date(), 'America/Sao_Paulo');
  const counter = async (instanceId: string, type: string, remoteJid = '') => {
    const parts = today();
    const row = await h.prisma.usageCounter.findUnique({
      where: {
        instanceId_type_period_remoteJid: {
          instanceId,
          type,
          period: type === 'month' ? parts.month : parts.day,
          remoteJid,
        },
      },
    });
    return row?.responses ?? 0;
  };

  test('concurrent answers are all counted (INSERT ... ON CONFLICT DO UPDATE, no lost update)', async () => {
    const t = await h.createTenant();
    const usage = new UsageService(h.prisma);
    const jid = t.contact();

    await Promise.all(Array.from({ length: 25 }, () => usage.recordAnswer(t.instance.instanceId, jid)));

    assert.equal(await counter(t.instance.instanceId, 'month'), 25);
    assert.equal(await counter(t.instance.instanceId, 'day'), 25);
    assert.equal(await counter(t.instance.instanceId, 'contact', jid), 25);
  });

  test('a debounced burst is one answer; human messages and bot echoes are not counted', async () => {
    const t = await h.createTenant({ settings: { debounceTime: 1 } });
    const jid = t.contact();

    await t.client(jid, 'oi');
    await t.client(jid, 'queria marcar');
    await t.client(jid, 'uma consulta');
    await waitFor(() => t.texts().length === 1, 10000, 'the answer of the burst');

    // Echo of the bot's own message (id registered) and a message typed by the owner
    const echo = t.wa.sent[0];
    await h.controller.emit({
      instance: t.instance,
      remoteJid: jid,
      msg: textMsg(jid, echo.data.text, { fromMe: true, id: echo.id }),
    });
    await t.human(jid, 'Oi, aqui é a Ana do escritório');
    await sleep(1500);

    assert.equal(t.texts().length, 1);
    assert.equal(await counter(t.instance.instanceId, 'month'), 1);
    assert.equal(await counter(t.instance.instanceId, 'contact', jid), 1);
  });

  test('pause over the franchise through the shared service; limits cascade away with the instance', async () => {
    const t = await h.createTenant();
    const jid = t.contact();
    await h.service.usage.saveLimits(t.instance.instanceId, { monthlyResponses: 1, overLimitAction: 'pause' });

    await t.client(jid, 'primeira');
    await waitFor(() => t.texts().length === 1, 5000, 'first answer');
    await t.client(jid, 'segunda');
    await sleep(300);

    assert.equal(t.texts().length, 1);
    assert.equal(h.openai.requests.length, 1);

    await h.prisma.instance.delete({ where: { id: t.instance.instanceId } });
    assert.equal(await h.prisma.instanceLimits.count({ where: { instanceId: t.instance.instanceId } }), 0);
    assert.equal(await h.prisma.usageCounter.count({ where: { instanceId: t.instance.instanceId } }), 0);
  });
});
