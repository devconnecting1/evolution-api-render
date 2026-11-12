import '../helpers/setup';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crc32, inflateRawSync } from 'node:zlib';

import {
  ExportService,
  ExportValidationError,
  messageText,
  normalizeExportDatasets,
} from '@api/services/export.service';

const INSTANCE_ID = 'inst-a';

type Row = Record<string, any>;

/** Only findMany exists: any write attempt fails the test. */
function fakePrisma(tables: Record<string, Row[]>, calls: { model: string; args: any }[] = []) {
  const read = (model: string) => ({
    findMany: async (args: any) => {
      calls.push({ model, args });
      const rows = (tables[model] ?? []).filter((row) => row.instanceId === args?.where?.instanceId);
      const start = args?.cursor?.id ? rows.findIndex((row) => row.id === args.cursor.id) + 1 : 0;
      const take = Number(args?.take ?? rows.length);
      return rows.slice(start, start + take).map((row) => {
        if (!args?.select) return { ...row };
        const selected: Row = {};
        for (const key of Object.keys(args.select)) selected[key] = row[key];
        return selected;
      });
    },
  });
  return new Proxy(
    {},
    {
      get: (_target, prop: string) => {
        if (prop === 'instance') {
          return {
            findUnique: async ({ where }: any) =>
              where?.name === 'loja-exemplo' ? { id: INSTANCE_ID, name: 'loja-exemplo' } : null,
          };
        }
        if (prop in tables || ['chat', 'message', 'contact', 'lead', 'appointment'].includes(prop)) {
          return read(prop);
        }
        throw new Error(`write or unknown operation on ${prop} is not allowed in the export`);
      },
    },
  );
}

function fixture() {
  return {
    chat: [
      {
        id: 'chat-1',
        instanceId: INSTANCE_ID,
        remoteJid: '5511900000001@s.whatsapp.net',
        name: 'Paula Fictícia',
        labels: ['novo cliente'],
        unreadMessages: 2,
        createdAt: new Date('2026-11-01T12:00:00Z'),
        updatedAt: new Date('2026-11-02T13:30:00Z'),
      },
    ],
    message: [
      {
        id: 'msg-1',
        instanceId: INSTANCE_ID,
        key: { id: 'A1', remoteJid: '5511900000001@s.whatsapp.net', fromMe: false },
        pushName: 'Paula',
        participant: null,
        messageType: 'conversation',
        message: { conversation: 'Oi, preciso de ajuda' },
        messageTimestamp: 1762084800,
        status: 'DELIVERY_ACK',
      },
      {
        id: 'msg-2',
        instanceId: INSTANCE_ID,
        key: { id: 'A2', remoteJid: '5511900000001@s.whatsapp.net', fromMe: true },
        pushName: null,
        participant: '5511900000009@s.whatsapp.net',
        messageType: 'imageMessage',
        message: { imageMessage: { caption: 'Documento = urgente' } },
        messageTimestamp: 1762084860,
        status: 'READ',
      },
      {
        id: 'msg-3',
        instanceId: INSTANCE_ID,
        key: { id: 'A3', remoteJid: '5511900000002@s.whatsapp.net', fromMe: false },
        pushName: 'Loja Fictícia',
        participant: null,
        messageType: 'audioMessage',
        message: { audioMessage: {} },
        messageTimestamp: 1762084920,
        status: null,
      },
    ],
    contact: [
      {
        id: 'contact-1',
        instanceId: INSTANCE_ID,
        remoteJid: '5511900000001@s.whatsapp.net',
        pushName: 'Paula',
        profilePicUrl: null,
        createdAt: new Date('2026-11-01T12:00:00Z'),
        updatedAt: null,
      },
    ],
    lead: [
      {
        id: 'lead-1',
        instanceId: INSTANCE_ID,
        remoteJid: '5511900000001@s.whatsapp.net',
        pushName: 'Paula',
        name: 'Paula Fictícia',
        area: 'Trabalhista',
        city: 'Cidade Fictícia',
        summary: 'Demitida sem verbas.',
        status: 'novo',
        priority: 'alta',
        priorityReason: 'audiência marcada',
        nextStep: 'confirmar data',
        opposingParty: 'Loja Fictícia Ltda',
        source: 'site',
        missingInfo: ['data da demissão'],
        attentionPoints: { audiencia: '12/11' },
        manualFields: null,
        firstMessageAt: new Date('2026-11-01T12:00:00Z'),
        lastMessageAt: null,
        createdAt: new Date('2026-11-01T12:05:00Z'),
        updatedAt: new Date('2026-11-02T09:00:00Z'),
      },
    ],
    appointment: [
      {
        id: 'appt-1',
        instanceId: INSTANCE_ID,
        remoteJid: '5511900000001@s.whatsapp.net',
        contactName: 'Paula Fictícia',
        typeName: 'Consulta inicial',
        mode: 'presencial',
        startsAt: new Date('2026-12-05T17:00:00Z'),
        endsAt: new Date('2026-12-05T17:30:00Z'),
        status: 'agendado',
        source: 'manual',
        notes: null,
        createdAt: new Date('2026-11-02T10:00:00Z'),
      },
    ],
  };
}

async function collect(stream: AsyncGenerator<Buffer>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/** Reads every entry through the central directory (the entries use data descriptors, bit 3). */
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
    const crc = buffer.readUInt32LE(pointer + 16);
    const compressedSize = buffer.readUInt32LE(pointer + 20);
    const rawSize = buffer.readUInt32LE(pointer + 24);
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const extraLength = buffer.readUInt16LE(pointer + 30);
    const commentLength = buffer.readUInt16LE(pointer + 32);
    const localOffset = buffer.readUInt32LE(pointer + 42);
    const name = buffer.toString('utf8', pointer + 46, pointer + 46 + nameLength);

    assert.equal(buffer.readUInt32LE(localOffset), 0x04034b50, `${name}: local header`);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(start, start + compressedSize);
    const data = method === 8 ? inflateRawSync(compressed) : compressed;

    assert.equal(data.length, rawSize, `${name}: uncompressed size`);
    assert.equal(crc32(data) >>> 0, crc, `${name}: crc`);
    entries.set(name, data);
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const csvLines = (data: Buffer): string[] => {
  const raw = data.toString('utf8');
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return text.trimEnd().split('\r\n');
};

test('normalizeExportDatasets: default all, comma list, repeated values, unknown refused', () => {
  assert.deepEqual(normalizeExportDatasets(undefined), ['conversas', 'mensagens', 'contatos', 'leads', 'agenda']);
  assert.deepEqual(normalizeExportDatasets(''), ['conversas', 'mensagens', 'contatos', 'leads', 'agenda']);
  assert.deepEqual(normalizeExportDatasets('contatos,leads'), ['contatos', 'leads']);
  assert.deepEqual(normalizeExportDatasets(['contatos', 'contatos', 'agenda']), ['contatos', 'agenda']);
  assert.throws(
    () => normalizeExportDatasets('contatos,tudo'),
    (error: any) => error instanceof ExportValidationError && /desconhecida: tudo/.test(error.message),
  );
});

test('messageText: text, captions and media markers', () => {
  assert.equal(messageText({ conversation: 'Olá' }), 'Olá');
  assert.equal(messageText({ extendedTextMessage: { text: 'Oi' } }), 'Oi');
  assert.equal(messageText({ imageMessage: { caption: 'foto do contrato' } }), 'foto do contrato');
  assert.equal(messageText({ imageMessage: {} }), '[imagem]');
  assert.equal(messageText({ audioMessage: {} }), '[áudio]');
  assert.equal(messageText({ documentMessage: { fileName: 'contrato.pdf' } }), '[documento contrato.pdf]');
  assert.equal(messageText({}), '');
});

test('streamZip: one CSV per dataset, Portuguese header, ISO dates, BOM and ";", plus leia-me last', async () => {
  const calls: { model: string; args: any }[] = [];
  const service = new ExportService(fakePrisma(fixture(), calls), {
    now: () => new Date('2026-11-12T15:00:00Z').getTime(),
  });

  const zip = await collect(service.streamZip(INSTANCE_ID, 'loja-exemplo', ['conversas', 'mensagens', 'agenda']));
  const entries = readZip(zip);

  assert.deepEqual([...entries.keys()], ['conversas.csv', 'mensagens.csv', 'agenda.csv', 'leia-me.txt']);

  const conversations = csvLines(entries.get('conversas.csv') as Buffer);
  assert.equal(conversations[0], 'ID;Conversa (JID);Nome;Rótulos;Não lidas;Criada em (ISO);Atualizada em (ISO)');
  assert.match(conversations[1], /^chat-1;5511900000001@s\.whatsapp\.net;Paula Fictícia;novo cliente;2;/);
  assert.ok(conversations[1].endsWith('2026-11-01T12:00:00.000Z;2026-11-02T13:30:00.000Z'));

  const messages = csvLines(entries.get('mensagens.csv') as Buffer);
  assert.equal(messages[0], 'ID;Data e hora (ISO);Conversa (JID);Contato;Direção;Tipo;Texto;Status;Participante');
  assert.match(
    messages[1],
    /^msg-1;2025-11-02T12:00:00\.000Z;5511900000001@s\.whatsapp\.net;Paula;Cliente;conversation;Oi, preciso de ajuda;/,
  );
  assert.match(messages[2], /;Equipe;imageMessage;Documento = urgente;READ;5511900000009@s\.whatsapp\.net$/);
  assert.match(messages[3], /;Cliente;audioMessage;\[áudio\];;/);

  const agenda = csvLines(entries.get('agenda.csv') as Buffer);
  assert.match(agenda[1], /^appt-1;5511900000001@s\.whatsapp\.net;Paula Fictícia;Consulta inicial;presencial;/);
  assert.match(agenda[1], /2026-12-05T17:00:00\.000Z;2026-12-05T17:30:00\.000Z;agendado;manual;/);

  const readme = (entries.get('leia-me.txt') as Buffer).toString('utf8');
  assert.match(readme, /Instância: loja-exemplo/);
  assert.match(readme, /conversas\.csv: 1 registro\(s\)/);
  assert.match(readme, /mensagens\.csv: 3 registro\(s\)/);
  assert.match(readme, /agenda\.csv: 1 registro\(s\)/);
  assert.match(readme, /direito de portabilidade da LGPD/);

  // only reads, always scoped to the instance; datasets not selected are not queried
  assert.deepEqual([...new Set(calls.map((call) => call.model))], ['chat', 'message', 'appointment']);
  for (const call of calls) {
    assert.equal(call.args.where.instanceId, INSTANCE_ID);
    assert.deepEqual(call.args.orderBy, { id: 'asc' });
  }
});

test('streamZip: empty dataset still has the header; missing datasets are not exported', async () => {
  const service = new ExportService(fakePrisma({}), { now: () => new Date('2026-11-12T15:00:00Z').getTime() });
  const zip = await collect(service.streamZip(INSTANCE_ID, 'loja-exemplo', ['contatos']));
  const entries = readZip(zip);

  assert.deepEqual([...entries.keys()], ['contatos.csv', 'leia-me.txt']);
  const lines = csvLines(entries.get('contatos.csv') as Buffer);
  assert.equal(lines.length, 1);
  assert.equal(lines[0], 'ID;Telefone ou JID;Nome;Foto;Criado em (ISO);Atualizado em (ISO)');
  assert.match((entries.get('leia-me.txt') as Buffer).toString('utf8'), /contatos\.csv: 0 registro\(s\)/);
});

test('streamZip: pages through every message (no silent truncation)', async () => {
  const tables: Record<string, Row[]> = fixture();
  tables.message = Array.from({ length: 5 }, (_, i) => ({
    id: `msg-${i}`,
    instanceId: INSTANCE_ID,
    key: { remoteJid: '5511900000001@s.whatsapp.net', fromMe: false },
    messageType: 'conversation',
    message: { conversation: `mensagem ${i}` },
    messageTimestamp: 1762084800 + i,
  }));
  const calls: { model: string; args: any }[] = [];
  const service = new ExportService(fakePrisma(tables, calls), { pageSize: 2 });

  const zip = await collect(service.streamZip(INSTANCE_ID, 'loja-exemplo', ['mensagens']));
  const messages = csvLines(readZip(zip).get('mensagens.csv') as Buffer);
  assert.equal(messages.length, 6, 'header + 5 messages');
  assert.match(messages[5], /mensagem 4/);
  assert.equal(calls.filter((call) => call.model === 'message').length, 3, '2 + 2 + 1');

  const readme = (readZip(zip).get('leia-me.txt') as Buffer).toString('utf8');
  assert.match(readme, /mensagens\.csv: 5 registro\(s\)/);
});

test('fileName: accents removed, date and .zip', () => {
  const service = new ExportService(fakePrisma({}), { now: () => new Date('2026-11-12T15:00:00Z').getTime() });
  assert.equal(service.fileName('Escritório São João'), 'dados-Escritorio-Sao-Joao-2026-11-12.zip');
  assert.equal(service.fileName('///'), 'dados-instancia-2026-11-12.zip');
});
