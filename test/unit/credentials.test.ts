import '../helpers/setup';
// Loads the routers graph first, as the app does (see router-instance-scope.test.ts: circular @exceptions import)
import '@exceptions';

import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, test } from 'node:test';

import { createAdminOnlyGuard } from '@api/guards/auth.guard';
import { FailedAuthLimiter } from '@api/integrations/mcp/mcp.auth';
import { AdminCredentialsRouter } from '@api/routes/credentials.router';
import {
  CREDENTIAL_KIND_NAMES,
  CredentialsDeps,
  listCredentials,
  maskCredential,
  maskCredentialUrl,
  revealCredential,
} from '@api/services/credentials.service';
import express from 'express';
import { Server } from 'http';

const GLOBAL_KEY = 'global-admin-key-for-tests-0123456789';
const TOKEN_A = 'token-of-escritorio-0123456789ABCD';
const TOKEN_B = 'token-of-clinica-0123456789EFGH';
const OPENAI_KEY = 'sk-test-not-a-real-key-000000WXYZ';
const DIFY_KEY = 'app-fictional-dify-key-11112222';
const WEBHOOK_URL =
  'https://user:hook-pass-9999@hooks.example.com/in/abcDEF1234567890ghijKLMN?token=query-secret-777#frag';
const N8N_PASS = 'n8n-basic-pass-fictional-5555';
const SECRETS = [GLOBAL_KEY, TOKEN_A, TOKEN_B, OPENAI_KEY, DIFY_KEY, 'hook-pass-9999', 'query-secret-777', N8N_PASS];

// --------------------------------------------------------------------------------------------- fakes

const matches = (row: any, where: any = {}) =>
  Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && 'in' in (value as any)) return (value as any).in.includes(row[key]);
    return row[key] === value;
  });

const pick = (row: any, select?: Record<string, boolean>) =>
  select ? Object.fromEntries(Object.keys(select).map((key) => [key, row[key]])) : { ...row };

function table(rows: any[]) {
  return {
    rows,
    findMany: async ({ where, select }: any = {}) =>
      rows.filter((row) => matches(row, where)).map((r) => pick(r, select)),
    findFirst: async ({ where, select }: any = {}) => {
      const row = rows.find((item) => matches(item, where));
      return row ? pick(row, select) : null;
    },
  };
}

function fakePrisma() {
  return {
    instance: table([
      { id: 'inst-a', name: 'escritorio', token: TOKEN_A, clientName: 'evolution', connectionStatus: 'close' },
      { id: 'inst-b', name: 'clinica', token: TOKEN_B, clientName: 'evolution', connectionStatus: 'open' },
      { id: 'inst-x', name: 'outro-deploy', token: 'token-other-deploy-000000', clientName: 'other' },
    ]),
    openaiCreds: table([{ id: 'cred-1', instanceId: 'inst-a', name: 'principal', apiKey: OPENAI_KEY }]),
    webhook: table([{ id: 'wh-1', instanceId: 'inst-a', url: WEBHOOK_URL }]),
    dify: table([{ id: 'dify-1', instanceId: 'inst-b', description: 'Atendimento', apiKey: DIFY_KEY }]),
    n8n: table([
      { id: 'n8n-1', instanceId: 'inst-b', description: 'Fluxo', webhookUrl: null, basicAuthPass: N8N_PASS },
    ]),
    flowise: table([{ id: 'fw-1', instanceId: 'inst-b', description: 'vazio', apiKey: '' }]),
    instanceDatabase: table([
      { id: 'db-1', instanceId: 'inst-a', status: 'ready', connectionUri: 'enc:fictional-encrypted-uri-0000' },
    ]),
    setting: {
      findMany: async () => {
        throw new Error('table missing');
      },
    },
  };
}

function deps(overrides: Partial<CredentialsDeps> = {}): CredentialsDeps {
  return {
    prisma: fakePrisma(),
    waMonitor: { waInstances: { escritorio: { connectionStatus: { state: 'open' } } } },
    clientName: 'evolution',
    openaiGlobalKeySet: true,
    logger: { error: () => undefined },
    ...overrides,
  };
}

// --------------------------------------------------------------------------------------------- helpers

describe('credentials: masking', () => {
  test('maskCredential keeps a short prefix and the last 4 only', () => {
    assert.equal(maskCredential(OPENAI_KEY), 'sk-…WXYZ');
    assert.equal(maskCredential('app-fictional-dify-key-11112222'), 'app-…2222');
    assert.equal(maskCredential('abcdefghijklmnopqrstuvwxyz'), '…wxyz');
    // A prefix that would leave too little hidden is dropped
    assert.equal(maskCredential('abcdefgh-1234567'), '…4567');
    assert.equal(maskCredential('short-key'), '****');
    assert.equal(maskCredential(''), null);
    assert.equal(maskCredential(null), null);
    assert.equal(maskCredential(undefined), null);
  });

  test('maskCredentialUrl hides user, password, query values, fragment and token-like path segments', () => {
    const masked = maskCredentialUrl(WEBHOOK_URL);
    assert.equal(masked, 'https://****:****@hooks.example.com/in/…KLMN?token=****');
    assert.equal(
      maskCredentialUrl('https://api.example.com/webhook/whatsapp'),
      'https://api.example.com/webhook/whatsapp',
    );
    assert.equal(maskCredentialUrl('not a url'), '****');
    assert.equal(maskCredentialUrl(''), null);
    assert.equal(maskCredentialUrl(42), null);
  });
});

describe('credentials: service', () => {
  test('listCredentials groups by instance, masks everything and never returns a full secret', async () => {
    const overview = await listCredentials(deps());
    const text = JSON.stringify(overview);

    for (const secret of SECRETS) assert.ok(!text.includes(secret), `leaked ${secret}`);
    assert.deepEqual(
      overview.instances.map((instance) => instance.name),
      ['escritorio', 'clinica'],
    );
    assert.equal(overview.openaiGlobalKey.configured, true);
    assert.deepEqual(
      overview.kinds.map((kind) => kind.kind),
      CREDENTIAL_KIND_NAMES,
    );

    const [a, b] = overview.instances;
    assert.equal(a.connectionStatus, 'open', 'live state of the loaded instance wins');
    assert.equal(b.connectionStatus, 'open');
    assert.equal(a.dbMode, 'own');
    assert.equal(b.dbMode, 'shared');
    assert.ok(!text.includes('fictional-encrypted-uri'));
    assert.equal(a.openaiGlobalFallback, false, 'own OpenAI key');
    assert.equal(b.openaiGlobalFallback, true, 'no own key + OPENAI_API_KEY_GLOBAL');

    const openai = a.items.find((item) => item.kind === 'openai');
    assert.deepEqual(openai, { kind: 'openai', label: 'OpenAI', id: 'cred-1', name: 'principal', masked: 'sk-…WXYZ' });
    assert.equal(a.items.find((item) => item.kind === 'instance_token').masked, 'token-…ABCD');
    assert.ok(
      a.items.find((item) => item.kind === 'webhook_url').masked.startsWith('https://****:****@hooks.example.com'),
    );

    // Empty values are not listed; a failing table does not break the page
    assert.ok(!b.items.some((item) => item.kind === 'flowise'));
    assert.ok(b.items.some((item) => item.kind === 'dify' && item.name === 'Atendimento'));
    assert.ok(b.items.some((item) => item.kind === 'n8n_basic_auth'));
  });

  test('without OPENAI_API_KEY_GLOBAL nothing falls back', async () => {
    const overview = await listCredentials(deps({ openaiGlobalKeySet: false }));
    assert.equal(overview.openaiGlobalKey.configured, false);
    assert.ok(overview.instances.every((instance) => !instance.openaiGlobalFallback));
  });

  test('revealCredential returns the value only inside this deployment', async () => {
    const d = deps();
    assert.equal((await revealCredential(d, 'openai', 'cred-1')).value, OPENAI_KEY);
    assert.equal((await revealCredential(d, 'instance_token', 'inst-b')).value, TOKEN_B);
    assert.equal((await revealCredential(d, 'webhook_url', 'wh-1')).instance.name, 'escritorio');
    assert.equal(await revealCredential(d, 'instance_token', 'inst-x'), null, 'other clientName');
    assert.equal(await revealCredential(d, 'openai', 'missing'), null);
    assert.equal(await revealCredential(d, 'flowise', 'fw-1'), null, 'empty value');
    assert.equal(await revealCredential(d, 'nope' as any, 'cred-1'), null);
  });
});

// --------------------------------------------------------------------------------------------- HTTP

type Harness = { url: string; server: Server; logs: string[] };

async function start(options: { attempts?: FailedAuthLimiter; failures?: FailedAuthLimiter } = {}): Promise<Harness> {
  const logs: string[] = [];
  const logger = {
    warn: (message: unknown) => logs.push(String(message)),
    error: (message: unknown) => logs.push(String(message)),
  };
  const app = express();
  app.use(express.json());
  app.use(
    '/admin/credentials',
    new AdminCredentialsRouter({
      deps: () => deps({ logger }),
      apiKey: () => GLOBAL_KEY,
      guard: createAdminOnlyGuard(() => GLOBAL_KEY),
      logger,
      ...options,
    }).router,
  );
  // Same shape as the error handler of main.ts (the guard throws the exceptions of @exceptions)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err?.status || 500).json({ status: err?.status }));

  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/admin/credentials`, server, logs };
}

const reveal = (h: Harness, body: any, key = GLOBAL_KEY, ip = '203.0.113.10') =>
  fetch(`${h.url}/reveal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: key, 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });

describe('credentials: REST', () => {
  let h: Harness;

  before(async () => {
    h = await start();
  });

  after(() => h.server.close());

  beforeEach(() => {
    h.logs.length = 0;
  });

  test('the guard: no key 401, an instance token (even valid) 403, the global key 200', async () => {
    assert.equal((await fetch(h.url)).status, 401);
    assert.equal((await fetch(h.url, { headers: { apikey: TOKEN_A } })).status, 403);
    assert.equal((await fetch(h.url, { headers: { apikey: 'whatever' } })).status, 403);
    assert.equal((await reveal(h, { kind: 'openai', id: 'cred-1', confirmPassword: TOKEN_A }, TOKEN_A)).status, 403);

    const ok = await fetch(h.url, { headers: { apikey: GLOBAL_KEY } });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('cache-control'), 'no-store');

    const text = await ok.text();
    for (const secret of SECRETS) assert.ok(!text.includes(secret), `leaked ${secret}`);
    assert.equal(JSON.parse(text).instances.length, 2);
  });

  test('an empty global key configuration lets nobody in', async () => {
    const guard = createAdminOnlyGuard(() => '');
    assert.throws(() => guard({ get: () => '' } as any, {} as any, () => undefined));
    assert.throws(() => guard({ get: () => 'x' } as any, {} as any, () => undefined));
  });

  test('reveal needs the password typed again; the value comes back once, with no-store', async () => {
    const missing = await reveal(h, { kind: 'openai', id: 'cred-1' }, GLOBAL_KEY, '198.51.100.1');
    assert.equal(missing.status, 400);

    const wrong = await reveal(
      h,
      { kind: 'openai', id: 'cred-1', confirmPassword: 'nope' },
      GLOBAL_KEY,
      '198.51.100.2',
    );
    assert.equal(wrong.status, 403);
    assert.ok(!(await wrong.text()).includes(OPENAI_KEY));

    const ok = await reveal(
      h,
      { kind: 'openai', id: 'cred-1', confirmPassword: GLOBAL_KEY },
      GLOBAL_KEY,
      '198.51.100.3',
    );
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('cache-control'), 'no-store');
    const body: any = await ok.json();
    assert.equal(body.value, OPENAI_KEY);
    assert.equal(body.instance.name, 'escritorio');

    const notFound = await reveal(
      h,
      { kind: 'openai', id: 'zzz', confirmPassword: GLOBAL_KEY },
      GLOBAL_KEY,
      '198.51.100.4',
    );
    assert.equal(notFound.status, 404);

    const badKind = await reveal(h, { kind: 'aws', id: 'x', confirmPassword: GLOBAL_KEY }, GLOBAL_KEY, '198.51.100.5');
    assert.equal(badKind.status, 400);
  });

  test('audit lines name instance, kind, id, ip and time, and never a secret', async () => {
    await reveal(h, { kind: 'instance_token', id: 'inst-b', confirmPassword: GLOBAL_KEY }, GLOBAL_KEY, '192.0.2.7');
    await reveal(h, { kind: 'openai', id: 'cred-1', confirmPassword: 'typo-' + GLOBAL_KEY }, GLOBAL_KEY, '192.0.2.8');

    const line = h.logs.find((entry) => entry.includes('credentials.reveal instance='));
    assert.match(
      line,
      /^\[audit\] credentials\.reveal instance=clinica kind=instance_token id=inst-b ip=192\.0\.2\.7 at=\d{4}-/,
    );
    assert.ok(h.logs.some((entry) => entry.includes('credentials.reveal.denied') && entry.includes('ip=192.0.2.8')));

    const all = h.logs.join('\n');
    for (const secret of SECRETS) assert.ok(!all.includes(secret), `logged ${secret}`);
  });
});

describe('credentials: rate limit', () => {
  test('5 attempts per minute per IP, then 429 with Retry-After; other IPs unaffected', async () => {
    let now = 1_000_000;
    const attempts = new FailedAuthLimiter(5, 60_000, 5000, () => now);
    const h = await start({ attempts, failures: new FailedAuthLimiter(5, 15 * 60_000, 5000, () => now) });
    try {
      const body = { kind: 'openai', id: 'cred-1', confirmPassword: GLOBAL_KEY };
      for (let i = 0; i < 5; i++) assert.equal((await reveal(h, body, GLOBAL_KEY, '10.0.0.1')).status, 200);

      const blocked = await reveal(h, body, GLOBAL_KEY, '10.0.0.1');
      assert.equal(blocked.status, 429);
      assert.ok(Number(blocked.headers.get('retry-after')) > 0);
      assert.ok(!(await blocked.text()).includes(OPENAI_KEY));

      assert.equal((await reveal(h, body, GLOBAL_KEY, '10.0.0.2')).status, 200);

      now += 61_000;
      assert.equal((await reveal(h, body, GLOBAL_KEY, '10.0.0.1')).status, 200);
    } finally {
      h.server.close();
    }
  });

  test('5 wrong passwords lock the IP out for 15 minutes, even with the right password', async () => {
    let now = 5_000_000;
    const h = await start({
      attempts: new FailedAuthLimiter(1000, 60_000, 5000, () => now),
      failures: new FailedAuthLimiter(5, 15 * 60_000, 5000, () => now),
    });
    try {
      const wrong = { kind: 'openai', id: 'cred-1', confirmPassword: 'guess' };
      for (let i = 0; i < 5; i++) assert.equal((await reveal(h, wrong, GLOBAL_KEY, '10.0.0.9')).status, 403);

      const right = { kind: 'openai', id: 'cred-1', confirmPassword: GLOBAL_KEY };
      assert.equal((await reveal(h, right, GLOBAL_KEY, '10.0.0.9')).status, 429);

      now += 14 * 60_000;
      assert.equal((await reveal(h, right, GLOBAL_KEY, '10.0.0.9')).status, 429);

      now += 2 * 60_000;
      assert.equal((await reveal(h, right, GLOBAL_KEY, '10.0.0.9')).status, 200);
    } finally {
      h.server.close();
    }
  });
});
