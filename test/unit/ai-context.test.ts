import '../helpers/setup';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  adReferralNote,
  buildContextNote,
  CONTEXT_NOTE_HEADER,
  dateNoteLines,
  extractAdReferral,
  nextOpening,
  stripAdMarker,
  stripAdMarkerFromMessage,
  summarize,
} from '@api/integrations/chatbot/openai/ai-context';
import { defaultBusinessHours } from '@utils/usageLimits';

// Monday 16/11/2026 14:05 in São Paulo (UTC-3)
const MONDAY_AFTERNOON = new Date('2026-11-16T17:05:00Z');
// Saturday 21/11/2026 10:00 in São Paulo
const SATURDAY_MORNING = new Date('2026-11-21T13:00:00Z');
const hours = { ...defaultBusinessHours(), enabled: true, mode: 'inside' as const };

describe('context note: date and business hours', () => {
  test('always the date and time in Brasília, even without business hours', () => {
    assert.deepEqual(dateNoteLines(MONDAY_AFTERNOON), [
      '- Agora: segunda-feira, 16/11/2026, 14:05 (horário de Brasília, America/Sao_Paulo).',
    ]);
  });

  test('open now: closing time; closed: next opening', () => {
    assert.match(dateNoteLines(MONDAY_AFTERNOON, null, hours)[1], /aberto agora \(hoje fecha às 18:00\)/);
    assert.match(
      dateNoteLines(SATURDAY_MORNING, null, hours)[1],
      /fechado agora\. Próxima abertura: segunda-feira, 23\/11, às 09:00\./,
    );
    // Monday 07:00: opens today
    assert.match(dateNoteLines(new Date('2026-11-16T10:00:00Z'), null, hours)[1], /Próxima abertura: hoje às 09:00/);
    // Friday 20:00: opens Monday
    assert.deepEqual(nextOpening(hours, new Date('2026-11-20T23:00:00Z')), {
      weekday: 'segunda-feira',
      date: '23/11',
      time: '09:00',
      days: 3,
    });
  });

  test('disabled business hours: only the date', () => {
    assert.equal(dateNoteLines(MONDAY_AFTERNOON, null, defaultBusinessHours()).length, 1);
  });
});

describe('context note: Click-to-WhatsApp ad', () => {
  const adMsg = {
    message: { conversation: 'oi, vi o anúncio' },
    contextInfo: {
      externalAdReply: {
        title: 'Ficou sem luz? Saiba o que fazer',
        body: 'Interrupção de energia por mais de 24 horas pode gerar indenização. Fale com a equipe pelo WhatsApp e tire suas dúvidas sobre o seu caso específico.',
        sourceUrl: 'https://instagram.example/p/abc',
        sourceType: 'ad',
      },
    },
  };

  test('read from the top-level contextInfo or from inside the message', () => {
    assert.equal(extractAdReferral(adMsg)?.title, 'Ficou sem luz? Saiba o que fazer');
    const nested = { message: { extendedTextMessage: { text: 'oi', contextInfo: adMsg.contextInfo } } };
    assert.equal(extractAdReferral(nested)?.sourceType, 'ad');
    assert.equal(extractAdReferral({ message: { conversation: 'oi' } }), null);
  });

  test('summarized, never the URL, and never "texto que veio junto"', () => {
    const note = adReferralNote(extractAdReferral(adMsg));
    assert.ok(note);
    assert.match(note, /^- O contato chegou por um anúncio: Ficou sem luz\? Saiba o que fazer — Interrupção/);
    assert.ok(!note.includes('https://'));
    assert.match(note, /nunca fale em "texto que veio junto"/);
    assert.ok(summarize('a '.repeat(200), 50).length <= 50);
  });

  test('the ad marker is removed from the customer text and from old history', () => {
    assert.equal(stripAdMarker('oi, vi o anúncio\nexternalAdReplyBody|Interrupção de energia...'), 'oi, vi o anúncio');
    assert.deepEqual(stripAdMarkerFromMessage({ role: 'user', content: 'oi\nexternalAdReplyBody|x' }), {
      role: 'user',
      content: 'oi',
    });
    assert.deepEqual(stripAdMarkerFromMessage({ role: 'assistant', content: 'externalAdReplyBody|x' }), {
      role: 'assistant',
      content: 'externalAdReplyBody|x',
    });
  });

  test('the full note: header first, then date, hours and ad', () => {
    const note = buildContextNote({ now: MONDAY_AFTERNOON, hours, ad: extractAdReferral(adMsg) });
    const lines = note.split('\n');
    assert.equal(lines[0], CONTEXT_NOTE_HEADER);
    assert.equal(lines.length, 4);
  });
});
