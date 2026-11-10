import '../helpers/setup';

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { AgendaService } from '@api/services/agenda.service';

import { texts } from '../helpers/fakes';
import { OpenaiHarness, SKIP_INTEGRATION } from '../helpers/integration';

const ALWAYS = Object.fromEntries(
  ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((day) => [day, [['00:00', '24:00']]]),
);
const HOUR = 3_600_000;

/**
 * "Agenda" on a real PostgreSQL: the migration, timestamptz/jsonb round-trips, the transactional overlap check
 * under real concurrency (row lock on AgendaSettings), idempotent bookings, reminders and the ICS token.
 */
describe('agenda (integration)', { skip: SKIP_INTEGRATION }, () => {
  let h: OpenaiHarness;
  let instanceId: string;
  let wa: any;

  before(async () => {
    h = await new OpenaiHarness().start();
    const tenant = await h.createTenant();
    instanceId = tenant.instance.instanceId;
    wa = tenant.wa;
    wa.connectionStatus = { state: 'open' };
  });

  after(async () => {
    await h?.stop();
  });

  const service = (now?: () => number) => new AgendaService(h.prisma, h.waMonitor, { cacheTtlMs: 0, now });

  test('settings: off by default, saved as jsonb, validated', async () => {
    const agenda = service();
    assert.equal((await agenda.getSettings(instanceId)).enabled, false);
    const { settings } = await agenda.saveSettings(instanceId, {
      enabled: true,
      minNoticeHours: 0,
      availability: ALWAYS,
      appointmentTypes: [
        { name: 'Atendimento inicial', minutes: 60, mode: 'online', location: 'https://meet.example.test/sala' },
      ],
    });
    assert.equal(settings.enabled, true);
    const row = await h.prisma.agendaSettings.findUnique({ where: { instanceId } });
    assert.equal((row.appointmentTypes as any)[0].minutes, 60);
    await assert.rejects(agenda.saveSettings(instanceId, { timezone: 'Nowhere/City' }), /Fuso horário inválido/);
  });

  test('concurrent bookings of one slot: exactly one row; same contact twice: idempotent', async () => {
    const agenda = service();
    const { slots } = await agenda.freeSlots(instanceId, { days: 2, limit: 3 });
    const start = new Date(slots[1].startsAt);
    const contacts = ['5511911110001', '5511911110002', '5511911110003', '5511911110004', '5511911110005'];
    const results = await Promise.allSettled(
      contacts.map((digits) =>
        agenda.createAppointment(instanceId, {
          remoteJid: `${digits}@s.whatsapp.net`,
          startsAt: start,
          source: 'ia',
          enforceAvailability: true,
        }),
      ),
    );
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(await h.prisma.appointment.count({ where: { instanceId, startsAt: start } }), 1);

    // 30 min later still overlaps the 60 min appointment
    await assert.rejects(
      agenda.createAppointment(instanceId, {
        remoteJid: '5511911110009@s.whatsapp.net',
        startsAt: new Date(start.getTime() + 30 * 60_000),
        source: 'manual',
        enforceAvailability: false,
      }),
      /Já existe um agendamento/,
    );

    const other = new Date(slots[2].startsAt.valueOf());
    const twice = await Promise.all([
      agenda.createAppointment(instanceId, {
        remoteJid: '5511922220000@s.whatsapp.net',
        startsAt: new Date(other.getTime() + 2 * HOUR),
        source: 'mcp',
        enforceAvailability: false,
      }),
      agenda.createAppointment(instanceId, {
        remoteJid: '5511922220000@s.whatsapp.net',
        startsAt: new Date(other.getTime() + 2 * HOUR),
        source: 'mcp',
        enforceAvailability: false,
      }),
    ]);
    assert.equal(twice[0].appointment.id, twice[1].appointment.id);
    assert.deepEqual(twice.map((item) => item.created).sort(), [false, true]);
  });

  test('reminder: sent once through the channel, "1" confirms (timestamptz round-trip)', async () => {
    const start = new Date(Math.ceil((Date.now() + 30 * HOUR) / HOUR) * HOUR);
    const created = await service().createAppointment(instanceId, {
      remoteJid: '5511933330000@s.whatsapp.net',
      contactName: 'Maria Teste',
      startsAt: start,
      source: 'manual',
      enforceAvailability: false,
    });
    const stored = await h.prisma.appointment.findUnique({ where: { id: created.appointment.id } });
    assert.equal(new Date(stored.startsAt).toISOString(), start.toISOString());

    // 24 h before (shifted out of the quiet hours when needed), the reminder is due
    const sentBefore = texts(wa).length;
    let clock = start.getTime() - 24 * HOUR + 60_000;
    const later = service(() => clock);
    let sent = 0;
    for (let step = 0; step < 30 && sent === 0; step++) {
      sent = ((await later.tick()) as any).sent ?? 0;
      if (!sent) clock += HOUR;
    }
    assert.equal(sent, 1);
    assert.equal(texts(wa).length, sentBefore + 1);
    assert.match(texts(wa).at(-1), /Lembrete do seu Atendimento inicial/);
    assert.equal(((await later.tick()) as any).sent, 0);

    const row = await h.prisma.appointment.findUnique({ where: { id: created.appointment.id } });
    assert.ok(row.awaitingReplyAt);
    const reply = await later.handleReminderReply(instanceId, ['5511933330000@s.whatsapp.net'], 'confirmo');
    assert.match(reply.reply, /está confirmado/);
    const confirmed = await h.prisma.appointment.findUnique({ where: { id: created.appointment.id } });
    assert.equal(confirmed.status, 'confirmado');
  });

  test('ICS by token, regenerated token invalidates the old URL', async () => {
    const agenda = service();
    const first = await agenda.regenerateIcsToken(instanceId);
    assert.match(await agenda.icsByToken(first), /BEGIN:VCALENDAR[\s\S]*BEGIN:VEVENT/);
    const second = await agenda.regenerateIcsToken(instanceId);
    assert.equal(await agenda.icsByToken(first), null);
    assert.ok(await agenda.icsByToken(second));
  });
});
