import '../helpers/setup';

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import { LeadsService } from '@api/services/leads.service';
import { zonedParts } from '@utils/usageLimits';

import { OpenaiHarness, SKIP_INTEGRATION } from '../helpers/integration';
import { createFakeExtractor, extraction } from '../helpers/leads-mock';

/**
 * "Leads (triagem)" on a real PostgreSQL: the migration, the hook after the real bot answer (through the controller
 * emit), the human takeover ending the wait, list ordering with NULLS LAST, counts, CSV and the backfill SQL.
 * Every name and number is fictional.
 */
describe('leads (integration)', { skip: SKIP_INTEGRATION }, () => {
  let h: OpenaiHarness;
  let extractor: ReturnType<typeof createFakeExtractor>;
  let leads: LeadsService;

  before(async () => {
    h = await new OpenaiHarness().start();
  });

  after(async () => {
    await h?.stop();
  });

  beforeEach(() => {
    h.openai.reset();
    extractor = createFakeExtractor([
      extraction({
        name: 'Paula Fictícia',
        area: 'Trabalhista',
        city: 'Cidade Fictícia',
        summary: 'Demitida sem verbas; audiência marcada.',
        urgentType: 'audiencia',
        urgentFact: 'audiência em 12/11',
        clearNeed: true,
        missingInfo: ['data da demissão'],
        opposingParty: 'Loja Fictícia Ltda',
        documentsMentioned: ['carta de demissão'],
      }),
    ]);
    leads = new LeadsService(h.prisma, h.service.usage, h.waMonitor, {
      openai: () => extractor.client,
      provider: 'postgresql',
    });
    h.service.leads = leads;
  });

  /** The channel stores every message before the bot sees it: do the same for the fake channel. */
  const store = async (instanceId: string, remoteJid: string, text: string, fromMe = false, at = Date.now()) =>
    h.prisma.message.create({
      data: {
        instanceId,
        key: { id: `T${Math.random().toString(36).slice(2)}`, remoteJid, fromMe },
        pushName: fromMe ? null : 'Paula',
        messageType: 'conversation',
        message: { conversation: text },
        messageTimestamp: Math.floor(at / 1000),
        source: 'unknown',
      },
    });

  test('after the third client message the bot answer creates the lead; extraction is not a plan answer', async () => {
    const t = await h.createTenant();
    const jid = t.contact();
    const say = async (text: string) => {
      await store(t.instance.instanceId, jid, text);
      await t.client(jid, text);
      await leads.idle();
    };

    h.openai.reply('Olá! Como posso ajudar?', 'Entendi. Qual a sua cidade?', 'Obrigada, o advogado vai analisar.');
    await say('Oi, fui demitida [origem: site]');
    await say('Tenho audiência dia 12/11');
    assert.equal(extractor.requests.length, 0, 'two client messages: no analysis yet');
    await say('Sou Paula, de Cidade Fictícia');
    assert.equal(extractor.requests.length, 1);

    const lead = await h.prisma.lead.findFirst({ where: { instanceId: t.instance.instanceId } });
    assert.ok(lead);
    assert.equal(lead.remoteJid, jid);
    assert.equal(lead.status, 'qualificado');
    assert.equal(lead.priority, 'alta');
    assert.equal(lead.priorityRank, 0);
    assert.equal(lead.priorityReason, 'audiência em 12/11');
    assert.equal(lead.source, 'site');
    assert.deepEqual(lead.missingInfo, ['data da demissão']);
    assert.ok(lead.awaitingHumanSince);
    assert.equal(t.texts().length, 3, 'only the three bot answers went to the client');

    const month = await h.prisma.usageCounter.findUnique({
      where: {
        instanceId_type_period_remoteJid: {
          instanceId: t.instance.instanceId,
          type: 'month',
          period: zonedParts(new Date(), 'America/Sao_Paulo').month,
          remoteJid: '',
        },
      },
    });
    assert.equal(month?.responses, 3, 'the analysis is not counted as an answer');

    // A person of the team writes from the phone: the human takeover ends the wait for the team
    await t.human(jid, 'Oi Paula, aqui é do escritório. Vamos marcar?');
    await leads.idle();
    const after = await h.prisma.lead.findUnique({ where: { id: lead.id } });
    assert.equal(after?.awaitingHumanSince, null);
    assert.ok(after?.lastHumanReplyAt);
  });

  test('list order (priority, then NULLS LAST wait), counts, edit and CSV on PostgreSQL', async () => {
    const t = await h.createTenant();
    const id = t.instance.instanceId;
    const now = Date.now();
    const make = (k: number, data: Record<string, any>) =>
      h.prisma.lead.create({
        data: {
          instanceId: id,
          remoteJid: `552190000010${k}@s.whatsapp.net`,
          lastMessageAt: new Date(now - k * 60_000),
          ...data,
        },
      });
    await make(1, { name: 'Sem Espera', status: 'novo' });
    await make(2, { name: 'Espera Curta', status: 'qualificado', awaitingHumanSince: new Date(now - 3_600_000) });
    await make(3, {
      name: 'Urgente',
      status: 'novo',
      priority: 'alta',
      priorityRank: 0,
      awaitingHumanSince: new Date(now - 60_000),
    });
    await make(4, { name: 'Espera Longa', status: 'qualificado', awaitingHumanSince: new Date(now - 7_200_000) });
    await make(5, { name: 'Cliente', status: 'cliente', area: 'Família' });

    const list = await leads.list(id, {});
    assert.deepEqual(
      list.leads.map((lead: any) => lead.name),
      ['Urgente', 'Espera Longa', 'Espera Curta', 'Sem Espera', 'Cliente'],
    );
    assert.equal(list.counts.todos, 5);
    assert.equal(list.counts.aguardando, 3);
    assert.equal(list.counts.qualificado, 2);
    assert.equal((await leads.list(id, { search: 'ESPERA' })).total, 3, 'case-insensitive search');

    const target = list.leads.find((lead: any) => lead.name === 'Espera Longa');
    // em_atendimento keeps waiting now; descartado is the status that leaves the queue
    const edited = await leads.update(id, target.id, { status: 'descartado' });
    assert.equal(edited?.lead.awaitingHumanSince, null);
    assert.equal((await leads.list(id, { status: 'aguardando' })).total, 2);

    const csv = await leads.exportCsv(id, { status: 'cliente' });
    assert.ok(csv.startsWith('\uFEFFNome;'));
    assert.match(csv, /\r\nCliente;55 \(21\) 90000-0105;Família;/);
  });

  test('backfill: the GROUP BY over the stored messages finds conversations never analysed', async () => {
    const t = await h.createTenant();
    const id = t.instance.instanceId;
    const now = Date.now();
    const old = `5521900000${String(Date.now() % 10000).padStart(4, '0')}1@s.whatsapp.net`;
    const few = `5521900000${String(Date.now() % 10000).padStart(4, '0')}2@s.whatsapp.net`;
    for (let k = 0; k < 4; k++) await store(id, old, `mensagem ${k}`, false, now - 86_400_000 + k * 1000);
    await store(id, old, 'resposta', true, now - 86_000_000);
    for (let k = 0; k < 2; k++) await store(id, few, `oi ${k}`, false, now - 3_600_000 + k);
    await store(id, '120363000000000099@g.us', 'grupo', false, now - 1000);

    const dry = await leads.backfill(id, t.name, { days: 7, dryRun: true });
    assert.equal(dry.candidates, 1);

    const run = await leads.backfill(id, t.name, { days: 7, max: 10 });
    assert.equal(run.started, true);
    await leads.idle();
    const status = leads.backfillStatus(id);
    assert.equal(status.created, 1);
    assert.equal(extractor.requests[0].model, 'gpt-4o-mini', 'the model of the bot');
    const lead = await h.prisma.lead.findFirst({ where: { instanceId: id, remoteJid: old } });
    assert.equal(lead?.extractedFromCount, 4);
    assert.equal((await leads.backfill(id, t.name, { days: 7, dryRun: true })).candidates, 0);
  });
});
