import '../helpers/setup';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { AiReviewService } from '@api/services/ai-review.service';
import { conversationIssues, evidenceOf, IssueConfig, IssueType } from '@utils/ai-issues';
import { parseReviewPeriod, ReviewConversation, ReviewEntry } from '@utils/conversation-review';
import { ResolvedSender } from '@utils/message-sender';
import { defaultBusinessHours } from '@utils/usageLimits';

/** Thursday 12/11/2026 10:00 in Brasília. */
const T0 = Math.floor(Date.parse('2026-11-12T10:00:00-03:00') / 1000);
const MIN = 60;

let seq = 0;
const e = (sender: ResolvedSender, at: number, text: string, type = 'conversation'): ReviewEntry => ({
  messageId: `M${++seq}`,
  at,
  sender,
  type,
  text,
});
const conv = (...entries: ReviewEntry[]): ReviewConversation => ({ ref: '****4321', entries });

const base: IssueConfig = {
  unansweredMinutes: 30,
  hours: null,
  fallbackTexts: ['Desculpe, tive um problema para responder agora.'],
  outsideHoursTexts: ['Estamos fora do horário. Respondemos amanhã.'],
  pausesForTeam: true,
  resumeMinutes: 60,
  splitMessages: false,
  advocacia: false,
  until: T0 + 48 * 3600,
};

const types = (entries: ReviewEntry[], config: Partial<IssueConfig> = {}) =>
  conversationIssues(conv(...entries), { ...base, ...config }).map((f) => f.type);

describe('find_ai_issues: regras', () => {
  test('a normal exchange has no flag', () => {
    assert.deepEqual(
      types([
        e('contact', T0, 'Oi, quero agendar'),
        e('ai', T0 + 20, 'Claro! Qual dia fica melhor para você?'),
        e('contact', T0 + 60, 'Sexta'),
        e('ai', T0 + 80, 'Combinado, sexta às 10h.'),
      ]),
      [],
    );
  });

  test('unanswered: only after unanswered_minutes, only inside business hours, one flag per customer turn', () => {
    assert.deepEqual(
      types([e('contact', T0, 'Oi'), e('contact', T0 + 10, 'alguém?'), e('ai', T0 + 31 * MIN, 'Olá!')]),
      ['unanswered'],
    );
    assert.deepEqual(types([e('contact', T0, 'Oi'), e('ai', T0 + 29 * MIN, 'Olá!')]), []);
    assert.deepEqual(
      types([e('contact', T0, 'Oi')], { until: T0 + 10 * MIN }),
      [],
      'not judged before the time passed',
    );

    const hours = { ...defaultBusinessHours(), enabled: true, mode: 'inside' as const };
    hours.week = { sun: [], mon: [], tue: [], wed: [], thu: [['09:00', '18:00']], fri: [], sat: [] };
    const night = T0 + 12 * 3600; // 22:00
    assert.deepEqual(types([e('contact', night, 'Oi')], { hours }), [], 'outside business hours');
    assert.deepEqual(types([e('contact', T0, 'Oi')], { hours }), ['unanswered']);
  });

  test('ai_after_human_takeover and paused_too_long', () => {
    assert.deepEqual(
      types([e('contact', T0, 'Oi'), e('device', T0 + 60, 'Aqui é a Dra. Ana'), e('ai', T0 + 120, 'Posso ajudar?')]),
      ['ai_after_human_takeover'],
    );
    assert.deepEqual(
      types([e('contact', T0, 'Oi'), e('panel', T0 + 60, 'Oi!'), e('ai', T0 + 2 * 3600, 'Posso ajudar?')]),
      [],
      'the pause of 60 min was over',
    );
    assert.deepEqual(
      types([e('contact', T0, 'Oi'), e('device', T0 + 60, 'Aqui é a Ana'), e('ai', T0 + 120, 'Posso ajudar?')], {
        pausesForTeam: false,
      }),
      [],
      'stopBotFromMe off: the AI is expected to keep answering',
    );
    assert.deepEqual(
      types([
        e('contact', T0, 'Oi'),
        e('panel', T0 + 60, 'Já te respondo'),
        e('contact', T0 + 120, 'ok, aguardo'),
        e('panel', T0 + 30 * 3600, 'Voltei'),
      ]),
      ['paused_too_long'],
    );
  });

  test('repeated answer, repeated question and two questions in one message', () => {
    const flags = types([
      e('contact', T0, 'Oi'),
      e('ai', T0 + 10, 'Olá! Para começar, qual é o seu nome completo?'),
      e('contact', T0 + 60, 'Ana'),
      e('ai', T0 + 70, 'Olá! Para começar, qual é o seu nome completo?'),
      e('contact', T0 + 120, 'Já disse'),
      e('ai', T0 + 130, 'Desculpe. Qual é o seu nome completo? E a sua cidade?'),
    ]);
    assert.deepEqual(flags, ['repeated_ai_answer', 'repeated_question', 'double_question']);
  });

  test('long answer: more than 3 sentences or more than 450 characters', () => {
    assert.deepEqual(types([e('contact', T0, 'Oi'), e('ai', T0 + 10, 'Um. Dois. Três. Quatro.')]), ['long_answer']);
    assert.deepEqual(types([e('contact', T0, 'Oi'), e('ai', T0 + 10, 'a'.repeat(451))]), ['long_answer']);
    assert.deepEqual(types([e('contact', T0, 'Oi'), e('ai', T0 + 10, 'Um. Dois. Três.')]), []);
  });

  test('double_reply: two AI answers within 30 s for one turn, not when splitMessages is on', () => {
    const entries = [e('contact', T0, 'Oi'), e('ai', T0 + 10, 'Olá!'), e('ai', T0 + 25, 'Em que posso ajudar hoje?')];
    assert.deepEqual(types(entries), ['double_reply']);
    assert.deepEqual(types(entries, { splitMessages: true }), []);
    assert.deepEqual(types([e('contact', T0, 'Oi'), e('ai', T0 + 10, 'Olá!'), e('ai', T0 + 90, 'Ainda está aí?')]), []);
  });

  test('fallback_sent, off_hours_reply (except the outside-hours notice) and ethics_candidate', () => {
    assert.deepEqual(
      types([e('contact', T0, 'Oi'), e('ai', T0 + 10, 'Desculpe, tive um problema para responder agora.')]),
      ['fallback_sent'],
    );

    const hours = { ...defaultBusinessHours(), enabled: true, mode: 'inside' as const };
    hours.week = { sun: [], mon: [], tue: [], wed: [], thu: [['09:00', '18:00']], fri: [], sat: [] };
    const night = T0 + 12 * 3600;
    assert.deepEqual(types([e('contact', night, 'Oi'), e('ai', night + 10, 'Olá! Como posso ajudar?')], { hours }), [
      'off_hours_reply',
    ]);
    assert.deepEqual(
      types([e('contact', night, 'Oi'), e('ai', night + 10, 'Estamos fora do horário. Respondemos amanhã.')], {
        hours,
      }),
      [],
    );

    const pricey = [
      e('contact', T0, 'Quanto custa?'),
      e('ai', T0 + 10, 'A consulta custa R$ 300 e você tem direito à indenização.'),
    ];
    assert.deepEqual(types(pricey), []);
    assert.deepEqual(types(pricey, { advocacia: true }), ['ethics_candidate']);
  });

  test('evidence: at most 120 characters, flags carry the message id and time', () => {
    assert.equal(evidenceOf('x'.repeat(200)).length, 120);
    const [flag] = conversationIssues(conv(e('contact', T0, 'Oi'), e('ai', T0 + 10, 'a'.repeat(500))), base);
    assert.equal(flag.type, 'long_answer');
    assert.equal(flag.severity, 'baixa');
    assert.equal(flag.at, T0 + 10);
    assert.match(String(flag.messageId), /^M\d+$/);
  });
});

describe('find_ai_issues: serviço', () => {
  const PHONE_A = '5521900001111@s.whatsapp.net';
  const PHONE_B = '5521900002222@s.whatsapp.net';
  const PHONE_C = '5521900003333@s.whatsapp.net';
  const row = (id: string, jid: string, at: number, fromMe: boolean, text: string, sentBy: string) => ({
    id,
    key: { id, remoteJid: jid, fromMe },
    messageType: 'conversation',
    message: { conversation: text },
    messageTimestamp: at,
    sentBy,
  });
  const rows = [
    // A: fallback (alta)
    row('a1', PHONE_A, T0, false, 'Oi', 'contact'),
    row('a2', PHONE_A, T0 + 10, true, 'Desculpe, tive um problema para responder agora.', 'ai'),
    // B: long answer only (baixa)
    row('b1', PHONE_B, T0 + 100, false, 'Oi', 'contact'),
    row('b2', PHONE_B, T0 + 110, true, 'Um. Dois. Três. Quatro.', 'ai'),
    // C: clean
    row('c1', PHONE_C, T0 + 200, false, 'Oi', 'contact'),
    row('c2', PHONE_C, T0 + 210, true, 'Olá!', 'ai'),
  ];

  const fake = (calls: string[] = []) => ({
    message: {
      findMany: async ({ where }: any) => {
        calls.push('message.findMany');
        return where.OR ? [] : rows;
      },
    },
    integrationSession: { findMany: async () => [] },
    openaiBot: {
      findMany: async ({ where }: any) => {
        calls.push(`openaiBot:${where.instanceId}:${where.enabled}`);
        return [
          {
            unknownMessage: 'Desculpe, tive um problema para responder agora.',
            splitMessages: false,
            stopBotFromMe: true,
            humanResumeMinutes: 30,
          },
        ];
      },
    },
    openaiSetting: { findFirst: async () => ({ ethicsProfile: 'advocacia', humanResumeMinutes: 0 }) },
    instanceLimits: { findUnique: async () => null },
  });

  test('only flagged conversations, the most severe first, masked, with counts by who wrote', async () => {
    const calls: string[] = [];
    const result = await new AiReviewService(fake(calls)).findIssues(
      'inst-1',
      parseReviewPeriod('2026-11-12', '2026-11-12'),
      {
        now: T0 + 3600,
      },
    );
    assert.deepEqual(result.totals, {
      conversations: 3,
      flaggedConversations: 2,
      messages: 6,
      bySender: { cliente: 3, ia: 3 },
      byFlag: { fallback_sent: 1, long_answer: 1 },
      partial: false,
    });
    assert.deepEqual(
      result.conversations.map((c) => c.ref),
      ['****1111', '****2222'],
    );
    assert.deepEqual(result.conversations[0].counts, { cliente: 1, ia: 1 });
    assert.deepEqual(result.conversations[0].flags[0], {
      type: 'fallback_sent',
      severity: 'alta',
      at: new Date((T0 + 10) * 1000).toISOString(),
      messageId: 'a2',
      evidence: 'Desculpe, tive um problema para responder agora.',
    });
    assert.equal(result.nextCursor, null);
    assert.deepEqual(result.config, {
      unansweredMinutes: 30,
      businessHours: false,
      pausesForTeam: true,
      splitMessages: false,
      advocacia: true,
    });
    assert.ok(calls.includes('openaiBot:inst-1:true'));
    assert.equal(calls.filter((c) => c === 'message.findMany').length, 1, 'one range query for 6 rows');
  });

  test('min_severity, page size and cursor', async () => {
    const service = new AiReviewService(fake());
    const period = parseReviewPeriod('2026-11-12', '2026-11-12');
    const high = await service.findIssues('inst-1', period, { minSeverity: 'alta', now: T0 + 3600 });
    assert.deepEqual(
      high.conversations.map((c) => c.ref),
      ['****1111'],
    );
    assert.deepEqual(high.severities, ['alta']);

    const first = await service.findIssues('inst-1', period, { pageSize: 1, now: T0 + 3600 });
    assert.equal(first.conversations.length, 1);
    assert.equal(first.nextCursor, '1');
    const second = await service.findIssues('inst-1', period, { pageSize: 1, offset: 1, now: T0 + 3600 });
    assert.deepEqual(
      second.conversations.map((c) => c.ref),
      ['****2222'],
    );
    assert.equal(second.nextCursor, null);
  });

  test('the flag list covers every type', () => {
    const all: IssueType[] = [
      'unanswered',
      'ai_after_human_takeover',
      'repeated_ai_answer',
      'repeated_question',
      'double_question',
      'long_answer',
      'double_reply',
      'fallback_sent',
      'ethics_candidate',
      'off_hours_reply',
      'paused_too_long',
    ];
    assert.equal(new Set(all).size, 11);
  });
});
