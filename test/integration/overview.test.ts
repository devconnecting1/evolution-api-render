import '../helpers/setup';
import '@exceptions';

import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';

import { OverviewController } from '@api/controllers/overview.controller';
import { authGuard } from '@api/guards/auth.guard';
import { instanceExistsGuard, instanceLoggedGuard } from '@api/guards/instance.guard';
import { PrismaRepository } from '@api/repository/repository.service';
import { OverviewRouter } from '@api/routes/overview.router';
import { OverviewService } from '@api/services/overview.service';
import { Auth, configService } from '@config/env.config';
import { shiftDay, zonedParts } from '@utils/usageLimits';
import express from 'express';
import { Server } from 'http';

import { serverModuleOverrides } from '../helpers/chatbot-emit';
import { migrateTestDatabase, SKIP_INTEGRATION } from '../helpers/integration';

const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const TOKEN_A = `fictional-overview-token-a-${suffix}`;
const TOKEN_B = `fictional-overview-token-b-${suffix}`;
const GLOBAL_KEY = configService.get<Auth>('AUTHENTICATION').API_KEY.KEY;

const HOUR = 3_600_000;

/** GET /overview/:instanceName on a real PostgreSQL: tenant isolation, auth and the counts the panel shows. */
describe('overview route (integration)', { skip: SKIP_INTEGRATION }, () => {
  const prisma = new PrismaRepository(configService);
  let server: Server;
  let base: string;
  let instanceA: any;
  let instanceB: any;
  const today = zonedParts(new Date(), 'America/Sao_Paulo').day;
  const month = zonedParts(new Date(), 'America/Sao_Paulo').month;

  const get = (name: string, key?: string, query = '') =>
    fetch(`${base}/${name}${query}`, { headers: key === undefined ? {} : { apikey: key } });

  before(async () => {
    migrateTestDatabase();
    await prisma.$connect();

    instanceA = await prisma.instance.create({
      data: {
        name: `overview-a-${suffix}`,
        token: TOKEN_A,
        integration: 'WHATSAPP-BAILEYS',
        connectionStatus: 'open',
      },
    });
    instanceB = await prisma.instance.create({
      data: {
        name: `overview-b-${suffix}`,
        token: TOKEN_B,
        integration: 'WHATSAPP-BAILEYS',
        connectionStatus: 'open',
      },
    });

    await prisma.instanceLimits.create({
      data: {
        instanceId: instanceA.id,
        monthlyResponses: 100,
        businessHours: { timezone: 'America/Sao_Paulo' },
      },
    });

    const now = Date.now();
    const noon = new Date(`${today}T12:00:00-03:00`);
    await prisma.lead.createMany({
      data: [
        {
          instanceId: instanceA.id,
          remoteJid: `5511900000001@s.whatsapp.net`,
          status: 'novo',
          awaitingHumanSince: new Date(now - 3 * HOUR),
        },
        {
          instanceId: instanceA.id,
          remoteJid: `5511900000002@s.whatsapp.net`,
          status: 'qualificado',
          awaitingHumanSince: new Date(now - 30 * 60_000),
        },
        {
          instanceId: instanceA.id,
          remoteJid: `5511900000003@s.whatsapp.net`,
          status: 'descartado',
          awaitingHumanSince: new Date(now - 5 * HOUR),
        },
      ],
    });
    await prisma.appointment.createMany({
      data: [
        {
          instanceId: instanceA.id,
          remoteJid: `5511900000001@s.whatsapp.net`,
          contactName: 'Maria Fictícia',
          typeName: 'Consulta',
          startsAt: noon,
          endsAt: new Date(noon.getTime() + HOUR),
          status: 'agendado',
        },
        {
          instanceId: instanceA.id,
          remoteJid: `5511900000002@s.whatsapp.net`,
          contactName: 'João Fictício',
          typeName: 'Reunião',
          startsAt: new Date(noon.getTime() + HOUR),
          endsAt: new Date(noon.getTime() + 2 * HOUR),
          status: 'cancelado',
        },
        {
          instanceId: instanceA.id,
          remoteJid: `5511900000003@s.whatsapp.net`,
          contactName: 'Ana Fictícia',
          typeName: 'Consulta',
          startsAt: new Date(now - 10 * 24 * HOUR),
          endsAt: new Date(now - 10 * 24 * HOUR + HOUR),
          createdAt: new Date(now - 10 * 24 * HOUR),
          status: 'agendado',
        },
      ],
    });
    await prisma.usageCounter.createMany({
      data: [
        { instanceId: instanceA.id, type: 'day', period: today, remoteJid: '', responses: 4 },
        { instanceId: instanceA.id, type: 'day', period: shiftDay(today, 1), remoteJid: '', responses: 2 },
        { instanceId: instanceA.id, type: 'month', period: month, remoteJid: '', responses: 42 },
      ],
    });

    await prisma.lead.create({
      data: { instanceId: instanceB.id, remoteJid: `5511900000009@s.whatsapp.net`, status: 'novo' },
    });
    await prisma.appointment.create({
      data: {
        instanceId: instanceB.id,
        remoteJid: `5511900000009@s.whatsapp.net`,
        contactName: 'Cliente Fictício',
        typeName: 'Consulta',
        startsAt: noon,
        endsAt: new Date(noon.getTime() + HOUR),
        status: 'agendado',
      },
    });
    await prisma.usageCounter.create({
      data: { instanceId: instanceB.id, type: 'day', period: today, remoteJid: '', responses: 9 },
    });

    serverModuleOverrides.prismaRepository = prisma;
    serverModuleOverrides.overviewController = new OverviewController(new OverviewService(prisma), prisma);

    const app = express();
    app.use(express.json());
    app.use('/overview', new OverviewRouter(instanceExistsGuard, instanceLoggedGuard, authGuard.apikey).router);
    app.use((error: any, _req: any, res: any, _next: any) => {
      void _next;
      res.status(error?.status ?? 500).json(error);
    });
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/overview`;
  });

  after(async () => {
    server?.close();
    delete serverModuleOverrides.prismaRepository;
    delete serverModuleOverrides.overviewController;
    await prisma.instance.deleteMany({ where: { id: { in: [instanceA?.id, instanceB?.id].filter(Boolean) } } });
    await prisma.$disconnect();
  });

  test('the token of the instance reads its own numbers', async () => {
    const response = await get(instanceA.name, TOKEN_A);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');

    const view: any = await response.json();
    assert.equal(view.instance, instanceA.name);
    assert.equal(view.timezone, 'America/Sao_Paulo');
    assert.deepEqual(view.period, { days: 7, from: shiftDay(today, 6), to: today });
    assert.equal(view.daily.length, 7);
    assert.equal(view.totals.leadsNew, 3);
    assert.equal(view.totals.awaitingTeam, 2, 'descartado does not wait for the team');
    assert.equal(view.totals.aiResponses, 6);
    assert.equal(view.alerts.leadsWaitingOver2h, 1);
    assert.equal(view.today.appointments.length, 1, 'cancelled appointments stay out of the agenda');
    assert.equal(view.today.appointments[0].time.length, 5);
    assert.deepEqual(view.plan, { month, responses: 42, limit: 100, percent: 42 });
  });

  test('the global key reads any instance and nothing leaks between tenants', async () => {
    const a: any = await (await get(instanceA.name, GLOBAL_KEY)).json();
    const b: any = await (await get(instanceB.name, GLOBAL_KEY)).json();

    assert.equal(a.totals.leadsNew, 3);
    assert.equal(b.totals.leadsNew, 1);
    assert.equal(b.totals.aiResponses, 9);
    assert.equal(b.today.appointments.length, 1);
    assert.equal(b.plan.limit, null, 'instance B has no plan');
    assert.ok(!JSON.stringify(b).includes('Maria Fictícia'));
    assert.ok(!JSON.stringify(a).includes('Cliente Fictício'));

    const month30: any = await (await get(instanceA.name, TOKEN_A, '?days=30')).json();
    assert.equal(month30.daily.length, 30);
  });

  test('authentication and the period are enforced before any query', async () => {
    assert.equal((await get(instanceA.name)).status, 401);
    assert.equal((await get(instanceA.name, `wrong-${suffix}`)).status, 401);
    assert.equal((await get(instanceA.name, TOKEN_B)).status, 401, 'another tenant token is not accepted');
    assert.equal((await get('nao-existe-' + suffix, GLOBAL_KEY)).status, 404);
    assert.equal((await get(instanceA.name, TOKEN_A, '?days=14')).status, 400);
  });
});
