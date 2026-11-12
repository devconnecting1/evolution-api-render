import '../helpers/setup';

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { BillingService } from '@api/services/billing.service';
import { DataExportService } from '@api/services/data-export.service';
import { strFromU8, unzipSync } from 'fflate';

import { OpenaiHarness, SKIP_INTEGRATION } from '../helpers/integration';

/**
 * Cobrança manual and the data export on a real PostgreSQL: the migration (unique receipt number, FK cascade), the
 * receipt sequence kept in GlobalSetting, and an export that reads the real tables and never carries the token.
 */
describe('billing and data export (integration)', { skip: SKIP_INTEGRATION }, () => {
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
      const list = await service.list(a.id);
      assert.deepEqual(
        list.entries.map((e: any) => e.period),
        ['2026-12', '2026-11', '2026-10'],
      );
      assert.equal(list.totals.paidCents, 87400);
    } finally {
      await h.prisma.instance.delete({ where: { id: a.id } });
      await h.prisma.instance.delete({ where: { id: b.id } });
    }
    assert.equal(await h.prisma.billingEntry.count({ where: { instanceId: a.id } }), 0, 'removed with the instance');
  });

  test('export reads the instance tables and leaves the token out', async () => {
    const token = 'tok-it-export-segredo-0001';
    const row = await h.prisma.instance.create({
      data: { name: 'it-exportar', integration: 'WHATSAPP-BAILEYS', token },
    });
    try {
      await h.prisma.message.create({
        data: {
          instanceId: row.id,
          key: { id: 'X1', remoteJid: '5521900000011@s.whatsapp.net', fromMe: false },
          pushName: 'Mariana Exemplo',
          messageType: 'conversation',
          message: { conversation: 'Oi, quero marcar um horário' },
          messageTimestamp: 1762900000,
          source: 'android',
        },
      });
      await h.prisma.contact.create({
        data: { instanceId: row.id, remoteJid: '5521900000011@s.whatsapp.net', pushName: 'Mariana Exemplo' },
      });
      const chunks: Uint8Array[] = [];
      const svc = new DataExportService({ prisma: h.prisma, batchSize: 10 });
      const counts = await svc.exportInstance(
        { id: row.id, name: row.name },
        { write: (c) => (chunks.push(c), true), drain: async () => {}, end: () => {} },
      );
      assert.equal(counts.mensagens, 1);
      assert.equal(counts.contatos, 1);
      const files = unzipSync(new Uint8Array(Buffer.concat(chunks.map((c) => Buffer.from(c)))));
      const all = Object.values(files)
        .map((f) => strFromU8(f))
        .join('\n');
      assert.ok(all.includes('quero marcar um horário'));
      assert.ok(!all.includes(token), 'the instance token never goes into the export');
    } finally {
      await h.prisma.instance.delete({ where: { id: row.id } });
    }
  });
});
