import '../helpers/setup';

import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';

import { FailedAuthLimiter, safeEqual } from '@api/integrations/mcp/mcp.auth';
import { escapeLike, searchMessages } from '@api/integrations/mcp/mcp.queries';
import { createMcpRouter } from '@api/integrations/mcp/mcp.router';
import { McpDeps } from '@api/integrations/mcp/mcp.types';
import { maskSecret, maskUrl, normalizeRecipient, scrubSecrets } from '@api/integrations/mcp/mcp.util';
import { TOOL_NAMES } from '@api/integrations/mcp/tools';
import { UsageService } from '@api/services/usage.service';
import { Prisma } from '@prisma/client';
import express from 'express';
import { Server } from 'http';
import path from 'path';

import { createUsageTables } from '../helpers/usage-mock';

const GLOBAL_KEY = 'global-key-for-tests-only-0123456789';
const PATH_TOKEN = 'p'.repeat(40);
const OPENAI_KEY = 'sk-test-not-a-real-key-1234WXYZ';

const EXPECTED_TOOLS = [
  'list_instances',
  'get_instance_status',
  'list_chats',
  'get_messages',
  'search_messages',
  'get_media',
  'get_bot_config',
  'list_paused_contacts',
  'get_observability',
  'get_webhook_and_settings',
  'send_text_message',
  'pause_bot_for_contact',
  'resume_bot_for_contact',
  'update_bot_settings',
  'get_usage',
  'update_limits',
  'list_processes',
  'get_process',
  'add_process',
  'list_publications',
  'sync_process',
];

// --------------------------------------------------------------------------------------------- fakes

const matches = (row: any, where: any = {}) =>
  Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true;
    if (value && typeof value === 'object') {
      if ('in' in (value as any)) return (value as any).in.includes(row[key]);
      if ('not' in (value as any)) return row[key] !== (value as any).not;
      return true;
    }
    return row[key] === value;
  });

type Calls = { sendText: any[]; changeStatus: any[]; updateBot: any[]; fetchMessages: any[]; sessionCreate: any[] };

function fakeDeps(overrides: Partial<McpDeps['config']> = {}) {
  const calls: Calls = { sendText: [], changeStatus: [], updateBot: [], fetchMessages: [], sessionCreate: [] };

  const instances = [
    {
      id: 'inst-a',
      name: 'escritorio',
      token: 'token-of-escritorio-0123456789',
      clientName: 'evolution',
      connectionStatus: 'open',
      ownerJid: '5511999990000@s.whatsapp.net',
      integration: 'WHATSAPP-BAILEYS',
    },
    {
      id: 'inst-b',
      name: 'clinica',
      token: 'token-of-clinica-0123456789',
      clientName: 'evolution',
      connectionStatus: 'close',
      integration: 'WHATSAPP-BAILEYS',
    },
  ];

  const bots = [
    {
      id: 'bot-1',
      instanceId: 'inst-a',
      enabled: true,
      botType: 'chatCompletion',
      model: 'gpt-6-luna',
      maxTokens: 2000,
      systemMessages: ['Você é a assistente do escritório.'],
      expire: 0,
      keywordFinish: '#sair',
      humanResumeMinutes: 30,
      triggerType: 'all',
      openaiCredsId: 'cred-1',
      createdAt: new Date('2026-10-01T00:00:00Z'),
    },
  ];

  const sessions: any[] = [
    {
      id: 's1',
      instanceId: 'inst-a',
      remoteJid: '5511988887777@s.whatsapp.net',
      botId: 'bot-1',
      status: 'opened',
      parameters: null,
      updatedAt: new Date(),
    },
  ];

  const records = [
    {
      id: 'db1',
      key: { id: 'MSG-IN', remoteJid: '5511988887777@s.whatsapp.net', fromMe: false },
      pushName: 'Maria',
      messageType: 'conversation',
      message: { conversation: 'Olá, quero marcar uma consulta' },
      messageTimestamp: 1_790_000_000,
      MessageUpdate: [],
    },
    {
      id: 'db2',
      key: { id: 'MSG-IMG', remoteJid: '5511988887777@lid', fromMe: true },
      pushName: 'Dono',
      messageType: 'imageMessage',
      message: { imageMessage: { mimetype: 'image/jpeg', fileLength: { low: 2048, high: 0 }, caption: 'Foto' } },
      messageTimestamp: 1_790_000_100,
      MessageUpdate: [{ status: 'READ' }],
    },
  ];

  const channelA = {
    connectionStatus: { state: 'open' },
    fetchMessages: async (query: any) => {
      calls.fetchMessages.push(structuredClone(query));
      return { messages: { total: 2, pages: 1, currentPage: 1, records } };
    },
    fetchChats: async () => [],
    resolveEquivalentJids: async (jid: string) => [jid],
  };

  const prisma: any = {
    instance: {
      findMany: async ({ where, take }: any) => instances.filter((row) => matches(row, where)).slice(0, take ?? 100),
    },
    openaiBot: { findMany: async ({ where }: any) => bots.filter((row) => matches(row, where)) },
    openaiSetting: {
      findFirst: async () => ({ instanceId: 'inst-a', humanResumeMinutes: 0, openaiCredsId: 'cred-1' }),
    },
    openaiCreds: {
      findMany: async ({ where }: any) =>
        where.instanceId === 'inst-a' ? [{ id: 'cred-1', name: 'principal', apiKey: OPENAI_KEY }] : [],
    },
    integrationSession: {
      findMany: async ({ where }: any) => sessions.filter((row) => matches(row, where)),
      create: async ({ data }: any) => {
        calls.sessionCreate.push(data);
        const row = { id: `s${sessions.length + 1}`, updatedAt: new Date(), ...data };
        sessions.push(row);
        return row;
      },
    },
    setting: {
      findUnique: async () => ({ rejectCall: true, groupsIgnore: true, wavoipToken: 'wavoip-secret-value-9876' }),
    },
    webhook: {
      findUnique: async () => ({
        enabled: true,
        url: 'https://hooks.example.com/in?token=fake-query-value',
        events: ['MESSAGES_UPSERT'],
        headers: { authorization: 'Bearer very-secret-header-value' },
      }),
    },
  };

  const usageTables = createUsageTables(instances);
  const usage = new UsageService({ ...prisma, ...usageTables, instance: prisma.instance });

  const deps: McpDeps = {
    prisma,
    usage,
    waMonitor: { waInstances: { escritorio: channelA } },
    openaiController: {
      integrationEnabled: true,
      changeStatus: async (instance: any, data: any) => {
        calls.changeStatus.push({ instance, data });
        for (const session of sessions) {
          if (session.remoteJid === data.remoteJid) {
            session.status = data.status;
            session.parameters = data.status === 'paused' ? { manualPause: true } : {};
          }
        }
        return {};
      },
      updateBot: async (instance: any, botId: string, data: any) => {
        calls.updateBot.push({ instance, botId, data });
        return { ...data };
      },
    },
    sendMessageController: {
      sendText: async (instance, data) => {
        calls.sendText.push({ instance, data });
        return {
          key: { id: 'SENT-1', remoteJid: `${data.number}@s.whatsapp.net`, fromMe: true },
          status: 'PENDING',
          messageTimestamp: 1_790_000_200,
        };
      },
    },
    observability: {
      getOverview: async () => ({ providers: [{ name: 'neon', apiToken: 'neon-secret-token-000111' }], alerts: [] }),
    },
    isBotMessageId: async () => false,
    logger: { error: () => undefined, warn: () => undefined },
    config: {
      apiKey: GLOBAL_KEY,
      pathToken: undefined,
      clientName: 'evolution',
      dbProvider: 'postgresql',
      docsDirs: [path.resolve(__dirname, '../..'), path.resolve(__dirname, '../../readmes')],
      ...overrides,
    },
  };

  return { deps, calls, sessions, usageTables };
}

// --------------------------------------------------------------------------------------------- http helpers

type Harness = {
  url: string;
  server: Server;
  calls: Calls;
  sessions: any[];
  usageTables: ReturnType<typeof createUsageTables>;
};

async function startServer(overrides: Partial<McpDeps['config']> = {}, limiter?: FailedAuthLimiter): Promise<Harness> {
  const { deps, calls, sessions, usageTables } = fakeDeps(overrides);
  const app = express();
  app.use(express.json());
  app.use(
    '/mcp',
    createMcpRouter(() => deps, limiter),
  );

  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const { port } = server.address() as AddressInfo;

  return { url: `http://127.0.0.1:${port}/mcp`, server, calls, sessions, usageTables };
}

let nextRpcId = 1;

async function rpc(url: string, method: string, params: any = {}, headers: Record<string, string> = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextRpcId++, method, params }),
  });

  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
}

const bearer = (key: string) => ({ authorization: `Bearer ${key}` });

async function callTool(url: string, name: string, args: any, headers = bearer(GLOBAL_KEY)) {
  const { status, body } = await rpc(url, 'tools/call', { name, arguments: args }, headers);
  assert.equal(status, 200, JSON.stringify(body));
  const result = body.result;
  const text = result.content.find((item: any) => item.type === 'text')?.text ?? '';
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    // error results are plain text
  }
  return { result, text, json };
}

// --------------------------------------------------------------------------------------------- tests

describe('MCP: helpers', () => {
  test('safeEqual compares in constant time and never matches empty values', () => {
    assert.equal(safeEqual('abc', 'abc'), true);
    assert.equal(safeEqual('abc', 'abd'), false);
    assert.equal(safeEqual('abc', 'abcd'), false);
    assert.equal(safeEqual('', ''), false);
    assert.equal(safeEqual(undefined, 'x'), false);
  });

  test('secrets are masked', () => {
    assert.equal(maskSecret(OPENAI_KEY), '****WXYZ');
    assert.equal(maskSecret('short'), '****');
    assert.equal(maskSecret(null), null);

    const scrubbed = scrubSecrets({
      apiKey: OPENAI_KEY,
      nested: { accessToken: 'abcdefghijklmnop', ok: 1 },
      list: [{ password: 'x' }],
    });
    assert.deepEqual(scrubbed, {
      apiKey: '****WXYZ',
      nested: { accessToken: '****mnop', ok: 1 },
      list: [{ password: '****' }],
    });

    const url = maskUrl('https://user:pass@hooks.example.com/x?token=abc&b=2');
    assert.ok(!url.includes('abc') && !url.includes('pass@'), url);
  });

  test('recipient validation', () => {
    assert.equal(normalizeRecipient('+55 (11) 98888-7777'), '5511988887777');
    assert.equal(normalizeRecipient('5511988887777@s.whatsapp.net'), '5511988887777@s.whatsapp.net');
    assert.throws(() => normalizeRecipient('12345'), /número inválido/);
    assert.throws(() => normalizeRecipient('120363000000@g.us'), /grupos/);
  });

  test('search_messages builds one bounded, parameterized query over the text fields only', async () => {
    let query: Prisma.Sql = null;
    const prisma = {
      $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        query = Prisma.sql(strings, ...values);
        return [];
      },
    };

    await searchMessages(prisma, 'postgresql', {
      instanceId: 'inst-a',
      term: "50% off'; DROP",
      remoteJids: ['5511988887777@s.whatsapp.net'],
      fromSeconds: 100,
      toSeconds: 200,
      limit: 20,
    });

    assert.ok(!query.sql.includes('DROP'), 'the term is a parameter, never SQL');
    assert.match(query.sql, /"message" #>> '\{conversation\}' ILIKE/);
    assert.match(query.sql, /LIMIT \?\s*$/);
    assert.ok(query.values.includes("%50\\% off'; DROP%"));
    assert.ok(query.values.includes(20));
    assert.equal(escapeLike('a_b%c\\'), 'a\\_b\\%c\\\\');
  });

  test('the failed-auth limiter blocks after the limit and frees after the window', () => {
    let now = 0;
    const limiter = new FailedAuthLimiter(2, 1000, 10, () => now);
    limiter.fail('1.1.1.1');
    assert.equal(limiter.blockedFor('1.1.1.1'), 0);
    limiter.fail('1.1.1.1');
    assert.ok(limiter.blockedFor('1.1.1.1') > 0);
    now = 1001;
    assert.equal(limiter.blockedFor('1.1.1.1'), 0);

    for (let i = 0; i < 50; i++) limiter.fail(`10.0.0.${i}`);
    assert.ok(limiter.size <= 10);
  });
});

describe('MCP: auth and transport', () => {
  let h: Harness;
  let withPath: Harness;

  before(async () => {
    h = await startServer();
    withPath = await startServer({ pathToken: PATH_TOKEN });
  });

  after(() => {
    h.server.close();
    withPath.server.close();
  });

  test('no key and wrong key are 401 JSON-RPC errors', async () => {
    const none = await rpc(h.url, 'tools/list');
    assert.equal(none.status, 401);
    assert.equal(none.body.jsonrpc, '2.0');
    assert.equal(none.body.error.code, -32001);

    const wrong = await rpc(h.url, 'tools/list', {}, bearer('not-the-key'));
    assert.equal(wrong.status, 401);
    assert.ok(!JSON.stringify(wrong.body).includes(GLOBAL_KEY));
  });

  test('the global key works as Bearer and as apikey header', async () => {
    const init = await rpc(
      h.url,
      'initialize',
      { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
      bearer(GLOBAL_KEY),
    );
    assert.equal(init.status, 200, JSON.stringify(init.body));
    assert.equal(init.body.result.serverInfo.name, 'whatsai');

    const list = await rpc(h.url, 'tools/list', {}, { apikey: GLOBAL_KEY });
    assert.equal(list.status, 200);
  });

  test('tools/list returns exactly the expected tools with annotations', async () => {
    const { body } = await rpc(h.url, 'tools/list', {}, bearer(GLOBAL_KEY));
    const names = body.result.tools.map((tool: any) => tool.name).sort();
    assert.deepEqual(names, [...EXPECTED_TOOLS].sort());
    assert.deepEqual([...TOOL_NAMES].sort(), [...EXPECTED_TOOLS].sort());

    for (const forbidden of ['delete_instance', 'logout_instance', 'restart_instance', 'delete_message', 'run_sql']) {
      assert.ok(!names.includes(forbidden));
    }

    const send = body.result.tools.find((tool: any) => tool.name === 'send_text_message');
    assert.equal(send.annotations.openWorldHint, true);
    assert.equal(send.annotations.destructiveHint, false);
    assert.equal(send.annotations.readOnlyHint, false);

    const read = body.result.tools.find((tool: any) => tool.name === 'get_messages');
    assert.equal(read.annotations.readOnlyHint, true);
    assert.ok(read.inputSchema.properties.contact);
  });

  test('GET and DELETE answer 405', async () => {
    const get = await fetch(h.url, { method: 'GET' });
    assert.equal(get.status, 405);
    const del = await fetch(h.url, { method: 'DELETE' });
    assert.equal(del.status, 405);
  });

  test('an instance token only reaches its own instance', async () => {
    const token = bearer('token-of-escritorio-0123456789');

    const { json } = await callTool(h.url, 'list_instances', {}, token);
    assert.equal(json.scope, 'instance');
    assert.deepEqual(
      json.instances.map((item: any) => item.name),
      ['escritorio'],
    );
    assert.ok(!JSON.stringify(json).includes('token-of'));

    const other = await callTool(h.url, 'get_instance_status', { instance: 'clinica' }, token);
    assert.equal(other.result.isError, true);
    assert.match(other.text, /só dá acesso à instância "escritorio"/);

    const observability = await callTool(h.url, 'get_observability', {}, token);
    assert.equal(observability.result.isError, true);
    assert.match(observability.text, /chave global/);
  });

  test('path token mode is 404 when MCP_PATH_TOKEN is unset or short', async () => {
    const off = await rpc(`${h.url}/${PATH_TOKEN}`, 'tools/list');
    assert.equal(off.status, 404);

    const short = await startServer({ pathToken: 'too-short' });
    try {
      assert.equal((await rpc(`${short.url}/too-short`, 'tools/list')).status, 404);
    } finally {
      short.server.close();
    }
  });

  test('path token mode grants global access only with the exact token', async () => {
    const ok = await rpc(`${withPath.url}/${PATH_TOKEN}`, 'tools/list');
    assert.equal(ok.status, 200);
    assert.equal(ok.body.result.tools.length, EXPECTED_TOOLS.length);

    const wrong = await rpc(`${withPath.url}/${'q'.repeat(40)}`, 'tools/list');
    assert.equal(wrong.status, 401);
  });

  test('too many failed attempts from one IP answer 429', async () => {
    const limited = await startServer({}, new FailedAuthLimiter(2, 60_000));
    try {
      await rpc(limited.url, 'tools/list', {}, bearer('bad-1'));
      await rpc(limited.url, 'tools/list', {}, bearer('bad-2'));
      const blocked = await rpc(limited.url, 'tools/list', {}, bearer(GLOBAL_KEY));
      assert.equal(blocked.status, 429);
      assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    } finally {
      limited.server.close();
    }
  });
});

describe('MCP: tools', () => {
  let h: Harness;

  before(async () => {
    h = await startServer();
  });

  after(() => h.server.close());

  test('get_messages reads through fetchMessages with the LID merge and summarizes each message', async () => {
    const { json, result } = await callTool(h.url, 'get_messages', {
      instance: 'escritorio',
      contact: '+55 11 98888-7777',
      page: 1,
      page_size: 10,
    });

    assert.ok(!result.isError, JSON.stringify(result));
    assert.deepEqual(h.calls.fetchMessages.at(-1), {
      where: { key: { remoteJid: '5511988887777@s.whatsapp.net' } },
      page: 1,
      offset: 10,
      mergeLid: true,
    });

    assert.equal(json.total, 2);
    const [incoming, image] = json.messages;
    assert.equal(incoming.messageId, 'MSG-IN');
    assert.equal(incoming.sender, 'contact');
    assert.equal(incoming.senderName, 'Maria');
    assert.equal(incoming.text, 'Olá, quero marcar uma consulta');
    assert.equal(incoming.hasMedia, false);

    assert.equal(image.sender, 'me');
    assert.equal(image.hasMedia, true);
    assert.equal(image.media.kind, 'image');
    assert.equal(image.media.sizeBytes, 2048);
    assert.equal(image.text, 'Foto');
    assert.equal(image.status, 'READ');
  });

  test('get_messages needs a loaded instance', async () => {
    const { result, text } = await callTool(h.url, 'get_messages', { instance: 'clinica', contact: '5511988887777' });
    assert.equal(result.isError, true);
    assert.match(text, /não está carregada/);
  });

  test('send_text_message validates the number before sending', async () => {
    const bad = await callTool(h.url, 'send_text_message', { instance: 'escritorio', number: '123456789', text: 'oi' });
    assert.equal(bad.result.isError, true);
    assert.equal(h.calls.sendText.length, 0);

    const { json, result } = await callTool(h.url, 'send_text_message', {
      instance: 'escritorio',
      number: '+55 (11) 98888-7777',
      text: 'Olá! Recebemos sua mensagem.',
      delay_ms: 1200,
    });

    assert.ok(!result.isError, JSON.stringify(result));
    assert.deepEqual(h.calls.sendText.at(-1), {
      instance: { instanceName: 'escritorio' },
      data: { number: '5511988887777', text: 'Olá! Recebemos sua mensagem.', delay: 1200 },
    });
    assert.equal(json.sent, true);
    assert.equal(json.messageId, 'SENT-1');
  });

  test('pause and resume go through changeStatus', async () => {
    const paused = await callTool(h.url, 'pause_bot_for_contact', { instance: 'escritorio', contact: '5511988887777' });
    assert.ok(!paused.result.isError, paused.text);
    assert.deepEqual(h.calls.changeStatus.at(-1).data, { remoteJid: '5511988887777@s.whatsapp.net', status: 'paused' });
    assert.equal(paused.json.sessions[0].paused, true);
    assert.equal(paused.json.sessions[0].humanPause.reason, 'manual');

    const listed = await callTool(h.url, 'list_paused_contacts', { instance: 'escritorio' });
    assert.equal(listed.json.count, 1);

    const resumed = await callTool(h.url, 'resume_bot_for_contact', {
      instance: 'escritorio',
      contact: '5511988887777',
    });
    assert.equal(resumed.json.resumed, true);
    assert.deepEqual(h.calls.changeStatus.at(-1).data, { remoteJid: '5511988887777@s.whatsapp.net', status: 'opened' });
  });

  test('pausing a contact without a session creates a manually paused one', async () => {
    const { json } = await callTool(h.url, 'pause_bot_for_contact', {
      instance: 'escritorio',
      contact: '5521977776666',
    });
    assert.equal(json.createdSession, true);
    const created = h.calls.sessionCreate.at(-1);
    assert.equal(created.status, 'paused');
    assert.equal(created.botId, 'bot-1');
    assert.deepEqual(created.parameters, { manualPause: true });
  });

  test('update_bot_settings sends the whole bot with the whitelisted changes and returns the previous values', async () => {
    const { json, result } = await callTool(h.url, 'update_bot_settings', {
      instance: 'escritorio',
      system_prompt: 'Novo prompt',
      pause_minutes: 45,
    });

    assert.ok(!result.isError, JSON.stringify(result));
    const call = h.calls.updateBot.at(-1);
    assert.equal(call.botId, 'bot-1');
    assert.deepEqual(call.data.systemMessages, ['Novo prompt']);
    assert.equal(call.data.humanResumeMinutes, 45);
    assert.equal(call.data.model, 'gpt-6-luna');
    assert.equal(call.data.triggerType, 'all');
    assert.deepEqual(json.changes.systemMessages.before, ['Você é a assistente do escritório.']);

    const empty = await callTool(h.url, 'update_bot_settings', { instance: 'escritorio' });
    assert.equal(empty.result.isError, true);
  });

  test('get_usage: no plan configured still shows the counted answers', async () => {
    const { json, result } = await callTool(h.url, 'get_usage', { instance: 'escritorio' });
    assert.ok(!result.isError, JSON.stringify(result));
    assert.equal(json.instance, 'escritorio');
    assert.equal(json.configured, false);
    assert.match(json.note, /sem limite/);
    assert.equal(json.month.limit, null);
    assert.equal(json.last30Days.length, 30);
  });

  test('update_limits is destructive, saves a partial change and returns the previous values', async () => {
    const { body } = await rpc(h.url, 'tools/list', {}, bearer(GLOBAL_KEY));
    const tool = body.result.tools.find((item: any) => item.name === 'update_limits');
    assert.equal(tool.annotations.destructiveHint, true);
    assert.equal(tool.annotations.readOnlyHint, false);

    const first = await callTool(h.url, 'update_limits', { instance: 'escritorio', plan: 'Essencial' });
    assert.ok(!first.result.isError, first.text);
    assert.equal(first.json.previous, null);
    assert.equal(first.json.limits.monthlyResponses, 2000);
    assert.equal(first.json.limits.overLimitAction, 'continue');

    const second = await callTool(h.url, 'update_limits', {
      instance: 'escritorio',
      daily_responses: 300,
      business_hours: { enabled: true, mode: 'inside', week: { sat: [['09:00', '13:00']] } },
    });
    assert.equal(second.json.previous.monthlyResponses, 2000);
    assert.equal(second.json.previous.dailyResponses, null);
    assert.equal(second.json.limits.monthlyResponses, 2000, 'absent fields keep their value');
    assert.equal(second.json.limits.dailyResponses, 300);
    assert.deepEqual(second.json.limits.businessHours.week.sat, [['09:00', '13:00']]);
    assert.deepEqual(second.json.limits.businessHours.week.mon, [['09:00', '18:00']]);

    const invalid = await callTool(h.url, 'update_limits', { instance: 'escritorio', over_limit_action: 'message' });
    assert.equal(invalid.result.isError, true);
    assert.match(invalid.text, /mensagem/);

    const empty = await callTool(h.url, 'update_limits', { instance: 'escritorio' });
    assert.equal(empty.result.isError, true);

    const usage = await callTool(h.url, 'get_usage', { instance: 'escritorio' });
    assert.equal(usage.json.configured, true);
    assert.equal(usage.json.month.limit, 2000);
    assert.equal(h.usageTables.limits.get('inst-a').dailyResponses, 300);

    const other = await callTool(
      h.url,
      'update_limits',
      { instance: 'clinica', plan: 'Premium' },
      bearer('token-of-escritorio-0123456789'),
    );
    assert.equal(other.result.isError, true);
  });

  test('secrets never leave: OpenAI key, webhook header/url, wavoip and observability tokens', async () => {
    const bot = await callTool(h.url, 'get_bot_config', { instance: 'escritorio' });
    assert.ok(!bot.text.includes(OPENAI_KEY));
    assert.equal(bot.json.credentials[0].apiKey, '****WXYZ');
    assert.equal(bot.json.bots[0].credential.apiKey, '****WXYZ');

    const settings = await callTool(h.url, 'get_webhook_and_settings', { instance: 'escritorio' });
    for (const secret of ['very-secret-header-value', 'fake-query-value', 'wavoip-secret-value-9876']) {
      assert.ok(!settings.text.includes(secret), secret);
    }
    assert.deepEqual(settings.json.webhook.events, ['MESSAGES_UPSERT']);

    const observability = await callTool(h.url, 'get_observability', {});
    assert.ok(!observability.text.includes('neon-secret-token-000111'));
  });

  test('the manuals are exposed as resources', async () => {
    const { body } = await rpc(h.url, 'resources/list', {}, bearer(GLOBAL_KEY));
    const uris = body.result.resources.map((resource: any) => resource.uri);
    assert.ok(uris.includes('whatsai://docs/README-WHATSAI'), JSON.stringify(uris));
    assert.ok(!uris.includes('whatsai://docs/README'));

    const read = await rpc(h.url, 'resources/read', { uri: 'whatsai://docs/README-WHATSAI' }, bearer(GLOBAL_KEY));
    assert.match(read.body.result.contents[0].text, /WhatsAI/);
  });

  test('the prompts exist and never ask to send', async () => {
    const { body } = await rpc(h.url, 'prompts/list', {}, bearer(GLOBAL_KEY));
    assert.deepEqual(body.result.prompts.map((prompt: any) => prompt.name).sort(), [
      'resumo_do_dia',
      'revisar_atendimento',
    ]);

    const review = await rpc(
      h.url,
      'prompts/get',
      { name: 'revisar_atendimento', arguments: { instance: 'escritorio', contact: '5511988887777' } },
      bearer(GLOBAL_KEY),
    );
    assert.match(review.body.result.messages[0].content.text, /NÃO envie/);
  });
});
