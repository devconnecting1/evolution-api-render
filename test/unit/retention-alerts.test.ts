import '../helpers/setup';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { adminAlertsConfigFromEnv, AdminAlertsService, DISCONNECTED_MS } from '@api/services/admin-alerts.service';
import { retentionDaysFromEnv, RetentionService, validRetentionDays } from '@api/services/retention.service';
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
  test('MESSAGE_RETENTION_DAYS: off by default and below 7 days; capped at 10 years', () => {
    assert.equal(retentionDaysFromEnv({}), 0);
    assert.equal(retentionDaysFromEnv({ MESSAGE_RETENTION_DAYS: '6' }), 0);
    assert.equal(retentionDaysFromEnv({ MESSAGE_RETENTION_DAYS: '7' }), 7);
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

function settingsPrisma(base: any) {
  const store: Record<string, any> = {};
  base.globalSetting = {
    findUnique: async ({ where }: any) => store[where.key] ?? null,
    upsert: async ({ where, create, update }: any) => {
      store[where.key] = { ...(store[where.key] ?? create), ...update, key: where.key, updatedAt: new Date(NOW) };
      return store[where.key];
    },
  };
  base.instance = {
    findMany: async () => [
      { id: 'a', name: 'Cliente Exemplo' },
      { id: 'b', name: 'Cliente Fictício' },
    ],
  };
  base.message.count = async ({ where }: any) =>
    base.rows.filter((r: any) => r.instanceId === where.instanceId && r.messageTimestamp < where.messageTimestamp.lt)
      .length;
  return { base, store };
}

describe('retention set in the panel (all instances)', () => {
  const sec = (ms: number) => Math.floor(ms / 1000);

  test('the panel value wins over the environment; preview counts per instance; run now deletes everywhere', async () => {
    const { base } = settingsPrisma(
      messagesPrisma({ a: [sec(NOW - 200 * DAY), sec(NOW - 40 * DAY), sec(NOW - 1 * DAY)], b: [sec(NOW - 100 * DAY)] }),
    );
    const service = new RetentionService({ prisma: base, days: 0, logger: quiet, now: () => NOW });

    assert.deepEqual(
      { days: (await service.config()).days, source: (await service.config()).source },
      { days: 0, source: 'padrao' },
    );
    const preview = await service.preview(30);
    assert.deepEqual(
      preview.instances.map((i) => [i.instance, i.older]),
      [
        ['Cliente Exemplo', 2],
        ['Cliente Fictício', 1],
      ],
    );
    assert.equal(preview.total, 3);

    const saved = await service.setDays(90);
    assert.deepEqual([saved.days, saved.source], [90, 'painel']);
    const run = await service.purgeAll();
    assert.equal(run.removed, 2, 'only what is older than 90 days, in both instances');
    assert.equal(base.rows.length, 2, 'a: 40 e 1 dia ficam; b: a de 100 dias saiu');

    await service.setDays(0);
    assert.equal(service.enabled, false);
    assert.equal((await service.purgeAll()).removed, 0);
  });

  test('a saved value is read once from the database and survives a restart; invalid values are refused', async () => {
    const { base } = settingsPrisma(messagesPrisma({ a: [] }));
    const first = new RetentionService({ prisma: base, days: 90, logger: quiet, now: () => NOW });
    await first.setDays(365);
    const restarted = new RetentionService({ prisma: base, days: 90, logger: quiet, now: () => NOW });
    assert.equal((await restarted.config()).days, 365);
    for (const bad of [3, -1, 4000, 'x', 1.5]) {
      await assert.rejects(restarted.setDays(bad), /deve ser 0/);
    }
    assert.equal(validRetentionDays(7), 7);
    assert.equal(validRetentionDays('180'), 180);
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
