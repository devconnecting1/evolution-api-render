import '../helpers/setup';
// Loads the routers graph before abstract.router (as the app does), see router-instance-scope.test.ts
import '@exceptions';

import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';

import { OverviewRouter } from '@api/routes/overview.router';
import express from 'express';
import { Server } from 'http';

import { serverModuleOverrides } from '../helpers/chatbot-emit';

describe('OverviewRouter: GET /overview/:instanceName', () => {
  const calls: any[] = [];
  let server: Server;
  let base: string;

  before(async () => {
    serverModuleOverrides.overviewController = {
      get: async (instance: any) => {
        calls.push(instance);
        return { instance: instance.instanceName, period: { days: instance.days ?? 7 } };
      },
    };
    const app = express();
    app.use(express.json());
    app.use('/overview', new OverviewRouter().router);
    app.use((error: any, _req: any, res: any, _next: any) => {
      void _next;
      res.status(error?.status ?? 500).json(error);
    });
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/overview`;
  });

  after(() => {
    delete serverModuleOverrides.overviewController;
    server.close();
  });

  test('the period goes in the query, as the panel sends it', async () => {
    const response = await fetch(`${base}/escritorio?days=30`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(calls[calls.length - 1].instanceName, 'escritorio');
    assert.equal(calls[calls.length - 1].days, '30');
    assert.equal(((await response.json()) as any).period.days, '30');

    await fetch(`${base}/escritorio`);
    assert.equal(calls[calls.length - 1].days, undefined, 'absent days: the service uses 7');
  });

  test('instanceName in the query is ignored: the path decides the tenant', async () => {
    await fetch(`${base}/escritorio?instanceName=outra`);
    assert.equal(calls[calls.length - 1].instanceName, 'escritorio');
    assert.equal(calls[calls.length - 1].outra, undefined);
  });
});
