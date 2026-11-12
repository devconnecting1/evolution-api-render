import '../helpers/setup';
// Loads the routers graph before abstract.router (as the app does), see router-instance-scope.test.ts
import '@exceptions';

import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { inflateRawSync } from 'node:zlib';

import { ExportController } from '@api/controllers/export.controller';
import { UsageRouter } from '@api/routes/usage.router';
import { ExportService } from '@api/services/export.service';
import express from 'express';
import { Server } from 'http';

import { serverModuleOverrides } from '../helpers/chatbot-emit';

/** Only the instance lookup and findMany: a write attempt throws. */
const prisma: any = new Proxy(
  {
    instance: {
      findUnique: async ({ where }: any) =>
        where?.name === 'loja-exemplo' ? { id: 'inst-a', name: 'loja-exemplo' } : null,
    },
    chat: {
      findMany: async ({ where }: any) =>
        where?.instanceId === 'inst-a'
          ? [
              {
                id: 'chat-1',
                instanceId: 'inst-a',
                remoteJid: '5511900000001@s.whatsapp.net',
                name: 'Paula Fictícia',
                labels: [],
                unreadMessages: 0,
                createdAt: new Date('2026-11-01T12:00:00Z'),
                updatedAt: new Date('2026-11-01T12:00:00Z'),
              },
            ]
          : [],
    },
    message: { findMany: async () => [] },
    contact: { findMany: async () => [] },
    lead: { findMany: async () => [] },
    appointment: { findMany: async () => [] },
  },
  {
    get: (target: any, prop: string) => {
      if (!(prop in target)) throw new Error(`unexpected operation on ${prop} in the export`);
      return target[prop];
    },
  },
);

/** Reads the entries through the central directory (the entries use data descriptors, bit 3). */
function readZip(buffer: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  assert.ok(eocd >= 0, 'end of central directory not found');
  const count = buffer.readUInt16LE(eocd + 10);
  let pointer = buffer.readUInt32LE(eocd + 16);
  const entries = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    assert.equal(buffer.readUInt32LE(pointer), 0x02014b50);
    const method = buffer.readUInt16LE(pointer + 10);
    const compressedSize = buffer.readUInt32LE(pointer + 20);
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const extraLength = buffer.readUInt16LE(pointer + 30);
    const commentLength = buffer.readUInt16LE(pointer + 32);
    const localOffset = buffer.readUInt32LE(pointer + 42);
    const name = buffer.toString('utf8', pointer + 46, pointer + 46 + nameLength);
    const start = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const compressed = buffer.subarray(start, start + compressedSize);
    entries.set(name, method === 8 ? inflateRawSync(compressed) : compressed);
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

describe('UsageRouter: billing and the streaming export download', () => {
  let server: Server;
  let base: string;

  before(async () => {
    serverModuleOverrides.exportController = new ExportController(new ExportService(prisma), prisma);
    serverModuleOverrides.usageController = {
      getBilling: async (instance: any) => ({
        instance: instance.instanceName,
        generatedAt: '2026-11-12T15:00:00.000Z',
        source: 'none',
        plan: { name: 'Essencial', monthlyResponses: 2000, configured: true },
        nextDueDate: null,
        paymentMethod: null,
        history: [],
        invoice: { legalName: null, taxId: null, email: null, address: null, updatedAt: null },
      }),
    };

    const app = express();
    app.use(express.json());
    app.use('/usage', new UsageRouter().router);
    app.use((error: any, _req: any, res: any, _next: any) => {
      void _next;
      res.status(error?.status ?? 500).json(error);
    });
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/usage`;
  });

  after(() => {
    delete serverModuleOverrides.exportController;
    delete serverModuleOverrides.usageController;
    server.close();
  });

  test('export is a ZIP download with a safe file name and the selected CSV', async () => {
    const response = await fetch(`${base}/export/loja-exemplo?datasets=conversas`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/zip');
    assert.match(
      response.headers.get('content-disposition') ?? '',
      /^attachment; filename="dados-loja-exemplo-\d{4}-\d{2}-\d{2}\.zip"$/,
    );

    const entries = readZip(Buffer.from(await response.arrayBuffer()));
    assert.deepEqual([...entries.keys()], ['conversas.csv', 'leia-me.txt']);
    assert.match((entries.get('conversas.csv') as Buffer).toString('utf8'), /Paula Fictícia/);
  });

  test('no datasets parameter exports everything; the query never swaps the instance', async () => {
    const response = await fetch(`${base}/export/loja-exemplo?instanceName=outra`);
    assert.equal(response.status, 200);
    const entries = readZip(Buffer.from(await response.arrayBuffer()));
    assert.deepEqual(
      [...entries.keys()],
      ['conversas.csv', 'mensagens.csv', 'contatos.csv', 'leads.csv', 'agenda.csv', 'leia-me.txt'],
    );
  });

  test('unknown dataset is refused with 400 before any byte of the ZIP', async () => {
    const response = await fetch(`${base}/export/loja-exemplo?datasets=contatos,tudo`);
    assert.equal(response.status, 400);
    const body = (await response.json()) as any;
    assert.match(JSON.stringify(body.message), /desconhecida: tudo/);
  });

  test('unknown instance is 404', async () => {
    const response = await fetch(`${base}/export/nao-existe?datasets=contatos`);
    assert.equal(response.status, 404);
  });

  test('billing answers the plan and the honest empty history', async () => {
    const response = await fetch(`${base}/billing/loja-exemplo`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as any;
    assert.equal(body.instance, 'loja-exemplo');
    assert.equal(body.source, 'none');
    assert.equal(body.plan.name, 'Essencial');
    assert.deepEqual(body.history, []);
    assert.equal(body.nextDueDate, null);
  });
});
