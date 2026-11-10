import '../helpers/setup';

import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';

import { createMcpRouter } from '@api/integrations/mcp/mcp.router';
import { McpDeps } from '@api/integrations/mcp/mcp.types';
import express from 'express';
import { Server } from 'http';

const KEY = 'global-key-for-tests-only-0123456789';
const TJRJ = '0001234-04.2026.8.19.0001';

describe('Processos: MCP tools', () => {
  let server: Server;
  let url = '';
  const calls: any[] = [];

  const processRow = {
    id: 'p1',
    numeroCnj: TJRJ,
    tribunalAlias: 'tjrj',
    apelido: 'Silva x Banco Fictício',
    clientName: 'Maria Fictícia',
    classe: 'Procedimento Comum Cível',
    status: 'novidade',
    unseen: 1,
    active: true,
    lastMovement: { occurredAt: '2026-11-03T15:00:00.000Z', name: 'Juntada de Petição' },
  };

  before(async () => {
    const deps: McpDeps = {
      prisma: {
        instance: { findMany: async () => [{ id: 'inst-a', name: 'escritorio', clientName: 'evolution' }] },
      },
      waMonitor: { waInstances: {} },
      openaiController: {},
      sendMessageController: { sendText: async () => ({}) },
      observability: { getOverview: async () => ({}) },
      usage: {
        getLimits: async () => null,
        getSummary: async () => ({}),
        saveLimits: async () => ({ previous: null, limits: {} }),
      },
      leads: {
        list: async () => ({}),
        get: async () => null,
        update: async () => null,
        getStoredSettings: async () => ({ configured: false, settings: {} }),
        saveSettings: async () => ({ previous: null, settings: {} }),
      } as any,
      agenda: {
        getSettings: async () => null,
        today: () => '2026-11-10',
        listAppointments: async () => [],
        freeSlots: async () => [],
        createAppointment: async () => null,
        cancelAppointment: async () => null,
        saveSettings: async () => null,
      } as any,
      processos: {
        list: async (instanceId, filters) => {
          calls.push(['list', instanceId, filters]);
          return { items: [processRow], counts: { all: 1, news: 1, archived: 0, errors: 0, unseenPublications: 0 } };
        },
        get: async (instanceId, id) => {
          if (id !== 'p1') throw Object.assign(new Error('Processo não encontrado nesta instância.'), { status: 404 });
          return {
            ...processRow,
            remoteJid: null,
            notifyTeam: true,
            notifyClient: false,
            allowAiAnswer: false,
            segredoJustica: false,
            movements: [{ occurredAt: '2026-11-03T15:00:00.000Z', name: 'Juntada de Petição', seen: false }],
            publications: [],
          };
        },
        add: async (instanceId, input) => {
          calls.push(['add', instanceId, input]);
          return { id: 'p2', numeroCnj: TJRJ, tribunalAlias: 'tjrj' };
        },
        listPublications: async () => ({ total: 0, items: [] }),
        manualSync: async () => ({ result: { ok: true, created: 0 }, process: { ...processRow, movements: [] } }),
        getSettings: async () => ({
          configured: true,
          enabled: true,
          checkEveryHours: 6,
          djenDays: 7,
          notifyNumbers: [],
        }),
        saveSettings: async (instanceId, input) => {
          calls.push(['saveSettings', instanceId, input]);
          return { previous: { enabled: false }, settings: { enabled: true, ...input } };
        },
        listOab: async () => [{ id: 'o1', numeroOab: '123456', ufOab: 'RJ', label: null, active: true }],
        addOab: async (instanceId, input) => {
          calls.push(['addOab', instanceId, input]);
          return { id: 'o2', numeroOab: input.numeroOab, ufOab: input.ufOab, label: input.label ?? null };
        },
      },
      isBotMessageId: async () => false,
      logger: { error: () => undefined, warn: () => undefined },
      config: { apiKey: KEY, clientName: 'evolution', dbProvider: 'postgresql', docsDirs: [] },
    };
    const app = express();
    app.use(express.json());
    app.use(
      '/mcp',
      createMcpRouter(() => deps),
    );
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  });

  after(() => server?.close());

  let id = 1;
  const rpc = async (method: string, params: any) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${KEY}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params }),
    });
    return JSON.parse(await response.text());
  };
  const callTool = async (name: string, args: any) => {
    const body = await rpc('tools/call', { name, arguments: args });
    const text = body.result.content[0].text;
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // error text
    }
    return { result: body.result, text, json };
  };

  test('tools are listed; add_process is not destructive, reads are read-only', async () => {
    const body = await rpc('tools/list', {});
    const tools = Object.fromEntries(body.result.tools.map((t: any) => [t.name, t]));
    for (const name of ['list_processes', 'get_process', 'add_process', 'list_publications', 'sync_process']) {
      assert.ok(tools[name], name);
    }
    assert.equal(tools.add_process.annotations.destructiveHint, false);
    assert.equal(tools.add_process.annotations.readOnlyHint, false);
    assert.equal(tools.list_processes.annotations.readOnlyHint, true);
    assert.equal(tools.get_process.annotations.readOnlyHint, true);
  });

  test('list_processes and get_process return PT-BR summaries', async () => {
    const list = await callTool('list_processes', { view: 'news' });
    assert.ok(!list.result.isError, list.text);
    assert.equal(list.json.processes[0].numero, TJRJ);
    assert.equal(list.json.processes[0].tribunal, 'TJRJ');
    assert.equal(list.json.processes[0].situacao, 'Nova movimentação');
    assert.equal(calls.find((c) => c[0] === 'list')[2].view, 'news');

    const detail = await callTool('get_process', { process_id: 'p1' });
    assert.equal(detail.json.movimentacoes[0].nome, 'Juntada de Petição');
    assert.equal(detail.json.avisos.cliente, false);

    const missing = await callTool('get_process', { process_id: 'nope' });
    assert.equal(missing.result.isError, true);
    assert.match(missing.text, /não encontrado/);
  });

  test('add_process maps the arguments; sync_process returns the result', async () => {
    const added = await callTool('add_process', { numero: TJRJ, apelido: 'Teste', cliente: 'Maria' });
    assert.ok(!added.result.isError, added.text);
    assert.equal(added.json.added, true);
    assert.deepEqual(calls.find((c) => c[0] === 'add')[2], {
      numero: TJRJ,
      apelido: 'Teste',
      clientName: 'Maria',
      tribunalAlias: undefined,
    });
    const synced = await callTool('sync_process', { process_id: 'p1' });
    assert.equal(synced.json.ok, true);
    const pubs = await callTool('list_publications', { unseen: true });
    assert.equal(pubs.json.total, 0);
  });

  test('get_process_settings shows settings and OABs; update_process_settings maps names and adds an OAB', async () => {
    const got = await callTool('get_process_settings', {});
    assert.ok(!got.result.isError, got.text);
    assert.equal(got.json.oabs[0].oab, '123456/RJ');

    const updated = await callTool('update_process_settings', {
      enabled: true,
      check_every_hours: 12,
      notify_numbers: ['5521999990000'],
      add_oab: { numero: '654321', uf: 'RJ', label: 'Dr. Exemplo' },
    });
    assert.ok(!updated.result.isError, updated.text);
    assert.deepEqual(calls.find((c) => c[0] === 'saveSettings')[2], {
      enabled: true,
      checkEveryHours: 12,
      notifyNumbers: ['5521999990000'],
    });
    assert.deepEqual(calls.find((c) => c[0] === 'addOab')[2], {
      numeroOab: '654321',
      ufOab: 'RJ',
      label: 'Dr. Exemplo',
    });
    assert.equal(updated.json.oabAdded.oab, '654321/RJ');

    const empty = await callTool('update_process_settings', {});
    assert.equal(empty.result.isError, true);
  });
});
