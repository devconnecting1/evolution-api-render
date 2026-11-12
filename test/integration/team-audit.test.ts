import '../helpers/setup';

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { AuditLogService } from '@api/services/audit-log.service';
import { TeamAccessService } from '@api/services/team-access.service';
import { hashTeamKey } from '@utils/team-access';

import { OpenaiHarness, SKIP_INTEGRATION } from '../helpers/integration';

/**
 * "Equipe" and "Registro de ações" on a real PostgreSQL: the migration (unique hash, nullable instance list, indexes),
 * the key never stored in clear, scoped keys resolving to instance names, revocation, and audit rows that survive
 * the instance they mention (no FK).
 */
describe('team keys and audit log (integration)', { skip: SKIP_INTEGRATION }, () => {
  let h: OpenaiHarness;

  before(async () => {
    h = await new OpenaiHarness().start();
  });

  after(async () => {
    await h?.stop();
  });

  test('create scoped and global keys, resolve by hash, revoke', async () => {
    const service = new TeamAccessService({ prisma: h.prisma, cacheTtlMs: 0 });
    const row = await h.prisma.instance.create({ data: { name: 'it-equipe', integration: 'WHATSAPP-BAILEYS' } });
    try {
      const scoped: any = await service.create({ name: 'Ana Exemplo', role: 'equipe', instances: ['it-equipe'] });
      const all: any = await service.create({ name: 'Bruno Teste', role: 'leitura' });
      const stored = await h.prisma.teamKey.findMany();
      assert.ok(!JSON.stringify(stored).includes(scoped.key));
      assert.equal(stored.find((r: any) => r.name === 'Ana Exemplo')?.keyHash, hashTeamKey(scoped.key));
      assert.equal(stored.find((r: any) => r.name === 'Bruno Teste')?.instances, null);

      assert.deepEqual((await service.resolve(scoped.key))?.instanceNames, ['it-equipe']);
      assert.equal((await service.resolve(all.key))?.instanceNames, null);

      await service.revoke(stored.find((r: any) => r.name === 'Ana Exemplo')!.id);
      assert.equal(await service.resolve(scoped.key), null);
    } finally {
      await h.prisma.teamKey.deleteMany({});
      await h.prisma.instance.delete({ where: { id: row.id } });
    }
  });

  test('audit rows are written, filtered and kept after the instance is gone', async () => {
    const service = new AuditLogService({ prisma: h.prisma });
    service.record({
      actor: 'Dono',
      actorKind: 'owner',
      type: 'instancia',
      action: 'Excluiu a instância',
      instanceName: 'it-auditoria',
      method: 'DELETE',
      path: '/instance/delete/it-auditoria',
      status: 200,
      ip: '203.0.113.0',
    });
    for (let i = 0; i < 50 && (await h.prisma.auditLog.count()) === 0; i++) await new Promise((r) => setTimeout(r, 20));
    try {
      const list = await service.list({ instance: 'it-auditoria', type: 'instancia' });
      assert.equal(list.total, 1);
      assert.equal(list.items[0].action, 'Excluiu a instância');
      assert.deepEqual(list.instances, ['it-auditoria']);
      const csv = await service.csv({ actor: 'Dono' });
      assert.match(csv, /"Excluiu a instância";"it-auditoria"/);
    } finally {
      await h.prisma.auditLog.deleteMany({});
    }
  });
});
