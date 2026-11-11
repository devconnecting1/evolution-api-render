import '../helpers/setup';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  agendaTools,
  buildAgendaContext,
  isToolsUnsupportedError,
  MAX_TOOL_ROUNDS,
  runToolLoop,
} from '@api/integrations/chatbot/openai/agenda-ai';
import { InternalAgendaProvider } from '@api/services/agenda.provider';
import { AgendaError, AgendaService } from '@api/services/agenda.service';
import {
  buildIcs,
  decideReminder,
  defaultAgendaSettings,
  formatSlot,
  generateSlots,
  icsFold,
  isBookableSlot,
  localToUtc,
  normalizeAgendaSettings,
  parseReminderReply,
  parseStart,
  planReminders,
  reminderText,
  toLocalIso,
  validateAgendaInput,
} from '@utils/agenda';

import { createAgendaTables } from '../helpers/agenda-mock';

const SP = 'America/Sao_Paulo';
/** Monday 2026-11-09 09:00 in São Paulo (UTC-3, no DST). */
const NOW = new Date('2026-11-09T12:00:00Z');
const at = (iso: string) => new Date(iso);
const sp = (local: string) => parseStart(local, SP) as Date;

const settings = (patch: Record<string, any> = {}) =>
  normalizeAgendaSettings({ ...defaultAgendaSettings(), enabled: true, ...patch });

describe('agenda: time helpers', () => {
  test('local time <-> UTC, PT-BR label and local ISO', () => {
    assert.equal(localToUtc('2026-11-12', 14 * 60, SP)?.toISOString(), '2026-11-12T17:00:00.000Z');
    assert.equal(formatSlot(at('2026-11-12T17:00:00Z'), SP), 'qui, 12/11 às 14:00');
    assert.equal(toLocalIso(at('2026-11-12T17:00:00Z'), SP), '2026-11-12T14:00:00-03:00');
    assert.equal(parseStart('2026-11-12T14:00', SP)?.toISOString(), '2026-11-12T17:00:00.000Z');
    assert.equal(parseStart('2026-11-12T14:00:00-03:00', SP)?.toISOString(), '2026-11-12T17:00:00.000Z');
    assert.equal(parseStart('amanhã às 14h', SP), null);
    assert.equal(parseStart('2026-11-12T25:00', SP), null);
  });

  test('DST: a local time inside the spring-forward gap does not exist', () => {
    const ny = 'America/New_York';
    assert.equal(localToUtc('2026-03-08', 2 * 60 + 30, ny), null);
    assert.equal(localToUtc('2026-03-08', 3 * 60, ny)?.toISOString(), '2026-03-08T07:00:00.000Z');
    assert.equal(localToUtc('2026-03-07', 3 * 60, ny)?.toISOString(), '2026-03-07T08:00:00.000Z');
  });
});

describe('agenda: slot generation', () => {
  test('weekly availability, slot length and min notice', () => {
    const slots = generateSlots(settings(), { now: NOW, days: 1, busy: [] });
    // Monday 09:00 local + 2 h notice: first slot 11:00; 09:00-12:00 and 14:00-18:00, every 30 min
    assert.equal(formatSlot(slots[0].start, SP), 'seg, 09/11 às 11:00');
    assert.deepEqual(
      slots.map((slot) => formatSlot(slot.start, SP).slice(-5)),
      ['11:00', '11:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30'],
    );
    // A 60 min type does not start at 11:30 (it would end at 12:30)
    const long = generateSlots(settings(), { now: NOW, days: 1, busy: [], durationMinutes: 60 });
    assert.ok(!long.some((slot) => formatSlot(slot.start, SP).endsWith('11:30')));
    assert.ok(long.some((slot) => formatSlot(slot.start, SP).endsWith('17:00')));
  });

  test('weekends closed, max days ahead and limit', () => {
    const week = generateSlots(settings({ maxDaysAhead: 3 }), { now: NOW, days: 10, busy: [] });
    const days = new Set(week.map((slot) => formatSlot(slot.start, SP).slice(0, 10)));
    assert.deepEqual([...days], ['seg, 09/11', 'ter, 10/11', 'qua, 11/11', 'qui, 12/11']);
    assert.equal(generateSlots(settings(), { now: NOW, days: 30, busy: [], limit: 6 }).length, 6);
  });

  test('existing appointments with buffer, and the rescheduled one ignored', () => {
    const busy = [{ id: 'a1', start: sp('2026-11-10T10:00'), end: sp('2026-11-10T10:30') }];
    const labels = (s: any, ignoreId?: string) =>
      generateSlots(s, { now: NOW, fromDay: '2026-11-10', days: 1, busy, ignoreId }).map((slot) =>
        formatSlot(slot.start, SP).slice(-5),
      );
    assert.deepEqual(labels(settings()).slice(0, 4), ['09:00', '09:30', '10:30', '11:00']);
    assert.deepEqual(labels(settings({ bufferMinutes: 15 })).slice(0, 3), ['09:00', '11:00', '11:30']);
    assert.ok(labels(settings(), 'a1').includes('10:00'));
  });

  test('blocked days (holidays) and blocked hours', () => {
    const s = settings({
      blocks: [
        { start: '2026-11-10', end: '2026-11-11', reason: 'Recesso' },
        { start: '2026-11-12', from: '14:00', to: '16:00', reason: 'Audiência' },
      ],
    });
    const slots = generateSlots(s, { now: NOW, fromDay: '2026-11-10', days: 3, busy: [] }).map((slot) =>
      formatSlot(slot.start, SP),
    );
    assert.ok(slots.every((label) => label.startsWith('qui, 12/11')));
    assert.ok(!slots.some((label) => /1[45]:\d\d$/.test(label)));
    assert.ok(slots.includes('qui, 12/11 às 16:00'));
  });

  test('DST day: slots in the gap are skipped, the others keep their wall time', () => {
    const s = settings({
      timezone: 'America/New_York',
      minNoticeHours: 0,
      availability: { sun: [['01:00', '04:00']] },
    });
    const slots = generateSlots(s, { now: at('2026-03-07T12:00:00Z'), fromDay: '2026-03-08', days: 1, busy: [] });
    assert.deepEqual(
      slots.map((slot) => toLocalIso(slot.start, 'America/New_York')),
      [
        '2026-03-08T01:00:00-05:00',
        '2026-03-08T01:30:00-05:00',
        '2026-03-08T03:00:00-04:00',
        '2026-03-08T03:30:00-04:00',
      ],
    );
  });

  test('isBookableSlot only accepts exact free slots', () => {
    const s = settings();
    assert.equal(isBookableSlot(s, sp('2026-11-10T14:00'), 30, [], NOW), true);
    assert.equal(isBookableSlot(s, sp('2026-11-10T14:10'), 30, [], NOW), false);
    assert.equal(isBookableSlot(s, sp('2026-11-10T12:30'), 30, [], NOW), false);
    assert.equal(isBookableSlot(s, sp('2026-11-09T09:30'), 30, [], NOW), false);
  });

  test('input validation messages are in Portuguese', () => {
    const errors = validateAgendaInput({
      timezone: 'Mars/Base',
      availability: { mon: [['18:00', '09:00']] },
      appointmentTypes: [],
      notifyNumbers: ['123'],
      reminders: { hoursBefore: [100] },
    });
    assert.equal(errors.length, 5);
    assert.match(errors.join(' '), /Fuso horário inválido/);
    assert.match(errors.join(' '), /fim \(09:00\) precisa ser depois/);
  });
});

describe('agenda: reminder timing', () => {
  const keys = (list: any[]) => list.map((item) => `${item.key}@${toLocalIso(item.sendAt, SP).slice(0, 16)}`);

  test('normal appointment: 24 h and 2 h before', () => {
    assert.deepEqual(keys(planReminders(sp('2026-11-12T14:00'), [24, 2], SP)), [
      '24@2026-11-11T14:00',
      '2@2026-11-12T12:00',
    ]);
  });

  test('before 10:00: the quiet-hours reminder goes the evening before at 20:00', () => {
    assert.deepEqual(keys(planReminders(sp('2026-11-12T09:00'), [24, 2], SP)), [
      '24@2026-11-11T09:00',
      '2@2026-11-11T20:00',
    ]);
  });

  test('quiet hours otherwise move to 08:00, and close reminders are sent once', () => {
    assert.deepEqual(keys(planReminders(sp('2026-11-12T22:30'), [24], SP)), ['24@2026-11-12T08:00']);
    assert.deepEqual(keys(planReminders(sp('2026-11-12T10:30'), [2, 3], SP)), ['2@2026-11-12T08:30']);
  });

  test('reminders that would go out before the booking are dropped', () => {
    assert.deepEqual(keys(planReminders(sp('2026-11-10T14:00'), [24, 2], SP, sp('2026-11-09T20:00'))), [
      '2@2026-11-10T12:00',
    ]);
  });

  test('decision: send the latest due one, skip missed ones, wait in quiet hours, skip when too late', () => {
    const appointment = { startsAt: sp('2026-11-12T14:00'), createdAt: sp('2026-11-01T10:00') };
    assert.deepEqual(decideReminder(appointment, [24, 2], SP, {}, sp('2026-11-12T12:05')), {
      action: 'send',
      key: '2',
      skip: ['24'],
    });
    const wait = decideReminder(appointment, [24, 2], SP, {}, sp('2026-11-11T13:00'));
    assert.equal(wait.action, 'wait');
    assert.equal((wait as any).at.toISOString(), sp('2026-11-11T14:00').toISOString());
    assert.deepEqual(decideReminder(appointment, [24, 2], SP, { '24': {}, '2': {} }, sp('2026-11-12T12:05')), {
      action: 'wait',
      at: null,
    });
    const quiet = decideReminder(appointment, [24], SP, {}, sp('2026-11-11T22:00'));
    assert.equal(quiet.action, 'wait');
    assert.equal((quiet as any).at.toISOString(), sp('2026-11-12T08:00').toISOString());
    assert.deepEqual(decideReminder(appointment, [2], SP, {}, sp('2026-11-12T13:45')), { action: 'skip', skip: ['2'] });
  });

  test('reminder text follows the client-message policy', () => {
    const type = {
      name: 'Atendimento inicial',
      minutes: 30,
      mode: 'presencial' as const,
      location: 'Rua Fictícia, 100',
      instructions: 'RG e comprovante',
      active: true,
      maxPerDay: null,
      minNoticeHours: null,
    };
    const text = reminderText(
      { startsAt: sp('2026-11-12T14:00'), typeName: type.name, contactName: 'Maria Teste' },
      type,
      SP,
      true,
    );
    assert.match(text, /^Olá, Maria! Lembrete do seu Atendimento inicial: qui, 12\/11 às 14:00\./);
    assert.match(text, /Local: Rua Fictícia, 100/);
    assert.match(text, /O que levar: RG e comprovante/);
    assert.match(text, /Responda 1 para confirmar ou 2 para remarcar\/cancelar\./);
    assert.doesNotMatch(text, /R\$|valor|honorár/i);
    const confirmed = reminderText(
      { startsAt: sp('2026-11-12T14:00'), typeName: 'X', status: 'confirmado' },
      null,
      SP,
      true,
    );
    assert.match(confirmed, /Se precisar remarcar ou cancelar, responda 2\./);
  });

  test('reply parsing', () => {
    for (const text of ['1', ' 1. ', '1️⃣', 'Confirmo!', 'sim', 'confirmado'])
      assert.equal(parseReminderReply(text), 'confirm', text);
    for (const text of ['2', 'Remarcar', 'quero cancelar']) assert.equal(parseReminderReply(text), 'change', text);
    for (const text of ['10', 'quero saber o endereço', '', 'sim, mas posso levar meu filho?']) {
      assert.equal(parseReminderReply(text), null, text);
    }
  });
});

describe('agenda: iCalendar', () => {
  test('RFC 5545 format: CRLF, escaping, folding and status', () => {
    const ics = buildIcs({
      name: 'Agenda escritorio',
      timeZone: SP,
      now: NOW,
      events: [
        {
          uid: 'ap1@whatsai',
          start: at('2026-11-12T17:00:00Z'),
          end: at('2026-11-12T17:30:00Z'),
          summary: 'Atendimento inicial — Maria T.',
          description: 'Cliente: Maria Teste\nWhatsApp: +5511999990000',
          location: 'Rua Fictícia, 100; sala 2',
          status: 'TENTATIVE',
        },
        { uid: 'ap2@whatsai', start: NOW, end: NOW, summary: 'x', status: 'CANCELLED' },
      ],
    });
    assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
    assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
    assert.equal(ics.match(/BEGIN:VEVENT/g)?.length, 2);
    assert.match(ics, /DTSTART:20261112T170000Z\r\n/);
    assert.match(ics, /LOCATION:Rua Fictícia\\, 100\\; sala 2/);
    assert.match(ics, /DESCRIPTION:Cliente: Maria Teste\\nWhatsApp/);
    assert.match(ics, /STATUS:CANCELLED/);
    assert.ok(ics.split('\r\n').every((line) => Buffer.byteLength(line) <= 75));
    const folded = icsFold('DESCRIPTION:' + 'á'.repeat(80));
    assert.ok(folded.split('\r\n').every((line) => Buffer.byteLength(line) <= 75));
    assert.equal(folded.replace(/\r\n /g, ''), 'DESCRIPTION:' + 'á'.repeat(80));
  });
});

// -------------------------------------------------------------------------------------------- service

function service(now = NOW, patch: Record<string, any> = {}) {
  let clock = now.getTime();
  const prisma = createAgendaTables(undefined, () => clock);
  const sent: { jid: string; text: string }[] = [];
  const agenda = new AgendaService(prisma, undefined, {
    now: () => clock,
    cacheTtlMs: 0,
    sendText: async (_id, jid, text) => {
      sent.push({ jid, text });
      return true;
    },
  });
  const ready = agenda.saveSettings('inst-a', {
    enabled: true,
    notifyNumbers: ['5511900001111'],
    appointmentTypes: [{ name: 'Atendimento inicial', minutes: 30, mode: 'presencial', location: 'Rua Fictícia, 100' }],
    ...patch,
  });
  return { prisma, agenda, sent, ready, setNow: (date: Date) => (clock = date.getTime()) };
}

const CLIENT = '5511988887777@s.whatsapp.net';
const OTHER = '5511977776666@s.whatsapp.net';

describe('agenda: service', () => {
  test('booking is idempotent per contact + start and blocks overlaps', async () => {
    const { agenda, sent, ready } = service();
    await ready;
    const input = {
      remoteJid: CLIENT,
      startsAt: sp('2026-11-10T14:00'),
      source: 'ia' as const,
      enforceAvailability: true,
    };
    const first = await agenda.createAppointment('inst-a', input);
    const again = await agenda.createAppointment('inst-a', input);
    assert.equal(first.created, true);
    assert.equal(again.created, false);
    assert.equal(again.appointment.id, first.appointment.id);
    await assert.rejects(
      agenda.createAppointment('inst-a', { ...input, remoteJid: OTHER }),
      (error: any) => error.code === 'conflict',
    );
    // Manual booking outside the availability is allowed, but never on top of another one
    await assert.rejects(
      agenda.createAppointment('inst-a', {
        remoteJid: OTHER,
        startsAt: sp('2026-11-10T14:15'),
        source: 'manual',
        enforceAvailability: false,
      }),
      AgendaError,
    );
    const evening = await agenda.createAppointment('inst-a', {
      remoteJid: OTHER,
      startsAt: sp('2026-11-10T19:00'),
      source: 'manual',
      enforceAvailability: false,
      notifyClient: true,
    });
    assert.equal(evening.created, true);
    // Team notified about the AI booking only (the panel booking was made by the team); client got the confirmation
    assert.equal(sent.filter((item) => item.jid === '5511900001111@s.whatsapp.net').length, 1);
    assert.match(
      sent.find((item) => item.jid === OTHER)!.text,
      /Seu agendamento está marcado: Atendimento inicial, ter, 10\/11 às 19:00\.\nLocal: Rua Fictícia, 100/,
    );
  });

  test('two concurrent bookings of the same slot: exactly one wins', async () => {
    const { agenda, ready } = service();
    await ready;
    const start = sp('2026-11-11T15:00');
    const results = await Promise.allSettled([
      agenda.createAppointment('inst-a', {
        remoteJid: CLIENT,
        startsAt: start,
        source: 'ia',
        enforceAvailability: true,
      }),
      agenda.createAppointment('inst-a', {
        remoteJid: OTHER,
        startsAt: start,
        source: 'ia',
        enforceAvailability: true,
      }),
    ]);
    assert.deepEqual(results.map((result) => result.status).sort(), ['fulfilled', 'rejected']);
  });

  test('the AI may hold at most 2 future appointments per contact', async () => {
    const { agenda, ready } = service();
    await ready;
    for (const time of ['2026-11-10T14:00', '2026-11-10T15:00']) {
      await agenda.createAppointment('inst-a', {
        remoteJid: CLIENT,
        startsAt: sp(time),
        source: 'ia',
        enforceAvailability: true,
      });
    }
    await assert.rejects(
      agenda.createAppointment('inst-a', {
        remoteJid: CLIENT,
        startsAt: sp('2026-11-10T16:00'),
        source: 'ia',
        enforceAvailability: true,
      }),
      (error: any) => error.code === 'forbidden',
    );
  });

  test('tipos (Cal.com): limite por dia, antecedência própria e tipo pausado só para a IA', async () => {
    const { agenda, ready } = service(sp('2026-11-09T08:00'), {
      appointmentTypes: [
        { name: 'Consulta', minutes: 30, mode: 'presencial', maxPerDay: 1 },
        { name: 'Retorno', minutes: 30, mode: 'presencial', minNoticeHours: 48 },
        { name: 'Visita', minutes: 30, mode: 'presencial', active: false },
      ],
    });
    await ready;
    const settings = await agenda.getSettings('inst-a');
    assert.deepEqual(
      settings.appointmentTypes.map((t) => [t.name, t.active, t.maxPerDay, t.minNoticeHours]),
      [
        ['Consulta', true, 1, null],
        ['Retorno', true, null, 48],
        ['Visita', false, null, null],
      ],
    );
    await agenda.createAppointment('inst-a', {
      remoteJid: CLIENT,
      typeName: 'Consulta',
      startsAt: sp('2026-11-10T09:00'),
      source: 'ia',
    });
    const day = (await agenda.freeSlots('inst-a', { fromDay: '2026-11-10', days: 1, typeName: 'Consulta' })).slots;
    assert.equal(day.length, 0, 'Consulta: limite de 1 por dia já atingido no dia 10');
    const next = (await agenda.freeSlots('inst-a', { fromDay: '2026-11-11', days: 1, typeName: 'Consulta' })).slots;
    assert.ok(next.length > 0, 'no dia seguinte volta a ter horário');
    await assert.rejects(
      agenda.createAppointment('inst-a', {
        remoteJid: '5511900002222@s.whatsapp.net',
        typeName: 'Consulta',
        startsAt: sp('2026-11-10T15:00'),
        source: 'ia',
      }),
      /não está disponível/,
    );
    const retorno = (await agenda.freeSlots('inst-a', { fromDay: '2026-11-10', days: 3, typeName: 'Retorno' })).slots;
    assert.ok(
      retorno.every((slot) => +new Date(slot.startsAt) >= +sp('2026-11-11T08:00')),
      'Retorno: 48 h de antecedência',
    );
    await assert.rejects(
      agenda.createAppointment('inst-a', {
        remoteJid: CLIENT,
        typeName: 'Visita',
        startsAt: sp('2026-11-12T10:00'),
        source: 'ia',
      }),
      /pausado/,
    );
    const manual = await agenda.createAppointment('inst-a', {
      remoteJid: CLIENT,
      typeName: 'Visita',
      startsAt: sp('2026-11-12T10:00'),
      source: 'manual',
      enforceAvailability: false,
    });
    assert.equal(manual.created, true, 'a equipe ainda agenda um tipo pausado');
  });

  test('cancelar com motivo: o motivo vai para as observações internas', async () => {
    const { agenda, ready, prisma } = service(sp('2026-11-09T08:00'));
    await ready;
    const { appointment } = await agenda.createAppointment('inst-a', {
      remoteJid: CLIENT,
      startsAt: sp('2026-11-10T09:00'),
      source: 'manual',
      notes: 'Trazer RG',
      enforceAvailability: false,
    });
    await agenda.cancelAppointment('inst-a', appointment.id, { reason: 'Cliente pediu outra data' });
    const row = prisma.appointment.rows.get(appointment.id);
    assert.equal(row.status, 'cancelado');
    assert.equal(row.notes, 'Trazer RG\nMotivo do cancelamento: Cliente pediu outra data');
  });

  test('ticker: sends due reminders once, then "1" confirms', async () => {
    const { agenda, sent, ready, setNow, prisma } = service(sp('2026-11-01T10:00'));
    await ready;
    const { appointment } = await agenda.createAppointment('inst-a', {
      remoteJid: CLIENT,
      contactName: 'Maria Teste',
      startsAt: sp('2026-11-12T14:00'),
      source: 'manual',
      enforceAvailability: false,
    });

    setNow(sp('2026-11-11T14:01'));
    const first = await agenda.tick();
    assert.equal((first as any).sent, 1);
    const reminder = sent.find((item) => item.jid === CLIENT && /Lembrete/.test(item.text));
    assert.ok(reminder);
    assert.match(reminder!.text, /Responda 1 para confirmar ou 2 para remarcar\/cancelar\./);
    assert.equal(((await agenda.tick()) as any).sent, 0);

    // Not a reply: clears the wait, the AI answers as usual
    assert.equal(await agenda.handleReminderReply('inst-a', [CLIENT], 'Qual é o endereço?'), null);
    assert.equal(await agenda.handleReminderReply('inst-a', [CLIENT], '1'), null);

    setNow(sp('2026-11-12T12:00'));
    assert.equal(((await agenda.tick()) as any).sent, 1);
    const reply = await agenda.handleReminderReply('inst-a', [CLIENT], '1');
    assert.match(reply!.reply!, /está confirmado/);
    const row = prisma.appointment.rows.get(appointment.id);
    assert.equal(row.status, 'confirmado');
    assert.equal(row.awaitingReplyAt, null);
    assert.deepEqual(Object.keys(row.remindersSent).sort(), ['2', '24']);
  });

  test('"2" after a reminder: note for the AI when allowed, otherwise acknowledgment + team notice', async () => {
    const { agenda, sent, ready, setNow } = service(sp('2026-11-01T10:00'));
    await ready;
    await agenda.createAppointment('inst-a', {
      remoteJid: CLIENT,
      startsAt: sp('2026-11-12T14:00'),
      source: 'manual',
      enforceAvailability: false,
    });
    setNow(sp('2026-11-11T14:05'));
    await agenda.tick();
    const withAi = await agenda.handleReminderReply('inst-a', [CLIENT], '2');
    assert.match(withAi!.note!, /quer remarcar ou cancelar/);
    assert.match(withAi!.fallback!, /A equipe vai falar com você/);

    await agenda.saveSettings('inst-a', { aiPermissions: { allowCancel: false, allowReschedule: false } });
    setNow(sp('2026-11-12T12:01'));
    await agenda.tick();
    const noAi = await agenda.handleReminderReply('inst-a', [CLIENT], 'quero remarcar');
    assert.match(noAi!.reply!, /A equipe vai falar com você/);
    assert.ok(
      sent.some((item) => item.jid === '5511900001111@s.whatsapp.net' && /pediu para remarcar/.test(item.text)),
    );
  });

  test('agenda off: no reply handling, no reminders', async () => {
    const { agenda, sent, ready, setNow } = service(sp('2026-11-01T10:00'), { enabled: false });
    await ready;
    await agenda.createAppointment('inst-a', {
      remoteJid: CLIENT,
      startsAt: sp('2026-11-12T14:00'),
      source: 'manual',
      enforceAvailability: false,
    });
    setNow(sp('2026-11-11T14:05'));
    assert.equal(((await agenda.tick()) as any).sent, 0);
    assert.equal(await agenda.handleReminderReply('inst-a', [CLIENT], '1'), null);
    assert.equal(sent.length, 0);
  });

  test('settings: defaults off, validation, ICS token and feed without notes', async () => {
    const prisma = createAgendaTables();
    const agenda = new AgendaService(prisma, undefined, { now: () => NOW.getTime(), cacheTtlMs: 0 });
    assert.equal((await agenda.getSettings('inst-a')).enabled, false);
    await assert.rejects(
      agenda.saveSettings('inst-a', { enabled: true, availability: { mon: [], tue: [], wed: [], thu: [], fri: [] } }),
      /pelo menos um horário/,
    );
    await agenda.saveSettings('inst-a', { enabled: true });
    const token = await agenda.regenerateIcsToken('inst-a');
    assert.match(token, /^[a-f0-9]{48}$/);
    await agenda.createAppointment('inst-a', {
      remoteJid: CLIENT,
      contactName: 'Maria Teste',
      startsAt: sp('2026-11-12T14:00'),
      notes: 'Sigilo: assunto do processo',
      source: 'manual',
      enforceAvailability: false,
    });
    const ics = await agenda.icsByToken(token);
    assert.match(ics!, /SUMMARY:Atendimento inicial — Maria T\./);
    assert.doesNotMatch(ics!, /Sigilo/);
    assert.equal(await agenda.icsByToken('0'.repeat(48)), null);
    assert.equal(await agenda.icsByToken('../etc'), null);
  });
});

// ----------------------------------------------------------------------------------------- AI tools

describe('agenda: AI tools and the bounded loop', () => {
  const call = (name: string, args: any, id = name) => ({
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  });
  const toolReply = (...calls: any[]) => ({
    choices: [{ message: { role: 'assistant', content: null, tool_calls: calls } }],
  });
  const textReply = (content: string) => ({
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
  });

  test('tools follow the AI permissions', () => {
    const names = (patch: any) => agendaTools(settings({ aiPermissions: patch })).map((tool) => tool.function.name);
    assert.deepEqual(names({}), ['consultar_horarios', 'meus_agendamentos', 'agendar', 'remarcar', 'cancelar']);
    assert.deepEqual(names({ allowBook: false, allowCancel: false, allowReschedule: false }), [
      'consultar_horarios',
      'meus_agendamentos',
    ]);
  });

  test('no context when the agenda is off, for groups or for models without tools', async () => {
    const { agenda, ready } = service(NOW, { enabled: false });
    await ready;
    assert.equal(await buildAgendaContext(agenda, 'inst-a', CLIENT), null);
    assert.equal(await buildAgendaContext(undefined, 'inst-a', CLIENT), null);
    await agenda.saveSettings('inst-a', { enabled: true });
    assert.equal(await buildAgendaContext(agenda, 'inst-a', '1203630@g.us'), null);
    assert.ok(await buildAgendaContext(agenda, 'inst-a', CLIENT));
  });

  test('loop: consult, book (server re-validates), then text; at most 3 rounds', async () => {
    const { agenda, ready, prisma } = service();
    await ready;
    const ctx = (await buildAgendaContext(agenda, 'inst-a', CLIENT, { pushName: 'Maria' }))!;
    assert.match(ctx.systemPrompt, /Agora: seg, 09\/11\/2026 às 09:00/);
    assert.match(ctx.systemPrompt, /confirme com o cliente o dia, a hora e o tipo/);

    const requests: any[] = [];
    let consulted: any;
    const answers = [
      toolReply(call('consultar_horarios', { data_inicio: '2026-11-10', dias: 1 })),
      (messages: any[]) => {
        consulted = JSON.parse(messages[messages.length - 1].content);
        // The model tries a time that is not a slot first, then the real one
        return toolReply(
          call('agendar', { inicio_iso: '2026-11-10T14:10:00-03:00' }, 'bad'),
          call('agendar', { inicio_iso: consulted.horarios[0].inicio_iso, nome: 'Maria Teste' }, 'good'),
        );
      },
      textReply('Pronto! Marcado para ter, 10/11 às 09:00.'),
    ];
    const { completion, rounds, calls } = await runToolLoop(
      [{ role: 'user', content: 'quero marcar amanhã' }],
      ctx,
      async (messages, extra) => {
        requests.push({ messages: structuredClone(messages), extra });
        const next = answers.shift() as any;
        return typeof next === 'function' ? next(messages) : next;
      },
    );
    assert.equal(rounds, 2);
    assert.deepEqual(calls, ['consultar_horarios', 'agendar', 'agendar']);
    assert.equal(completion.choices[0].message.content, 'Pronto! Marcado para ter, 10/11 às 09:00.');
    assert.equal(consulted.horarios.length, 6);
    assert.equal(consulted.horarios[0].quando, 'ter, 10/11 às 09:00');
    const results = requests[2].messages.filter((m: any) => m.role === 'tool').map((m: any) => JSON.parse(m.content));
    assert.equal(results[1].erro, 'horario_indisponivel');
    assert.ok(Array.isArray(results[1].proximos));
    assert.equal(results[2].ok, true);
    assert.equal(results[2].local_ou_link, 'Rua Fictícia, 100');
    assert.equal([...prisma.appointment.rows.values()].length, 1);
    assert.equal([...prisma.appointment.rows.values()][0].source, 'ia');

    // A model that keeps calling tools is cut after MAX_TOOL_ROUNDS; the last call forbids tools
    const extras: any[] = [];
    const loop = await runToolLoop([{ role: 'user', content: 'x' }], ctx, async (_m, extra) => {
      extras.push(extra.tool_choice);
      return toolReply(call('meus_agendamentos', {}));
    });
    assert.equal(loop.rounds, MAX_TOOL_ROUNDS);
    assert.deepEqual(extras, ['auto', 'auto', 'auto', 'none']);
  });

  test('a contact only sees and changes their own appointments', async () => {
    const { agenda, ready } = service();
    await ready;
    const other = await agenda.createAppointment('inst-a', {
      remoteJid: OTHER,
      startsAt: sp('2026-11-10T15:00'),
      source: 'manual',
      enforceAvailability: false,
    });
    const ctx = (await buildAgendaContext(agenda, 'inst-a', CLIENT))!;
    assert.deepEqual(await ctx.execute('meus_agendamentos', {}), { ok: true, agendamentos: [] });
    const cancel = await ctx.execute('cancelar', { agendamento: other.appointment.id });
    assert.equal(cancel.erro, 'nao_encontrado');
    const move = await ctx.execute('remarcar', {
      agendamento: other.appointment.id,
      novo_inicio_iso: '2026-11-10T16:00',
    });
    assert.equal(move.erro, 'nao_encontrado');

    const mine = await ctx.execute('agendar', { inicio_iso: '2026-11-11T10:00', tipo: 'atendimento inicial' });
    assert.equal(mine.ok, true);
    const moved = await ctx.execute('remarcar', { agendamento: 'proximo', novo_inicio_iso: '2026-11-11T11:00' });
    assert.equal(moved.quando, 'qua, 11/11 às 11:00');
    const cancelled = await ctx.execute('cancelar', { agendamento: 'proximo' });
    assert.equal(cancelled.ok, true);
  });

  test('tools-unsupported errors are recognized', () => {
    assert.equal(
      isToolsUnsupportedError({
        status: 400,
        message: "Unsupported parameter: 'tools' is not supported with this model.",
      }),
      true,
    );
    assert.equal(isToolsUnsupportedError({ status: 400, message: 'Invalid image' }), false);
    assert.equal(isToolsUnsupportedError({ status: 500, message: 'tools not supported' }), false);
  });
});

// ------------------------------------------------------------------- permissions and provider (server side)

describe('agenda: permission flags are enforced in the tool handlers', () => {
  test('a tool that is off is neither offered nor executed, even if the model calls it', async () => {
    const { agenda, ready, prisma } = service(NOW, {
      aiPermissions: { allowBook: false, allowReschedule: false, allowCancel: false },
    });
    await ready;
    const ctx = (await buildAgendaContext(agenda, 'inst-a', CLIENT))!;
    assert.deepEqual(
      ctx.tools.map((tool) => tool.function.name),
      ['consultar_horarios', 'meus_agendamentos'],
    );
    assert.match(ctx.systemPrompt, /NÃO pode marcar/);
    const booked = await ctx.execute('agendar', { inicio_iso: '2026-11-10T14:00' });
    assert.equal(booked.erro, 'sem_permissao');
    assert.equal(prisma.appointment.rows.size, 0);

    const own = await agenda.createAppointment('inst-a', {
      remoteJid: CLIENT,
      startsAt: sp('2026-11-10T15:00'),
      source: 'manual',
      enforceAvailability: false,
    });
    assert.equal(
      (await ctx.execute('remarcar', { agendamento: 'proximo', novo_inicio_iso: '2026-11-10T16:00' })).erro,
      'sem_permissao',
    );
    assert.equal((await ctx.execute('cancelar', { agendamento: own.appointment.id })).erro, 'sem_permissao');
    assert.equal(prisma.appointment.rows.get(own.appointment.id).status, 'agendado');
  });

  test('requireTeamApproval: the AI creates "pendente", no reminder, the team approves and the client is told', async () => {
    const { agenda, ready, prisma, sent, setNow } = service(sp('2026-11-01T10:00'), {
      aiPermissions: { requireTeamApproval: true },
    });
    await ready;
    const ctx = (await buildAgendaContext(agenda, 'inst-a', CLIENT))!;
    assert.match(ctx.systemPrompt, /PENDENTE até a equipe aprovar/);
    const result = await ctx.execute('agendar', { inicio_iso: '2026-11-12T14:00' });
    assert.equal(result.pendente_aprovacao, true);
    const row = [...prisma.appointment.rows.values()][0];
    assert.equal(row.status, 'pendente');
    assert.ok(sent.some((item) => /aguarda aprovação/.test(item.text)));
    // The pending request holds the slot
    await assert.rejects(
      agenda.createAppointment('inst-a', {
        remoteJid: OTHER,
        startsAt: sp('2026-11-12T14:00'),
        source: 'ia',
        enforceAvailability: true,
      }),
      (error: any) => error.code === 'conflict',
    );
    setNow(sp('2026-11-11T14:05'));
    assert.equal(((await agenda.tick()) as any).sent, 0);

    const before = sent.length;
    await agenda.updateAppointment('inst-a', row.id, { status: 'agendado', notifyClient: true });
    assert.match(sent[before].text, /Seu agendamento está marcado/);
    assert.equal(sent[before].jid, CLIENT);
  });

  test('showOtherEventDetails: off = only free slots; on = time and type of others, never names or numbers', async () => {
    const { agenda, ready } = service();
    await ready;
    await agenda.createAppointment('inst-a', {
      remoteJid: OTHER,
      contactName: 'Pessoa Sigilosa',
      startsAt: sp('2026-11-10T10:00'),
      notes: 'assunto confidencial',
      source: 'manual',
      enforceAvailability: false,
    });
    const off = (await buildAgendaContext(agenda, 'inst-a', CLIENT))!;
    const hidden = JSON.stringify(await off.execute('consultar_horarios', { data_inicio: '2026-11-10', dias: 1 }));
    assert.doesNotMatch(hidden, /ocupados|Sigilosa|confidencial|77776666/);

    await agenda.saveSettings('inst-a', { aiPermissions: { showOtherEventDetails: true } });
    const on = (await buildAgendaContext(agenda, 'inst-a', CLIENT))!;
    const shown = await on.execute('consultar_horarios', { data_inicio: '2026-11-10', dias: 1 });
    assert.deepEqual(shown.ocupados, [{ quando: 'ter, 10/11 às 10:00', tipo: 'Atendimento inicial' }]);
    assert.doesNotMatch(JSON.stringify(shown), /Sigilosa|confidencial|77776666/);
  });

  test('onlyOwnAppointments cannot be turned off; unknown providers are refused; a custom provider is used', async () => {
    const { agenda, ready } = service();
    await ready;
    await assert.rejects(
      agenda.saveSettings('inst-a', { aiPermissions: { onlyOwnAppointments: false } }),
      /não pode ser desligado/,
    );
    assert.equal(
      normalizeAgendaSettings({ aiPermissions: { onlyOwnAppointments: false } }).aiPermissions.onlyOwnAppointments,
      true,
    );
    await assert.rejects(agenda.saveSettings('inst-a', { provider: 'google' }), /Provedor de agenda indisponível/);

    const prisma = createAgendaTables();
    const calls: string[] = [];
    const internal = new InternalAgendaProvider(prisma);
    const spy: any = {
      name: 'internal',
      getBusy: (...args: any[]) => (calls.push('getBusy'), (internal.getBusy as any)(...args)),
      createEvent: (...args: any[]) => (calls.push('createEvent'), (internal.createEvent as any)(...args)),
      updateEvent: (...args: any[]) => (calls.push('updateEvent'), (internal.updateEvent as any)(...args)),
      cancelEvent: (...args: any[]) => (calls.push('cancelEvent'), (internal.cancelEvent as any)(...args)),
      listOwnEvents: (...args: any[]) => (calls.push('listOwnEvents'), (internal.listOwnEvents as any)(...args)),
    };
    const custom = new AgendaService(prisma, undefined, {
      now: () => NOW.getTime(),
      cacheTtlMs: 0,
      providers: { internal: spy },
    });
    await custom.saveSettings('inst-a', { enabled: true });
    const { appointment } = await custom.createAppointment('inst-a', {
      remoteJid: CLIENT,
      startsAt: sp('2026-11-10T14:00'),
      source: 'ia',
      enforceAvailability: true,
    });
    await custom.listOwnAppointments('inst-a', [CLIENT]);
    await custom.cancelAppointment('inst-a', appointment.id);
    assert.deepEqual([...new Set(calls)].sort(), ['cancelEvent', 'createEvent', 'getBusy', 'listOwnEvents']);
  });
});
