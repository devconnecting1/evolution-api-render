import '../helpers/setup';
import '@exceptions';

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { createAdminOnlyGuard } from '@api/guards/auth.guard';
import { AuthThrottle, BLOCK_MS, clientIp, MAX_FAILURES, WINDOW_MS } from '@utils/auth-throttle';
import { SECURITY_HEADERS, securityHeaders } from '@utils/security-headers';
import express from 'express';

const DIST = join(__dirname, '..', '..', 'manager', 'dist');

describe('wrong-key throttle', () => {
  test('only trusts the edge headers; anything else turns the throttle off', () => {
    assert.equal(clientIp({ 'cf-connecting-ip': '203.0.113.7' }), '203.0.113.7');
    assert.equal(clientIp({ 'true-client-ip': '2001:db8::1' }), '2001:db8::1');
    assert.equal(clientIp({ 'x-forwarded-for': '203.0.113.7' }), null, 'X-Forwarded-For can be forged');
    assert.equal(clientIp({ 'cf-connecting-ip': '<script>' }), null);
    const t = new AuthThrottle();
    for (let i = 0; i < MAX_FAILURES * 2; i++) t.recordFailure(null);
    assert.equal(t.isBlocked(null), false);
  });

  test('TRUSTED_CLIENT_IP_HEADER picks the header (and the entry of a list header)', () => {
    const h = { 'x-forwarded-for': '198.51.100.1, 203.0.113.9', 'x-real-ip': '192.0.2.4' };
    assert.equal(clientIp(h, 'x-forwarded-for'), '198.51.100.1');
    assert.equal(clientIp(h, 'x-forwarded-for:first'), '198.51.100.1');
    assert.equal(clientIp(h, 'x-forwarded-for:last'), '203.0.113.9');
    assert.equal(clientIp(h, 'cf-connecting-ip, x-real-ip'), '192.0.2.4', 'tried in order');
    assert.equal(clientIp({ 'x-real-ip': 'not an ip' }, 'x-real-ip'), null);
  });

  test('blocks after MAX_FAILURES in the window, for BLOCK_MS, per IP', () => {
    let now = 1_000_000;
    const t = new AuthThrottle(() => now);
    for (let i = 0; i < MAX_FAILURES - 1; i++) t.recordFailure('a');
    assert.equal(t.isBlocked('a'), false);
    t.recordFailure('a');
    assert.equal(t.isBlocked('a'), true);
    assert.equal(t.isBlocked('b'), false, 'other IPs are not affected');
    assert.equal(t.retryAfter('a'), BLOCK_MS / 1000);
    now += BLOCK_MS;
    assert.equal(t.isBlocked('a'), false);

    // failures older than the window do not add up
    for (let i = 0; i < MAX_FAILURES - 1; i++) t.recordFailure('c');
    now += WINDOW_MS;
    t.recordFailure('c');
    assert.equal(t.isBlocked('c'), false);
  });

  test('admin guard: a blocked IP gets 429, the global key still gets in, other IPs are untouched', async () => {
    const GLOBAL = 'unit-global-key-0123456789abcdef';
    const app = express();
    app.get(
      '/x',
      createAdminOnlyGuard(() => GLOBAL),
      (_req, res) => res.json({ ok: true }),
    );
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    app.use((err: any, _req: any, res: any, _next: any) => res.status(err.status || 500).json({}));
    const server = await new Promise<any>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/x`;
    const get = (key: string | null, ip: string) =>
      fetch(url, { headers: { ...(key ? { apikey: key } : {}), 'cf-connecting-ip': ip } });
    try {
      for (let i = 0; i < MAX_FAILURES; i++) assert.equal((await get('wrong-' + i, '198.51.100.9')).status, 403);
      const blocked = await get('wrong-again', '198.51.100.9');
      assert.equal(blocked.status, 429);
      assert.ok(Number(blocked.headers.get('retry-after')) > 0);
      assert.equal((await get(GLOBAL, '198.51.100.9')).status, 200);
      assert.equal((await get('wrong', '198.51.100.10')).status, 403);
    } finally {
      server.close();
    }
  });
});

describe('security headers', () => {
  test('API: basic protections on every response, no X-Powered-By', async () => {
    const app = express();
    app.disable('x-powered-by');
    app.use(securityHeaders);
    app.get('/', (_req, res) => res.send('ok'));
    const server = await new Promise<any>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) assert.equal(res.headers.get(name), value);
      assert.equal(res.headers.get('x-powered-by'), null);
    } finally {
      server.close();
    }
    assert.match(readFileSync(join(__dirname, '..', '..', 'src', 'main.ts'), 'utf8'), /app\.disable\('x-powered-by'\)/);
  });

  test('site and panel (vercel.json): CSP allows exactly the inline scripts the pages have', () => {
    const routes = JSON.parse(readFileSync(join(DIST, 'vercel.json'), 'utf8')).routes;
    const headers = routes[0].continue ? routes[0].headers : {};
    const csp: string = headers['Content-Security-Policy'] ?? '';
    for (const d of ["default-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'"]) {
      assert.ok(csp.includes(d), d);
    }
    assert.ok(!/script-src[^;]*'unsafe-(inline|eval)'/.test(csp), 'no unsafe script sources');
    assert.equal(headers['X-Content-Type-Options'], 'nosniff');
    assert.equal(headers['X-Frame-Options'], 'DENY');
    // the one-time Google login code comes back in the login URL: never leak it through the Referer
    const login = routes.find((route: any) => route.src === '^/manager/login/?$');
    assert.equal(login?.headers?.['Referrer-Policy'], 'no-referrer');

    const html: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (name.endsWith('.html')) html.push(p);
      }
    };
    walk(DIST);
    const inline = new Set<string>();
    for (const file of html) {
      const s = readFileSync(file, 'utf8');
      for (const m of s.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)) {
        if (/json/.test(m[1])) continue;
        inline.add(`'sha256-${createHash('sha256').update(m[2]).digest('base64')}'`);
      }
      assert.ok(!/\son[a-z]+="/i.test(s), `${file}: inline event handler (blocked by the CSP)`);
    }
    const allowed = new Set(
      /script-src ([^;]*)/
        .exec(csp)[1]
        .split(' ')
        .filter((x) => x.startsWith("'sha256-")),
    );
    assert.deepEqual([...inline].sort(), [...allowed].sort(), 'update the hashes in manager/dist/vercel.json');
  });

  test('landing CSS bundle is up to date with its sources', () => {
    execFileSync(process.execPath, [join(__dirname, '..', '..', 'manager', 'patches', 'landing-css.mjs'), '--check'], {
      stdio: 'pipe',
    });
  });

  test('files for AI agents and security.txt are real files, not the panel', () => {
    assert.match(readFileSync(join(DIST, 'llms.txt'), 'utf8'), /^# WhatsAI\n/);
    const ard = JSON.parse(readFileSync(join(DIST, 'ard.json'), 'utf8'));
    for (const e of ard.entries) {
      assert.match(e.identifier, /^urn:air:/);
      assert.ok(statSync(join(DIST, new URL(e.url).pathname)).isFile(), e.url);
    }
    const sec = readFileSync(join(DIST, 'security.txt'), 'utf8');
    assert.match(sec, /^Contact: https:\/\//m);
    const expires = Date.parse(/^Expires: (.+)$/m.exec(sec)[1]);
    assert.ok(expires > Date.now() + 30 * 86_400_000, 'security.txt Expires must be renewed (RFC 9116)');
  });
});
