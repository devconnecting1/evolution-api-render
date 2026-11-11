import '../helpers/setup';

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { RetentionService } from '@api/services/retention.service';

import { OpenaiHarness, SKIP_INTEGRATION } from '../helpers/integration';

const quiet = { log: () => undefined, warn: () => undefined };

/**
 * Retention on a real PostgreSQL: the GlobalSetting migration, the deadline saved in the panel surviving a restart,
 * and "Apagar agora" removing only what is older than the deadline (with its MessageUpdate rows, FK cascade).
 */
describe('message retention (integration)', { skip: SKIP_INTEGRATION }, () => {
  let h: OpenaiHarness;

  before(async () => {
    h = await new OpenaiHarness().start();
  });

  after(async () => {
    await h?.prisma.globalSetting.deleteMany({ where: { key: 'retention' } });
    await h?.stop();
  });

  test('saved deadline, preview and run now', async () => {
    const row = await h.prisma.instance.create({ data: { name: 'it-retencao', integration: 'WHATSAPP-BAILEYS' } });
    const now = Math.floor(Date.now() / 1000);
    const msg = (id: string, ageDays: number) => ({
      id,
      key: { id, remoteJid: '5521900000000@s.whatsapp.net', fromMe: false },
      messageType: 'conversation',
      message: { conversation: 'exemplo' },
      messageTimestamp: now - ageDays * 86_400,
      source: 'android',
      instanceId: row.id,
    });
    try {
      await h.prisma.message.createMany({ data: [msg('it-ret-old', 120), msg('it-ret-new', 10)] as any });
      await h.prisma.messageUpdate.create({
        data: {
          keyId: 'it-ret-old',
          remoteJid: '5521900000000@s.whatsapp.net',
          fromMe: false,
          status: 'READ',
          messageId: 'it-ret-old',
          instanceId: row.id,
        } as any,
      });

      const first = new RetentionService({ prisma: h.prisma, days: 0, logger: quiet });
      assert.equal((await first.config()).source, 'padrao');
      await first.setDays(90);

      const restarted = new RetentionService({ prisma: h.prisma, days: 0, logger: quiet });
      const config = await restarted.config();
      assert.deepEqual([config.days, config.source], [90, 'painel']);
      const preview = await restarted.preview();
      assert.equal(preview.instances.find((i) => i.instanceId === row.id)?.older, 1);

      const run = await restarted.purgeAll();
      assert.ok(run.removed >= 1);
      assert.deepEqual(
        (await h.prisma.message.findMany({ where: { instanceId: row.id }, select: { id: true } })).map((m) => m.id),
        ['it-ret-new'],
      );
      assert.equal(await h.prisma.messageUpdate.count({ where: { instanceId: row.id } }), 0, 'status rows go with it');
    } finally {
      await h.prisma.instance.delete({ where: { id: row.id } });
    }
  });
});
