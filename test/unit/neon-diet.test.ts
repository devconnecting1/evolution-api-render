import '../helpers/setup';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { EventController } from '@api/integrations/event/event.controller';
import { ChannelStartupService } from '@api/services/channel.service';

/**
 * Menos consultas ao banco por evento do WhatsApp: a configuração de eventos (webhook...) e as
 * configurações da instância ficam em memória, com invalidação nas escritas da API.
 */
describe('neon diet: event config cache', () => {
  function setup() {
    const calls: string[] = [];
    let row: any = { instanceId: 'i1', enabled: true, url: 'https://a', events: ['MESSAGES_UPSERT'] };
    const prisma: any = {
      webhook: {
        findUnique: async () => {
          calls.push('findUnique');
          return row;
        },
        upsert: async ({ update }: any) => {
          calls.push('upsert');
          row = { ...row, ...update };
          return row;
        },
      },
    };
    const monitor: any = { waInstances: { Escritorio: { instanceId: 'i1' } } };

    class FakeWebhook extends EventController {
      constructor() {
        super(prisma, monitor, true, 'webhook');
      }
      override async set(instanceName: string, data: any) {
        return this.prisma.webhook.upsert({
          where: { instanceId: this.monitor.waInstances[instanceName].instanceId },
          update: { url: data.webhook.url, enabled: true, events: [] },
          create: {} as any,
        });
      }
    }
    EventController.forgetInstance();
    return { controller: new FakeWebhook(), calls, monitor };
  }

  test('a burst of events reads the config once', async () => {
    const { controller, calls } = setup();
    for (let i = 0; i < 50; i++) await controller.get('Escritorio');
    assert.equal(calls.filter((c) => c === 'findUnique').length, 1);
  });

  test('set() (also when overridden) refreshes the cached value', async () => {
    const { controller, calls } = setup();
    assert.equal(((await controller.get('Escritorio')) as any).url, 'https://a');
    await controller.set('Escritorio', { webhook: { url: 'https://b' } } as any);
    assert.equal(((await controller.get('Escritorio')) as any).url, 'https://b');
    assert.equal(calls.filter((c) => c === 'findUnique').length, 2);
  });

  test('missing config (null) is cached too; forgetInstance and TTL force a new read', async () => {
    const { controller, calls } = setup();
    (controller as any).prisma.webhook.findUnique = async () => {
      calls.push('findUnique');
      return null;
    };
    assert.equal(await controller.get('Escritorio'), null);
    assert.equal(await controller.get('Escritorio'), null);
    assert.equal(calls.length, 1);

    EventController.forgetInstance('i1');
    await controller.get('Escritorio');
    assert.equal(calls.length, 2);

    const ttl = EventController.CONFIG_TTL_MS;
    EventController.CONFIG_TTL_MS = -1;
    try {
      await controller.get('Escritorio');
      assert.equal(calls.length, 3);
    } finally {
      EventController.CONFIG_TTL_MS = ttl;
    }
  });

  test('unknown instance or disabled integration: no query at all', async () => {
    const { controller, calls } = setup();
    assert.equal(await controller.get('Outra'), null);
    controller.status = false;
    assert.equal(await controller.get('Escritorio'), undefined);
    assert.equal(calls.length, 0);
  });
});

describe('neon diet: instance settings cache', () => {
  function service(rows: any[]) {
    const calls: string[] = [];
    const svc: any = Object.create(ChannelStartupService.prototype);
    svc.settingsCache = null;
    svc.localSettings = {};
    svc.instance = { id: 'i1', name: 'Escritorio' };
    Object.defineProperty(svc, 'instanceId', { get: () => 'i1' });
    svc.prismaRepository = {
      setting: {
        findUnique: async () => {
          calls.push('findUnique');
          return rows[0] ?? null;
        },
        upsert: async ({ update }: any) => {
          calls.push('upsert');
          rows[0] = { ...(rows[0] ?? {}), ...update };
          return rows[0];
        },
      },
    };
    svc.client = { ws: { close() {}, connect() {} } };
    return { svc, calls };
  }

  test('event batches reuse the settings; setSettings invalidates', async () => {
    const { svc, calls } = service([{ rejectCall: false, groupsIgnore: true, readMessages: false }]);
    for (let i = 0; i < 20; i++) assert.equal((await svc.findSettings()).groupsIgnore, true);
    assert.equal(calls.filter((c) => c === 'findUnique').length, 1);

    await svc.setSettings({ rejectCall: true, groupsIgnore: false, readMessages: true } as any);
    const after = await svc.findSettings();
    assert.equal(after.rejectCall, true);
    assert.equal(after.groupsIgnore, false);
    assert.equal(calls.filter((c) => c === 'findUnique').length, 2);
  });

  test('callers cannot mutate the cached object; "no settings row" stays null', async () => {
    const { svc } = service([{ rejectCall: false }]);
    const a = await svc.findSettings();
    a.rejectCall = true;
    assert.equal((await svc.findSettings()).rejectCall, false);

    const empty = service([]);
    assert.equal(await empty.svc.findSettings(), null);
    assert.equal(await empty.svc.findSettings(), null);
    assert.equal(empty.calls.length, 1);
  });
});
