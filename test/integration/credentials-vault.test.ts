import '../helpers/setup';
import '@exceptions';

import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';

import { createAdminOnlyGuard } from '@api/guards/auth.guard';
import { PrismaRepository } from '@api/repository/repository.service';
import { AdminCredentialsRouter } from '@api/routes/credentials.router';
import { CredentialsDeps, listCredentials } from '@api/services/credentials.service';
import { configService } from '@config/env.config';
import express from 'express';
import { Server } from 'http';

import { migrateTestDatabase, SKIP_INTEGRATION } from '../helpers/integration';

const GLOBAL_KEY = 'integration-admin-key-0123456789';
const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const OPENAI_KEY = `sk-fictional-integration-${suffix}-WXYZ`;
const TOKEN = `fictional-instance-token-${suffix}`;
const DIFY_KEY = `app-fictional-dify-${suffix}`;

/** "Chaves e credenciais" on a real PostgreSQL: the Prisma queries of every kind and the reveal round trip. */
describe('credentials vault (integration)', { skip: SKIP_INTEGRATION }, () => {
  const prisma = new PrismaRepository(configService);
  let instanceId: string;
  let credId: string;
  let server: Server;
  let url: string;
  const logs: string[] = [];

  const deps = (): CredentialsDeps => ({
    prisma,
    clientName: undefined,
    openaiGlobalKeySet: false,
    logger: { error: (m: unknown) => logs.push(String(m)) },
  });

  before(async () => {
    migrateTestDatabase();
    await prisma.$connect();

    const instance = await prisma.instance.create({
      data: { name: `vault-${suffix}`, token: TOKEN, integration: 'WHATSAPP-BAILEYS', connectionStatus: 'open' },
    });
    instanceId = instance.id;
    credId = (await prisma.openaiCreds.create({ data: { instanceId, name: `cred-${suffix}`, apiKey: OPENAI_KEY } })).id;
    await prisma.webhook.create({
      data: { instanceId, url: `https://hooks.example.com/in?token=hook-${suffix}`, events: [] },
    });
    await prisma.dify.create({
      data: { instanceId, botType: 'chatBot', apiUrl: 'https://dify.example.com', apiKey: DIFY_KEY },
    });

    const logger = { warn: (m: unknown) => logs.push(String(m)), error: (m: unknown) => logs.push(String(m)) };
    const app = express();
    app.use(express.json());
    app.use(
      '/admin/credentials',
      new AdminCredentialsRouter({
        deps,
        apiKey: () => GLOBAL_KEY,
        guard: createAdminOnlyGuard(() => GLOBAL_KEY),
        logger,
      }).router,
    );
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    app.use((err: any, _req: any, res: any, _next: any) => res.status(err?.status || 500).json({}));
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/admin/credentials`;
  });

  after(async () => {
    server?.close();
    if (instanceId) await prisma.instance.deleteMany({ where: { id: instanceId } });
    await prisma.$disconnect();
  });

  test('every kind is queried on the real schema and comes back masked', async () => {
    const overview = await listCredentials(deps());
    const mine = overview.instances.find((instance) => instance.id === instanceId);
    assert.ok(mine);

    const kinds = mine.items.map((item) => item.kind).sort();
    assert.deepEqual(kinds, ['dify', 'instance_token', 'openai', 'webhook_url']);
    assert.equal(mine.items.find((item) => item.kind === 'openai').masked, 'sk-…WXYZ');
    assert.equal(
      mine.items.find((item) => item.kind === 'webhook_url').masked,
      'https://hooks.example.com/in?token=****',
    );

    assert.ok(!logs.some((line) => line.includes('unavailable')), logs.join('\n'));

    const text = JSON.stringify(overview);
    for (const secret of [OPENAI_KEY, TOKEN, DIFY_KEY, `hook-${suffix}`]) assert.ok(!text.includes(secret));
  });

  test('reveal over HTTP returns the stored value once and audits it', async () => {
    const response = await fetch(`${url}/reveal`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: GLOBAL_KEY },
      body: JSON.stringify({ kind: 'openai', id: credId, confirmPassword: GLOBAL_KEY }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(((await response.json()) as any).value, OPENAI_KEY);

    assert.ok(logs.some((line) => line.includes(`credentials.reveal instance=vault-${suffix} kind=openai`)));
    assert.ok(!logs.join('\n').includes(OPENAI_KEY));

    const asInstance = await fetch(url, { headers: { apikey: TOKEN } });
    assert.equal(asInstance.status, 403);
  });
});
