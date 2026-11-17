import '../helpers/setup';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { registerBotMessageId } from '@utils/botMessageRegistry';
import {
  aiReplyIndex,
  deriveSender,
  isMessageSender,
  matchesAiReply,
  messageBodyText,
  runWithSendOrigin,
  senderLabel,
  sendOriginMiddleware,
  sentByForReceived,
  sentByForSend,
} from '@utils/message-sender';
import { backfillMessageSender, formatBackfillReport } from '@utils/message-sender-backfill';

import { createBaileysService, incoming, INSTANCE_ID } from '../helpers/baileys';

const fakeReq = (headers: Record<string, string> = {}) => ({
  get: (name: string) => headers[name.toLowerCase()],
});

describe('origem das mensagens: envio', () => {
  test('a chatbot send is always the AI, even inside a panel request', () => {
    assert.equal(sentByForSend(true), 'ai');
    assert.equal(
      runWithSendOrigin(true, () => sentByForSend(true)),
      'ai',
    );
  });

  test('without the panel context a send is the API', () => {
    assert.equal(sentByForSend(false), 'api');
    assert.equal(
      runWithSendOrigin(false, () => sentByForSend(false)),
      'api',
    );
  });

  test('x-wa-origin: panel marks the request, also after an await', async () => {
    let seen = '';
    await new Promise<void>((resolve) =>
      sendOriginMiddleware(fakeReq({ 'x-wa-origin': ' Panel ' }), null, async () => {
        await new Promise((r) => setTimeout(r, 1));
        seen = sentByForSend(false);
        resolve();
      }),
    );
    assert.equal(seen, 'panel');
  });

  test('another header value or no header is the API', () => {
    let other = '';
    sendOriginMiddleware(fakeReq({ 'x-wa-origin': 'mobile' }), null, () => void (other = sentByForSend(false)));
    let none = '';
    sendOriginMiddleware(fakeReq(), null, () => void (none = sentByForSend(false)));
    assert.equal(other, 'api');
    assert.equal(none, 'api');
  });

  test('received: the contact, another device of the number, or an id the API registered', () => {
    assert.equal(sentByForReceived(false, false), 'contact');
    assert.equal(sentByForReceived(undefined, true), 'contact');
    assert.equal(sentByForReceived(true, false), 'device');
    assert.equal(sentByForReceived(true, true), 'ai');
  });
});

describe('origem das mensagens: leitura de linhas antigas', () => {
  test('the stored value wins; an unknown value is ignored', () => {
    assert.equal(deriveSender({ sentBy: 'panel', key: { fromMe: true, id: '3EB0AA' } }), 'panel');
    assert.equal(deriveSender({ sentBy: 'robot', key: { fromMe: false, id: 'X' } }), 'contact');
    assert.equal(isMessageSender('device'), true);
    assert.equal(isMessageSender('robot'), false);
  });

  test('fromMe=false is the contact; a fromMe id that is not 3EB0 came from the phone', () => {
    assert.equal(deriveSender({ key: { fromMe: false, id: '3EB0X' } }), 'contact');
    assert.equal(deriveSender({ key: { fromMe: true, id: '3A1F00BB' } }), 'device');
    assert.equal(deriveSender({ key: JSON.stringify({ fromMe: true, id: 'BAE5C0DE' }) }), 'device');
  });

  test('a 3EB0 id is unknown unless its text is exactly an AI answer', () => {
    const replies = aiReplyIndex([
      { context: { history: [{ role: 'assistant', content: 'Bom dia! Como posso ajudar?\n\nPode mandar o CPF.' }] } },
    ]);
    const row = (text: string) => ({ key: { fromMe: true, id: '3EB0ABC' }, message: { conversation: text } });

    assert.equal(deriveSender(row('Bom dia! Como posso ajudar?')), 'unknown');
    assert.equal(deriveSender(row('Bom dia! Como posso ajudar?'), replies), 'ai');
    assert.equal(deriveSender(row('Pode mandar o CPF.'), replies), 'ai', 'a part split by a blank line');
    assert.equal(deriveSender(row('Bom dia'), replies), 'unknown', 'a piece of an answer is not exact');
    assert.equal(deriveSender(row('Oi, aqui é a Dra. Ana'), replies), 'unknown');
  });

  test('the AI index reads string and array contents, ignores formatting and other roles', () => {
    const replies = aiReplyIndex([
      {
        context: JSON.stringify({
          history: [
            { role: 'user', content: 'quero agendar' },
            { role: 'assistant', content: [{ type: 'text', text: 'Claro, *qual dia* fica melhor?' }] },
          ],
        }),
      },
      { context: null },
    ]);
    assert.equal(matchesAiReply('Claro, qual dia fica   melhor?', replies), true);
    assert.equal(matchesAiReply('quero agendar', replies), false);
    assert.equal(matchesAiReply('', replies), false);
    assert.equal(aiReplyIndex(null).size, 0);
  });

  test('text of a stored message: text and captions only', () => {
    assert.equal(messageBodyText({ extendedTextMessage: { text: 'oi' } }), 'oi');
    assert.equal(messageBodyText({ imageMessage: { caption: 'foto' } }), 'foto');
    assert.equal(messageBodyText({ audioMessage: {}, speechToText: 'transcrito' }), null);
    assert.equal(messageBodyText(null), null);
  });

  test('labels of the MCP', () => {
    assert.deepEqual((['ai', 'panel', 'device', 'api', 'contact', 'unknown'] as const).map(senderLabel), [
      'ia',
      'equipe_painel',
      'equipe_celular',
      'api',
      'cliente',
      'nao_identificado',
    ]);
  });
});

describe('origem das mensagens: backfill', () => {
  const fakePrisma = (rows: any[], sessions: any[]) => {
    const calls = { updates: [] as any[], sessionReads: 0, pages: 0 };
    const prisma = {
      message: {
        findMany: async ({ where, take }: any) => {
          calls.pages++;
          return rows
            .filter((row) => row.sentBy == null)
            .filter((row) => !where.instanceId || row.instanceId === where.instanceId)
            .filter((row) => !where.id?.gt || row.id > where.id.gt)
            .sort((a, b) => (a.id < b.id ? -1 : 1))
            .slice(0, take)
            .map(({ id, instanceId, key, message }) => ({ id, instanceId, key, message }));
        },
        updateMany: async ({ where, data }: any) => {
          calls.updates.push({ ids: [...where.id.in], data });
          let count = 0;
          for (const row of rows) {
            if (where.id.in.includes(row.id) && row.sentBy == null) {
              row.sentBy = data.sentBy;
              count++;
            }
          }
          return { count };
        },
      },
      integrationSession: {
        findMany: async ({ where }: any) => {
          calls.sessionReads++;
          return sessions.filter((s) => s.instanceId === where.instanceId && where.remoteJid.in.includes(s.remoteJid));
        },
      },
    };
    return { prisma, calls };
  };

  const jid = '5511900000001@s.whatsapp.net';
  const seed = () => [
    { id: 'm1', instanceId: 'i1', key: { id: 'C1', fromMe: false, remoteJid: jid }, message: { conversation: 'oi' } },
    {
      id: 'm2',
      instanceId: 'i1',
      key: { id: '3EB0A', fromMe: true, remoteJid: jid },
      message: { conversation: 'Olá!' },
    },
    {
      id: 'm3',
      instanceId: 'i1',
      key: { id: '3EB0B', fromMe: true, remoteJid: jid },
      message: { conversation: 'Sou a Ana' },
    },
    { id: 'm4', instanceId: 'i1', key: { id: 'BAE5', fromMe: true, remoteJid: jid }, message: { conversation: 'ok' } },
    { id: 'm5', instanceId: 'i1', sentBy: 'panel', key: { id: '3EB0C', fromMe: true, remoteJid: jid }, message: {} },
    { id: 'm6', instanceId: 'i2', key: { id: 'C2', fromMe: false, remoteJid: jid }, message: { conversation: 'oi' } },
  ];
  const sessions = [
    { instanceId: 'i1', remoteJid: jid, context: { history: [{ role: 'assistant', content: 'Olá!' }] } },
  ];

  test('dry run (default) counts per value and writes nothing', async () => {
    const rows = seed();
    const { prisma, calls } = fakePrisma(rows, sessions);
    const result = await backfillMessageSender(prisma, { batchSize: 2 });

    assert.equal(result.scanned, 5, 'the row that already has a value is not read');
    assert.deepEqual(result.counts, { ai: 1, panel: 0, api: 0, device: 1, contact: 2, unknown: 1 });
    assert.equal(result.written, 0);
    assert.equal(calls.updates.length, 0);
    assert.equal(calls.sessionReads, 1, 'the sessions of a contact are read once');
    assert.match(formatBackfillReport(result, false), /simulação/);
  });

  test('--apply writes only what it proves, grouped by value, and keeps the unknown rows empty', async () => {
    const rows = seed();
    const { prisma, calls } = fakePrisma(rows, sessions);
    const result = await backfillMessageSender(prisma, { apply: true, instanceId: 'i1', batchSize: 10 });

    assert.equal(result.scanned, 4);
    assert.equal(result.written, 3);
    assert.deepEqual(Object.fromEntries(rows.map((row) => [row.id, row.sentBy ?? null])), {
      m1: 'contact',
      m2: 'ai',
      m3: null,
      m4: 'device',
      m5: 'panel',
      m6: null,
    });
    assert.ok(calls.updates.every((update) => update.ids.length > 0));
    assert.match(formatBackfillReport(result, true), /Linhas gravadas: 3/);
  });
});

describe('origem das mensagens: Baileys grava quem escreveu', () => {
  test('incoming is the contact; fromMe from another device is the device; a registered bot id is the AI', async () => {
    const { state, upsert } = createBaileysService();
    const fromContact = incoming({ conversation: 'oi' });
    const fromPhone = incoming({ conversation: 'já te ligo' }, { id: '3A00PHONE', fromMe: true });
    const fromBot = incoming({ conversation: 'resposta automática' }, { id: '3EB0BOTREPLY', fromMe: true });
    await registerBotMessageId(INSTANCE_ID, fromBot.key.id);

    await upsert([fromContact, fromPhone, fromBot]);

    const stored = (id: string) => state.created.find((m) => m.key.id === id)?.sentBy;
    assert.equal(stored(fromContact.key.id), 'contact');
    assert.equal(stored('3A00PHONE'), 'device');
    assert.equal(stored('3EB0BOTREPLY'), 'ai');
  });

  const sendingService = () => {
    const ctx = createBaileysService();
    ctx.service.whatsappNumber = async ({ numbers }: any) => [
      { exists: true, jid: `${numbers[0]}@s.whatsapp.net`, number: numbers[0] },
    ];
    ctx.service.stateConnection = { state: 'open' };
    return ctx;
  };

  test('a chatbot send is stored as the AI', async () => {
    const { service, state } = sendingService();
    await service.textMessage({ number: '5511987654321', text: 'olá' }, false, true);
    assert.equal(state.created.at(-1).sentBy, 'ai');
  });

  test('a send of the panel is stored as the panel, any other call as the API', async () => {
    const { service, state } = sendingService();
    await runWithSendOrigin(true, () => service.textMessage({ number: '5511987654321', text: 'do painel' }));
    assert.equal(state.created.at(-1).sentBy, 'panel');

    await service.textMessage({ number: '5511987654321', text: 'de um sistema' });
    assert.equal(state.created.at(-1).sentBy, 'api');
  });

  test('the field is not sent to the webhook payload', async () => {
    const { service, state } = sendingService();
    await service.textMessage({ number: '5511987654321', text: 'olá' }, false, true);
    const sent = state.webhooks.find((hook) => hook.event === 'send.message');
    assert.ok(sent, JSON.stringify(state.webhooks.map((hook) => hook.event)));
    assert.equal('sentBy' in sent.data, false);
  });
});
