import '../helpers/setup';
import '@exceptions';

import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';

import { AuditRouter } from '@api/routes/audit.router';
import express from 'express';

import { serverModuleOverrides } from '../helpers/chatbot-emit';

const seen: Record<string, unknown>[] = [];

const fakeService = {
  list: async (filters: Record<string, unknown>) => {
    seen.push(filters);
    return { total: 0, page: 1, pages: 1, items: [], actors: [], instances: [], types: [], retentionDays: 180 };
  },
  csv: async (filters: Record<string, unknown>) => {
    seen.push(filters);
    return String.fromCharCode(0xfeff) + '"Quando (UTC)";"Quem"\r\n';
  },
};

/** Stands in for adminOnlyGuard: the real guard is covered in team-access.test.ts and user-session.test.ts. */
const pass = (_req: any, _res: any, next: any) => next();

let server: any;
let base = '';

before(async () => {
  serverModuleOverrides.auditLogService = fakeService;
  const app = express();
  app.use('/admin/audit', new AuditRouter(pass).router);
  app.use((err: any, _req: any, res: any, _next: any) => {
    void _next;
    return res.status(err?.status || 500).json({ message: err?.message });
  });
  server = await new Promise<any>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server?.close();
  delete serverModuleOverrides.auditLogService;
});

describe('registro de ações HTTP', () => {
  test('GET /admin/audit passes the filters and answers the page', async () => {
    const res = await fetch(`${base}/admin/audit?instance=Loja&actor=Ana&type=ia&from=2026-11-01&to=2026-11-12&page=2`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body: any = await res.json();
    assert.equal(body.retentionDays, 180);
    const filters = seen[seen.length - 1];
    assert.equal(filters.instance, 'Loja');
    assert.equal(filters.actor, 'Ana');
    assert.equal(filters.type, 'ia');
    assert.equal(filters.from, '2026-11-01');
    assert.equal(filters.to, '2026-11-12');
    assert.equal(filters.page, '2');
  });

  test('GET /admin/audit/export.csv answers a spreadsheet with the same filters', async () => {
    const res = await fetch(`${base}/admin/audit/export.csv?instance=Loja`);
    assert.equal(res.status, 200);
    assert.match(String(res.headers.get('content-type')), /text\/csv/);
    assert.match(String(res.headers.get('content-disposition')), /registro-de-acoes\.csv/);
    const text = await res.text();
    assert.ok(text.startsWith(String.fromCharCode(0xfeff) + '"Quando (UTC)"'));
    assert.equal(seen[seen.length - 1].instance, 'Loja');
  });
});
