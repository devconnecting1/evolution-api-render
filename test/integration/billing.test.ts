import '../helpers/setup';

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { BillingService } from '@api/services/billing.service';

import { OpenaiHarness, SKIP_INTEGRATION } from '../helpers/integration';

/**
 * Cobrança manual on a real PostgreSQL: the migration (unique receipt number, FK cascade), the receipt sequence kept
 * in GlobalSetting and the totals/open period of the list.
 */
describe('billing (integration)', { skip: SKIP_INTEGRATION }, () => {
  let h: OpenaiHarness;

  before(async () => {
    h = await new OpenaiHarness().start();
  });

  after(async () => {
    await h?.stop();
  });

  test('receipts are numbered across instances, never reused, and entries go with the instance', async () => {
    const service = new BillingService({ prisma: h.prisma, provider: () => ({}) });
    const a = await h.prisma.instance.create({ data: { name: 'it-cobranca-a', integration: 'WHATSAPP-BAILEYS' } });
    const b = await h.prisma.instance.create({ data: { name: 'it-cobranca-b', integration: 'WHATSAPP-BAILEYS' } });
    try {
      await h.prisma.globalSetting.deleteMany({ where: { key: 'billing.receiptSeq' } });
      const p1: any = await service.create(a.id, {
        period: '2026-10',
        amountCents: 43700,
        status: 'pago',
        method: 'pix',
      });
      const p2: any = await service.create(b.id, { period: '2026-10', amountCents: 76700, status: 'pago' });
      assert.equal(p2.receiptNumber, p1.receiptNumber + 1);
      await service.remove(b.id, p2.id);
      const p3: any = await service.create(a.id, { period: '2026-11', amountCents: 43700, status: 'pago' });
      assert.equal(p3.receiptNumber, p2.receiptNumber + 1, 'the deleted number is not reused');
      const pending: any = await service.create(a.id, { period: '2026-12', amountCents: 43700 });
      assert.equal(pending.receiptNumber, null);
      const overdue: any = await service.create(a.id, { period: '2026-09', amountCents: 1000, status: 'atrasado' });
      assert.equal(overdue.paidAt, null);
      const list = await service.list(a.id);
      assert.deepEqual(
        list.entries.map((e: any) => e.period),
        ['2026-12', '2026-11', '2026-10', '2026-09'],
      );
      assert.deepEqual(list.totals, { paidCents: 87400, pendingCents: 43700, overdueCents: 1000 });
      assert.equal(list.openPeriod, '2026-09');
      assert.equal(list.nextDueDate, '2026-09-01');
      assert.equal(list.paymentMethod, 'pix');
    } finally {
      await h.prisma.instance.delete({ where: { id: a.id } });
      await h.prisma.instance.delete({ where: { id: b.id } });
    }
    assert.equal(await h.prisma.billingEntry.count({ where: { instanceId: a.id } }), 0, 'removed with the instance');
  });
});
