import '../helpers/setup';
// Loads the routers graph before abstract.router (as the app does), see router-instance-scope.test.ts
import '@exceptions';

import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { inflateRawSync } from 'node:zlib';

import { ExportController } from '@api/controllers/export.controller';
import { UsageController } from '@api/controllers/usage.controller';
import { UsageRouter } from '@api/routes/usage.router';
import { ExportService } from '@api/services/export.service';
import { UsageService } from '@api/services/usage.service';
import express from 'express';
import { Server } from 'http';

import { serverModuleOverrides } from '../helpers/chatbot-emit';
import { nextId } from '../helpers/fakes';
import { OpenaiHarness, SKIP_INTEGRATION } from '../helpers/integration';

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
    assert.equal(buffer.readUInt32LE(pointer), 0x02014b50, 'central directory header');
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

const csvText = (data: Buffer): string => {
  const raw = data.toString('utf8');
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
};

type Seeded = { name: string; id: string; jid: string };

/**
 * "Exportar dados" and "Cobrança" on a real PostgreSQL: the ZIP is generated from the real rows, only the requested
 * instance appears (multi-tenant isolation), nothing is written or deleted, and the billing answer comes from the
 * plan saved in "Plano e limites" with an honest empty history.
 */
describe('export and billing (integration)', { skip: SKIP_INTEGRATION }, () => {
  let h: OpenaiHarness;
  let server: Server;
  let base: string;
  const instanceIds: string[] = [];

  const seed = async (label: string): Promise<Seeded> => {
    const name = `it-export-${label}-${nextId()}`.toLowerCase();
    const row = await h.prisma.instance.create({
      data: { name, integration: 'WHATSAPP-BAILEYS', connectionStatus: 'open' },
    });
    instanceIds.push(row.id);

    const jid = `55119${String(Date.now() % 100000000).padStart(8, '0')}${instanceIds.length}@s.whatsapp.net`;
    await h.prisma.chat.create({
      data: {
        instanceId: row.id,
        remoteJid: jid,
        name: `Contato ${label}`,
        labels: ['triagem'],
        unreadMessages: 1,
      },
    });
    await h.prisma.message.create({
      data: {
        instanceId: row.id,
        key: { id: `msg-${label}-${nextId()}`, remoteJid: jid, fromMe: false },
        pushName: `Contato ${label}`,
        messageType: 'conversation',
        message: { conversation: `Mensagem fictícia de ${label}` },
        source: 'web',
        messageTimestamp: 1762084800,
        status: 'DELIVERY_ACK',
      },
    });
    await h.prisma.contact.create({
      data: { instanceId: row.id, remoteJid: jid, pushName: `Contato ${label}` },
    });
    await h.prisma.lead.create({
      data: {
        instanceId: row.id,
        remoteJid: jid,
        name: `Contato ${label}`,
        area: 'Trabalhista',
        city: 'Cidade Fictícia',
        summary: `Resumo fictício de ${label}`,
        source: 'site',
      },
    });
    await h.prisma.appointment.create({
      data: {
        instanceId: row.id,
        remoteJid: jid,
        contactName: `Contato ${label}`,
        typeName: 'Consulta inicial',
        mode: 'presencial',
        startsAt: new Date('2026-12-05T17:00:00Z'),
        endsAt: new Date('2026-12-05T17:30:00Z'),
      },
    });

    return { name, id: row.id, jid };
  };

  const counts = async (instanceId: string) => ({
    chats: await h.prisma.chat.count({ where: { instanceId } }),
    messages: await h.prisma.message.count({ where: { instanceId } }),
    contacts: await h.prisma.contact.count({ where: { instanceId } }),
    leads: await h.prisma.lead.count({ where: { instanceId } }),
    appointments: await h.prisma.appointment.count({ where: { instanceId } }),
  });

  before(async () => {
    h = await new OpenaiHarness().start();
    const usage = new UsageService(h.prisma);
    serverModuleOverrides.exportController = new ExportController(new ExportService(h.prisma), h.prisma);
    serverModuleOverrides.usageController = new UsageController(usage, h.prisma);

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

  after(async () => {
    delete serverModuleOverrides.exportController;
    delete serverModuleOverrides.usageController;
    server?.close();
    if (instanceIds.length) await h?.prisma.instance.deleteMany({ where: { id: { in: instanceIds } } });
    await h?.stop();
  });

  test('the ZIP carries only the requested instance and nothing is written or deleted', async () => {
    const a = await seed('a');
    const b = await seed('b');
    const before = await counts(a.id);

    const response = await fetch(`${base}/export/${a.name}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/zip');
    assert.match(
      response.headers.get('content-disposition') ?? '',
      new RegExp(`^attachment; filename="dados-${a.name}-\\d{4}-\\d{2}-\\d{2}\\.zip"$`),
    );

    const entries = readZip(Buffer.from(await response.arrayBuffer()));
    assert.deepEqual(
      [...entries.keys()],
      ['conversas.csv', 'mensagens.csv', 'contatos.csv', 'leads.csv', 'agenda.csv', 'leia-me.txt'],
    );

    const all = [...entries]
      .filter(([name]) => name !== 'leia-me.txt')
      .map(([, data]) => csvText(data))
      .join('\n');
    assert.match(all, new RegExp(`Mensagem fictícia de a`));
    assert.match(all, new RegExp(`Resumo fictício de a`));
    assert.ok(all.includes(a.jid), 'the contact of the exported instance is there');
    assert.ok(!all.includes(b.jid), "the other instance's contact is not");
    assert.ok(!all.includes('fictício de b'), "the other instance's rows are not");

    const readme = (entries.get('leia-me.txt') as Buffer).toString('utf8');
    assert.match(readme, new RegExp(`Instância: ${a.name}`));
    assert.match(readme, /conversas\.csv: 1 registro\(s\)/);
    assert.match(readme, /mensagens\.csv: 1 registro\(s\)/);
    assert.match(readme, /leads\.csv: 1 registro\(s\)/);
    assert.match(readme, /agenda\.csv: 1 registro\(s\)/);

    assert.deepEqual(await counts(a.id), before, 'the export did not change the rows');
    assert.deepEqual(await counts(b.id), {
      chats: 1,
      messages: 1,
      contacts: 1,
      leads: 1,
      appointments: 1,
    });
  });

  test('an unknown dataset is refused with 400, not with an incomplete ZIP', async () => {
    const a = await seed('c');
    const response = await fetch(`${base}/export/${a.name}?datasets=contatos,tudo`);
    assert.equal(response.status, 400);
    const body = (await response.json()) as any;
    assert.match(JSON.stringify(body.message), /desconhecida: tudo/);
    assert.deepEqual(await counts(a.id), {
      chats: 1,
      messages: 1,
      contacts: 1,
      leads: 1,
      appointments: 1,
    });
  });

  test('billing answers the plan of "Plano e limites" and the honest empty history', async () => {
    const a = await seed('d');
    await (serverModuleOverrides.usageController as UsageController).saveLimits(
      { instanceName: a.name } as any,
      { planName: 'Essencial' } as any,
    );

    const response = await fetch(`${base}/billing/${a.name}`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as any;
    assert.equal(body.instance, a.name);
    assert.equal(body.source, 'none');
    assert.deepEqual(body.plan, { name: 'Essencial', monthlyResponses: 2000, configured: true });
    assert.equal(body.nextDueDate, null);
    assert.deepEqual(body.history, []);
    assert.deepEqual(body.invoice, { legalName: null, taxId: null, email: null, address: null, updatedAt: null });
  });
});
