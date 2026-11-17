import '../helpers/setup';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { EventController } from '@api/integrations/event/event.controller';
import { dbActivity, DbActivityDailyStore, DbActivityTracker, softCacheValid } from '@api/repository/db-activity';
import { AgendaService } from '@api/services/agenda.service';
import { ChannelStartupService } from '@api/services/channel.service';
import { RecentWrites } from '@utils/recent-writes';

import { createAgendaTables } from '../helpers/agenda-mock';
import { createBaileysService } from '../helpers/baileys';

/**
 * Acordadas do Neon de madrugada: caches que venciam e relíam o banco no primeiro evento do WhatsApp, a reconferência
 * da agenda a cada 6 h e contatos regravados iguais. Nenhum destes testes toca em conexão, sessão ou credenciais do
 * WhatsApp.
 */

const HOUR = 3_600_000;
const MIN = 60_000;

describe('neon acordadas: cache que não acorda o banco', () => {
  test('softCacheValid: dentro do TTL vale; vencido só relê com o banco acordado; nunca passa de 24 h', () => {
    const now = 10 * 24 * HOUR;
    const asleep = () => false;
    const awake = () => true;
    assert.equal(softCacheValid(now - 10 * MIN, HOUR, { now, awake: asleep }), true);
    assert.equal(softCacheValid(now - 2 * HOUR, HOUR, { now, awake: asleep }), true, 'vencido + dormindo: segue');
    assert.equal(softCacheValid(now - 2 * HOUR, HOUR, { now, awake }), false, 'vencido + acordado: relê');
    assert.equal(softCacheValid(now - 25 * HOUR, HOUR, { now, awake: asleep }), false, 'limite de 24 h');
  });

  test('DbActivityTracker.isAwake: consultou há menos de 4 min', () => {
    let clock = 1_000_000;
    const tracker = new DbActivityTracker(5 * MIN, () => clock);
    assert.equal(tracker.isAwake(), false);
    tracker.record('SELECT 1');
    assert.equal(tracker.isAwake(), true);
    clock += 4 * MIN + 1;
    assert.equal(tracker.isAwake(), false);
    assert.equal(tracker.lastQueryAt(), 1_000_000);
  });

  // Este processo de teste não consultou nenhum banco: dbActivity começa "dormindo".
  test('configurações da instância: TTL vencido de madrugada não relê; com o banco acordado relê', async () => {
    const calls: string[] = [];
    const svc: any = Object.create(ChannelStartupService.prototype);
    svc.settingsCache = null;
    svc.localSettings = {};
    Object.defineProperty(svc, 'instanceId', { get: () => 'i1' });
    svc.prismaRepository = {
      setting: {
        findUnique: async () => {
          calls.push('findUnique');
          return { groupsIgnore: true };
        },
      },
    };
    await svc.findSettings();
    svc.settingsCache.at -= 2 * HOUR; // TTL (1 h) vencido
    for (let i = 0; i < 50; i++) await svc.findSettings(); // eventos de presença/recibo da madrugada
    assert.equal(calls.length, 1, 'nenhuma consulta com o banco dormindo');

    svc.settingsCache.at -= 23 * HOUR; // 25 h: limite de atraso
    await svc.findSettings();
    assert.equal(calls.length, 2);

    svc.settingsCache.at -= 2 * HOUR;
    dbActivity.record('SELECT "public"."Message"'); // outra consulta acabou de acordar o banco
    await svc.findSettings();
    assert.equal(calls.length, 3, 'releitura de carona');
  });

  test('configuração de eventos (webhook): o mesmo vale para o cache do EventController', async () => {
    const calls: string[] = [];
    const prisma: any = {
      webhook: {
        findUnique: async () => {
          calls.push('findUnique');
          return { enabled: true, url: 'https://a' };
        },
      },
    };
    const controller = new EventController(
      prisma,
      { waInstances: { Loja: { instanceId: 'loja-1' } } } as any,
      true,
      'webhook',
    );
    const ttl = EventController.CONFIG_TTL_MS;
    try {
      await controller.get('Loja');
      EventController.CONFIG_TTL_MS = -1;
      const awake = dbActivity.isAwake();
      await controller.get('Loja');
      assert.equal(calls.length, awake ? 2 : 1);
      dbActivity.record('SELECT 1');
      await controller.get('Loja');
      assert.equal(calls.length, awake ? 3 : 2);
    } finally {
      EventController.CONFIG_TTL_MS = ttl;
      EventController.forgetInstance();
    }
  });
});

describe('neon acordadas: reconferência da agenda', () => {
  function agendaWith(start: number) {
    let clock = start;
    let awake = false;
    const prisma = createAgendaTables(undefined, () => clock);
    const sent: string[] = [];
    const agenda = new AgendaService(prisma, undefined, {
      now: () => clock,
      cacheTtlMs: 0,
      dbAwake: () => awake,
      sendText: async (_id, _jid, text) => {
        sent.push(text);
        return true;
      },
    });
    let ticks = 0;
    const tick = agenda.tick.bind(agenda);
    (agenda as any).tick = async () => {
      ticks++;
      return tick();
    };
    return {
      agenda,
      sent,
      ticks: () => ticks,
      run: () => (agenda as any).runIfDue(),
      setNow: (ms: number) => (clock = ms),
      setAwake: (value: boolean) => (awake = value),
      now: () => clock,
    };
  }

  test('sem nada para enviar: a reconferência de 6 h espera o banco acordar (no máximo 24 h)', async () => {
    const start = Date.UTC(2026, 10, 17, 3, 0);
    const t = agendaWith(start);
    await t.agenda.saveSettings('inst-a', { enabled: true });
    await t.run();
    assert.equal(t.ticks(), 1);

    for (const hours of [6, 9, 12, 18]) {
      t.setNow(start + hours * HOUR + MIN);
      await t.run();
    }
    assert.equal(t.ticks(), 1, 'madrugada sem consulta: não acorda o Neon');

    t.setAwake(true);
    await t.run();
    assert.equal(t.ticks(), 2, 'de carona em outra consulta');

    t.setAwake(false);
    t.setNow(start + 18 * HOUR + MIN + 24 * HOUR + MIN);
    await t.run();
    assert.equal(t.ticks(), 3, 'limite de 24 h');
  });

  test('lembrete conhecido além de 6 h: dorme até ele e envia na hora, mesmo com o banco dormindo', async () => {
    const start = Date.UTC(2026, 10, 17, 3, 0);
    const t = agendaWith(start);
    await t.agenda.saveSettings('inst-a', { enabled: true });
    await t.agenda.createAppointment('inst-a', {
      remoteJid: '5511988887777@s.whatsapp.net',
      startsAt: new Date(start + 40 * HOUR),
      source: 'manual',
      enforceAvailability: false,
    });
    await t.run(); // escrita neste processo zera o próximo horário: roda já
    assert.equal(t.ticks(), 1);
    t.setNow(start + 7 * HOUR);
    await t.run();
    assert.equal(t.ticks(), 1);

    // 24 h antes do início (o primeiro lembrete), com o banco dormindo: roda e envia
    t.setNow(start + 16 * HOUR + 5 * MIN);
    await t.run();
    assert.equal(t.ticks(), 2);
    assert.equal(t.sent.length, 1);
  });

  test('alteração feita neste processo roda na hora, dormindo ou não', async () => {
    const start = Date.UTC(2026, 10, 17, 3, 0);
    const t = agendaWith(start);
    await t.agenda.saveSettings('inst-a', { enabled: true });
    await t.run();
    t.setNow(start + 7 * HOUR);
    await t.agenda.saveSettings('inst-a', { enabled: true, timezone: 'America/Sao_Paulo' });
    await t.run();
    assert.equal(t.ticks(), 2);
  });
});

describe('neon acordadas: resumo diário que sobrevive ao deploy', () => {
  function fakeStore() {
    const data = new Map<string, Record<string, string>>();
    let ready = true;
    const store: DbActivityDailyStore = {
      increment: async (key, fields) => {
        if (!ready) throw new Error('redis down');
        const row = data.get(key) ?? {};
        for (const field of fields) row[field] = String(Number(row[field] ?? 0) + 1);
        data.set(key, row);
      },
      read: async (key) => data.get(key) ?? null,
    };
    return { store, data, setReady: (value: boolean) => (ready = value) };
  }

  test('acordadas por dia, hora e causa no Redis; um deploy novo continua somando', async () => {
    const day = Date.UTC(2026, 10, 12, 4, 4);
    let clock = day;
    const redis = fakeStore();
    const first = new DbActivityTracker(5 * MIN, () => clock);
    first.attachDailyStore(redis.store);
    first.record('SELECT "public"."Setting"');
    for (const minutes of [30, 60]) {
      clock = day + minutes * MIN;
      first.record('SELECT "id" FROM "public"."Setting" WHERE 1');
    }
    await first.flushDaily();

    // deploy: processo novo, memória zerada
    const second = new DbActivityTracker(5 * MIN, () => clock);
    second.attachDailyStore(redis.store);
    clock += 10 * MIN;
    second.record('INSERT INTO "public"."Contact"');
    clock += 10 * MIN;
    second.record('INSERT INTO "public"."Contact"');
    redis.setReady(false);
    clock += 10 * MIN;
    second.record('DELETE FROM "public"."AuthStateKey"');
    await second.flushDaily(); // falha: fica pendente
    redis.setReady(true);
    const daily = await second.daily(3);
    assert.equal(daily.length, 1);
    assert.equal(daily[0].date, '2026-11-12');
    assert.equal(daily[0].wakes, 4);
    assert.deepEqual(daily[0].topCauses, [
      { cause: 'SELECT Setting', count: 2 },
      { cause: 'INSERT Contact', count: 1 },
      { cause: 'DELETE AuthStateKey', count: 1 },
    ]);
    assert.equal(daily[0].byHourUtc[4], 1);
    assert.equal(daily[0].byHourUtc[5], 3);
    assert.ok(!JSON.stringify(daily).includes('WHERE'), 'só verbo e tabela');
    assert.equal(second.snapshot().totalQueries, 3, 'o registro em memória continua igual');
  });

  test('sem Redis: daily vazio e nada quebra', async () => {
    const tracker = new DbActivityTracker();
    tracker.record('SELECT 1');
    assert.deepEqual(await tracker.daily(), []);
  });
});

describe('neon acordadas: contatos regravados iguais', () => {
  test('RecentWrites: lembra o valor gravado e esquece o mais antigo', () => {
    const writes = new RecentWrites(2);
    writes.remember('a', '1');
    writes.remember('b', '1');
    assert.equal(writes.unchanged('a', '1'), true);
    assert.equal(writes.unchanged('a', '2'), false);
    writes.remember('c', '1');
    assert.equal(writes.unchanged('a', '1'), false);
    assert.equal(writes.size, 2);
  });

  function baileysWithContacts() {
    const { service } = createBaileysService();
    const calls: { op: string; count: number }[] = [];
    const original = service.prismaRepository;
    service.prismaRepository = new Proxy(original, {
      get: (target: any, name: string) => {
        if (name === 'contact') {
          return {
            createMany: async (args: any) => void calls.push({ op: 'createMany', count: args.data.length }),
            updateMany: async () => void calls.push({ op: 'updateMany', count: 1 }),
            upsert: (args: any) => ({ op: 'upsert', args }),
          };
        }
        if (name === '$transaction')
          return async (list: any[]) => void calls.push({ op: 'transaction', count: list.length });
        return target[name];
      },
    });
    const config = service.configService;
    service.configService = {
      get: (key: string) => {
        const value = config.get(key);
        return key === 'DATABASE' ? { ...value, SAVE_DATA: { ...value.SAVE_DATA, CONTACTS: true } } : value;
      },
    };
    return { service, calls };
  }

  test('contacts.upsert repetido: grava só o que este processo ainda não gravou', async () => {
    const { service, calls } = baileysWithContacts();
    const contacts = [
      { id: '5511911111111@s.whatsapp.net', name: 'Ana' },
      { id: '5511922222222@s.whatsapp.net', name: 'Bia' },
    ];
    await service.contactHandle['contacts.upsert'](contacts);
    assert.deepEqual(calls, [
      { op: 'createMany', count: 2 },
      { op: 'updateMany', count: 1 },
      { op: 'updateMany', count: 1 },
    ]);
    calls.length = 0;
    for (let i = 0; i < 5; i++) await service.contactHandle['contacts.upsert'](contacts);
    assert.deepEqual(calls, [], 'reenvios iguais da madrugada não vão ao banco');

    await service.contactHandle['contacts.upsert']([...contacts, { id: '5511933333333@s.whatsapp.net', name: 'Caio' }]);
    assert.deepEqual(calls, [
      { op: 'createMany', count: 1 },
      { op: 'updateMany', count: 1 },
    ]);
  });

  test('contacts.update: upsert só quando nome ou foto mudam', async () => {
    const { service, calls } = baileysWithContacts();
    const update = (name: string) =>
      service.contactHandle['contacts.update']([{ id: '5511944444444@s.whatsapp.net', name }]);
    await update('Davi');
    await update('Davi');
    await update('Davi');
    assert.deepEqual(calls, [{ op: 'transaction', count: 1 }]);
    await update('Davi Souza');
    assert.deepEqual(calls.at(-1), { op: 'transaction', count: 1 });
    assert.equal(calls.length, 2);
  });
});
