import '../helpers/setup';
import '@exceptions';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  BillingNotFoundError,
  BillingService,
  BillingValidationError,
  providerView,
  validateBillingInput,
} from '@api/services/billing.service';
import { csvCell, DataExportService, ExportBusyError, stripMedia } from '@api/services/data-export.service';
import { clientRouteAllowed, normalizeClientPath } from '@utils/client-access';
import { strFromU8, unzipSync } from 'fflate';

const NAME = 'Loja Exemplo';
const INST = 'inst-1';

/** In-memory prisma with just what BillingService touches. */
function fakePrisma() {
  const rows: any[] = [];
  const settings = new Map<string, any>();
  let seq = 0;
  const pick = (r: any) => ({ ...r });
  return {
    rows,
    settings,
    billingEntry: {
      findMany: async ({ where }: any) => rows.filter((r) => r.instanceId === where.instanceId).map(pick),
      findFirst: async ({ where }: any) => {
        const r = rows.find((x) => x.id === where.id && x.instanceId === where.instanceId);
        return r ? pick(r) : null;
      },
      create: async ({ data }: any) => {
        const r = { id: `b${++seq}`, receiptNumber: null, method: null, paidAt: null, note: null, ...data };
        rows.push(r);
        return pick(r);
      },
      update: async ({ where, data }: any) => {
        const r = rows.find((x) => x.id === where.id);
        if (data.receiptNumber && rows.some((x) => x.receiptNumber === data.receiptNumber && x.id !== r.id)) {
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        }
        for (const [k, v] of Object.entries(data)) if (v !== undefined) r[k] = v;
        return pick(r);
      },
      delete: async ({ where }: any) => {
        rows.splice(
          rows.findIndex((x) => x.id === where.id),
          1,
        );
      },
      aggregate: async () => ({
        _max: { receiptNumber: rows.reduce((m, r) => Math.max(m, r.receiptNumber || 0), 0) || null },
      }),
    },
    globalSetting: {
      findUnique: async ({ where }: any) =>
        settings.has(where.key) ? { key: where.key, value: settings.get(where.key) } : null,
      upsert: async ({ where, create, update }: any) => {
        settings.set(where.key, settings.has(where.key) ? update.value : create.value);
      },
    },
  };
}

const service = (prisma = fakePrisma(), provider: any = {}) => ({
  prisma,
  svc: new BillingService({ prisma, provider: () => provider, now: () => new Date('2026-11-12T12:00:00Z') }),
});

describe('billing: validation', () => {
  test('a new entry needs period AAAA-MM and a positive integer amount in cents; status defaults to pendente', () => {
    assert.deepEqual(validateBillingInput({ period: '2026-11', amountCents: 43700 }), {
      period: '2026-11',
      amountCents: 43700,
      status: 'pendente',
    });
    for (const bad of [
      { period: '2026-13', amountCents: 100 },
      { period: '11/2026', amountCents: 100 },
      { period: '2026-11', amountCents: 0 },
      { period: '2026-11', amountCents: 10.5 },
      { period: '2026-11', amountCents: '437' },
      { period: '2026-11', amountCents: 100, status: 'quitado' },
      { period: '2026-11', amountCents: 100, method: 'cheque' },
      { period: '2026-11', amountCents: 100, paidAt: 'ontem' },
      { period: '2026-11', amountCents: 100, note: 'x'.repeat(281) },
    ]) {
      assert.throws(() => validateBillingInput(bad as any), BillingValidationError, JSON.stringify(bad));
    }
  });

  test('an update checks only the fields sent; empty method, date and note clear them', () => {
    assert.deepEqual(validateBillingInput({ status: 'pago' }, true), { status: 'pago' });
    assert.deepEqual(validateBillingInput({ method: '', paidAt: null, note: '  ' }, true), {
      method: null,
      paidAt: null,
      note: null,
    });
  });

  test('provider data: says which variables are missing, never invents them', () => {
    assert.deepEqual(providerView(undefined), {
      name: null,
      doc: null,
      city: null,
      configured: false,
      missing: ['BILLING_PROVIDER_NAME', 'BILLING_PROVIDER_DOC', 'BILLING_PROVIDER_CITY'],
    });
    const full = providerView({
      PROVIDER_NAME: 'Prestador Exemplo',
      PROVIDER_DOC: '000.000.000-00',
      PROVIDER_CITY: 'Rio de Janeiro',
    });
    assert.equal(full.configured, true);
    assert.deepEqual(full.missing, []);
  });
});

describe('billing: receipts', () => {
  test('paid entries get sequential receipt numbers; pending ones do not', async () => {
    const { svc } = service();
    const a = await svc.create(INST, { period: '2026-09', amountCents: 43700, status: 'pago', method: 'pix' });
    const b = await svc.create(INST, { period: '2026-10', amountCents: 43700 });
    const c = await svc.create('inst-2', { period: '2026-10', amountCents: 76700, status: 'pago' });
    assert.equal(a.receiptNumber, 1);
    assert.equal(b.receiptNumber, null);
    assert.equal(c.receiptNumber, 2, 'the numbering is global, across instances');
    assert.equal(a.paidAt.toISOString(), '2026-11-12T12:00:00.000Z', 'paid without date: today');
  });

  test('marking as paid later gives the next number; going back to pending keeps it', async () => {
    const { svc } = service();
    const a = await svc.create(INST, { period: '2026-10', amountCents: 43700 });
    const paid = await svc.update(INST, a.id, { status: 'pago', paidAt: '2026-11-05' });
    assert.equal(paid.receiptNumber, 1);
    assert.equal(paid.paidAt.toISOString().slice(0, 10), '2026-11-05');
    const back = await svc.update(INST, a.id, { status: 'pendente' });
    assert.equal(back.receiptNumber, 1);
    const again = await svc.update(INST, a.id, { status: 'pago' });
    assert.equal(again.receiptNumber, 1, 'no new number for the same entry');
  });

  test('deleting the last paid entry does not let its number be reused', async () => {
    const { svc } = service();
    const a = await svc.create(INST, { period: '2026-09', amountCents: 100, status: 'pago' });
    const b = await svc.create(INST, { period: '2026-10', amountCents: 100, status: 'pago' });
    assert.equal(b.receiptNumber, 2);
    await svc.remove(INST, b.id);
    const c = await svc.create(INST, { period: '2026-11', amountCents: 100, status: 'pago' });
    assert.equal(c.receiptNumber, 3);
    assert.equal(a.receiptNumber, 1);
  });

  test('an entry of another instance is not found (no cross-instance edit or delete)', async () => {
    const { svc } = service();
    const a = await svc.create(INST, { period: '2026-10', amountCents: 100 });
    await assert.rejects(() => svc.update('inst-2', a.id, { status: 'pago' }), BillingNotFoundError);
    await assert.rejects(() => svc.remove('inst-2', a.id), BillingNotFoundError);
  });

  test('list: entries, paid and pending totals and the provider block', async () => {
    const { svc } = service(fakePrisma(), { PROVIDER_NAME: 'Prestador Exemplo' });
    await svc.create(INST, { period: '2026-09', amountCents: 43700, status: 'pago' });
    await svc.create(INST, { period: '2026-10', amountCents: 43700 });
    await svc.create(INST, { period: '2026-08', amountCents: 1000, status: 'cancelado' });
    const out = await svc.list(INST);
    assert.equal(out.entries.length, 3);
    assert.deepEqual(out.totals, { paidCents: 43700, pendingCents: 43700 });
    assert.equal(out.provider.name, 'Prestador Exemplo');
    assert.equal(out.provider.configured, false);
  });
});

describe('billing: client access', () => {
  const allowed = (method: string, url: string, modules: any[]) =>
    clientRouteAllowed(method, normalizeClientPath(url, NAME), modules);
  const url = '/billing/' + encodeURIComponent(NAME);

  test('the client code with "plano" reads the history; never writes, edits, deletes or exports', () => {
    assert.equal(allowed('GET', url, ['plano']), true);
    assert.equal(allowed('POST', url, ['plano']), false);
    assert.equal(allowed('PATCH', url + '/b1', ['plano']), false);
    assert.equal(allowed('DELETE', url + '/b1', ['plano']), false);
    assert.equal(allowed('GET', url + '/export.zip', ['plano']), false);
  });

  test('without the module "plano" the client does not see the billing', () => {
    assert.equal(allowed('GET', url, ['conversas', 'leads', 'conexao']), false);
  });
});

describe('data export', () => {
  const SECRET = 'TOKEN-SECRETO-DA-INSTANCIA';

  /** Prisma that serves the exportable tables and fails on anything else (secrets live in other tables). */
  function exportPrisma(pageCounter: Record<string, number> = {}) {
    const data: Record<string, any[]> = {
      message: [
        {
          id: 'm1',
          key: { remoteJid: '5521900000011@s.whatsapp.net', fromMe: false },
          pushName: 'Mariana Exemplo',
          messageType: 'conversation',
          message: { conversation: 'Olá, quero agendar' },
          messageTimestamp: 1762900000,
          status: 'READ',
        },
        {
          id: 'm2',
          key: { remoteJid: '5521900000011@s.whatsapp.net', fromMe: true },
          pushName: null,
          messageType: 'imageMessage',
          message: { imageMessage: { caption: 'Cardápio', jpegThumbnail: 'AAAA' }, base64: 'BIGBASE64' },
          messageTimestamp: 1762900060,
          status: 'SENT',
        },
        {
          id: 'm3',
          key: { remoteJid: '5521900000012@s.whatsapp.net', fromMe: false },
          pushName: 'Roberto Fictício',
          messageType: 'conversation',
          message: { conversation: '=HYPERLINK("x")' },
          messageTimestamp: 1762900120,
          status: null,
        },
      ],
      contact: [
        { id: 'c1', remoteJid: '5521900000011@s.whatsapp.net', pushName: '=cmd', createdAt: new Date('2026-11-01') },
      ],
      chat: [{ id: 'h1', remoteJid: '5521900000011@s.whatsapp.net', name: 'Mariana, "VIP"', unreadMessages: 2 }],
      lead: [{ id: 'l1', remoteJid: '5521900000011@s.whatsapp.net', name: 'Mariana Exemplo', status: 'novo' }],
      appointment: [
        { id: 'a1', remoteJid: '5521900000011@s.whatsapp.net', typeName: 'Consulta', status: 'confirmado' },
      ],
      process: [],
      publication: [],
    };
    const model = (name: string) => ({
      findMany: async (args: any) => {
        assert.equal(args.where.instanceId, INST, `${name}: always scoped to the instance`);
        pageCounter[name] = (pageCounter[name] || 0) + 1;
        const all = data[name];
        const start = args.cursor ? all.findIndex((r) => r.id === args.cursor.id) + 1 : 0;
        return all.slice(start, start + args.take);
      },
    });
    const allowed: Record<string, any> = {
      instance: {
        findUnique: async (args: any) => {
          assert.ok(!args.select.token, 'never selects the instance token');
          return { name: NAME, number: '5521900000000', connectionStatus: 'open', integration: 'WHATSAPP-BAILEYS' };
        },
      },
    };
    for (const name of Object.keys(data)) allowed[name] = model(name);
    return new Proxy(allowed, {
      get(target, prop: string) {
        if (prop in target) return target[prop];
        throw new Error(`export must not read "${prop}" (${SECRET})`);
      },
    });
  }

  function memorySink() {
    const chunks: Uint8Array[] = [];
    let ended = false;
    return {
      sink: { write: (c: Uint8Array) => (chunks.push(c), true), drain: async () => {}, end: () => (ended = true) },
      bytes: () => Buffer.concat(chunks.map((c) => Buffer.from(c))),
      ended: () => ended,
    };
  }

  test('ZIP with the expected files, paginated, without media bytes or secrets', async () => {
    const pages: Record<string, number> = {};
    const logs: string[] = [];
    const svc = new DataExportService({
      prisma: exportPrisma(pages),
      batchSize: 2,
      logger: { info: (m) => logs.push(m), error: (m) => logs.push(String(m)) },
    });
    const out = memorySink();
    const counts = await svc.exportInstance({ id: INST, name: NAME }, out.sink);
    assert.equal(out.ended(), true);
    assert.deepEqual(counts, {
      mensagens: 3,
      contatos: 1,
      conversas: 1,
      leads: 1,
      agendamentos: 1,
      processos: 0,
      publicacoes: 0,
    });
    assert.equal(pages.message, 2, 'three messages in pages of two');

    const files = unzipSync(new Uint8Array(out.bytes()));
    assert.deepEqual(Object.keys(files).sort(), [
      'LEIA-ME.txt',
      'agendamentos.csv',
      'contatos.csv',
      'conversas.csv',
      'instancia.json',
      'leads.jsonl',
      'mensagens.jsonl',
      'processos.jsonl',
      'publicacoes.jsonl',
    ]);
    const all = Object.values(files)
      .map((f) => strFromU8(f))
      .join('\n');
    assert.ok(!all.includes(SECRET));
    assert.ok(!all.includes('BIGBASE64') && !all.includes('jpegThumbnail'), 'media bytes are left out');
    const lines = strFromU8(files['mensagens.jsonl'])
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    assert.equal(lines[1].message.imageMessage.caption, 'Cardápio');
    assert.equal(lines[0].fromMe, false);
    assert.match(strFromU8(files['contatos.csv']), /'=cmd/, 'formula neutralized in CSV');
    assert.match(strFromU8(files['conversas.csv']), /"Mariana, ""VIP"""/);
    assert.ok(logs.some((l) => l.includes('mensagens=3')));
    assert.ok(!logs.join(' ').includes('agendar'), 'the log never carries message content');
  });

  test('one export at a time per instance', async () => {
    const svc = new DataExportService({ prisma: exportPrisma(), batchSize: 1 });
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const first = svc.exportInstance({ id: INST, name: NAME }, { write: () => true, drain: () => gate, end: () => {} });
    assert.equal(svc.isRunning(INST), true);
    await assert.rejects(() => svc.exportInstance({ id: INST, name: NAME }, memorySink().sink), ExportBusyError);
    release();
    await first;
    assert.equal(svc.isRunning(INST), false);
  });

  test('csvCell and stripMedia', () => {
    assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)");
    assert.equal(csvCell('a,b'), '"a,b"');
    assert.equal(csvCell(null), '');
    assert.deepEqual(stripMedia({ a: { base64: 'x', b: 1 }, list: [{ jpegThumbnail: 'y', c: 2 }] }), {
      a: { b: 1 },
      list: [{ c: 2 }],
    });
  });
});
