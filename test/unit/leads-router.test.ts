import '../helpers/setup';
// Loads the routers graph before abstract.router (as the app does), see router-instance-scope.test.ts
import '@exceptions';

import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';

import { LeadsRouter } from '@api/routes/leads.router';
import express from 'express';
import { Server } from 'http';

import { serverModuleOverrides } from '../helpers/chatbot-emit';

describe('LeadsRouter: paths, order and the CSV download', () => {
  const calls: any[] = [];
  let server: Server;
  let base: string;

  before(async () => {
    const record =
      (name: string, result: any = {}) =>
      async (...args: any[]) => {
        calls.push({ name, args });
        return result;
      };
    serverModuleOverrides.leadsController = {
      list: record('list', { leads: [] }),
      get: record('get', { lead: { id: 'x' } }),
      update: record('update', { lead: { id: 'x' } }),
      exportCsv: record('exportCsv', { name: 'Escritório Fictício', csv: '\uFEFFNome;Telefone\r\n' }),
      getSettings: record('getSettings'),
      saveSettings: record('saveSettings'),
      backfill: record('backfill', { started: true }),
      backfillStatus: record('backfillStatus', { running: false }),
    };
    const app = express();
    app.use(express.json());
    app.use('/leads', new LeadsRouter().router);
    app.use((error: any, _req: any, res: any, _next: any) => {
      void _next;
      res.status(error?.status ?? 500).json(error);
    });
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/leads`;
  });

  after(() => {
    delete serverModuleOverrides.leadsController;
    server.close();
  });

  const last = () => calls[calls.length - 1];

  test('settings and backfill are not read as a lead id', async () => {
    await fetch(`${base}/settings/escritorio`);
    assert.equal(last().name, 'getSettings');
    assert.equal(last().args[0].instanceName, 'escritorio');

    const started = await fetch(`${base}/backfill/escritorio`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ days: 30, max: 50 }),
    });
    assert.equal(started.status, 201);
    assert.equal(last().name, 'backfill');

    const invalid = await fetch(`${base}/backfill/escritorio`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ days: 90 }),
    });
    assert.equal(invalid.status, 400);
  });

  test('list, one lead and the edit; the query never swaps the instance', async () => {
    await fetch(`${base}/escritorio?status=novo&instanceName=outra`);
    assert.equal(last().name, 'list');
    assert.equal(last().args[0].instanceName, 'escritorio');
    assert.deepEqual(last().args[1], { status: 'novo' });

    await fetch(`${base}/escritorio/lead-1`);
    assert.deepEqual([last().name, last().args[1]], ['get', 'lead-1']);

    await fetch(`${base}/escritorio/lead-1`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'cliente' }),
    });
    assert.equal(last().name, 'update');
    assert.equal(last().args[1], 'lead-1');
    assert.equal(last().args[2].status, 'cliente');
  });

  test('export.csv is a download with a safe file name', async () => {
    const response = await fetch(`${base}/escritorio/export.csv?status=cliente`);
    assert.equal(last().name, 'exportCsv');
    assert.equal(response.headers.get('content-type'), 'text/csv; charset=utf-8');
    assert.match(
      response.headers.get('content-disposition') ?? '',
      /^attachment; filename="leads-Escrit-rio-Fict-cio-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM');
  });
});
