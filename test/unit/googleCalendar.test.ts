import '../helpers/setup';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { AgendaService } from '@api/services/agenda.service';
import { GoogleCalendarError, GoogleCalendarService } from '@api/services/google-calendar.service';
import { clientRouteAllowed } from '@utils/client-access';
import {
  authUrl,
  busyFromEvents,
  decryptToken,
  emailFromIdToken,
  encryptToken,
  eventBody,
  googleEventId,
  hasEventsScope,
  signState,
  STATE_TTL_MS,
  verifyState,
} from '@utils/google-calendar';

const SECRET = 'segredo-de-teste';
const NOW = Date.UTC(2026, 10, 11, 13, 0, 0);

const idToken = (email: string) => ['x', Buffer.from(JSON.stringify({ email })).toString('base64url'), 'sig'].join('.');

type Call = { url: string; init: any };
function fakeFetch(handler: (url: string, init: any) => { status?: number; body?: any }) {
  const calls: Call[] = [];
  const impl = async (url: string, init: any = {}) => {
    calls.push({ url, init });
    const { status = 200, body = {} } = handler(url, init);
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { calls, impl };
}

function fakePrisma() {
  const store = new Map<string, any>();
  return {
    store,
    globalSetting: {
      findUnique: async ({ where }: any) =>
        store.has(where.key) ? { key: where.key, value: store.get(where.key) } : null,
      upsert: async ({ where, create, update }: any) => {
        store.set(where.key, structuredClone(store.has(where.key) ? update.value : create.value));
        return { key: where.key };
      },
      deleteMany: async ({ where }: any) => {
        store.delete(where.key);
        return { count: 1 };
      },
    },
  };
}

function service(handler: Parameters<typeof fakeFetch>[0], opts: Partial<{ now: number; configured: boolean }> = {}) {
  const fetch = fakeFetch(handler);
  const prisma = fakePrisma();
  let now = opts.now ?? NOW;
  const svc = new GoogleCalendarService(prisma, {
    clientId: opts.configured === false ? undefined : 'client-id',
    clientSecret: opts.configured === false ? undefined : 'client-secret',
    redirectUri: 'https://api.exemplo.test/agenda/google/callback',
    returnUrl: 'https://painel.exemplo.test',
    secret: SECRET,
    fetchImpl: fetch.impl as any,
    now: () => now,
  });
  return { svc, fetch, prisma, tick: (ms: number) => (now += ms) };
}

const tokenOk = (extra: any = {}) => ({
  access_token: 'at-1',
  refresh_token: 'rt-1',
  expires_in: 3600,
  scope: 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/calendar.events',
  id_token: idToken('escritorio@exemplo.test'),
  ...extra,
});

describe('google calendar helpers', () => {
  test('state: signed, bound to the instance, expires in 10 min, rejects tampering', () => {
    const state = signState('inst-1', SECRET, NOW);
    assert.equal(verifyState(state, SECRET, NOW + 1000), 'inst-1');
    assert.equal(verifyState(state, SECRET, NOW + STATE_TTL_MS + 1), null);
    assert.equal(verifyState(state, 'outro-segredo', NOW), null);
    const [payload, mac] = state.split('.');
    const forged = Buffer.from(JSON.stringify({ i: 'inst-2', e: NOW + 60_000, n: 'x' })).toString('base64url');
    assert.equal(verifyState(`${forged}.${mac}`, SECRET, NOW), null);
    assert.equal(verifyState(`${payload}.${mac}.x`, SECRET, NOW), null);
    assert.equal(verifyState(undefined, SECRET, NOW), null);
  });

  test('refresh token is encrypted at rest and only opens with the same secret', () => {
    const sealed = encryptToken('1//refresh-token', SECRET);
    assert.ok(sealed.startsWith('v1.'));
    assert.ok(!sealed.includes('refresh-token'));
    assert.equal(decryptToken(sealed, SECRET), '1//refresh-token');
    assert.equal(decryptToken(sealed, 'outro'), null);
    assert.equal(decryptToken('v1.a.b.c', SECRET), null);
    assert.notEqual(encryptToken('x', SECRET), encryptToken('x', SECRET));
  });

  test('event id is stable and valid for Google (base32hex)', () => {
    const id = googleEventId('cmabc123xyz');
    assert.equal(id, googleEventId('cmabc123xyz'));
    assert.match(id, /^[a-v0-9]{5,1024}$/);
    assert.notEqual(id, googleEventId('cmabc123xy0'));
  });

  test('auth URL asks offline access with the calendar.events scope', () => {
    const url = new URL(authUrl({ clientId: 'c', redirectUri: 'https://r.test/cb', state: 's', loginHint: 'a@b.c' }));
    assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(url.searchParams.get('access_type'), 'offline');
    assert.equal(url.searchParams.get('prompt'), 'consent');
    assert.ok(hasEventsScope(url.searchParams.get('scope')));
    assert.equal(url.searchParams.get('login_hint'), 'a@b.c');
    assert.equal(emailFromIdToken(idToken('x@y.z')), 'x@y.z');
    assert.equal(emailFromIdToken('lixo'), null);
  });

  test('event body: type and short name, phone, never the internal notes', () => {
    const body = eventBody(
      {
        id: 'ap1',
        typeName: 'Atendimento inicial',
        contactName: 'Maria Exemplo da Silva',
        remoteJid: '5521900000011@s.whatsapp.net',
        mode: 'presencial',
        status: 'pendente',
        notes: 'segredo do processo',
        startsAt: new Date('2026-11-12T13:00:00Z'),
        endsAt: new Date('2026-11-12T13:30:00Z'),
      },
      'America/Sao_Paulo',
      'Rua Fictícia, 100',
    );
    assert.equal(body.id, googleEventId('ap1'));
    assert.match(body.summary, /^Atendimento inicial — Maria/);
    assert.match(body.description, /WhatsApp: \+5521900000011/);
    assert.ok(!JSON.stringify(body).includes('segredo'));
    assert.equal(body.status, 'tentative');
    assert.equal(body.location, 'Rua Fictícia, 100');
    assert.equal(body.extendedProperties.private.whatsai, '1');
    assert.equal(body.start.timeZone, 'America/Sao_Paulo');
  });

  test('busy: opaque timed and all-day events; skips free, cancelled and WhatsAI copies', () => {
    const busy = busyFromEvents(
      [
        { id: 'a', start: { dateTime: '2026-11-12T14:00:00-03:00' }, end: { dateTime: '2026-11-12T15:00:00-03:00' } },
        {
          id: 'b',
          transparency: 'transparent',
          start: { dateTime: '2026-11-12T16:00:00Z' },
          end: { dateTime: '2026-11-12T17:00:00Z' },
        },
        {
          id: 'c',
          status: 'cancelled',
          start: { dateTime: '2026-11-12T16:00:00Z' },
          end: { dateTime: '2026-11-12T17:00:00Z' },
        },
        {
          id: 'd',
          extendedProperties: { private: { whatsai: '1' } },
          start: { dateTime: '2026-11-12T18:00:00Z' },
          end: { dateTime: '2026-11-12T19:00:00Z' },
        },
        { id: 'e', start: { date: '2026-11-13' }, end: { date: '2026-11-14' } },
        { id: 'f', start: { dateTime: 'x' }, end: { dateTime: 'y' } },
      ],
      'America/Sao_Paulo',
    );
    assert.deepEqual(
      busy.map((b) => [b.id, b.start.toISOString(), b.end.toISOString()]),
      [
        ['google:a', '2026-11-12T17:00:00.000Z', '2026-11-12T18:00:00.000Z'],
        ['google:e', '2026-11-13T03:00:00.000Z', '2026-11-14T03:00:00.000Z'],
      ],
    );
  });

  test('client access: the office can see, connect and disconnect its own Google Agenda', () => {
    for (const [method, path] of [
      ['GET', '/agenda/google/:i'],
      ['POST', '/agenda/google/:i/connect'],
      ['DELETE', '/agenda/google/:i'],
    ]) {
      assert.equal(clientRouteAllowed(method, path, ['agenda']), true, `${method} ${path}`);
      assert.equal(clientRouteAllowed(method, path, ['leads']), false, `${method} ${path} without agenda`);
    }
  });
});

describe('GoogleCalendarService', () => {
  test('not configured: status says so and connect refuses', async () => {
    const { svc } = service(() => ({}), { configured: false });
    assert.equal(svc.available(), false);
    assert.deepEqual((await svc.status('i1')).available, false);
    assert.throws(() => svc.connectUrl('i1'), GoogleCalendarError);
    assert.deepEqual(await svc.busy('i1', new Date(NOW), new Date(NOW + 1), 'UTC'), []);
  });

  test('connect: exchanges the code, stores the encrypted refresh token, shows the e-mail', async () => {
    const { svc, fetch, prisma } = service((url) => (url.includes('/token') ? { body: tokenOk() } : {}));
    const state = new URL(svc.connectUrl('inst-1')).searchParams.get('state');
    assert.equal(await svc.finishConnect('code-1', state), 'inst-1');
    const sent = new URLSearchParams(fetch.calls[0].init.body);
    assert.equal(sent.get('grant_type'), 'authorization_code');
    assert.equal(sent.get('redirect_uri'), 'https://api.exemplo.test/agenda/google/callback');
    const stored = prisma.store.get('gcal:inst-1');
    assert.ok(stored.refresh.startsWith('v1.'));
    assert.ok(!JSON.stringify(stored).includes('rt-1'));
    const status = await svc.status('inst-1');
    assert.equal(status.connected, true);
    assert.equal(status.email, 'escritorio@exemplo.test');
    assert.ok(!JSON.stringify(status).includes('v1.'));
    assert.equal(svc.returnTo('inst-1', 'ok'), 'https://painel.exemplo.test/manager/instance/inst-1/agenda?google=ok');
  });

  test('connect: refuses a bad state and a consent without the calendar permission', async () => {
    const { svc } = service(() => ({ body: tokenOk({ scope: 'openid email' }) }));
    await assert.rejects(svc.finishConnect('c', 'forjado.x'), /expirou/);
    const state = new URL(svc.connectUrl('inst-1')).searchParams.get('state');
    await assert.rejects(svc.finishConnect('c', state), /permissão da agenda/);
    assert.equal((await svc.status('inst-1')).connected, false);
  });

  async function connected(handler: Parameters<typeof fakeFetch>[0]) {
    const ctx = service((url, init) =>
      url.includes('oauth2.googleapis.com/token') ? { body: tokenOk() } : handler(url, init),
    );
    const state = new URL(ctx.svc.connectUrl('inst-1')).searchParams.get('state');
    await ctx.svc.finishConnect('code', state);
    ctx.fetch.calls.length = 0;
    return ctx;
  }

  test('busy times: reads the primary calendar, caches 60 s, fail-open with an error in the status', async () => {
    let fail = false;
    const { svc, fetch, tick } = await connected(() =>
      fail
        ? { status: 500 }
        : {
            body: {
              items: [
                { id: 'x', start: { dateTime: '2026-11-12T13:00:00Z' }, end: { dateTime: '2026-11-12T14:00:00Z' } },
              ],
            },
          },
    );
    const from = new Date('2026-11-11T00:00:00Z');
    const to = new Date('2026-11-20T00:00:00Z');
    const busy = await svc.busy('inst-1', from, to, 'America/Sao_Paulo');
    assert.equal(busy.length, 1);
    assert.match(fetch.calls[0].url, /\/calendars\/primary\/events\?/);
    assert.equal(fetch.calls[0].init.headers.Authorization, 'Bearer at-1');
    await svc.busy('inst-1', new Date('2026-11-12T00:00:00Z'), new Date('2026-11-13T00:00:00Z'), 'America/Sao_Paulo');
    assert.equal(fetch.calls.length, 1, 'second read inside the cached window uses the cache');
    tick(61_000);
    fail = true;
    assert.deepEqual(await svc.busy('inst-1', from, to, 'America/Sao_Paulo'), []);
    const status = await svc.status('inst-1');
    assert.equal(status.status, 'error');
    assert.match(status.lastError, /horários ocupados/);
  });

  test('sync: PUT updates, 404 creates with the fixed id, cancelled deletes; never throws', async () => {
    const seen: string[] = [];
    let putStatus = 404;
    const { svc } = await connected((url, init) => {
      seen.push(`${init.method} ${url.split('/v3')[1]}`);
      if (init.method === 'PUT') return { status: putStatus };
      return { status: init.method === 'DELETE' ? 204 : 200 };
    });
    const row = {
      id: 'ap1',
      typeName: 'Consulta',
      remoteJid: '5521900000011@s.whatsapp.net',
      status: 'agendado',
      startsAt: new Date('2026-11-12T13:00:00Z'),
      endsAt: new Date('2026-11-12T13:30:00Z'),
    };
    const eid = googleEventId('ap1');
    await svc.syncAppointment('inst-1', row, 'America/Sao_Paulo');
    putStatus = 200;
    await svc.syncAppointment('inst-1', { ...row, status: 'confirmado' }, 'America/Sao_Paulo');
    await svc.syncAppointment('inst-1', { ...row, status: 'cancelado' }, 'America/Sao_Paulo');
    assert.deepEqual(seen, [
      `PUT /calendars/primary/events/${eid}?sendUpdates=none`,
      'POST /calendars/primary/events?sendUpdates=none',
      `PUT /calendars/primary/events/${eid}?sendUpdates=none`,
      `DELETE /calendars/primary/events/${eid}?sendUpdates=none`,
    ]);
    assert.ok((await svc.status('inst-1')).lastSyncAt);
  });

  test('revoked access: the status asks to connect again and the agenda keeps working', async () => {
    const ctx = await connected(() => ({ status: 200, body: { items: [] } }));
    ctx.tick(2 * 3_600_000); // access token expired
    const prisma = ctx.prisma;
    // the next refresh is refused by Google
    const svc2 = new GoogleCalendarService(prisma, {
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'https://api.exemplo.test/agenda/google/callback',
      secret: SECRET,
      fetchImpl: (async (url: string) => ({
        ok: false,
        status: 400,
        json: async () => (url.includes('/token') ? { error: 'invalid_grant' } : {}),
      })) as any,
      now: () => NOW,
    });
    assert.deepEqual(await svc2.busy('inst-1', new Date(NOW), new Date(NOW + 86_400_000), 'UTC'), []);
    const status = await svc2.status('inst-1');
    assert.equal(status.status, 'error');
    assert.match(status.lastError, /Conectar Google Agenda/);
  });

  test('disconnect revokes at Google and forgets the connection', async () => {
    const { svc, fetch, prisma } = await connected(() => ({}));
    await svc.disconnect('inst-1');
    assert.match(fetch.calls[0].url, /^https:\/\/oauth2\.googleapis\.com\/revoke\?token=rt-1$/);
    assert.equal(prisma.store.has('gcal:inst-1'), false);
    assert.equal((await svc.status('inst-1')).connected, false);
  });
});

describe('AgendaService + Google Agenda', () => {
  test('busy times of Google block the slot; the booking is copied to Google', async () => {
    const synced: any[] = [];
    const google: any = {
      busy: async () => [
        { id: 'google:x', start: new Date('2026-11-12T13:00:00Z'), end: new Date('2026-11-12T14:00:00Z') },
      ],
      syncAppointment: async (_i: string, row: any) => {
        synced.push(row.status);
      },
    };
    const appointments: any[] = [];
    const prisma: any = {
      agendaSettings: {
        findUnique: async () => ({
          instanceId: 'i1',
          enabled: true,
          timezone: 'America/Sao_Paulo',
          availability: { thu: [['09:00', '18:00']] },
          appointmentTypes: [{ name: 'Consulta', minutes: 30, mode: 'presencial' }],
        }),
        upsert: async () => ({}),
        update: async () => ({}),
      },
      appointment: {
        findFirst: async () => null,
        count: async () => 0,
        findMany: async () => appointments,
        create: async ({ data }: any) => {
          const row = { id: 'new' + appointments.length, ...data };
          appointments.push(row);
          return row;
        },
      },
      $transaction: async (fn: any) => fn(prisma),
    };
    const agenda = new AgendaService(prisma, undefined, {
      now: () => Date.UTC(2026, 10, 11, 12, 0, 0),
      google,
      sendText: async () => true,
    });
    // 10:00 local (13:00Z) is busy in Google
    await assert.rejects(
      agenda.createAppointment('i1', {
        remoteJid: '5521900000011@s.whatsapp.net',
        startsAt: new Date('2026-11-12T13:00:00Z'),
        source: 'ia',
      }),
      /não está disponível/,
    );
    const ok = await agenda.createAppointment('i1', {
      remoteJid: '5521900000011@s.whatsapp.net',
      startsAt: new Date('2026-11-12T15:00:00Z'),
      source: 'ia',
    });
    assert.equal(ok.created, true);
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(synced, ['agendado']);
    const slots = await agenda.freeSlots('i1', { fromDay: '2026-11-12', days: 1 });
    assert.ok(!slots.slots.some((s) => s.startsAt === '2026-11-12T13:00:00.000Z'));
  });
});
