import '../helpers/setup';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { adminAlertsConfigFromEnv, AdminAlertsService, DISCONNECTED_MS } from '@api/services/admin-alerts.service';
import { retentionDaysFromEnv, RetentionService } from '@api/services/retention.service';
import { UsageService } from '@api/services/usage.service';
import { OpenaiHealthRegistry } from '@utils/openai-health';

const quiet = { log: () => undefined, warn: () => undefined, error: () => undefined };
const DAY = 86_400_000;
const NOW = Date.parse('2026-11-10T22:00:00Z');

function messagesPrisma(timestampsByInstance: Record<string, number[]>) {
  const rows = Object.entries(timestampsByInstance).flatMap(([instanceId, list]) =>
    list.map((t, i) => ({ id: `${instanceId}-${i}`, instanceId, messageTimestamp: t })),
  );
  const calls = { find: 0, del: 0 };
  return {
    rows,
    calls,
    message: {
      findMany: async ({ where, take }: any) => {
        calls.find++;
        return rows
          .filter((r) => r.instanceId === where.instanceId && r.messageTimestamp < where.messageTimestamp.lt)
          .slice(0, take)
          .map((r) => ({ id: r.id }));
      },
      deleteMany: async ({ where }: any) => {
        calls.del++;
        const ids = new Set(where.id.in);
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i--) if (ids.has(rows[i].id)) rows.splice(i, 1);
        return { count: before - rows.length };
      },
    },
  };
}

describe('retention (LGPD)', () => {
  test('MESSAGE_RETENTION_DAYS: off by default and below 30 days; capped at 10 years', () => {
    assert.equal(retentionDaysFromEnv({}), 0);
    assert.equal(retentionDaysFromEnv({ MESSAGE_RETENTION_DAYS: '7' }), 0);
    assert.equal(retentionDaysFromEnv({ MESSAGE_RETENTION_DAYS: 'x' }), 0);
    assert.equal(retentionDaysFromEnv({ MESSAGE_RETENTION_DAYS: '90' }), 90);
    assert.equal(retentionDaysFromEnv({ MESSAGE_RETENTION_DAYS: '99999' }), 3650);
  });

  test('deletes only the messages of the instance older than the limit, in batches', async () => {
    const sec = (ms: number) => Math.floor(ms / 1000);
    const old = Array.from({ length: 2500 }, () => sec(NOW - 120 * DAY));
    const recent = [sec(NOW - 10 * DAY), sec(NOW - 89 * DAY)];
    const prisma = messagesPrisma({ a: [...old, ...recent], b: [sec(NOW - 200 * DAY)] });
    const service = new RetentionService({ prisma, days: 90, logger: quiet, now: () => NOW });

    assert.equal(await service.purge('a'), 2500);
    assert.equal(prisma.calls.del, 3, '1.000 por lote');
    assert.deepEqual(
      prisma.rows.filter((r) => r.instanceId === 'a').map((r) => r.messageTimestamp),
      recent,
    );
    assert.equal(prisma.rows.filter((r) => r.instanceId === 'b').length, 1, 'other instance untouched');
  });

  test('off (0 days): never reads the database', async () => {
    const prisma = messagesPrisma({ a: [1] });
    const service = new RetentionService({ prisma, days: 0, logger: quiet, now: () => NOW });
    service.runOncePerDay('a');
    assert.equal(await service.purge('a'), 0);
    assert.equal(prisma.calls.find, 0);
  });

  test('runs at most once a day per instance, from the daily hook of the usage counter', async () => {
    const prisma = messagesPrisma({ a: [] });
    let now = NOW;
    const service = new RetentionService({ prisma, days: 90, logger: quiet, now: () => now });
    service.runOncePerDay('a');
    service.runOncePerDay('a');
    await new Promise((r) => setImmediate(r));
    assert.equal(prisma.calls.find, 1);
    now += DAY;
    service.runOncePerDay('a');
    await new Promise((r) => setImmediate(r));
    assert.equal(prisma.calls.find, 2);

    const hooked: string[] = [];
    const usagePrisma: any = {
      usageCounter: { upsert: async () => ({}), deleteMany: async () => ({ count: 0 }) },
      usageLimits: { findUnique: async () => null },
    };
    const usage = new UsageService(usagePrisma, { now: () => NOW, onDaily: (id) => hooked.push(id) });
    await usage.recordAnswer('inst-1', '5521900000000@s.whatsapp.net');
    await usage.recordAnswer('inst-1', '5521900000000@s.whatsapp.net');
    assert.deepEqual(hooked, ['inst-1']);
  });
});

function monitor(states: Record<string, string>, sent: { number: string; text: string }[]) {
  const waInstances: Record<string, any> = {};
  for (const [name, state] of Object.entries(states)) {
    waInstances[name] = {
      connectionStatus: { state },
      textMessage: async (data: any) => {
        sent.push({ number: data.number, text: data.text });
        return {};
      },
    };
  }
  return { waInstances };
}

describe('admin alerts over WhatsApp', () => {
  test('config: only valid numbers, deduplicated; off without numbers or sender', () => {
    assert.deepEqual(
      adminAlertsConfigFromEnv({
        ADMIN_ALERT_NUMBERS: '+55 21 90000-0000, 5521900000000;123',
        ADMIN_ALERT_INSTANCE: 'Admin',
      }),
      {
        numbers: ['5521900000000'],
        sender: 'Admin',
      },
    );
    const off = new AdminAlertsService({
      prisma: {},
      monitor: { waInstances: {} },
      logger: quiet,
      config: adminAlertsConfigFromEnv({ ADMIN_ALERT_NUMBERS: '5521900000000' }),
    });
    assert.equal(off.enabled, false);
  });

  test('an instance down for more than 10 minutes is reported once, and again when it comes back', async () => {
    const sent: { number: string; text: string }[] = [];
    const states = { Admin: 'open', 'Cliente Exemplo': 'close' };
    const mon = monitor(states, sent);
    let now = NOW;
    const alerts = new AdminAlertsService({
      prisma: {},
      monitor: mon,
      logger: quiet,
      config: { numbers: ['5521900000001'], sender: 'Admin' },
      now: () => now,
    });

    await alerts.checkConnections();
    now += DISCONNECTED_MS - 60_000;
    await alerts.checkConnections();
    assert.equal(sent.length, 0, 'short reconnects are normal');

    now += 2 * 60_000;
    await alerts.checkConnections();
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /"Cliente Exemplo" está desconectada há 11 min/);

    now += 5 * 60_000;
    await alerts.checkConnections();
    assert.equal(sent.length, 1, 'no repetition while still down');

    mon.waInstances['Cliente Exemplo'].connectionStatus.state = 'open';
    await alerts.checkConnections();
    assert.equal(sent.length, 2);
    assert.match(sent[1].text, /voltou a conectar/);
  });

  test('a serious OpenAI error is reported once per key and kind; a rate limit is not', async () => {
    const sent: { number: string; text: string }[] = [];
    const registry = new OpenaiHealthRegistry(() => NOW);
    const alerts = new AdminAlertsService({
      prisma: { openaiCreds: { findUnique: async () => ({ Instance: { name: 'Escritório Fictício' } }) } },
      monitor: monitor({ Admin: 'open' }, sent),
      logger: quiet,
      config: { numbers: ['5521900000001', '5521900000002'], sender: 'Admin' },
      now: () => NOW,
    });
    const pending: Promise<void>[] = [];
    registry.onError((credsId, info) => pending.push(alerts.openaiProblem(credsId, info)));

    const noCredit = Object.assign(new Error('You exceeded your current quota'), {
      status: 429,
      code: 'insufficient_quota',
    });
    registry.recordError('creds-1', noCredit, 'gpt-6-luna');
    registry.recordError('creds-1', noCredit, 'gpt-6-luna');
    registry.recordError(
      'creds-1',
      Object.assign(new Error('Rate limit reached'), { status: 429, code: 'rate_limit_exceeded' }),
    );
    await Promise.all(pending);

    assert.equal(sent.length, 2, 'two numbers, one alert');
    assert.match(sent[0].text, /IA de "Escritório Fictício" não está respondendo/);
    assert.match(sent[0].text, /Sem crédito na conta OpenAI/);
  });

  test('a listener that throws never breaks the registry', () => {
    const registry = new OpenaiHealthRegistry(() => NOW);
    registry.onError(() => {
      throw new Error('boom');
    });
    assert.doesNotThrow(() => registry.recordError('c', new Error('x')));
    assert.equal(registry.get('c')?.errorCount, 1);
  });
});
