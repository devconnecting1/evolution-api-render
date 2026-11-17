import '../helpers/setup';

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { ReviewExportService } from '@api/services/review-export.service';
import { parseReviewPeriod } from '@utils/conversation-review';

import { nextId } from '../helpers/fakes';
import { OpenaiHarness, SKIP_INTEGRATION } from '../helpers/integration';

/**
 * "Exportar conversas para revisão" on a real PostgreSQL (real migrations, including Message.sentBy and the
 * (instanceId, messageTimestamp) index): the keyset pages walk past ties of the same second, the period and the
 * instance are respected, and an old row without sentBy is resolved by the AI history of the contact.
 */
describe('review export (integration)', { skip: SKIP_INTEGRATION }, () => {
  let h: OpenaiHarness;
  const instanceIds: string[] = [];
  const T0 = Math.floor(Date.parse('2026-11-12T09:00:00-03:00') / 1000);

  before(async () => {
    h = await new OpenaiHarness().start();
  });

  after(async () => {
    if (instanceIds.length) await h?.prisma.instance.deleteMany({ where: { id: { in: instanceIds } } });
    await h?.stop();
  });

  const instance = async () => {
    const row = await h.prisma.instance.create({
      data: { name: `it-review-${nextId()}`.toLowerCase(), integration: 'WHATSAPP-BAILEYS', connectionStatus: 'open' },
    });
    instanceIds.push(row.id);
    return row.id;
  };

  const message = (instanceId: string, at: number, key: any, text: string, sentBy: string | null) => ({
    instanceId,
    key,
    messageType: 'conversation',
    message: { conversation: text },
    source: 'web' as const,
    messageTimestamp: at,
    sentBy,
  });

  test('pages of 500 by (timestamp, id), period and instance respected, old AI rows resolved', async () => {
    const id = await instance();
    const other = await instance();
    const jid = '5521900001234@s.whatsapp.net';

    const rows = [];
    // 1200 messages with many ties on the same second: the keyset must not repeat or skip any
    for (let i = 0; i < 1200; i++) {
      rows.push(
        message(
          id,
          T0 + Math.floor(i / 7),
          { id: `K${i}`, remoteJid: jid, fromMe: i % 3 === 1 },
          `mensagem ${i}`,
          i % 3 === 1 ? 'ai' : 'contact',
        ),
      );
    }
    rows.push(message(id, T0 + 400, { id: '3EB0OLD', remoteJid: jid, fromMe: true }, 'Qual o melhor horário?', null));
    rows.push(
      message(id, T0 - 86_400 * 3, { id: 'BEFORE', remoteJid: jid, fromMe: false }, 'fora do período', 'contact'),
    );
    rows.push(message(other, T0 + 5, { id: 'OTHER', remoteJid: jid, fromMe: false }, 'outra instância', 'contact'));
    await h.prisma.message.createMany({ data: rows });

    await h.prisma.integrationSession.create({
      data: {
        instanceId: id,
        remoteJid: jid,
        pushName: 'Contato',
        sessionId: `s-${nextId()}`,
        status: 'opened',
        awaitUser: false,
        type: 'openai',
        context: { history: [{ role: 'assistant', content: 'Qual o melhor horário?' }] },
      } as any,
    });

    const result = await new ReviewExportService(h.prisma).collect(id, parseReviewPeriod('2026-11-12', '2026-11-12'));

    assert.equal(result.messages, 1201);
    assert.equal(result.partial, false);
    assert.equal(result.conversations.length, 1);
    const entries = result.conversations[0].entries;
    const ids = entries.map((entry) => entry.messageId);
    assert.equal(new Set(ids).size, 1201, 'no message repeated');
    assert.ok(!ids.includes('BEFORE') && !ids.includes('OTHER'));
    assert.ok(
      entries.every((entry, i) => i === 0 || entries[i - 1].at <= entry.at),
      'in time order',
    );
    assert.equal(entries.find((entry) => entry.messageId === '3EB0OLD')?.sender, 'ai');
    assert.equal(entries.find((entry) => entry.messageId === 'K1')?.sender, 'ai');
    assert.equal(entries.find((entry) => entry.messageId === 'K0')?.sender, 'contact');
    assert.equal(result.conversations[0].ref, '****1234');
  });
});
