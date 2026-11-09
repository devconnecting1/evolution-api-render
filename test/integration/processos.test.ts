import '../helpers/setup';

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { PrismaRepository } from '@api/repository/repository.service';
import { ProcessosService } from '@api/services/processos.service';
import { configService } from '@config/env.config';
import { zonedParts } from '@utils/usageLimits';

import { waitFor } from '../helpers/fakes';
import { migrateTestDatabase, SKIP_INTEGRATION } from '../helpers/integration';

/** Fictional numbers (valid check digits). */
const TJRJ = '0001234-04.2026.8.19.0001';
const TJRJ_DIGITS = '00012340420268190001';
const TRT1 = '0100000-79.2025.5.01.0001';
const CLIENT = '5521988887777@s.whatsapp.net';
const NEUTRAL = 'Olá, Maria. Houve uma atualização no seu processo. O escritório vai analisar e entrar em contato.';

type Mov = { codigo: number; nome: string; dataHora: string; complementosTabelados?: any[] };

describe('Processos (integration, PostgreSQL)', { skip: SKIP_INTEGRATION }, () => {
  const prisma = new PrismaRepository(configService);
  const sent: { number: string; text: string }[] = [];
  const channel = {
    connectionStatus: { state: 'open' },
    textMessage: async (data: any, _integration: boolean, fromChatbot: boolean) => {
      assert.equal(fromChatbot, true, 'notifications never look like a human typing (no human pause)');
      sent.push({ number: data.number, text: data.text });
      return {};
    },
  };
  const waMonitor = { waInstances: {} as Record<string, any> };
  let clock = new Date(Math.floor(Date.now() / 60_000) * 60_000);
  const advance = (hours: number) => {
    clock = new Date(clock.getTime() + hours * 3600_000);
  };

  // fake external APIs
  const datajud: Record<string, { movimentos: Mov[]; nivelSigilo?: number } | null> = {};
  let djenItems: any[] = [];
  let datajudCalls = 0;
  const fetchImpl = async (url: string, init: any) => {
    if (url.includes('datajud')) {
      datajudCalls++;
      const digits = JSON.parse(init.body).query.match.numeroProcesso;
      const doc = datajud[digits];
      const hits = doc
        ? [
            {
              _source: {
                numeroProcesso: digits,
                classe: { nome: 'Procedimento Comum Cível' },
                assuntos: [{ nome: 'Indenização por Dano Moral' }],
                orgaoJulgador: { nome: '1ª Vara Cível Fictícia' },
                dataAjuizamento: '20260105000000',
                nivelSigilo: doc.nivelSigilo ?? 0,
                movimentos: doc.movimentos,
              },
            },
          ]
        : [];
      return { ok: true, status: 200, json: async () => ({ hits: { hits } }), text: async () => '' };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ count: djenItems.length, items: djenItems }),
      text: async () => '',
    };
  };

  const service = new ProcessosService(prisma, waMonitor, {
    fetchImpl: fetchImpl as any,
    pauseMs: 0,
    now: () => clock,
  });
  let instanceId = '';
  let otherInstanceId = '';

  const mov = (nome: string, iso: string, extra: Partial<Mov> = {}): Mov => ({
    codigo: 60,
    nome,
    dataHora: iso,
    ...extra,
  });
  const enable = (extra: Record<string, any> = {}) =>
    service.saveSettings(instanceId, {
      enabled: true,
      notifyNumbers: ['5521999990000'],
      quietHours: { enabled: false },
      ...extra,
    });
  /** Makes every item due and runs one tick. */
  const dueTick = async () => {
    advance(7);
    return service.tick({ force: true });
  };

  before(async () => {
    migrateTestDatabase();
    await prisma.$connect();
    const name = `proc-it-${Date.now()}`;
    instanceId = (await prisma.instance.create({ data: { name, integration: 'WHATSAPP-BAILEYS' } })).id;
    otherInstanceId = (await prisma.instance.create({ data: { name: `${name}-b`, integration: 'WHATSAPP-BAILEYS' } }))
      .id;
    waMonitor.waInstances[name] = channel;
  });

  after(async () => {
    await prisma.instance.deleteMany({ where: { id: { in: [instanceId, otherInstanceId] } } });
    await prisma.$disconnect();
  });

  test('add validates the number; the first import stores movements as seen and notifies nobody', async () => {
    await assert.rejects(service.add(instanceId, { numero: '0001234-05.2026.8.19.0001' }), /Dígito verificador/);
    await enable();
    datajud[TJRJ_DIGITS] = {
      movimentos: [mov('Distribuição', '2026-01-05T10:00:00Z'), mov('Conclusão', '2026-03-01T10:00:00Z')],
    };
    const row = await service.add(instanceId, {
      numero: TJRJ,
      apelido: 'Silva x Banco Fictício',
      clientName: 'Maria Fictícia',
    });
    assert.equal(row.tribunalAlias, 'tjrj');
    await assert.rejects(service.add(instanceId, { numero: TJRJ }), /já está na lista/);

    await waitFor(async () => (await prisma.process.findUnique({ where: { id: row.id } })).initialized, 5000, 'import');
    const movements = await prisma.processMovement.findMany({ where: { processId: row.id } });
    assert.equal(movements.length, 2);
    assert.ok(movements.every((m) => m.seenAt && m.notifyStatus === 'none'));
    const stored = await prisma.process.findUnique({ where: { id: row.id } });
    assert.equal(stored.classe, 'Procedimento Comum Cível');
    assert.equal(stored.lastMovementAt.toISOString(), '2026-03-01T10:00:00.000Z');

    await dueTick();
    assert.equal(sent.length, 0, 'first import never notifies');
  });

  test('a new movement notifies the team once with the full detail (dedupe on the next run)', async () => {
    datajud[TJRJ_DIGITS].movimentos.push(
      mov('Juntada de Petição', '2026-11-03T15:00:00Z', {
        complementosTabelados: [{ descricao: 'tipo_de_peticao', nome: 'Manifestação' }],
      }),
    );
    const result: any = await dueTick();
    assert.equal(result.newMovements, 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].number, '5521999990000');
    assert.match(
      sent[0].text,
      /^Nova movimentação — Silva x Banco Fictício \(TJRJ\)\n03\/11\/2026 · Juntada de Petição\ntipo de peticao: Manifestação/,
    );

    await dueTick();
    assert.equal(sent.length, 1, 'same response: nothing new, nothing sent');
    const list = await service.list(instanceId, { view: 'news' });
    assert.equal(list.items.length, 1);
    assert.equal(list.items[0].status, 'novidade');
    assert.equal(list.counts.news, 1);
  });

  test('client notice: only the neutral template, only to the linked contact, never under segredo', async () => {
    const [row] = await prisma.process.findMany({ where: { instanceId, numeroDigits: TJRJ_DIGITS } });
    await assert.rejects(service.update(instanceId, row.id, { notifyClient: true }), /vincule antes o contato/);
    await service.update(instanceId, row.id, {
      remoteJid: '+55 21 98888-7777',
      notifyClient: true,
      clientName: 'Maria Souza',
    });

    sent.length = 0;
    datajud[TJRJ_DIGITS].movimentos.push(mov('Julgado procedente o pedido', '2026-11-05T15:00:00Z'));
    await dueTick();
    const client = sent.filter((s) => s.number === '5521988887777');
    assert.equal(client.length, 1);
    assert.equal(client[0].text, NEUTRAL);
    assert.doesNotMatch(client[0].text, /procedente|Julgado|prazo/i);
    assert.match(sent.find((s) => s.number === '5521999990000').text, /Julgado procedente o pedido/);

    // segredo de justiça: the team is still told, the client never
    await service.update(instanceId, row.id, { segredoJustica: true });
    advance(24);
    sent.length = 0;
    datajud[TJRJ_DIGITS].movimentos.push(mov('Audiência designada', '2026-11-07T15:00:00Z'));
    await dueTick();
    assert.equal(sent.filter((s) => s.number === '5521988887777').length, 0);
    assert.equal(sent.filter((s) => s.number === '5521999990000').length, 1);
    await service.update(instanceId, row.id, { segredoJustica: false });
  });

  test('quiet hours hold the notifications until they end', async () => {
    const minutes = zonedParts(clock, 'America/Sao_Paulo').minutes;
    const hhmm = (m: number) => {
      const v = ((m % 1440) + 1440) % 1440;
      return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
    };
    // quiet from now+6h to now+16h: the next due run (7 h later) falls inside
    await enable({ quietHours: { enabled: true, start: hhmm(minutes + 6 * 60), end: hhmm(minutes + 16 * 60) } });
    sent.length = 0;
    datajud[TJRJ_DIGITS].movimentos.push(mov('Expedição de documento', '2026-11-08T15:00:00Z'));
    await dueTick();
    assert.equal(sent.length, 0, 'held');
    assert.equal(await prisma.processMovement.count({ where: { notifyStatus: 'pending' } }), 1);
    assert.ok(service.state.pendingMayExist);

    advance(10); // past the end of the quiet hours
    await service.tick({ force: true });
    assert.equal(sent.filter((s) => s.number === '5521999990000').length, 1);
    await enable();
  });

  test('DJEN: first import silent, then new publications are linked to the process and sent to the team', async () => {
    await assert.rejects(service.addOab(instanceId, { numeroOab: 'x', ufOab: 'RJ' }), /OAB inválido/);
    await service.addOab(instanceId, { numeroOab: '123456', ufOab: 'rj', label: 'Dra. Fictícia' });
    djenItems = [
      {
        id: 1001,
        data_disponibilizacao: '2026-11-02',
        siglaTribunal: 'TJRJ',
        tipoComunicacao: 'Intimação',
        texto: '<p>Antiga</p>',
        numero_processo: TJRJ_DIGITS,
      },
    ];
    sent.length = 0;
    await dueTick();
    assert.equal(sent.length, 0);
    djenItems.push({
      id: 1002,
      data_disponibilizacao: '2026-11-08',
      siglaTribunal: 'TJRJ',
      tipoComunicacao: 'Intimação',
      texto: '<p>Fica a parte intimada para se manifestar.</p>',
      numero_processo: TJRJ_DIGITS,
      link: 'https://comunica.pje.jus.br/ficticio',
    });
    await dueTick();
    const team = sent.filter((s) => s.number === '5521999990000');
    assert.equal(team.length, 1);
    assert.equal(
      team[0].text,
      `Nova intimação/publicação no DJEN — TJRJ · ${TJRJ}\nIntimação\nFica a parte intimada para se manifestar.\nhttps://comunica.pje.jus.br/ficticio`,
    );
    const client = sent.filter((s) => s.number === '5521988887777');
    assert.ok(client.every((c) => c.text === NEUTRAL));

    const pubs = await service.listPublications(instanceId, { unseen: true });
    assert.equal(pubs.total, 1);
    assert.equal(pubs.items[0].Process.numeroCnj, TJRJ);
    assert.equal((await service.markPublicationsSeen(instanceId, { all: true })).marked, 1);
    assert.equal((await service.badge(instanceId)).unseenPublications, 0);
  });

  test('AI context: only the linked contact, opt-in, dates only, never other clients or segredo', async () => {
    const [row] = await prisma.process.findMany({ where: { instanceId, numeroDigits: TJRJ_DIGITS } });
    assert.equal(await service.aiContext(instanceId, CLIENT), null, 'allowAiAnswer is off by default');
    await service.update(instanceId, row.id, { allowAiAnswer: true });
    // the settings cache lives 60 s; the process query is fresh
    const block = await service.aiContext(instanceId, CLIENT);
    assert.match(
      block,
      new RegExp(`Processo nº ${TJRJ.replace(/\./g, '\\.')}: atualizações registradas em 08/11/2026`),
    );
    assert.doesNotMatch(block, /Julgado|procedente|Audiência|Expedição/);
    assert.equal(await service.aiContext(instanceId, '5521977776666@s.whatsapp.net'), null, 'another contact');
    assert.equal(await service.aiContext(otherInstanceId, CLIENT), null, 'another instance');
    assert.ok(await service.aiContext(instanceId, '552188887777@s.whatsapp.net'), 'same number without the 9th digit');
    await service.update(instanceId, row.id, { segredoJustica: true });
    assert.equal(await service.aiContext(instanceId, CLIENT), null, 'segredo de justiça');
    await service.update(instanceId, row.id, { segredoJustica: false });
  });

  test('bulk add, manual sync rate limit, CSV and the in-memory due time', async () => {
    const result = await service.bulkAdd(instanceId, `${TJRJ}\n${TRT1}\n0001234-05.2026.8.19.0001\nsem número`);
    assert.deepEqual(result.added, [TRT1]);
    assert.deepEqual(result.duplicates, [TJRJ]);
    assert.equal(result.invalid.length, 2);

    const [row] = await prisma.process.findMany({ where: { instanceId, numeroDigits: TJRJ_DIGITS } });
    await service.manualSync(instanceId, row.id);
    await assert.rejects(service.manualSync(instanceId, row.id), /Tente de novo em 1 minuto/);

    const csv = await service.exportCsv(instanceId);
    assert.ok(csv.startsWith('﻿Processo;Apelido;Cliente;Tribunal'));
    assert.match(csv, new RegExp(TJRJ.replace(/\./g, '\\.')));

    await service.tick({ force: true });
    const calls = datajudCalls;
    const skipped: any = await service.tick();
    assert.equal(skipped.skipped, 'not-due', 'nothing due: the ticker does not even query the database');
    assert.equal(datajudCalls, calls);
  });

  test('a process not found in the DataJud gets a clear error and stays uninitialized', async () => {
    const [row] = await prisma.process.findMany({ where: { instanceId, numeroDigits: TRT1.replace(/\D/g, '') } });
    const stored = await waitFor(
      async () => (await prisma.process.findUnique({ where: { id: row.id } })).lastError,
      5000,
      'import of TRT1',
    );
    void stored;
    const after = await prisma.process.findUnique({ where: { id: row.id } });
    assert.equal(after.initialized, false);
    assert.match(after.lastError, /Não encontrado no DataJud/);
    const list = await service.list(instanceId, {});
    assert.equal(list.items.find((p: any) => p.id === row.id).status, 'erro');
  });
});
