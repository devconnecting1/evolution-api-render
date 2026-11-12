import '../helpers/setup';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { OverviewController } from '@api/controllers/overview.controller';
import { OverviewService } from '@api/services/overview.service';
import {
  overviewDays,
  overviewRange,
  overviewVariation,
  parseOverviewDays,
  previousPeriodLabel,
  zonedDay,
  zonedDayStart,
  zonedTime,
} from '@utils/overview';

/** Tuesday 2026-11-03 14:00 in São Paulo (UTC-3). */
const NOW = Date.parse('2026-11-03T17:00:00Z');

const INSTANCE = { id: 'inst-1', name: 'escritorio' };

// ------------------------------------------------------------------------------------------------ pure helpers

describe('overview: period arithmetic in the office time zone', () => {
  test('the selector accepts 7 and 30 only; absent means 7', () => {
    assert.equal(parseOverviewDays(undefined), 7);
    assert.equal(parseOverviewDays(null), 7);
    assert.equal(parseOverviewDays(''), 7);
    assert.equal(parseOverviewDays('7'), 7);
    assert.equal(parseOverviewDays(30), 30);
    assert.equal(parseOverviewDays('14'), null);
    assert.equal(parseOverviewDays('7 dias'), null);
    assert.equal(parseOverviewDays('0'), null);
    assert.equal(previousPeriodLabel(7), 'vs. 7 dias anteriores');
    assert.equal(previousPeriodLabel(30), 'vs. 30 dias anteriores');
  });

  test('current period ends today and the previous one comes right before it', () => {
    const range = overviewRange('2026-11-03', 7);
    assert.deepEqual(range, {
      from: '2026-10-28',
      to: '2026-11-03',
      previousFrom: '2026-10-21',
      previousTo: '2026-10-27',
    });
    const days = overviewDays(range);
    assert.equal(days.length, 7);
    assert.equal(days[0], '2026-10-28');
    assert.equal(days[6], '2026-11-03');
    assert.equal(overviewDays(overviewRange('2026-11-03', 30)).length, 30);

    const month = overviewRange('2026-03-02', 7);
    assert.deepEqual([month.from, month.previousFrom], ['2026-02-24', '2026-02-17'], 'across months');
  });

  test('variation: delta and percent, null when there is no previous value', () => {
    assert.deepEqual(overviewVariation(10, 5), { delta: 5, percent: 100 });
    assert.deepEqual(overviewVariation(5, 10), { delta: -5, percent: -50 });
    assert.deepEqual(overviewVariation(0, 0), { delta: 0, percent: 0 });
    assert.deepEqual(overviewVariation(3, 0), { delta: 3, percent: null }, 'no base: never invented');
    assert.equal(overviewVariation(3, null), null);
  });

  test('day start and wall clock follow the time zone, including DST days', () => {
    assert.equal(zonedDayStart('2026-11-03', 'America/Sao_Paulo').toISOString(), '2026-11-03T03:00:00.000Z');
    assert.equal(zonedDayStart('2026-11-03', 'UTC').toISOString(), '2026-11-03T00:00:00.000Z');
    // DST starts on 2026-03-08 in New York: midnight is still EST (UTC-5)
    assert.equal(zonedDayStart('2026-03-08', 'America/New_York').toISOString(), '2026-03-08T05:00:00.000Z');
    assert.equal(zonedDayStart('2026-03-09', 'America/New_York').toISOString(), '2026-03-09T04:00:00.000Z');

    assert.equal(zonedTime(new Date(NOW), 'America/Sao_Paulo'), '14:00');
    assert.equal(zonedDay(new Date(NOW), 'America/Sao_Paulo'), '2026-11-03');
    assert.equal(zonedDay(new Date('2026-12-01T02:30:00Z'), 'America/Sao_Paulo'), '2026-11-30');
  });
});

// ------------------------------------------------------------------------------------------------ fake tables

type Tables = {
  limits?: any;
  leads?: any[];
  appointments?: any[];
  counters?: any[];
  instances?: { id: string; name: string }[];
};

const matches = (row: any, where: any = {}): boolean =>
  Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as any[]).some((part) => matches(row, part));
    const value = row[key];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond && !(cond.in as any[]).includes(value)) return false;
      if ('not' in cond && (cond.not === null ? value === null : value === cond.not)) return false;
      if ('gte' in cond && !(value >= (cond as any).gte)) return false;
      if ('lte' in cond && !(value <= (cond as any).lte)) return false;
      if ('lt' in cond && !(value < (cond as any).lt)) return false;
      if ('gt' in cond && !(value > (cond as any).gt)) return false;
      return true;
    }
    return value === cond;
  });

function createOverviewTables(input: Tables = {}) {
  const limits = input.limits ?? null;
  const leads = input.leads ?? [];
  const appointments = input.appointments ?? [];
  const counters = input.counters ?? [];
  const instances = input.instances ?? [INSTANCE];
  const copy = (value: any) => (value ? structuredClone(value) : null);

  return {
    instanceLimits: {
      findUnique: async () => copy(limits),
    },
    instance: {
      findUnique: async ({ where }: any) => copy(instances.find((row) => row.name === where.name) ?? null),
    },
    lead: {
      findMany: async ({ where, take }: any) =>
        leads
          .filter((row) => matches(row, where))
          .slice(0, take ?? 1000)
          .map((row) => ({ ...row })),
      count: async ({ where }: any) => leads.filter((row) => matches(row, where)).length,
    },
    appointment: {
      findMany: async ({ where, take, orderBy }: any) => {
        const rows = appointments.filter((row) => matches(row, where));
        if (orderBy?.startsAt === 'asc') rows.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
        return rows.slice(0, take ?? 1000).map((row) => ({ ...row, contactName: row.contactName ?? null }));
      },
      count: async ({ where }: any) => appointments.filter((row) => matches(row, where)).length,
    },
    usageCounter: {
      findMany: async ({ where }: any) =>
        counters
          .filter((row) => matches(row, where))
          .map((row) => ({
            period: row.period,
            responses: row.responses,
          })),
      findUnique: async ({ where }: any) => {
        const key = where.instanceId_type_period_remoteJid;
        const row = counters.find(
          (item) =>
            item.instanceId === key.instanceId &&
            item.type === key.type &&
            item.period === key.period &&
            (item.remoteJid ?? '') === key.remoteJid,
        );
        return row ? { responses: row.responses } : null;
      },
    },
  };
}

const at = (iso: string) => new Date(iso);

function officeTables(overrides: Tables = {}) {
  return createOverviewTables({
    limits: {
      instanceId: INSTANCE.id,
      monthlyResponses: 2000,
      businessHours: { timezone: 'America/Sao_Paulo' },
    },
    leads: [
      { createdAt: at('2026-11-03T15:00:00Z'), status: 'novo', awaitingHumanSince: at('2026-11-03T13:00:00Z') },
      { createdAt: at('2026-11-02T23:00:00Z'), status: 'qualificado', awaitingHumanSince: at('2026-11-03T16:30:00Z') },
      { createdAt: at('2026-11-01T02:00:00Z'), status: 'descartado', awaitingHumanSince: at('2026-11-03T10:00:00Z') },
      { createdAt: at('2026-10-25T12:00:00Z'), status: 'cliente', awaitingHumanSince: null },
      { createdAt: at('2026-10-10T12:00:00Z'), status: 'novo', awaitingHumanSince: null },
    ].map((row) => ({ instanceId: INSTANCE.id, ...row })),
    appointments: [
      {
        id: 'a1',
        createdAt: at('2026-11-03T16:00:00Z'),
        startsAt: at('2026-11-03T18:00:00Z'),
        contactName: 'Maria Fictícia',
        typeName: 'Consulta',
        status: 'agendado',
      },
      {
        id: 'a2',
        createdAt: at('2026-10-29T12:00:00Z'),
        startsAt: at('2026-11-03T12:00:00Z'),
        contactName: 'João Fictício',
        typeName: 'Reunião',
        status: 'confirmado',
      },
      {
        id: 'a3',
        createdAt: at('2026-10-22T12:00:00Z'),
        startsAt: at('2026-11-03T19:00:00Z'),
        contactName: 'Ana Fictícia',
        typeName: 'Consulta',
        status: 'cancelado',
      },
      {
        id: 'a4',
        createdAt: at('2026-11-01T12:00:00Z'),
        startsAt: at('2026-11-04T12:00:00Z'),
        contactName: 'Pedro Fictício',
        typeName: 'Consulta',
        status: 'agendado',
      },
    ].map((row) => ({ instanceId: INSTANCE.id, ...row })),
    counters: [
      { instanceId: INSTANCE.id, type: 'day', period: '2026-11-03', remoteJid: '', responses: 5 },
      { instanceId: INSTANCE.id, type: 'day', period: '2026-11-02', remoteJid: '', responses: 3 },
      { instanceId: INSTANCE.id, type: 'day', period: '2026-10-31', remoteJid: '', responses: 4 },
      { instanceId: INSTANCE.id, type: 'day', period: '2026-10-25', remoteJid: '', responses: 2 },
      { instanceId: INSTANCE.id, type: 'day', period: '2026-10-10', remoteJid: '', responses: 50 },
      { instanceId: INSTANCE.id, type: 'month', period: '2026-11', remoteJid: '', responses: 1200 },
    ],
    ...overrides,
  });
}

// ------------------------------------------------------------------------------------------------ service

describe('OverviewService', () => {
  const get = (tables: any, options: any = {}) =>
    new OverviewService(tables, {
      now: () => NOW,
      processesBadge: async () => ({ processesWithNews: 2, unseenPublications: 3 }),
      ...options,
    }).get(INSTANCE.id, 7);

  test('totals, comparison and the zero-filled daily series of the last 7 days', async () => {
    const view = await get(officeTables());

    assert.equal(view.generatedAt, new Date(NOW).toISOString());
    assert.equal(view.timezone, 'America/Sao_Paulo');
    assert.deepEqual(view.period, { days: 7, from: '2026-10-28', to: '2026-11-03' });
    assert.deepEqual(view.previousPeriod, { from: '2026-10-21', to: '2026-10-27' });
    assert.deepEqual(view.totals, { leadsNew: 3, awaitingTeam: 2, appointments: 3, aiResponses: 12 });
    assert.deepEqual(view.previous, { leadsNew: 1, awaitingTeam: null, appointments: 1, aiResponses: 2 });
    assert.deepEqual(view.variation.leadsNew, { delta: 2, percent: 200 });
    assert.deepEqual(view.variation.appointments, { delta: 2, percent: 200 });
    assert.deepEqual(view.variation.aiResponses, { delta: 10, percent: 500 });
    assert.equal(view.variation.awaitingTeam, null, 'a queue snapshot has no previous period');

    assert.deepEqual(
      view.daily,
      [
        { day: '2026-10-28', leads: 0, appointments: 0, aiResponses: 0 },
        { day: '2026-10-29', leads: 0, appointments: 1, aiResponses: 0 },
        { day: '2026-10-30', leads: 0, appointments: 0, aiResponses: 0 },
        { day: '2026-10-31', leads: 1, appointments: 0, aiResponses: 4 },
        { day: '2026-11-01', leads: 0, appointments: 1, aiResponses: 0 },
        { day: '2026-11-02', leads: 1, appointments: 0, aiResponses: 3 },
        { day: '2026-11-03', leads: 1, appointments: 1, aiResponses: 5 },
      ],
      'a lead at 23:00 of the previous day (UTC) belongs to the local day',
    );
    assert.deepEqual(view.plan, { month: '2026-11', responses: 1200, limit: 2000, percent: 60 });
    assert.deepEqual(view.alerts, { processesWithNews: 2, unseenPublications: 3, leadsWaitingOver2h: 1 });
  });

  test('the agenda of today is local, sorted, without cancellations and without tomorrow', async () => {
    const view = await get(officeTables());
    assert.equal(view.today.day, '2026-11-03');
    assert.deepEqual(
      view.today.appointments.map((item: any) => [item.id, item.time, item.contactName, item.typeName, item.status]),
      [
        ['a2', '09:00', 'João Fictício', 'Reunião', 'confirmado'],
        ['a1', '15:00', 'Maria Fictícia', 'Consulta', 'agendado'],
      ],
    );
    assert.equal(view.today.appointments[0].startsAt, '2026-11-03T12:00:00.000Z');
  });

  test('30 days: previous period and the monthly plan', async () => {
    const view = await new OverviewService(officeTables(), {
      now: () => NOW,
      processesBadge: async () => ({ processesWithNews: 0, unseenPublications: 0 }),
    }).get(INSTANCE.id, 30);
    assert.equal(view.daily.length, 30);
    assert.deepEqual(view.previousPeriod, { from: '2026-09-05', to: '2026-10-04' });
    assert.equal(view.totals.aiResponses, 64, 'the counters of the last 30 days, including 2026-10-10');
    assert.equal(view.plan.percent, 60);
  });

  test('the day is the office day, not UTC, and the default zone is São Paulo', async () => {
    const ny = await new OverviewService(
      createOverviewTables({
        limits: { instanceId: INSTANCE.id, businessHours: { timezone: 'America/New_York' } },
      }),
      { now: () => Date.parse('2026-11-04T03:30:00Z') },
    ).get(INSTANCE.id, 7);
    assert.equal(ny.timezone, 'America/New_York');
    assert.equal(ny.today.day, '2026-11-03');

    const fallback = await new OverviewService(createOverviewTables(), {
      now: () => Date.parse('2026-11-04T03:30:00Z'),
    }).get(INSTANCE.id, 7);
    assert.equal(fallback.timezone, 'America/Sao_Paulo');
    assert.equal(fallback.today.day, '2026-11-04');
  });

  test('the high-volume guard counts the totals again when the scan hits the limit', async () => {
    const tables = officeTables({
      leads: [
        { instanceId: INSTANCE.id, createdAt: at('2026-11-03T12:00:00Z'), status: 'novo' },
        { instanceId: INSTANCE.id, createdAt: at('2026-11-02T12:00:00Z'), status: 'novo' },
        { instanceId: INSTANCE.id, createdAt: at('2026-11-01T12:00:00Z'), status: 'novo' },
      ],
    });
    const view = await new OverviewService(tables, { now: () => NOW, scanLimit: 2 }).get(INSTANCE.id, 7);
    assert.equal(view.totals.leadsNew, 3, 'count() is authoritative above the scan limit');
  });

  test('court-case alerts never take the first screen down', async () => {
    const view = await get(officeTables(), {
      processesBadge: async () => {
        throw new Error('indisponível');
      },
    });
    assert.deepEqual(view.alerts, { processesWithNews: 0, unseenPublications: 0, leadsWaitingOver2h: 1 });
  });
});

// ------------------------------------------------------------------------------------------------ controller

describe('OverviewController', () => {
  test('validates the period, resolves the instance and keeps the instance name', async () => {
    const tables = officeTables();
    const controller = new OverviewController(new OverviewService(tables, { now: () => NOW }), tables);

    const week = await controller.get({ instanceName: 'escritorio' } as any);
    assert.equal(week.instance, 'escritorio');
    assert.equal(week.period.days, 7);

    const month = await controller.get({ instanceName: 'escritorio', days: '30' } as any);
    assert.equal(month.period.days, 30);
    assert.equal(month.daily.length, 30);

    await assert.rejects(
      controller.get({ instanceName: 'escritorio', days: '14' } as any),
      (error: any) => error.status === 400 && /7 ou 30/.test(JSON.stringify(error.message)),
    );
    await assert.rejects(controller.get({ instanceName: 'nao-existe' } as any), (error: any) => error.status === 404);
  });
});
