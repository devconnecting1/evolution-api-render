import '../helpers/setup';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { UsageController } from '@api/controllers/usage.controller';
import { UsageLimitsDto } from '@api/dto/usage.dto';
import { OpenaiService } from '@api/integrations/chatbot/openai/services/openai.service';
import { ObservabilityService } from '@api/services/observability.service';
import { SystemProbe } from '@api/services/observability.system';
import { UsageService } from '@api/services/usage.service';
import { configService } from '@config/env.config';
import {
  aiAllowedByHours,
  defaultLimits,
  evaluateGate,
  isInsideSchedule,
  lastDays,
  maskContact,
  normalizeLimits,
  overage,
  UsageLimits,
  validateLimits,
  zonedParts,
} from '@utils/usageLimits';
import { usageLimitsSchema } from '@validate/usage.schema';

import { createFakeOpenai, createFakeWaInstance, nextId, texts, useFakeOpenai } from '../helpers/fakes';
import { createPrismaMock } from '../helpers/prisma-mock';
import { createUsageTables } from '../helpers/usage-mock';

const JID = '5521974699723@s.whatsapp.net';
/** Tuesday 2026-11-03 14:00 in São Paulo (UTC-3). */
const TUESDAY_14H = Date.parse('2026-11-03T17:00:00Z');
/** Tuesday 2026-11-03 20:00 in São Paulo. */
const TUESDAY_20H = Date.parse('2026-11-03T23:00:00Z');

const limitsWith = (patch: Partial<UsageLimits> & { hours?: Partial<UsageLimits['businessHours']> } = {}) => {
  const base = defaultLimits();
  const { hours, ...rest } = patch;
  return { ...base, ...rest, businessHours: { ...base.businessHours, ...(hours ?? {}) } } as UsageLimits;
};

// -------------------------------------------------------------------------------------------- helpers

describe('usage limits: time and business hours', () => {
  test('periods follow the instance time zone, not UTC', () => {
    // 02:30 UTC on the 1st is still the last day of the previous month in São Paulo
    const parts = zonedParts(new Date('2026-12-01T02:30:00Z'), 'America/Sao_Paulo');
    assert.equal(parts.day, '2026-11-30');
    assert.equal(parts.month, '2026-11');
    assert.equal(parts.weekday, 1); // Monday
    assert.equal(parts.minutes, 23 * 60 + 30);

    const utc = zonedParts(new Date('2026-12-01T02:30:00Z'), 'UTC');
    assert.equal(utc.day, '2026-12-01');
    assert.equal(zonedParts(new Date('2026-12-01T02:30:00Z'), 'Not/AZone').day, '2026-11-30', 'invalid zone: default');
  });

  test('schedule: normal ranges, 24:00 and overnight ranges that cross midnight', () => {
    const week = { ...defaultLimits().businessHours.week, mon: [['22:00', '06:00']], wed: [['18:00', '24:00']] } as any;
    const at = (weekday: number, hh: number, mm = 0) => isInsideSchedule(week, { weekday, minutes: hh * 60 + mm });

    assert.equal(at(2, 9), true); // Tuesday 09:00 (default 09-18)
    assert.equal(at(2, 18), false); // the end is exclusive
    assert.equal(at(2, 8, 59), false);
    assert.equal(at(1, 23), true); // Monday 23:00, overnight range of Monday
    assert.equal(at(2, 5, 59), true); // Tuesday 05:59, still Monday's range
    assert.equal(at(2, 6), false);
    assert.equal(at(1, 21, 59), false);
    assert.equal(at(3, 23, 59), true); // Wednesday until 24:00
    assert.equal(at(4, 0), false);
    assert.equal(at(0, 12), false); // Sunday closed
  });

  test('modes: always, inside, outside, disabled; the zone of the schedule is used', () => {
    const inside = limitsWith({ hours: { enabled: true, mode: 'inside' } }).businessHours;
    const outside = limitsWith({ hours: { enabled: true, mode: 'outside' } }).businessHours;
    const disabled = limitsWith({ hours: { enabled: false, mode: 'inside' } }).businessHours;
    const always = limitsWith({ hours: { enabled: true, mode: 'always' } }).businessHours;

    assert.equal(aiAllowedByHours(inside, new Date(TUESDAY_14H)), true);
    assert.equal(aiAllowedByHours(inside, new Date(TUESDAY_20H)), false);
    assert.equal(aiAllowedByHours(outside, new Date(TUESDAY_14H)), false);
    assert.equal(aiAllowedByHours(outside, new Date(TUESDAY_20H)), true);
    assert.equal(aiAllowedByHours(disabled, new Date(TUESDAY_20H)), true);
    assert.equal(aiAllowedByHours(always, new Date(TUESDAY_20H)), true);

    // 17:00 UTC is 14:00 in São Paulo (inside) but Wednesday 02:00 in Tokyo (outside)
    const tokyo = { ...inside, timezone: 'Asia/Tokyo' };
    assert.equal(aiAllowedByHours(tokyo, new Date(TUESDAY_14H)), false);
  });

  test('lastDays, overage blocks and masked contacts', () => {
    assert.deepEqual(lastDays('2026-03-02', 3), ['2026-02-28', '2026-03-01', '2026-03-02']);
    assert.deepEqual(overage(2000, 2000), { excedente: 0, blocks1000: 0, estimatedBRL: 0 });
    assert.deepEqual(overage(2001, 2000), { excedente: 1, blocks1000: 1, estimatedBRL: 49 });
    assert.deepEqual(overage(4500, 2000), { excedente: 2500, blocks1000: 3, estimatedBRL: 147 });
    assert.deepEqual(overage(9999, null), { excedente: 0, blocks1000: 0, estimatedBRL: 0 });
    assert.equal(maskContact(JID), '5521•••••9723');
    assert.ok(!maskContact(JID).includes('97469'));
    assert.equal(maskContact('123@lid'), '•••');
  });

  test('normalize and validate', () => {
    const normalized = normalizeLimits({
      monthlyResponses: 0,
      overLimitAction: 'nope',
      alertPercent: 300,
      businessHours: 'x',
    });
    assert.equal(normalized.monthlyResponses, null);
    assert.equal(normalized.overLimitAction, 'continue');
    assert.equal(normalized.alertPercent, 80);
    assert.equal(normalized.businessHours.mode, 'always');

    assert.match(validateLimits(limitsWith({ overLimitAction: 'message' })).join(), /mensagem/);
    assert.match(
      validateLimits(limitsWith({ dailyResponses: 10, perContactDailyResponses: 20 })).join(),
      /por contato/,
    );
    const noRanges = limitsWith({
      hours: { enabled: true, mode: 'inside', week: { sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] } },
    });
    assert.match(validateLimits(noRanges).join(), /pelo menos um horário/);
    const empty = limitsWith({ hours: { week: { ...defaultLimits().businessHours.week, mon: [['09:00', '09:00']] } } });
    assert.match(validateLimits(empty).join(), /sem duração/);
  });
});

describe('usage limits: gate decision', () => {
  const counts = (month = 0, day = 0, contact = 0) => ({ month, day, contact });

  test('no limits: always answers', () => {
    assert.deepEqual(evaluateGate(defaultLimits(), counts(99999, 9999, 999), true), {
      allow: true,
      reason: 'ok',
      overage: false,
      notice: null,
    });
  });

  test('monthly franchise: continue answers as excedente, pause stops, message notifies', () => {
    const at = (action: any, message: string | null = 'Limite atingido') =>
      evaluateGate(
        limitsWith({ monthlyResponses: 100, overLimitAction: action, overLimitMessage: message }),
        counts(100),
        true,
      );

    assert.deepEqual(at('continue'), { allow: true, reason: 'monthly', overage: true, notice: null });
    assert.deepEqual(at('pause'), { allow: false, reason: 'monthly', overage: false, notice: null });
    assert.deepEqual(at('message'), { allow: false, reason: 'monthly', overage: false, notice: 'limit' });
    assert.equal(evaluateGate(limitsWith({ monthlyResponses: 100 }), counts(99), true).allow, true);
  });

  test('daily caps never answer; per contact comes before the daily cap; hours come first', () => {
    const limits = limitsWith({
      dailyResponses: 50,
      perContactDailyResponses: 5,
      overLimitAction: 'continue',
      outsideHoursMessage: 'Fora do horário',
      hours: { enabled: true, mode: 'inside' },
    });
    assert.equal(evaluateGate(limits, counts(0, 10, 5), true).reason, 'contact_daily');
    assert.equal(evaluateGate(limits, counts(0, 50, 0), true).reason, 'daily');
    assert.equal(evaluateGate(limits, counts(0, 50, 0), true).allow, false);
    assert.deepEqual(evaluateGate(limits, counts(), false), {
      allow: false,
      reason: 'hours',
      overage: false,
      notice: 'hours',
    });
    // mode "outside": the team is working, no message
    assert.equal(
      evaluateGate({ ...limits, businessHours: { ...limits.businessHours, mode: 'outside' } }, counts(), false).notice,
      null,
    );
  });
});

// -------------------------------------------------------------------------------------------- service

function usageSetup(now = TUESDAY_14H) {
  const tables = createUsageTables([{ id: 'inst-1', name: 'escritorio' }]);
  const clock = { now };
  const usage = new UsageService(tables, { now: () => clock.now });
  return { tables, usage, clock };
}

describe('UsageService', () => {
  test('recordAnswer: one atomic upsert-increment per counter (month, day, contact), in the local calendar', async () => {
    const { tables, usage } = usageSetup(Date.parse('2026-12-01T02:30:00Z'));
    await usage.recordAnswer('inst-1', JID);
    await usage.recordAnswer('inst-1', JID);

    assert.equal(tables.count('inst-1', 'month', '2026-11'), 2);
    assert.equal(tables.count('inst-1', 'day', '2026-11-30'), 2);
    assert.equal(tables.count('inst-1', 'contact', '2026-11-30', JID), 2);
    const upserts = tables.calls.filter((call) => call.op === 'usageCounter.upsert');
    assert.equal(upserts.length, 6);
    assert.deepEqual(upserts[3].args.update, { responses: { increment: 1 } });
  });

  test('recordAnswer cleans old per-contact rows once per day, never throws', async () => {
    const { tables, usage } = usageSetup();
    await tables.usageCounter.create({
      data: { instanceId: 'inst-1', type: 'contact', period: '2026-10-20', remoteJid: JID },
    });
    await tables.usageCounter.create({
      data: { instanceId: 'inst-1', type: 'contact', period: '2026-10-30', remoteJid: JID },
    });
    await usage.recordAnswer('inst-1', JID);
    await new Promise((resolve) => setImmediate(resolve));
    await usage.recordAnswer('inst-1', JID);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(tables.calls.filter((call) => call.op === 'usageCounter.deleteMany').length, 1);
    assert.equal(tables.counters.has(`inst-1|contact|2026-10-20|${JID}`), false);
    assert.equal(tables.counters.has(`inst-1|contact|2026-10-30|${JID}`), true);

    const broken = new UsageService({ instanceLimits: { findUnique: async () => null }, usageCounter: {} });
    await broken.recordAnswer('inst-1', JID); // logs, does not throw
  });

  test('no limits: the gate does not query the counters; limits are cached 30 s and invalidated on save', async () => {
    const { tables, usage, clock } = usageSetup();
    assert.equal((await usage.checkBeforeAnswer('inst-1', JID)).allow, true);
    assert.equal((await usage.checkBeforeAnswer('inst-1', JID)).allow, true);
    assert.equal(tables.calls.filter((call) => call.op === 'instanceLimits.findUnique').length, 1, 'cached');
    assert.equal(tables.calls.filter((call) => call.op === 'usageCounter.findMany').length, 0);

    await usage.saveLimits('inst-1', { planName: 'Essencial' });
    await usage.recordAnswer('inst-1', JID);
    const gate = await usage.checkBeforeAnswer('inst-1', JID);
    assert.equal(gate.limits?.monthlyResponses, 2000, 'the new limits are used right away');
    assert.equal(tables.calls.filter((call) => call.op === 'usageCounter.findMany').length, 1, 'one query');

    clock.now += 31_000;
    await usage.checkBeforeAnswer('inst-1', JID);
    assert.equal(tables.calls.filter((call) => call.op === 'instanceLimits.findUnique').length, 4);
  });

  test('anti-loop guard: 100 AI answers per contact per day even without a plan, in memory, no notice', async () => {
    const { tables, usage, clock } = usageSetup();
    const OTHER = '5521900000099@s.whatsapp.net';
    for (let n = 0; n < 99; n++) await usage.recordAnswer('inst-1', JID);
    assert.equal((await usage.checkBeforeAnswer('inst-1', JID)).allow, true, '99 answers: still allowed');
    await usage.recordAnswer('inst-1', JID);
    const gate = await usage.checkBeforeAnswer('inst-1', JID);
    assert.equal(gate.allow, false);
    assert.equal(gate.reason, 'contact_daily');
    assert.equal(gate.notice, null, 'no message to the other bot');
    assert.equal((await usage.checkBeforeAnswer('inst-1', OTHER)).allow, true, 'other contacts are not affected');
    assert.equal(
      tables.calls.filter((call) => call.op === 'usageCounter.findMany').length,
      0,
      'no query without limits',
    );
    clock.now += 24 * 3_600_000;
    assert.equal((await usage.checkBeforeAnswer('inst-1', JID)).allow, true, 'next day: answers again');
  });

  test('anti-loop guard: a configured per-contact limit above 100 is refused; a lower one still applies', async () => {
    const { usage } = usageSetup();
    await assert.rejects(usage.saveLimits('inst-1', { perContactDailyResponses: 150 }), /vai até 100/);
    await usage.saveLimits('inst-1', { perContactDailyResponses: 3 });
    for (let n = 0; n < 3; n++) await usage.recordAnswer('inst-1', JID);
    assert.equal((await usage.checkBeforeAnswer('inst-1', JID)).reason, 'contact_daily');
  });

  test('the gate fails open when the database is down', async () => {
    const usage = new UsageService({
      instanceLimits: {
        findUnique: async () => {
          throw new Error('db down');
        },
      },
    });
    const gate = await usage.checkBeforeAnswer('inst-1', JID);
    assert.equal(gate.allow, true);
  });

  test('claimNotice: true only once per contact, kind and day', async () => {
    const { usage } = usageSetup();
    assert.equal(await usage.claimNotice('inst-1', JID, 'limit', '2026-11-03'), true);
    assert.equal(await usage.claimNotice('inst-1', JID, 'limit', '2026-11-03'), false);
    assert.equal(await usage.claimNotice('inst-1', JID, 'hours', '2026-11-03'), true);
    assert.equal(await usage.claimNotice('inst-1', JID, 'limit', '2026-11-04'), true);
    await usage.recordAnswer('inst-1', JID);
    assert.equal(await usage.claimNotice('inst-1', JID, 'hours', '2026-11-03'), false);
  });

  test('saveLimits: partial update, preset franchise, validation in Portuguese', async () => {
    const { usage } = usageSetup();
    const first = await usage.saveLimits('inst-1', { planName: 'Profissional' });
    assert.equal(first.previous, null);
    assert.equal(first.limits.monthlyResponses, 5000);

    const second = await usage.saveLimits('inst-1', {
      planName: 'Personalizado',
      monthlyResponses: 3000,
      alertPercent: 70,
    });
    assert.equal(second.previous?.monthlyResponses, 5000);
    assert.equal(second.limits.monthlyResponses, 3000);
    assert.equal(second.limits.alertPercent, 70);

    const cleared = await usage.saveLimits('inst-1', { monthlyResponses: null });
    assert.equal(cleared.limits.monthlyResponses, null);
    assert.equal(cleared.limits.alertPercent, 70);

    await assert.rejects(
      usage.saveLimits('inst-1', { businessHours: { timezone: 'Mars/Base' } }),
      /Fuso horário inválido/,
    );
    await assert.rejects(usage.saveLimits('inst-1', { overLimitAction: 'message' }), /mensagem/);
  });

  test('summary: month, today, excedente in blocks of 1,000, 30 days and masked top contacts', async () => {
    const { tables, usage } = usageSetup();
    await usage.saveLimits('inst-1', { planName: 'Essencial', dailyResponses: 200 });
    await tables.usageCounter.upsert({
      where: {
        instanceId_type_period_remoteJid: { instanceId: 'inst-1', type: 'month', period: '2026-11', remoteJid: '' },
      },
      create: { instanceId: 'inst-1', type: 'month', period: '2026-11', remoteJid: '', responses: 3233 },
      update: {},
    });
    await tables.usageCounter.create({
      data: { instanceId: 'inst-1', type: 'day', period: '2026-11-02', responses: 40 },
    });
    await usage.recordAnswer('inst-1', JID);
    await usage.recordAnswer('inst-1', '5511988887777@s.whatsapp.net');
    await usage.recordAnswer('inst-1', JID);

    const summary = await usage.getSummary('inst-1');
    assert.equal(summary.month.period, '2026-11');
    assert.equal(summary.month.responses, 3236);
    assert.equal(summary.month.limit, 2000);
    assert.equal(summary.month.excedente, 1236);
    assert.equal(summary.month.blocks1000, 2);
    assert.equal(summary.month.estimatedBRL, 98);
    assert.equal(summary.month.status, 'exceeded');
    assert.deepEqual(summary.today, {
      period: '2026-11-03',
      responses: 3,
      limit: 200,
      percent: 1.5,
      perContactLimit: null,
    });
    assert.equal(summary.last30Days.length, 30);
    assert.deepEqual(summary.last30Days.slice(-2), [
      { day: '2026-11-02', responses: 40 },
      { day: '2026-11-03', responses: 3 },
    ]);
    assert.deepEqual(summary.topContactsToday, [
      { contact: '5521•••••9723', responses: 2 },
      { contact: '5511•••••7777', responses: 1 },
    ]);
    assert.ok(!JSON.stringify(summary).includes('974699723'));
  });

  test('snapshot feeds the "Plano e uso" card and alerts at alertPercent and at 100%', async () => {
    const tables = createUsageTables([
      { id: 'a', name: 'escritorio' },
      { id: 'b', name: 'clinica' },
      { id: 'c', name: 'loja' },
    ]);
    const usage = new UsageService(tables, { now: () => TUESDAY_14H });
    await usage.saveLimits('a', { planName: 'Essencial', alertPercent: 70 });
    await usage.saveLimits('b', { planName: 'Premium' });
    const month = (instanceId: string, responses: number) =>
      tables.usageCounter.create({ data: { instanceId, type: 'month', period: '2026-11', responses } });
    await month('a', 1500); // 75% >= 70
    await month('b', 10_500); // 105%
    await month('c', 12); // no limit

    const items = await usage.snapshot();
    assert.deepEqual(
      items.map((item) => [item.name, item.percent]),
      [
        ['clinica', 105],
        ['escritorio', 75],
        ['loja', null],
      ],
    );

    const probe = new SystemProbe({ usage: () => usage.snapshot(), now: () => TUESDAY_14H });
    const overview = await new ObservabilityService({
      env: {},
      now: () => TUESDAY_14H,
      system: probe,
      http: () => ({
        get: async () => {
          throw new Error('offline');
        },
      }),
    }).getOverview();
    const card = overview.providers.find((item) => item.id === 'usage');
    assert.ok(card, 'usage card present');
    assert.equal(card.metrics.find((m) => m.id === 'usage:clinica').status, 'critical');
    assert.equal(card.metrics.find((m) => m.id === 'usage:escritorio').status, 'warning');
    assert.equal(card.metrics.find((m) => m.id === 'usage:loja').status, 'ok');
    assert.match(card.notes.join(' '), /clinica: franquia esgotada, 500 respostas de excedente \(1 bloco/);

    const usageAlerts = overview.alerts.filter((alert) => alert.provider === 'usage');
    assert.deepEqual(
      usageAlerts.map((alert) => alert.metric),
      ['usage:clinica', 'usage:escritorio'],
    );
    assert.match(usageAlerts[0].message, /franquia esgotada/);
  });
});

// ---------------------------------------------------------------------------------------- REST layer

describe('usage REST: validation and controller', () => {
  // Loaded here: as the first import, abstract.router enters an import cycle through the channel routers
  const validate = async (body: any) => {
    const { RouterBroker } = await import('@api/abstract/abstract.router');
    class Validator extends RouterBroker {}
    return new Validator().dataValidate<UsageLimitsDto>({
      request: {
        body,
        params: { instanceName: 'escritorio' },
        query: {},
        originalUrl: '/usage/limits/escritorio',
      } as any,
      schema: usageLimitsSchema,
      ClassRef: UsageLimitsDto,
      execute: async (_instance, data) => data,
    });
  };

  const rejects = async (body: any, pattern: RegExp) => {
    try {
      await validate(body);
    } catch (error) {
      assert.equal(error.status, 400);
      assert.match(JSON.stringify(error.message), pattern);
      return;
    }
    assert.fail(`accepted ${JSON.stringify(body)}`);
  };

  test('JSON schema accepts a full body and rejects bad values with Portuguese messages', async () => {
    const ok = await validate({
      planName: 'Essencial',
      monthlyResponses: 2000,
      dailyResponses: null,
      perContactDailyResponses: 30,
      overLimitAction: 'message',
      overLimitMessage: 'Atingimos o limite de hoje.',
      alertPercent: 80,
      businessHours: {
        enabled: true,
        mode: 'inside',
        timezone: 'America/Sao_Paulo',
        week: { mon: [['09:00', '18:00']], sat: [] },
      },
      outsideHoursMessage: null,
    });
    assert.equal(ok.monthlyResponses, 2000);

    await rejects({ monthlyResponses: 0 }, /monthlyResponses/);
    await rejects({ monthlyResponses: 1.5 }, /número inteiro/);
    await rejects({ overLimitAction: 'stop' }, /continue, pause ou message/);
    await rejects({ alertPercent: 120 }, /1 a 100/);
    await rejects({ planName: 'Gold' }, /Essencial/);
    await rejects({ businessHours: { mode: 'night' } }, /always, inside ou outside/);
    await rejects({ businessHours: { week: { mon: [['9h', '18:00']] } } }, /HH:MM/);
    await rejects({ businessHours: { week: { monday: [] } } }, /sun, mon/);
  });

  test('controller: 404 for an unknown instance, 400 for semantic errors, summary with the instance name', async () => {
    const tables = createUsageTables([{ id: 'inst-1', name: 'escritorio' }]);
    const controller = new UsageController(new UsageService(tables, { now: () => TUESDAY_14H }), tables);

    await assert.rejects(
      controller.getLimits({ instanceName: 'nao-existe' } as any),
      (error: any) => error.status === 404,
    );
    await assert.rejects(
      controller.saveLimits({ instanceName: 'escritorio' } as any, { overLimitAction: 'message' }),
      (error: any) => error.status === 400 && /mensagem/.test(JSON.stringify(error.message)),
    );

    const before = await controller.getLimits({ instanceName: 'escritorio' } as any);
    assert.equal(before.configured, false);
    assert.equal(before.limits.monthlyResponses, null);
    assert.deepEqual(before.presets, { Essencial: 2000, Profissional: 5000, Premium: 10000 });

    const saved = await controller.saveLimits({ instanceName: 'escritorio' } as any, { planName: 'Premium' });
    assert.equal(saved.limits.monthlyResponses, 10000);
    assert.equal(saved.previous, null);

    const summary = await controller.getSummary({ instanceName: 'escritorio' } as any);
    assert.equal(summary.instance, 'escritorio');
    assert.equal(summary.month.limit, 10000);
  });
});

// ------------------------------------------------------------------------------------- OpenAI service

function botSetup(
  options: { now?: number; settings?: Record<string, any>; session?: Record<string, any> | null } = {},
) {
  const instanceId = nextId('inst');
  const waInstance = createFakeWaInstance('usage', instanceId);
  const session =
    options.session === null
      ? null
      : {
          id: nextId('sess'),
          remoteJid: JID,
          sessionId: JID,
          instanceId,
          botId: 'bot-1',
          type: 'openai',
          status: 'opened',
          awaitUser: false,
          parameters: null,
          context: null,
          ...options.session,
        };
  const prisma = createPrismaMock(session ? [session] : []);
  const usage = new UsageService(prisma, { now: () => options.now ?? TUESDAY_14H });
  const service: any = new OpenaiService({ waInstances: { usage: waInstance } } as any, prisma, configService, usage);
  const openai = createFakeOpenai();
  useFakeOpenai(service, openai);

  const bot: any = {
    id: 'bot-1',
    botType: 'chatCompletion',
    openaiCredsId: 'creds-1',
    model: `gpt-4o-${nextId()}`,
    maxTokens: 300,
    tokenParam: null,
    systemMessages: ['Você é a assistente.'],
    assistantMessages: [],
    userMessages: [],
  };
  const settings: any = {
    unknownMessage: 'Desculpe, tive um problema.',
    keywordFinish: '#sair',
    splitMessages: false,
    timePerChar: 0,
    delayMessage: 0,
    keepOpen: false,
    ...options.settings,
  };

  const ask = (content = 'oi') =>
    service.process(
      waInstance,
      JID,
      bot,
      session ? structuredClone(prisma.sessions.get(session.id) ?? null) : null,
      settings,
      content,
      'Cliente',
    );
  const month = () => prisma.usage.count(instanceId, 'month', '2026-11');

  return { instanceId, waInstance, prisma, usage, service, openai, ask, month, session };
}

describe('OpenaiService: counting and enforcement', { concurrency: true }, () => {
  test('one answer split in three parts counts once', async () => {
    const t = botSetup({ settings: { splitMessages: true } });
    t.openai.reply('Parte 1\n\nParte 2\n\nParte 3');
    await t.ask('oi, tudo bem? quero marcar');

    assert.equal(texts(t.waInstance).length, 3);
    assert.equal(t.month(), 1);
    assert.equal(t.prisma.usage.count(t.instanceId, 'day', '2026-11-03'), 1);
    assert.equal(t.prisma.usage.count(t.instanceId, 'contact', '2026-11-03', JID), 1);
  });

  test('every answer counts, a new contact included; OpenAI failures (unknownMessage) do not', async () => {
    const t = botSetup({ session: null });
    await t.ask('primeira');
    assert.equal(t.month(), 1);

    const failing = botSetup();
    failing.openai.reply(new Error('boom'));
    await failing.ask();
    assert.deepEqual(texts(failing.waInstance), ['Desculpe, tive um problema.']);
    assert.equal(failing.month(), 0);
  });

  test('nothing is counted when a human took over before the answer went out', async () => {
    const t = botSetup();
    t.openai.reply(() => t.openai.completion('resposta'));
    const original = t.service.sendMessageWhatsApp.bind(t.service);
    t.service.sendMessageWhatsApp = async (...args: any[]) => {
      Object.assign(t.prisma.sessions.get(t.session.id), { status: 'paused', parameters: { manualPause: true } });
      return original(...args);
    };
    await t.ask();
    assert.equal(texts(t.waInstance).length, 0);
    assert.equal(t.month(), 0);
  });

  test('pause: over the franchise the AI does not call OpenAI nor answer', async () => {
    const t = botSetup();
    await t.usage.saveLimits(t.instanceId, { monthlyResponses: 2, overLimitAction: 'pause' });
    await t.ask('1');
    await t.ask('2');
    await t.ask('3');
    assert.equal(t.openai.requests.length, 2);
    assert.equal(texts(t.waInstance).length, 2);
    assert.equal(t.month(), 2);
  });

  test('continue: over the franchise the AI keeps answering and the excedente is counted', async () => {
    const t = botSetup();
    await t.usage.saveLimits(t.instanceId, { monthlyResponses: 1, overLimitAction: 'continue' });
    await t.ask('1');
    await t.ask('2');
    assert.equal(texts(t.waInstance).length, 2);
    const summary = await t.usage.getSummary(t.instanceId);
    assert.equal(summary.month.excedente, 1);
    assert.equal(summary.month.blocks1000, 1);
  });

  test('message: the overLimitMessage goes once per contact per day and is not counted', async () => {
    const t = botSetup();
    await t.usage.saveLimits(t.instanceId, {
      monthlyResponses: 1,
      overLimitAction: 'message',
      overLimitMessage: 'Nosso atendimento automático atingiu o limite. A equipe responde em breve.',
    });
    await t.ask('1');
    await t.ask('2');
    await t.ask('3');
    assert.deepEqual(texts(t.waInstance), [
      'resposta 1',
      'Nosso atendimento automático atingiu o limite. A equipe responde em breve.',
    ]);
    assert.equal(t.openai.requests.length, 1);
    assert.equal(t.month(), 1);
    assert.equal(t.waInstance.sent[1].fromChatbot, true, 'its echo never pauses the bot');
  });

  test('per-contact and daily caps', async () => {
    const t = botSetup();
    await t.usage.saveLimits(t.instanceId, { perContactDailyResponses: 1, dailyResponses: 5 });
    await t.ask('1');
    await t.ask('2');
    assert.equal(texts(t.waInstance).length, 1);

    const d = botSetup();
    await d.usage.saveLimits(d.instanceId, { dailyResponses: 1 });
    await d.usage.recordAnswer(d.instanceId, '5511900000000@s.whatsapp.net');
    await d.ask('1');
    assert.equal(texts(d.waInstance).length, 0);
    assert.equal(d.openai.requests.length, 0);
  });

  test('business hours "inside": outside the schedule only the outside message, once a day', async () => {
    const t = botSetup({ now: TUESDAY_20H });
    await t.usage.saveLimits(t.instanceId, {
      businessHours: { enabled: true, mode: 'inside' },
      outsideHoursMessage: 'Atendemos de segunda a sexta, das 9h às 18h.',
    });
    await t.ask('oi');
    await t.ask('alguém?');
    assert.deepEqual(texts(t.waInstance), ['Atendemos de segunda a sexta, das 9h às 18h.']);
    assert.equal(t.openai.requests.length, 0);
    assert.equal(t.month(), 0);

    const inside = botSetup({ now: TUESDAY_14H });
    await inside.usage.saveLimits(inside.instanceId, { businessHours: { enabled: true, mode: 'inside' } });
    await inside.ask('oi');
    assert.equal(texts(inside.waInstance).length, 1);
  });

  test('business hours "outside": the AI is silent while the team works', async () => {
    const t = botSetup({ now: TUESDAY_14H });
    await t.usage.saveLimits(t.instanceId, {
      businessHours: { enabled: true, mode: 'outside' },
      outsideHoursMessage: 'não deve ir',
    });
    await t.ask('oi');
    assert.equal(t.waInstance.sent.length, 0);
  });

  test('blocked + human pause: nothing is sent; the finish keyword still closes the session', async () => {
    const paused = botSetup({ session: { status: 'paused', parameters: { manualPause: true } } });
    await paused.usage.saveLimits(paused.instanceId, {
      monthlyResponses: 1,
      overLimitAction: 'message',
      overLimitMessage: 'limite',
    });
    await paused.usage.recordAnswer(paused.instanceId, JID);
    await paused.ask('oi');
    assert.equal(paused.waInstance.sent.length, 0);

    const finish = botSetup();
    await finish.usage.saveLimits(finish.instanceId, { monthlyResponses: 1, overLimitAction: 'pause' });
    await finish.usage.recordAnswer(finish.instanceId, JID);
    await finish.ask('#sair');
    assert.equal(finish.prisma.sessions.has(finish.session.id), false, 'session removed (keepOpen=false)');
  });
});
