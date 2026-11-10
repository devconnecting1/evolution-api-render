import '../helpers/setup';
// Loads the routers graph before abstract.router, as the app does (see router-instance-scope.test.ts)
import '@exceptions';

import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';

import { AgendaController } from '@api/controllers/agenda.controller';
import { AgendaRouter } from '@api/routes/agenda.router';
import { AgendaService } from '@api/services/agenda.service';
import express from 'express';
import { Server } from 'http';

import { createAgendaTables } from '../helpers/agenda-mock';
import { serverModuleOverrides } from '../helpers/chatbot-emit';

/** The REST routes of the Agenda on express (guards left out: the auth guards have their own tests). */
describe('agenda REST routes', () => {
  let server: Server;
  let url: string;
  let agenda: AgendaService;

  before(async () => {
    const prisma = createAgendaTables();
    agenda = new AgendaService(prisma, undefined, { cacheTtlMs: 0, sendText: async () => true });
    serverModuleOverrides.agendaService = agenda;
    serverModuleOverrides.agendaController = new AgendaController(agenda, prisma);
    const app = express();
    app.use(express.json());
    app.use('/agenda', new AgendaRouter().router);
    app.use((error: any, _req: any, res: any, _next: any) => {
      void _next;
      res.status(error?.status ?? 500).json({ status: error?.status ?? 500, response: { message: error?.message } });
    });
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/agenda`;
  });

  after(() => {
    server?.close();
    delete serverModuleOverrides.agendaService;
    delete serverModuleOverrides.agendaController;
  });

  const call = async (method: string, path: string, body?: any) => {
    const response = await fetch(url + path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      // ICS / plain text
    }
    return { status: response.status, json, text, type: response.headers.get('content-type') };
  };

  test('settings, create, list, slots, update, cancel and ICS by token', async () => {
    const always = Object.fromEntries(
      ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, [['00:00', '24:00']]]),
    );
    const saved = await call('POST', '/settings/escritorio', {
      enabled: true,
      availability: always,
      minNoticeHours: 0,
    });
    assert.equal(saved.status, 200, saved.text);
    assert.equal(saved.json.settings.enabled, true);

    const invalid = await call('POST', '/settings/escritorio', { slotMinutes: 1 });
    assert.equal(invalid.status, 400);
    assert.match(JSON.stringify(invalid.json), /slotMinutes/);

    const day = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const created = await call('POST', '/escritorio', {
      number: '5511988887777',
      contactName: 'Maria Teste',
      startsAt: `${day}T15:00`,
    });
    assert.equal(created.status, 201, created.text);
    const id = created.json.appointment.id;
    const again = await call('POST', '/escritorio', { number: '5511988887777', startsAt: `${day}T15:00` });
    assert.equal(again.status, 200);
    assert.equal(again.json.created, false);
    const clash = await call('POST', '/escritorio', { number: '5511977776666', startsAt: `${day}T15:15` });
    assert.equal(clash.status, 400);

    const list = await call('GET', `/escritorio?from=${day}`);
    assert.equal(list.json.appointments.length, 1);
    const byContact = await call('GET', `/escritorio?from=${day}&contact=5511977776666`);
    assert.equal(byContact.json.appointments.length, 0);

    const slots = await call('GET', `/escritorio/slots?from=${day}&days=1&limit=5`);
    assert.equal(slots.status, 200);
    assert.ok(!slots.json.slots.some((slot: any) => slot.label.endsWith('15:00')));

    const done = await call('PATCH', `/escritorio/${id}`, { status: 'confirmado', notes: 'interna' });
    assert.equal(done.json.appointment.status, 'confirmado');
    const bad = await call('PATCH', `/escritorio/${id}`, { status: 'perdido' });
    assert.equal(bad.status, 400);

    const token = await call('POST', '/settings/escritorio/ics-token');
    const ics = await call('GET', `/ics/${token.json.icsToken}.ics`);
    assert.equal(ics.status, 200);
    assert.match(ics.type ?? '', /text\/calendar/);
    assert.match(ics.text, /BEGIN:VEVENT/);
    assert.doesNotMatch(ics.text, /interna/);
    assert.equal((await call('GET', `/ics/${'0'.repeat(48)}.ics`)).status, 404);

    const cancelled = await call('DELETE', `/escritorio/${id}`);
    assert.equal(cancelled.json.appointment.status, 'cancelado');
    assert.equal((await call('PATCH', '/escritorio/nao-existe', { notes: 'x' })).status, 404);
  });
});
