import '../helpers/setup';

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import { BusinessStartupService } from '@api/integrations/channel/meta/whatsapp.business.service';
import { configService } from '@config/env.config';
import { detectAudioFormat, detectAudioFormatFromBase64 } from '@utils/audioFormat';
import EventEmitter2 from 'eventemitter2';

/**
 * Cloud API (WHATSAPP-BUSINESS) fixes testable without Meta credentials: status webhooks without `profile`
 * (#2704/#2710), one unknown status not dropping the batch (#2700), the real audio format and voice notes
 * (#2719) and the description/footer of buttons (#2723). Prisma and the Graph API are mocked.
 */
const INSTANCE_ID = 'inst-cloud-fixes';
const PHONE_NUMBER_ID = 'PNID-FIX';
const metadata = { display_phone_number: '15550000000', phone_number_id: PHONE_NUMBER_ID };
const OGG = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(60, 1)]);
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(60, 2)]);

function createService() {
  const state = {
    known: new Set<string>(['wamid.KNOWN']),
    messageUpdates: [] as any[],
    webhooks: [] as { event: string; data: any }[],
    posts: [] as any[],
    uploads: [] as any[],
    errors: [] as any[],
  };

  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_target, op: string) => async (args: any) => {
          if (name === 'message' && op === 'findFirst') {
            const id = args?.where?.key?.equals;
            return state.known.has(id) ? { id: `row-${id}`, webhookUrl: null } : null;
          }
          if (name === 'messageUpdate' && op === 'create') state.messageUpdates.push(args.data);
          if (op === 'create') return { id: 'row-1', ...(args?.data ?? {}) };
          return null;
        },
      },
    );

  const prisma: any = new Proxy({}, { get: (_target, name: string) => model(name) });
  const cache: any = { get: async () => null, set: async () => undefined, hSet: async () => undefined };

  const service: any = new BusinessStartupService(
    configService,
    new EventEmitter2(),
    prisma,
    cache,
    cache,
    cache,
    {} as any,
  );
  service.setInstance({
    instanceName: 'cloud-fixes',
    instanceId: INSTANCE_ID,
    integration: 'WHATSAPP-BUSINESS',
    number: PHONE_NUMBER_ID,
    token: 'not-a-real-token',
  });
  service.sendDataWebhook = (event: string, data: any) => void state.webhooks.push({ event, data });
  service.logger.error = (value: any) => void state.errors.push(value);
  service.post = async (content: any) => {
    state.posts.push(content);
    return { messages: [{ id: `wamid.OUT${state.posts.length}` }] };
  };
  service.getIdMedia = async (media: any) => {
    state.uploads.push({ fileName: media.fileName, mimetype: media.mimetype });
    return 'MEDIA-ID-1';
  };

  return { service, state };
}

describe('Cloud API status webhooks', () => {
  let ctx: ReturnType<typeof createService>;
  beforeEach(() => {
    ctx = createService();
  });

  const statuses = (ids: string[], contacts: any[] = [{ wa_id: '5511987654321' }]) => ({
    messaging_product: 'whatsapp',
    metadata,
    contacts,
    statuses: ids.map((id) => ({ id, status: 'delivered', timestamp: '1761750001', recipient_id: '5511987654321' })),
  });

  const updates = () => ctx.state.webhooks.filter((w) => w.event === 'messages.update');

  test('contacts without profile (status webhooks) no longer abort the statuses (#2704/#2710)', async () => {
    await ctx.service.messageHandle(statuses(['wamid.KNOWN']), {}, {});

    assert.equal(updates().length, 1);
    assert.equal(updates()[0].data.status, 'DELIVERED');
    assert.equal(ctx.state.messageUpdates.length, 1);
    assert.deepEqual(ctx.state.errors, []);
  });

  test('a failed status forwards a compact copy of the Meta errors to the webhook (#2486)', async () => {
    const payload = statuses(['wamid.KNOWN']);
    payload.statuses[0] = {
      ...payload.statuses[0],
      status: 'failed',
      errors: [
        {
          code: 131047,
          title: 'Re-engagement message',
          message: 'Re-engagement message',
          error_data: { details: 'Message failed to send because more than 24 hours have passed.'.repeat(10) },
          href: 'https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes/',
        },
      ],
    } as any;

    await ctx.service.messageHandle(payload, {}, {});

    const [update] = updates();
    assert.equal(update.data.status, 'FAILED');
    assert.equal(update.data.errors.length, 1);
    assert.equal(update.data.errors[0].code, 131047);
    assert.equal(update.data.errors[0].title, 'Re-engagement message');
    assert.equal(update.data.errors[0].details.length, 300, 'long texts are cut');
    assert.equal(update.data.errors[0].href, undefined, 'only the useful fields');
    assert.equal(ctx.state.messageUpdates[0].errors, undefined, 'no new column in MessageUpdate');
  });

  test('statuses without errors keep the payload as before', async () => {
    await ctx.service.messageHandle(statuses(['wamid.KNOWN']), {}, {});
    assert.equal('errors' in updates()[0].data, false);
  });

  test('an unknown wamid does not drop the rest of the batch (#2700)', async () => {
    await ctx.service.messageHandle(statuses(['wamid.UNKNOWN', 'wamid.KNOWN']), {}, {});

    assert.deepEqual(
      updates().map((w) => w.data.keyId),
      ['wamid.KNOWN'],
    );
  });
});

describe('Cloud API sends', () => {
  let ctx: ReturnType<typeof createService>;
  beforeEach(() => {
    ctx = createService();
  });

  test('a base64 OGG/Opus audio is uploaded as audio/ogg and sent as a voice note (#2719)', async () => {
    await ctx.service.audioWhatsapp({ number: '5511987654321', audio: OGG.toString('base64') });

    assert.equal(ctx.state.uploads.length, 1);
    assert.match(ctx.state.uploads[0].fileName, /\.ogg$/);
    assert.equal(ctx.state.uploads[0].mimetype, 'audio/ogg');

    const [content] = ctx.state.posts;
    assert.equal(content.type, 'audio');
    assert.deepEqual(content.audio, { id: 'MEDIA-ID-1', voice: true });
  });

  test('a base64 MP3 keeps audio/mpeg and is not a voice note', async () => {
    await ctx.service.audioWhatsapp({ number: '5511987654321', audio: MP3.toString('base64') });

    assert.match(ctx.state.uploads[0].fileName, /\.mp3$/);
    assert.equal(ctx.state.uploads[0].mimetype, 'audio/mpeg');
    assert.deepEqual(ctx.state.posts[0].audio, { id: 'MEDIA-ID-1' });
  });

  test('buttons keep the description in the body and the footer (#2723)', async () => {
    await ctx.service.buttonMessage({
      number: '5511987654321',
      title: 'Agendamento',
      description: 'Escolha um horário',
      footer: 'Escritório Silva',
      buttons: [
        { type: 'reply', displayText: 'Manhã', id: 'm' },
        { type: 'reply', displayText: 'Tarde', id: 't' },
      ],
    });

    const { interactive } = ctx.state.posts[0];
    assert.equal(interactive.body.text, 'Agendamento\n\nEscolha um horário');
    assert.deepEqual(interactive.footer, { text: 'Escritório Silva' });
    assert.deepEqual(
      interactive.action.buttons.map((button: any) => button.reply.title),
      ['Manhã', 'Tarde'],
    );
  });

  test('buttons without description or footer send only the title', async () => {
    await ctx.service.buttonMessage({
      number: '5511987654321',
      title: 'Confirma?',
      buttons: [{ type: 'reply', displayText: 'Sim', id: 's' }],
    });

    const { interactive } = ctx.state.posts[0];
    assert.equal(interactive.body.text, 'Confirma?');
    assert.equal(interactive.footer, undefined);
  });
});

describe('detectAudioFormat', () => {
  test('recognises the containers the Cloud API accepts', () => {
    assert.deepEqual(detectAudioFormat(OGG), { mimetype: 'audio/ogg', extension: 'ogg' });
    assert.deepEqual(detectAudioFormat(MP3), { mimetype: 'audio/mpeg', extension: 'mp3' });
    assert.equal(detectAudioFormat(Buffer.from([0xff, 0xfb, 0x90, 0x00]))?.mimetype, 'audio/mpeg');
    assert.equal(detectAudioFormat(Buffer.from([0xff, 0xf1, 0x50, 0x80]))?.mimetype, 'audio/aac');
    assert.equal(detectAudioFormat(Buffer.from('#!AMR\n'))?.mimetype, 'audio/amr');
    assert.equal(detectAudioFormat(Buffer.from('\0\0\0\x20ftypM4A '))?.mimetype, 'audio/mp4');
  });

  test('unknown or empty input is null; base64 with a data URL prefix works', () => {
    assert.equal(detectAudioFormat(Buffer.from('hello world')), null);
    assert.equal(detectAudioFormat(null), null);
    assert.equal(detectAudioFormatFromBase64(''), null);
    assert.equal(detectAudioFormatFromBase64(`data:audio/ogg;base64,${OGG.toString('base64')}`)?.extension, 'ogg');
  });
});
