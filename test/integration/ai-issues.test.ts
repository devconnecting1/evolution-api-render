import '../helpers/setup';

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { AiReviewService } from '@api/services/ai-review.service';
import { parseReviewPeriod } from '@utils/conversation-review';

import { OpenaiHarness, SKIP_INTEGRATION, UNKNOWN_MESSAGE } from '../helpers/integration';

/**
 * find_ai_issues on a real PostgreSQL: the settings it reads (bot, OpenAI settings, business hours) exist with these
 * names, and the flags come out of the stored messages (sentBy included).
 */
describe('find_ai_issues (integration)', { skip: SKIP_INTEGRATION }, () => {
  let h: OpenaiHarness;
  const T0 = Math.floor(Date.parse('2026-11-12T10:00:00-03:00') / 1000);

  before(async () => {
    h = await new OpenaiHarness().start();
  });

  after(async () => {
    await h?.stop();
  });

  test('reads the bot settings and the period, flags the fallback and the AI after the team took over', async () => {
    const tenant = await h.createTenant({ settings: { ethicsProfile: 'advocacia' } });
    const instanceId = tenant.instance.instanceId;
    const jid = '5521900005678@s.whatsapp.net';
    const msg = (id: string, at: number, fromMe: boolean, text: string, sentBy: string) => ({
      instanceId,
      key: { id, remoteJid: jid, fromMe },
      messageType: 'conversation',
      message: { conversation: text },
      source: 'web' as const,
      messageTimestamp: at,
      sentBy,
    });
    await h.prisma.message.createMany({
      data: [
        msg('C1', T0, false, 'Oi, quanto custa?', 'contact'),
        msg('3EB0A1', T0 + 10, true, UNKNOWN_MESSAGE, 'ai'),
        msg('3A00T1', T0 + 60, true, 'Aqui é a Dra. Ana, já te ajudo', 'device'),
        msg('3EB0A2', T0 + 90, true, 'Os honorários começam em R$ 500.', 'ai'),
      ],
    });
    await h.prisma.instanceLimits.create({
      data: { instanceId, businessHours: { enabled: false, mode: 'always', timezone: 'America/Sao_Paulo' } },
    });

    const result = await new AiReviewService(h.prisma).findIssues(
      instanceId,
      parseReviewPeriod('2026-11-12', '2026-11-12'),
      {
        now: T0 + 3600,
      },
    );

    assert.equal(result.totals.flaggedConversations, 1);
    assert.deepEqual(result.config, {
      unansweredMinutes: 30,
      businessHours: false,
      pausesForTeam: true,
      splitMessages: false,
      advocacia: true,
    });
    assert.deepEqual(result.conversations[0].flags.map((f) => f.type).sort(), [
      'ai_after_human_takeover',
      'ethics_candidate',
      'fallback_sent',
    ]);
    assert.equal(result.conversations[0].ref, '****5678');
  });
});
