import '../helpers/setup';

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import { MetaController } from '@api/integrations/channel/meta/meta.controller';
import { BusinessStartupService } from '@api/integrations/channel/meta/whatsapp.business.service';
import { configService } from '@config/env.config';
import EventEmitter2 from 'eventemitter2';

import { setChatbotEmitHandler } from '../helpers/chatbot-emit';
import { nextId, sleep, waitFor } from '../helpers/fakes';
import { OpenaiHarness, SKIP_INTEGRATION, Tenant } from '../helpers/integration';

/**
 * Cloud API (WHATSAPP-BUSINESS) with Coexistence, end to end: Meta webhook -> real BusinessStartupService -> real
 * OpenAI bot -> real database. Only the Graph API (`post`) and OpenAI are faked.
 */
describe('Cloud API: human pause through Coexistence echoes (integration)', { skip: SKIP_INTEGRATION }, () => {
  let h: OpenaiHarness;
  let meta: MetaController;

  before(async () => {
    h = await new OpenaiHarness().start();
    meta = new MetaController(h.prisma, h.waMonitor);
    // The channel hands its messages to chatbotController.emit (server.module): route them to the real bot
    setChatbotEmitHandler((data) => h.controller.emit(data));
  });

  after(async () => {
    setChatbotEmitHandler(null);
    await h?.stop();
  });

  beforeEach(() => {
    h.openai.reset();
  });

  /** A tenant whose channel is a real BusinessStartupService; returns the Graph API calls it made. */
  async function cloudTenant(settings: Record<string, any> = {}) {
    const t = await h.createTenant({ settings });
    const phoneNumberId = `PNID${nextId()}`;
    await h.prisma.instance.update({
      where: { id: t.instance.instanceId },
      data: { integration: 'WHATSAPP-BUSINESS', number: phoneNumberId, token: 'not-a-real-token' },
    });

    const cache: any = {
      get: async () => null,
      set: async () => undefined,
      hSet: async () => undefined,
      delete: async () => undefined,
    };
    const service: any = new BusinessStartupService(
      configService,
      new EventEmitter2(),
      h.prisma,
      cache,
      cache,
      cache,
      {} as any,
    );
    service.setInstance({
      instanceName: t.name,
      instanceId: t.instance.instanceId,
      integration: 'WHATSAPP-BUSINESS',
      number: phoneNumberId,
      token: 'not-a-real-token',
    });
    service.findSettings = async () => ({ groups_ignore: false });

    const graphCalls: any[] = [];
    const sentWamids: string[] = [];
    service.post = async (content: any) => {
      const id = `wamid.${nextId()}`;
      graphCalls.push(content);
      sentWamids.push(id);
      return { messaging_product: 'whatsapp', messages: [{ id }] };
    };
    const webhooks: { event: string; data: any }[] = [];
    service.sendDataWebhook = async (event: string, data: any) => void webhooks.push({ event, data });

    h.waMonitor.waInstances[t.name] = service;

    const metadata = { display_phone_number: '15550000000', phone_number_id: phoneNumberId };
    const wrap = (field: string, value: any) => ({
      object: 'whatsapp_business_account',
      entry: [{ id: 'WABA', changes: [{ field, value: { messaging_product: 'whatsapp', metadata, ...value } }] }],
    });

    return {
      t,
      service,
      graphCalls,
      sentWamids,
      webhooks,
      botTexts: () => graphCalls.filter((c) => c.type === 'text').map((c) => c.text.body),
      statusEvents: () => webhooks.filter((w) => w.event === 'openai.change_status').map((w) => w.data),
      /** Message of the contact. */
      inbound: (waId: string, body: string) =>
        meta.receiveWebhook(
          wrap('messages', {
            contacts: [{ profile: { name: 'Cliente' }, wa_id: waId }],
            messages: [
              {
                from: waId,
                id: `wamid.IN${nextId()}`,
                timestamp: `${Math.floor(Date.now() / 1000)}`,
                type: 'text',
                text: { body },
              },
            ],
          }),
        ),
      /** Message the owner wrote in the WhatsApp Business app. */
      echo: (to: string, body: string, id = `wamid.ECHO${nextId()}`) =>
        meta.receiveWebhook(
          wrap('smb_message_echoes', {
            message_echoes: [
              {
                from: '15550000000',
                to,
                id,
                timestamp: `${Math.floor(Date.now() / 1000)}`,
                type: 'text',
                text: { body },
              },
            ],
          }),
        ),
    };
  }

  const sessionOf = (t: Tenant) =>
    h.prisma.integrationSession.findFirst({
      where: { instanceId: t.instance.instanceId },
      orderBy: { createdAt: 'desc' },
    });

  test('contact -> bot answers; owner echo -> paused; next contact message ignored', async () => {
    const c = await cloudTenant();
    const waId = '5511987654321';

    await c.inbound(waId, 'oi, bom dia');
    await waitFor(() => c.botTexts().length === 1, 8000, 'bot answer');
    assert.deepEqual(c.botTexts(), ['resposta 1']);
    assert.equal(c.graphCalls[0].to, waId);

    await c.echo(waId, 'Bom dia! Aqui é o advogado, eu sigo com você.');
    const paused = await waitFor(
      async () => {
        const session = await sessionOf(c.t);
        return session?.status === 'paused' ? session : null;
      },
      5000,
      'paused session',
    );
    assert.ok((paused.parameters as any).humanLastMessageAt);
    await waitFor(() => c.statusEvents().length === 1, 5000, 'change status webhook');
    assert.equal(c.statusEvents()[0].reason, 'human');

    await c.inbound(waId, 'certo, obrigado');
    await sleep(1500);
    assert.equal(h.openai.requests.length, 1, 'not answered during the pause');
    assert.deepEqual(c.botTexts(), ['resposta 1']);
  });

  test('echo with the other Brazilian form of the number (ninth digit) pauses the same session', async () => {
    const c = await cloudTenant();

    await c.inbound('5511987654321', 'oi');
    await waitFor(() => c.botTexts().length === 1, 8000, 'bot answer');

    await c.echo('551187654321', 'eu assumo');
    await waitFor(async () => (await sessionOf(c.t))?.status === 'paused', 5000, 'paused session');

    const sessions = await h.prisma.integrationSession.findMany({ where: { instanceId: c.t.instance.instanceId } });
    assert.equal(sessions.length, 1, 'no second session for the other form of the number');
  });

  test('owner writes first in the app: a paused session is created and the bot never answers', async () => {
    const c = await cloudTenant();
    await c.echo('5521987654321', 'Olá! Sou do escritório, vi sua mensagem no site.');
    await waitFor(async () => (await sessionOf(c.t))?.status === 'paused', 5000, 'paused session');

    await c.inbound('5521987654321', 'oi!');
    await sleep(1500);
    assert.equal(h.openai.requests.length, 0);
    assert.deepEqual(c.botTexts(), []);
  });

  test('an echo carrying the wamid of a bot message (defensive) does not pause', async () => {
    const c = await cloudTenant();
    await c.inbound('5511912345678', 'oi');
    await waitFor(() => c.botTexts().length === 1, 8000, 'bot answer');

    const [botWamid] = c.sentWamids;
    const saved = await h.prisma.message.findFirst({
      where: { instanceId: c.t.instance.instanceId, key: { path: ['id'], equals: botWamid } },
    });
    assert.equal((saved.key as any).fromMe, true, 'the bot message was stored by the channel');

    await c.echo('5511912345678', 'resposta 1', botWamid);
    await sleep(300);
    assert.equal((await sessionOf(c.t)).status, 'opened');
    assert.deepEqual(c.statusEvents(), []);
  });
});
