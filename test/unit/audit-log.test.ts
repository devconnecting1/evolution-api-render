import '../helpers/setup';

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, test } from 'node:test';

import { auditActor, createAuditMiddleware } from '@api/guards/audit.middleware';
import { AuditLogService, auditRetentionDaysFromEnv } from '@api/services/audit-log.service';
import { auditActionFor, csvCell, maskJid, truncateIp } from '@utils/audit-log';

const NAME = 'Renato Paixão';
const enc = encodeURIComponent(NAME);
const GLOBAL = 'GLOBAL-KEY-FOR-THE-TEST-000000000';

describe('audit log: which actions are recorded', () => {
  test('pausing and resuming the AI for a contact: label, decoded instance and masked number only', () => {
    const body = { remoteJid: '5521900000011@s.whatsapp.net', status: 'paused', note: 'texto qualquer da conversa' };
    const a = auditActionFor('POST', `/openai/changeStatus/${enc}`, body);
    assert.deepEqual(a, { type: 'ia', action: 'Pausou a IA', instanceName: NAME, target: '+55 21 9****-0011' });
    assert.equal(
      auditActionFor('POST', `/openai/changeStatus/${enc}`, { ...body, status: 'opened' })?.action,
      'Retomou a IA',
    );
    assert.ok(!JSON.stringify(a).includes('texto qualquer'), 'nothing else from the body');
  });

  test('instance, settings, exports, deletes, credentials, team and access are recognized', () => {
    const cases: [string, string, any, string][] = [
      ['POST', '/instance/create', { instanceName: 'Loja Exemplo', token: 'secret-token' }, 'Criou a instância'],
      ['DELETE', `/instance/delete/${enc}`, {}, 'Excluiu a instância'],
      ['DELETE', `/instance/logout/${enc}`, {}, 'Desconectou o WhatsApp'],
      ['POST', `/settings/set/${enc}`, { rejectCall: true }, 'Alterou o comportamento'],
      ['PUT', `/openai/update/bot1/${enc}`, { systemMessages: ['prompt secreto'] }, 'Alterou o atendente IA'],
      ['POST', `/openai/creds/${enc}`, { apiKey: 'sk-secret' }, 'Alterou as credenciais da IA'],
      ['DELETE', `/leads/${enc}/lead1`, {}, 'Excluiu um lead'],
      ['GET', `/leads/${enc}/export.xlsx?x=1`, {}, 'Exportou os leads'],
      ['GET', `/processos/${enc}/export.csv`, {}, 'Exportou os processos'],
      ['DELETE', `/chat/deleteMessageForEveryone/${enc}`, { id: 'm1' }, 'Apagou uma mensagem para todos'],
      ['POST', `/usage/limits/${enc}`, {}, 'Alterou o plano e os limites'],
      ['POST', `/usage/billing/${enc}`, { amount: 100 }, 'Criou um lançamento da cobrança'],
      ['PATCH', `/usage/billing/${enc}/b1`, { amount: 100 }, 'Alterou um lançamento da cobrança'],
      ['DELETE', `/usage/billing/${enc}/b1`, {}, 'Excluiu um lançamento da cobrança'],
      ['POST', `/client-access/${enc}`, { newKey: true }, 'Gerou um novo código do cliente'],
      ['DELETE', `/client-access/${enc}`, {}, 'Removeu o acesso do cliente'],
      ['POST', '/team/keys', { name: 'Ana Exemplo', role: 'equipe' }, 'Criou uma chave de equipe'],
      ['DELETE', '/team/keys/k1', {}, 'Revogou uma chave de equipe'],
      ['POST', '/admin/retention/run', {}, 'Apagou mensagens antigas agora'],
      ['POST', '/admin/credentials/reveal', { id: 'x' }, 'Revelou uma credencial'],
      ['GET', '/admin/audit/export.csv', {}, 'Exportou o registro de ações'],
    ];
    for (const [m, u, b, label] of cases) assert.equal(auditActionFor(m, u, b)?.action, label, `${m} ${u}`);
    assert.equal(
      auditActionFor('POST', '/instance/create', { instanceName: 'Loja Exemplo' })?.instanceName,
      'Loja Exemplo',
    );
    const created = JSON.stringify(
      auditActionFor('POST', '/instance/create', { instanceName: 'X', token: 'secret-token' }),
    );
    assert.ok(!created.includes('secret-token'));
    assert.equal(auditActionFor('POST', '/team/keys', { name: 'Ana Exemplo', role: 'equipe' })?.target, 'Ana Exemplo');
  });

  test('ordinary traffic is not recorded: reads, sending messages, polling', () => {
    for (const [m, u] of [
      ['GET', `/leads/${enc}`],
      ['POST', `/chat/findChats/${enc}`],
      ['POST', `/message/sendText/${enc}`],
      ['GET', '/instance/fetchInstances'],
      ['GET', `/instance/connectionState/${enc}`],
      ['GET', '/team/me'],
      ['GET', '/team/sessions'],
    ]) {
      assert.equal(auditActionFor(m, u, {}), null, `${m} ${u}`);
    }
  });

  test('helpers: masked number, truncated IP, CSV cell safe against formulas', () => {
    assert.equal(maskJid('all'), 'todos os contatos');
    assert.equal(maskJid('123'), null);
    assert.equal(truncateIp('203.0.113.57'), '203.0.113.0');
    assert.equal(truncateIp('::ffff:198.51.100.7'), '198.51.100.0');
    assert.equal(truncateIp('2001:db8:85a3:8d3:1319:8a2e:370:7348'), '2001:db8:85a3::');
    assert.equal(truncateIp(null), null);
    assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
    assert.equal(csvCell('Ana'), '"Ana"');
  });
});

describe('audit log: middleware', () => {
  const make = (key: string | undefined, method: string, url: string, body: any = {}, extra: any = {}) =>
    Object.assign(
      {
        get: (h: string) => (h.toLowerCase() === 'apikey' ? key : undefined),
        method,
        originalUrl: url,
        body,
        headers: { 'cf-connecting-ip': '203.0.113.57' },
      },
      extra,
    ) as any;

  const runOnce = (req: any, status: number) => {
    const recorded: any[] = [];
    const service = { record: (entry: any) => recorded.push(entry) } as unknown as AuditLogService;
    const res: any = new EventEmitter();
    res.statusCode = status;
    let nextCalled = false;
    createAuditMiddleware(() => service, () => GLOBAL)(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true, 'never blocks the request');
    assert.equal(recorded.length, 0, 'nothing before the response is sent');
    res.emit('finish');
    return recorded;
  };

  test('owner, team member (any role, including dono), client code and instance token are told apart', () => {
    const owner = runOnce(make(GLOBAL, 'DELETE', `/instance/delete/${enc}`), 200);
    assert.equal(owner.length, 1);
    assert.deepEqual(
      { actor: owner[0].actor, kind: owner[0].actorKind, instance: owner[0].instanceName, ip: owner[0].ip },
      { actor: 'Dono', kind: 'owner', instance: NAME, ip: '203.0.113.0' },
    );

    const teamBody = { remoteJid: '5521900000011@s.whatsapp.net', status: 'paused' };
    const teamExtra = { teamAccess: { name: 'Ana Exemplo', role: 'equipe' } };
    const team = runOnce(
      make('wat_' + 'e'.repeat(43), 'POST', `/openai/changeStatus/${enc}`, teamBody, teamExtra),
      201,
    );
    assert.equal(team[0].actor, 'Ana Exemplo');
    assert.equal(team[0].actorKind, 'team');

    const dono = runOnce(
      make('wat_' + 'd'.repeat(43), 'DELETE', '/team/keys/k1', {}, { teamAccess: { name: 'Dono', role: 'dono' } }),
      200,
    );
    assert.equal(dono[0].actor, 'Dono');
    assert.equal(dono[0].actorKind, 'team');

    const sessionExtra = { userSession: { name: 'Dona Google' } };
    const session = runOnce(make('was_' + 'x'.repeat(40), 'POST', `/settings/set/${enc}`, {}, sessionExtra), 200);
    assert.equal(session[0].actor, 'Dona Google');
    assert.equal(session[0].actorKind, 'team');

    const key = 'wac_' + 'c'.repeat(39) + 'Zx9Q';
    const client = runOnce(make(key, 'DELETE', `/leads/${enc}/l1`, {}, { clientAccess: { instanceName: NAME } }), 200);
    assert.equal(client[0].actor, 'Cliente (código wac_…Zx9Q)');

    const token = runOnce(make('SOME-INSTANCE-TOKEN', 'POST', `/settings/set/${enc}`), 200);
    assert.equal(token[0].actor, 'Token da instância');
    assert.ok(!JSON.stringify(token[0]).includes('SOME-INSTANCE-TOKEN'), 'the key itself is never recorded');
  });

  test('failed requests and ordinary traffic are not recorded', () => {
    assert.equal(runOnce(make(GLOBAL, 'DELETE', `/instance/delete/${enc}`), 403).length, 0);
    assert.equal(runOnce(make(GLOBAL, 'POST', `/message/sendText/${enc}`, { text: 'olá' }), 201).length, 0);
    assert.equal(runOnce(make(undefined, 'DELETE', `/instance/delete/${enc}`), 200).length, 0);
  });

  test('auditActor without key is null', () => {
    assert.equal(auditActor(make(undefined, 'GET', '/'), GLOBAL), null);
  });
});

describe('audit log: service', () => {
  const fake = () => {
    const rows: any[] = [];
    const calls: any[] = [];
    let resolveCreate: (() => void) | null = null;
    return {
      rows,
      calls,
      hold() {
        return new Promise<void>((r) => (resolveCreate = r));
      },
      release() {
        resolveCreate?.();
      },
      prisma: {
        auditLog: {
          create: async ({ data }: any) => {
            rows.push({ id: String(rows.length + 1), createdAt: new Date('2026-11-12T10:00:00Z'), ...data });
            return rows[rows.length - 1];
          },
          deleteMany: async (args: any) => {
            calls.push(['deleteMany', args]);
            return { count: 0 };
          },
          count: async () => rows.length,
          findMany: async (args: any) => {
            calls.push(['findMany', args]);
            if (args.distinct) return [];
            return rows;
          },
        },
      },
    };
  };

  test('record never throws, clips long values and purges rows older than the retention once a day', async () => {
    const f = fake();
    const service = new AuditLogService({ prisma: f.prisma, now: () => Date.parse('2026-11-12T10:00:00Z') });
    service.record({
      actor: 'A'.repeat(500),
      actorKind: 'owner',
      type: 'ia',
      action: 'Pausou a IA',
      instanceName: NAME,
      target: null,
      method: 'POST',
      path: '/x'.repeat(300),
      status: 201,
      ip: '203.0.113.0',
    });
    service.record({
      actor: 'B',
      actorKind: 'team',
      type: 'ia',
      action: 'Retomou a IA',
      method: 'POST',
      path: '/y',
      status: 201,
    });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(f.rows.length, 2);
    assert.equal(f.rows[0].actor.length, 120);
    assert.equal(f.rows[0].path.length, 200);
    const purges = f.calls.filter((c) => c[0] === 'deleteMany');
    assert.equal(purges.length, 1, 'once per day');
    assert.equal(purges[0][1].where.createdAt.lt.toISOString(), '2026-05-16T10:00:00.000Z');

    const broken = new AuditLogService({
      prisma: { auditLog: { create: async () => Promise.reject(new Error('db down')), deleteMany: async () => ({}) } },
    });
    assert.doesNotThrow(() =>
      broken.record({
        actor: 'A',
        actorKind: 'owner',
        type: 'ia',
        action: 'x',
        method: 'POST',
        path: '/',
        status: 200,
      }),
    );
  });

  test('retention is configurable (AUDIT_RETENTION_DAYS): default 180, clamped between 1 and 3650', async () => {
    assert.equal(auditRetentionDaysFromEnv(undefined), 180);
    assert.equal(auditRetentionDaysFromEnv(''), 180);
    assert.equal(auditRetentionDaysFromEnv('abc'), 180);
    assert.equal(auditRetentionDaysFromEnv('0'), 180);
    assert.equal(auditRetentionDaysFromEnv('30'), 30);
    assert.equal(auditRetentionDaysFromEnv('99999'), 3650);

    const f = fake();
    const service = new AuditLogService({
      prisma: f.prisma,
      now: () => Date.parse('2026-11-12T10:00:00Z'),
      retentionDays: 30,
    });
    service.record({ actor: 'A', actorKind: 'owner', type: 'ia', action: 'x', method: 'POST', path: '/', status: 200 });
    await new Promise((r) => setTimeout(r, 10));
    const purge = f.calls.find((c) => c[0] === 'deleteMany');
    assert.equal(purge[1].where.createdAt.lt.toISOString(), '2026-10-13T10:00:00.000Z');
    assert.equal((await service.list()).retentionDays, 30);
  });

  test('list filters by instance, actor, type and period; csv has a header and a BOM', async () => {
    const f = fake();
    const service = new AuditLogService({ prisma: f.prisma });
    await f.prisma.auditLog.create({
      data: {
        actor: 'Ana',
        actorKind: 'team',
        type: 'ia',
        action: 'Pausou a IA',
        instanceName: NAME,
        target: '+55 21 9****-0011',
        ip: '203.0.113.0',
      },
    });
    const list = await service.list({
      instance: NAME,
      actor: 'Ana',
      type: 'ia',
      from: '2026-11-01',
      to: '2026-11-12',
      page: '1',
    });
    const where = f.calls.find((c) => c[0] === 'findMany' && !c[1].distinct)[1].where;
    assert.equal(where.instanceName, NAME);
    assert.equal(where.actor, 'Ana');
    assert.equal(where.type, 'ia');
    assert.ok(where.createdAt.gte instanceof Date && where.createdAt.lt instanceof Date);
    assert.equal(list.items[0].typeLabel, 'IA');
    assert.equal(list.retentionDays, 180);

    const ignored = await service.list({ type: 'nao-existe' });
    assert.equal(ignored.total, 1);

    const csv = await service.csv({});
    assert.ok(csv.startsWith(String.fromCharCode(0xfeff) + '"Quando (UTC)";"Quem"'));
    assert.match(csv, /"Ana";"Equipe";"IA";"Pausou a IA"/);
  });
});
