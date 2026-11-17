import '../helpers/setup';
// Loads the routers graph before abstract.router (as the app does), see router-instance-scope.test.ts
import '@exceptions';

import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { inflateRawSync } from 'node:zlib';

import { ReviewExportController } from '@api/controllers/review-export.controller';
import { authGuard } from '@api/guards/auth.guard';
import { reviewExportDenial } from '@api/guards/review-export.guard';
import { reviewPage } from '@api/integrations/mcp/tools/review.tools';
import { ReviewExportRouter } from '@api/routes/review-export.router';
import { MAX_REVIEW_MESSAGES, ReviewExportService } from '@api/services/review-export.service';
import { clientRouteAllowed, CLIENT_MODULES, normalizeClientPath } from '@utils/client-access';
import {
  conversationJid,
  conversationMarkdown,
  maskedRef,
  messageContent,
  parseReviewPeriod,
  redactText,
} from '@utils/conversation-review';
import { teamRouteAllowed } from '@utils/team-access';
import express from 'express';
import { Server } from 'http';

import { serverModuleOverrides } from '../helpers/chatbot-emit';

const NAME = 'Escritório Exemplo';
const enc = encodeURIComponent(NAME);
const PHONE = '5521987654321@s.whatsapp.net';
const LID = '99887766554433@lid';
const GROUP = '120363000000000001@g.us';
/** 12/11/2026 14:03 in Brasília (UTC-3). */
const T0 = Math.floor(Date.parse('2026-11-12T14:03:00-03:00') / 1000);

function readZip(buffer: Buffer): Map<string, string> {
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
  const entries = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    const compressedSize = buffer.readUInt32LE(pointer + 20);
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const extraLength = buffer.readUInt16LE(pointer + 30);
    const commentLength = buffer.readUInt16LE(pointer + 32);
    const localOffset = buffer.readUInt32LE(pointer + 42);
    const name = buffer.toString('utf8', pointer + 46, pointer + 46 + nameLength);
    const start = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    entries.set(name, inflateRawSync(buffer.subarray(start, start + compressedSize)).toString('utf8'));
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

type Row = {
  id: string;
  instanceId: string;
  key: any;
  messageType: string;
  message: any;
  messageTimestamp: number;
  sentBy?: string | null;
};

/** Message rows with the range + keyset filters the service sends; records every query. */
function fakePrisma(rows: Row[], sessions: any[] = []) {
  const calls = { messageQueries: [] as any[], sessionQueries: 0 };
  const prisma: any = {
    instance: {
      findUnique: async ({ where }: any) => (where?.name === NAME ? { id: 'inst-1', name: NAME } : null),
    },
    message: {
      findMany: async (args: any) => {
        calls.messageQueries.push(args);
        const { where, take } = args;
        const after = (row: Row) =>
          !where.OR ||
          row.messageTimestamp > where.OR[0].messageTimestamp.gt ||
          (row.messageTimestamp === where.OR[1].messageTimestamp && row.id > where.OR[1].id.gt);
        return rows
          .filter((row) => row.instanceId === where.instanceId)
          .filter(
            (row) =>
              row.messageTimestamp >= where.messageTimestamp.gte && row.messageTimestamp <= where.messageTimestamp.lte,
          )
          .filter(after)
          .sort((a, b) => a.messageTimestamp - b.messageTimestamp || (a.id < b.id ? -1 : 1))
          .slice(0, take)
          .map((row) => Object.fromEntries(Object.keys(args.select).map((k) => [k, (row as any)[k]])));
      },
    },
    integrationSession: {
      findMany: async ({ where }: any) => {
        calls.sessionQueries++;
        return sessions.filter((s) => s.instanceId === where.instanceId && where.remoteJid.in.includes(s.remoteJid));
      },
    },
  };
  return { prisma, calls };
}

let seq = 0;
const row = (at: number, key: any, message: any, extra: Partial<Row> = {}): Row => ({
  id: `m${String(++seq).padStart(6, '0')}`,
  instanceId: 'inst-1',
  key,
  messageType: Object.keys(message)[0] ?? 'conversation',
  message,
  messageTimestamp: at,
  ...extra,
});

const sampleRows = () => [
  row(
    T0,
    { id: 'C1', remoteJid: PHONE, fromMe: false },
    { conversation: 'Oi, meu CPF é 123.456.789-09 e meu e-mail é ana@exemplo.com' },
  ),
  row(
    T0 + 5,
    { id: '3EB0AI1', remoteJid: PHONE, fromMe: true },
    { conversation: 'Olá! Posso ajudar?' },
    { sentBy: 'ai' },
  ),
  row(
    T0 + 120,
    { id: '3A00PHONE', remoteJid: PHONE, fromMe: true },
    { conversation: 'Ligo às 15h no (21) 98765-4321' },
  ),
  row(
    T0 + 130,
    { id: 'C2', remoteJid: LID, remoteJidAlt: PHONE, fromMe: false },
    {
      audioMessage: { seconds: 40 },
      speechToText: '[audio] quero saber do processo 0001234-55.2026.8.19.0001',
    },
  ),
  row(T0 + 140, { id: '3EB0OLD', remoteJid: PHONE, fromMe: true }, { conversation: 'Qual o melhor horário?' }),
  row(
    T0 + 150,
    { id: 'P1', remoteJid: PHONE, fromMe: false },
    { protocolMessage: { type: 0 } },
    { messageType: 'protocolMessage' },
  ),
  row(T0 + 160, { id: 'G1', remoteJid: GROUP, fromMe: false }, { conversation: 'mensagem de grupo' }),
  row(
    T0 + 86_400,
    { id: 'D1', remoteJid: PHONE, fromMe: true },
    {
      documentMessage: { fileName: 'contrato.pdf' },
    },
    { sentBy: 'panel' },
  ),
];
const SESSIONS = [
  {
    instanceId: 'inst-1',
    remoteJid: PHONE,
    context: { history: [{ role: 'assistant', content: 'Qual o melhor horário?' }] },
  },
];

describe('revisão: período, identidade e texto', () => {
  test('period: days of Brasília, both included, at most 31 days', () => {
    const p = parseReviewPeriod('2026-11-01', '2026-11-30');
    assert.equal(p.days, 30);
    assert.equal(p.fromSeconds, Date.parse('2026-11-01T00:00:00-03:00') / 1000);
    assert.equal(p.toSeconds, Date.parse('2026-11-30T23:59:59-03:00') / 1000);
    assert.equal(parseReviewPeriod('2026-10-01', '2026-10-31').days, 31);
    assert.throws(() => parseReviewPeriod('2026-10-01', '2026-11-01'), /31 dias/);
    assert.throws(() => parseReviewPeriod('2026-11-10', '2026-11-01'), /depois/);
    assert.throws(() => parseReviewPeriod('2026-02-31', '2026-03-01'), /não existe/);
    assert.throws(() => parseReviewPeriod('12/11/2026', '2026-11-13'), /AAAA-MM-DD/);
    assert.throws(() => parseReviewPeriod(undefined, '2026-11-13'), /Informe/);
  });

  test('contact: the phone JID when the LID carries it, no groups, masked to the last 4 digits', () => {
    assert.equal(conversationJid({ remoteJid: LID, remoteJidAlt: PHONE }), PHONE);
    assert.equal(conversationJid({ remoteJid: LID }), LID);
    assert.equal(conversationJid({ remoteJid: GROUP }), null);
    assert.equal(conversationJid({ remoteJid: 'status@broadcast' }), null);
    assert.equal(maskedRef(PHONE), '****4321');
  });

  test('redaction: e-mail, CPF, CNPJ, phones and long digit runs; dates, times and prices stay', () => {
    assert.equal(
      redactText(
        'CPF 123.456.789-09, CNPJ 12.345.678/0001-90, ana@exemplo.com, tel (21) 98765-4321 ou +55 21 987654321',
      ),
      'CPF [CPF], CNPJ [CNPJ], [e-mail], tel [número] ou [número]',
    );
    assert.equal(redactText('processo 0001234-55.2026.8.19.0001'), 'processo [número]');
    assert.equal(
      redactText('dia 12/11/2026 às 14:30, custa R$ 150,00, sala 1203'),
      'dia 12/11/2026 às 14:30, custa R$ 150,00, sala 1203',
    );
  });

  test('media markers and skipped protocol messages', () => {
    assert.equal(
      messageContent({ audioMessage: { seconds: 40 }, speechToText: '[audio] bom dia' }, 'audioMessage'),
      '[áudio 40 s · transcrição: bom dia]',
    );
    assert.equal(messageContent({ audioMessage: {} }, 'audioMessage'), '[áudio]');
    assert.equal(
      messageContent({ documentMessage: { fileName: 'nome.pdf' } }, 'documentMessage'),
      '[documento: nome.pdf]',
    );
    assert.equal(
      messageContent(
        { documentWithCaptionMessage: { message: { documentMessage: { fileName: 'a.pdf', caption: 'segue' } } } },
        'documentWithCaptionMessage',
      ),
      '[documento: a.pdf] segue',
    );
    assert.equal(messageContent({ imageMessage: { caption: 'foto' } }, 'imageMessage'), '[imagem] foto');
    assert.equal(messageContent({ videoMessage: { seconds: 12 } }, 'videoMessage'), '[vídeo 12 s]');
    assert.equal(messageContent({ reactionMessage: { text: '' } }, 'reactionMessage'), null);
    assert.equal(messageContent({ protocolMessage: {} }, 'protocolMessage'), null);
    assert.equal(messageContent({ ephemeralMessage: { message: { conversation: 'oi' } } }, 'conversation'), 'oi');
  });
});

describe('revisão: leitura do período', () => {
  test('one range query on the index columns, only the needed columns, keyset pages', async () => {
    const rows: Row[] = [];
    for (let i = 0; i < 1100; i++)
      rows.push(
        row(
          T0 + i,
          { id: `K${i}`, remoteJid: PHONE, fromMe: i % 2 === 1 },
          { conversation: `msg ${i}` },
          { sentBy: i % 2 ? 'ai' : 'contact' },
        ),
      );
    rows.push(
      row(T0 - 86_400 * 40, { id: 'OLD', remoteJid: PHONE, fromMe: false }, { conversation: 'fora do período' }),
    );
    const { prisma, calls } = fakePrisma(rows);
    const result = await new ReviewExportService(prisma).collect(
      'inst-1',
      parseReviewPeriod('2026-11-12', '2026-11-12'),
    );

    assert.equal(result.messages, 1100);
    assert.equal(result.conversations.length, 1);
    assert.equal(result.conversations[0].entries.length, 1100);
    assert.equal(calls.messageQueries.length, 3, '500 + 500 + 100');
    const first = calls.messageQueries[0];
    assert.deepEqual(Object.keys(first.select).sort(), [
      'id',
      'key',
      'message',
      'messageTimestamp',
      'messageType',
      'sentBy',
    ]);
    assert.deepEqual(first.orderBy, [{ messageTimestamp: 'asc' }, { id: 'asc' }]);
    assert.equal(first.where.instanceId, 'inst-1');
    assert.ok(calls.messageQueries[1].where.OR, 'the next pages continue after the last (timestamp, id)');
    assert.equal(calls.sessionQueries, 0, 'no bot session read when every row has its sender');
  });

  test('groups by contact (LID merged), skips groups and protocol messages, resolves old AI rows by exact text', async () => {
    const { prisma, calls } = fakePrisma(sampleRows(), SESSIONS);
    const result = await new ReviewExportService(prisma).collect(
      'inst-1',
      parseReviewPeriod('2026-11-12', '2026-11-13'),
    );

    assert.equal(result.conversations.length, 1);
    const [conversation] = result.conversations;
    assert.equal(conversation.ref, '****4321');
    assert.deepEqual(
      conversation.entries.map((e) => [e.messageId, e.sender]),
      [
        ['C1', 'contact'],
        ['3EB0AI1', 'ai'],
        ['3A00PHONE', 'device'],
        ['C2', 'contact'],
        ['3EB0OLD', 'ai'],
        ['D1', 'panel'],
      ],
    );
    assert.equal(calls.sessionQueries, 1);
  });

  test('stops at the message limit and says it is partial', async () => {
    assert.equal(MAX_REVIEW_MESSAGES, 100_000);
    const rows: Row[] = [];
    for (let i = 0; i < 1200; i++)
      rows.push(row(T0 + i, { id: `L${i}`, remoteJid: PHONE, fromMe: false }, { conversation: 'oi' }));
    const { prisma, calls } = fakePrisma(rows);
    const service = new ReviewExportService(prisma, 600);
    const period = parseReviewPeriod('2026-11-12', '2026-11-12');
    const result = await service.collect('inst-1', period);
    assert.equal(result.partial, true);
    assert.equal(calls.messageQueries.length, 2, 'no page read after the limit');
    const zip: Buffer[] = [];
    for await (const chunk of service.streamZip(NAME, period, 'jsonl', result)) zip.push(chunk);
    assert.match(readZip(Buffer.concat(zip)).get('LEIAME.txt') ?? '', /exportação parcial/);
  });
});

describe('revisão: texto das conversas e página do MCP', () => {
  test('markdown: masked heading, one line per message with time and who wrote it, a separator per day', async () => {
    const { prisma } = fakePrisma(sampleRows(), SESSIONS);
    const { conversations } = await new ReviewExportService(prisma).collect(
      'inst-1',
      parseReviewPeriod('2026-11-12', '2026-11-13'),
    );
    const text = conversationMarkdown(conversations[0]);

    assert.match(text, /^## Conversa \*\*\*\*4321 · 12\/11\/2026\n/);
    assert.match(text, /\[14:03\] Cliente: Oi, meu CPF é \[CPF\] e meu e-mail é \[e-mail\]/);
    assert.match(text, /\[14:03\] IA: Olá! Posso ajudar\?/);
    assert.match(text, /\[14:05\] Equipe \(celular\): Ligo às 15h no \[número\]/);
    assert.match(text, /Cliente: \[áudio 40 s · transcrição: quero saber do processo \[número\]\]/);
    assert.match(text, /— 13\/11\/2026 —\n\n\[14:03\] Equipe \(painel\): \[documento: contrato.pdf\]/);
    assert.doesNotMatch(text, /98765|21987654321|ana@exemplo|mensagem de grupo/);
  });

  test('MCP pages hold whole conversations and cut only a conversation that alone passes the budget', () => {
    const md = ['a'.repeat(30) + '\n', 'b'.repeat(30) + '\n', 'c'.repeat(30) + '\n'];
    assert.deepEqual(reviewPage(md, 0, 70), { text: `${md[0]}\n${md[1]}`, next: 2 });
    assert.deepEqual(reviewPage(md, 2, 70), { text: md[2], next: 3 });
    const long = Array.from({ length: 50 }, (_, i) => `linha ${i}`).join('\n');
    const cut = reviewPage([long], 0, 100);
    assert.equal(cut.next, 1);
    assert.match(cut.text, /conversa cortada aqui: mais \d+ linhas/);
    assert.ok(cut.text.length < 200);
  });
});

describe('revisão: acesso', () => {
  test('client codes never export, whatever the modules; other team roles neither', () => {
    const path = normalizeClientPath(`/export/review/${enc}?from=2026-11-01&to=2026-11-07`, NAME);
    assert.equal(clientRouteAllowed('GET', path, [...CLIENT_MODULES]), false);
    assert.equal(teamRouteAllowed('GET', path, 'leitura', true), false);
    assert.equal(teamRouteAllowed('GET', path, 'equipe', true), false);
    assert.equal(teamRouteAllowed('GET', path, 'dono', true), true);

    assert.match(
      String(reviewExportDenial({ clientAccess: { instanceName: NAME } } as any)),
      /código de acesso do cliente/,
    );
    assert.match(String(reviewExportDenial({ teamAccess: { role: 'equipe' } } as any)), /dono/);
    assert.equal(reviewExportDenial({ teamAccess: { role: 'dono' } } as any), null);
    assert.equal(reviewExportDenial({ userSession: { email: 'dono@exemplo.com' } } as any), null);
    assert.equal(reviewExportDenial({} as any), null);
  });

  test('the real apikey guard refuses a client code on the export route', async () => {
    const key = 'wac_' + 'r'.repeat(43);
    serverModuleOverrides.clientAccessService = {
      resolve: async (k: string) =>
        k === key ? { instanceId: 'inst-1', instanceName: NAME, modules: [...CLIENT_MODULES] } : null,
    };
    try {
      let passed = false;
      let error: any = null;
      try {
        await (authGuard.apikey as any)(
          {
            get: (h: string) => (h.toLowerCase() === 'apikey' ? key : undefined),
            method: 'GET',
            originalUrl: `/export/review/${enc}?from=2026-11-01&to=2026-11-07`,
            params: { instanceName: NAME },
            body: {},
            headers: {},
          },
          {},
          () => void (passed = true),
        );
      } catch (e) {
        error = e;
      }
      assert.equal(passed, false);
      assert.equal(error?.status, 403);
    } finally {
      delete serverModuleOverrides.clientAccessService;
    }
  });
});

describe('GET /export/review/:instanceName', () => {
  let server: Server;
  let base: string;

  before(async () => {
    const { prisma } = fakePrisma(sampleRows(), SESSIONS);
    serverModuleOverrides.reviewExportController = new ReviewExportController(new ReviewExportService(prisma), prisma);
    const app = express();
    // stands in for the apikey guard: the header says who is calling
    const fakeAuth = (req: any, _res: any, next: any) => {
      const who = req.get('x-test-who');
      if (who === 'client') req.clientAccess = { instanceName: NAME, modules: [...CLIENT_MODULES] };
      if (who === 'equipe') req.teamAccess = { role: 'equipe' };
      next();
    };
    app.use('/export', new ReviewExportRouter(fakeAuth).router);
    app.use((error: any, _req: any, res: any, _next: any) => {
      void _next;
      res.status(error?.status ?? 500).json(error);
    });
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/export/review/${enc}`;
  });

  after(() => {
    delete serverModuleOverrides.reviewExportController;
    server.close();
  });

  test('a ZIP with the readme, one Markdown file per conversation and one JSONL, all masked', async () => {
    const response = await fetch(`${base}?from=2026-11-12&to=2026-11-13`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/zip');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(
      response.headers.get('content-disposition') ?? '',
      /filename="revisao-Escrit-rio-Exemplo-2026-11-12_a_2026-11-13\.zip"/,
    );

    const entries = readZip(Buffer.from(await response.arrayBuffer()));
    assert.deepEqual([...entries.keys()], ['LEIAME.txt', 'conversas/2026-11-12-final-4321.md', 'conversas.jsonl']);
    assert.match(entries.get('LEIAME.txt') ?? '', /1 conversas, 6 mensagens/);
    const lines = (entries.get('conversas.jsonl') ?? '')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(lines.length, 6);
    assert.deepEqual(
      lines.map((line) => line.quem),
      ['cliente', 'ia', 'equipe_celular', 'cliente', 'ia', 'equipe_painel'],
    );
    assert.equal(lines[0].conversa, '****4321');
    const all = [...entries.values()].join('\n');
    assert.doesNotMatch(all, /21987654321|98765-4321|ana@exemplo|123\.456/);
  });

  test('format=jsonl leaves only the readme and the JSONL', async () => {
    const response = await fetch(`${base}?from=2026-11-12&to=2026-11-13&format=jsonl`);
    assert.equal(response.status, 200);
    const entries = readZip(Buffer.from(await response.arrayBuffer()));
    assert.deepEqual([...entries.keys()], ['LEIAME.txt', 'conversas.jsonl']);
  });

  test('more than 31 days, a bad date or a bad format: 400 before any byte of the ZIP', async () => {
    for (const query of [
      'from=2026-10-01&to=2026-11-13',
      'from=2026-11-12',
      'from=2026-11-12&to=2026-11-13&format=pdf',
    ]) {
      const response = await fetch(`${base}?${query}`);
      assert.equal(response.status, 400, query);
      assert.notEqual(response.headers.get('content-type'), 'application/zip');
    }
  });

  test('a client access code or a team key that is not the owner gets 403', async () => {
    for (const who of ['client', 'equipe']) {
      const response = await fetch(`${base}?from=2026-11-12&to=2026-11-13`, { headers: { 'x-test-who': who } });
      assert.equal(response.status, 403, who);
    }
  });

  test('unknown instance: 404', async () => {
    const response = await fetch(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/export/review/outra?from=2026-11-12&to=2026-11-13`,
    );
    assert.equal(response.status, 404);
  });
});
