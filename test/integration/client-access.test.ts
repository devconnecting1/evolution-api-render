import '../helpers/setup';

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { ClientAccessService } from '@api/services/client-access.service';
import { hashClientKey } from '@utils/client-access';

import { OpenaiHarness, SKIP_INTEGRATION } from '../helpers/integration';

/**
 * "Acesso do cliente" on a real PostgreSQL: the migration (unique hash, one row per instance), the code never stored
 * in clear, the lookup by hash with the instance name, and the row removed with its instance (FK cascade).
 */
describe('client access (integration)', { skip: SKIP_INTEGRATION }, () => {
  let h: OpenaiHarness;

  before(async () => {
    h = await new OpenaiHarness().start();
  });

  after(async () => {
    await h?.stop();
  });

  test('create, resolve by hash, rotate, and cascade on instance removal', async () => {
    const service = new ClientAccessService({ prisma: h.prisma, cacheTtlMs: 0 });
    const row = await h.prisma.instance.create({
      data: { name: 'it-acesso-cliente', integration: 'WHATSAPP-BAILEYS' },
    });

    try {
      const first: any = await service.save(row.id, row.name, { modules: ['leads', 'conversas'] });
      const stored = await h.prisma.clientAccess.findUnique({ where: { instanceId: row.id } });
      assert.equal(stored?.keyHash, hashClientKey(first.key));
      assert.deepEqual(stored?.modules, ['conversas', 'leads']);
      assert.ok(!JSON.stringify(stored).includes(first.key));

      assert.deepEqual(await service.resolve(first.key), {
        instanceId: row.id,
        instanceName: 'it-acesso-cliente',
        modules: ['conversas', 'leads'],
      });

      const rotated: any = await service.save(row.id, row.name, { newKey: true });
      assert.equal(await service.resolve(first.key), null);
      assert.ok(await service.resolve(rotated.key));
      assert.equal(await h.prisma.clientAccess.count({ where: { instanceId: row.id } }), 1);
    } finally {
      await h.prisma.instance.delete({ where: { id: row.id } });
    }
    assert.equal(await h.prisma.clientAccess.count({ where: { instanceId: row.id } }), 0, 'removed with the instance');
  });
});
