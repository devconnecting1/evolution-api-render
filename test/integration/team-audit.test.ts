import '../helpers/setup';

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { AuditLogService } from '@api/services/audit-log.service';
import { TeamAccessService } from '@api/services/team-access.service';
import { hashTeamKey } from '@utils/team-access';

import { OpenaiHarness, SKIP_INTEGRATION } from '../helpers/integration';

const unique = (suffix: string) =>
  `it-${suffix}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const email = () => `${unique('equipe')}@exemplo.com`;

/**
 * "Equipe" and "Registro de ações" on a real PostgreSQL: the migration (unique hash, nullable instance list, indexes),
 * the key never stored in clear, scoped keys resolving to instance names, revocation, the default role of a person,
 * and audit rows that survive the instance they mention (no FK).
 */
describe('team keys and audit log (integration)', { skip: SKIP_INTEGRATION }, () => {
  let h: OpenaiHarness;
  const createdInstances: string[] = [];
  const createdUsers: string[] = [];

  before(async () => {
    h = await new OpenaiHarness().start();
  });

  after(async () => {
    if (h?.prisma) {
      await h.prisma.teamKey.deleteMany({}).catch(() => undefined);
      await h.prisma.auditLog.deleteMany({}).catch(() => undefined);
      await h.prisma.user.deleteMany({ where: { email: { in: createdUsers } } }).catch(() => undefined);
      for (const id of createdInstances) await h.prisma.instance.delete({ where: { id } }).catch(() => undefined);
    }
    await h?.stop();
  });

  test('create scoped and global keys, resolve by hash, revoke', async () => {
    const service = new TeamAccessService({ prisma: h.prisma, cacheTtlMs: 0 });
    const name = unique('equipe-inst');
    const row = await h.prisma.instance.create({ data: { name, integration: 'WHATSAPP-BAILEYS' } });
    createdInstances.push(row.id);

    const scoped: any = await service.create({ name: 'Ana Exemplo', role: 'equipe', instances: [name] });
    const all: any = await service.create({ name: 'Bruno Teste', role: 'leitura' });
    const dono: any = await service.create({ name: 'Carla Teste', role: 'dono' });

    const stored = await h.prisma.teamKey.findMany();
    assert.ok(!JSON.stringify(stored).includes(scoped.key));
    assert.equal(stored.find((r: any) => r.name === 'Ana Exemplo')?.keyHash, hashTeamKey(scoped.key));
    assert.equal(stored.find((r: any) => r.name === 'Bruno Teste')?.instances, null);
    assert.equal(stored.find((r: any) => r.name === 'Carla Teste')?.role, 'dono');

    assert.deepEqual((await service.resolve(scoped.key))?.instanceNames, [name]);
    assert.equal((await service.resolve(all.key))?.instanceNames, null);
    assert.equal((await service.resolve(dono.key))?.role, 'dono');

    const lastUse = await h.prisma.teamKey.findUnique({
      where: { id: stored.find((r: any) => r.name === 'Ana Exemplo')!.id },
    });
    assert.ok(lastUse!.lastUsedAt, 'the first use records lastUsedAt');

    await service.revoke(stored.find((r: any) => r.name === 'Ana Exemplo')!.id);
    assert.equal(await service.resolve(scoped.key), null);
  });

  test('a person created by the login model already has the dono role and every instance', async () => {
    const address = email();
    createdUsers.push(address);
    const user = await h.prisma.user.create({ data: { email: address, name: 'Pessoa Fictícia' } });
    assert.equal(user.role, 'dono');
    assert.equal(user.instances, null);
  });

  test('audit rows are written, filtered and kept after the instance is gone', async () => {
    const service = new AuditLogService({ prisma: h.prisma });
    const instanceName = unique('auditoria');
    service.record({
      actor: 'Dono',
      actorKind: 'owner',
      type: 'instancia',
      action: 'Excluiu a instância',
      instanceName,
      method: 'DELETE',
      path: `/instance/delete/${instanceName}`,
      status: 200,
      ip: '203.0.113.0',
    });
    for (let i = 0; i < 50 && (await h.prisma.auditLog.count({ where: { instanceName } })) === 0; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }

    const list = await service.list({ instance: instanceName, type: 'instancia' });
    assert.equal(list.total, 1);
    assert.equal(list.items[0].action, 'Excluiu a instância');
    assert.equal(list.items[0].result, 'Concluído');
    assert.equal(list.items[0].typeLabel, 'Instância');
    assert.deepEqual(list.instances, [instanceName]);
    assert.equal(list.retentionDays, 180);

    const csv = await service.csv({ actor: 'Dono' });
    assert.match(csv, /"Dono";"Dono";"Instância";"Excluiu a instância"/);
    assert.ok(csv.startsWith(String.fromCharCode(0xfeff) + '"Quando (UTC)"'));
    assert.ok(csv.includes(';'), 'Excel em português');

    await h.prisma.auditLog.deleteMany({ where: { instanceName } });
    assert.equal(await h.prisma.auditLog.count({ where: { instanceName } }), 0);
  });
});
