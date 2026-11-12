import '../helpers/setup';
import '@exceptions';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  BillingNotFoundError,
  BillingService,
  BillingValidationError,
  oldestOpenPeriod,
  providerView,
  validateBillingInput,
} from '@api/services/billing.service';
import { clientRouteAllowed, normalizeClientPath } from '@utils/client-access';

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
      findMany: async ({ where, orderBy }: any) => {
        const out = rows.filter((r) => r.instanceId === where.instanceId);
        if (Array.isArray(orderBy)) {
          out.sort((a, b) => {
            const byPeriod = String(b.period).localeCompare(String(a.period));
            if (byPeriod) return byPeriod;
            return +new Date(b.createdAt) - +new Date(a.createdAt);
          });
        }
        return out.map(pick);
      },
      findFirst: async ({ where }: any) => {
        const r = rows.find((x) => x.id === where.id && x.instanceId === where.instanceId);
        return r ? pick(r) : null;
      },
      create: async ({ data }: any) => {
        const r = {
          id: `b${++seq}`,
          receiptNumber: null,
          method: null,
          paidAt: null,
          note: null,
          createdAt: new Date(),
          ...data,
        };
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

  test('oldest open period ignores paid entries and keeps the month order', () => {
    assert.equal(oldestOpenPeriod([]), null);
    assert.equal(
      oldestOpenPeriod([
        { period: '2026-09', status: 'pago' },
        { period: '2026-11', status: 'atrasado' },
        { period: '2026-10', status: 'pendente' },
      ]),
      '2026-10',
    );
    assert.equal(oldestOpenPeriod([{ period: '2026-09', status: 'pago' }]), null);
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
    assert.equal(b.paidAt, null, 'a pending entry has no payment date');
    assert.equal(c.receiptNumber, 2, 'the numbering is global, across instances');
    assert.equal(a.paidAt.toISOString(), '2026-11-12T12:00:00.000Z', 'paid without date: today');
  });

  test('marking as paid later gives the next number; going back to pending keeps it and clears the date', async () => {
    const { svc } = service();
    const a = await svc.create(INST, { period: '2026-10', amountCents: 43700 });
    const paid = await svc.update(INST, a.id, { status: 'pago', paidAt: '2026-11-05' });
    assert.equal(paid.receiptNumber, 1);
    assert.equal(paid.paidAt.toISOString().slice(0, 10), '2026-11-05');
    const back = await svc.update(INST, a.id, { status: 'pendente' });
    assert.equal(back.receiptNumber, 1, 'the number is never lost nor reused');
    assert.equal(back.paidAt, null);
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

  test('list: entries, totals, open period and the provider block', async () => {
    const { svc } = service(fakePrisma(), { PROVIDER_NAME: 'Prestador Exemplo' });
    await svc.create(INST, { period: '2026-09', amountCents: 43700, status: 'pago' });
    await svc.create(INST, { period: '2026-10', amountCents: 43700, method: 'pix' });
    await svc.create(INST, { period: '2026-08', amountCents: 1000, status: 'atrasado' });
    const out = await svc.list(INST);
    assert.equal(out.entries.length, 3);
    assert.deepEqual(
      out.entries.map((e: any) => e.period),
      ['2026-10', '2026-09', '2026-08'],
    );
    assert.deepEqual(out.totals, { paidCents: 43700, pendingCents: 43700, overdueCents: 1000 });
    assert.equal(out.openPeriod, '2026-08');
    assert.equal(out.nextDueDate, '2026-08-01');
    assert.equal(out.paymentMethod, null, 'the only paid entry has no method');
    assert.equal(out.provider.name, 'Prestador Exemplo');
    assert.equal(out.provider.configured, false);
  });
});

describe('billing: client access', () => {
  const allowed = (method: string, url: string, modules: any[]) =>
    clientRouteAllowed(method, normalizeClientPath(url, NAME), modules);
  const url = '/usage/billing/' + encodeURIComponent(NAME);

  test('the client code with "plano" reads the history; never writes, edits or deletes', () => {
    assert.equal(allowed('GET', url, ['plano']), true);
    assert.equal(allowed('POST', url, ['plano']), false);
    assert.equal(allowed('PATCH', url + '/b1', ['plano']), false);
    assert.equal(allowed('DELETE', url + '/b1', ['plano']), false);
  });

  test('without the module "plano" the client does not see the billing', () => {
    assert.equal(allowed('GET', url, ['conversas', 'leads', 'conexao']), false);
  });
});
