import '../helpers/setup';

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { UserSessionService } from '@api/services/user-session.service';
import { hashSessionToken } from '@utils/google-login';

import { OpenaiHarness, SKIP_INTEGRATION } from '../helpers/integration';

const unique = () => `it-equipe-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@exemplo.com`;

/**
 * "Equipe" on a real PostgreSQL: the migration (unique e-mail and token hash, FK cascade), the session token stored
 * only as a hash, lastSeenAt written at most every 10 minutes, and immediate revocation.
 */
describe('equipe: users and sessions (integration)', { skip: SKIP_INTEGRATION }, () => {
  let h: OpenaiHarness;
  const created: string[] = [];

  before(async () => {
    h = await new OpenaiHarness().start();
  });

  after(async () => {
    if (h?.prisma) await h.prisma.user.deleteMany({ where: { email: { in: created } } }).catch(() => undefined);
    await h?.stop();
  });

  test('one person per e-mail, sessions stored as a hash, lastSeenAt bounded, revocation and cascade', async () => {
    let now = Math.floor(Date.now() / 1000) * 1000;
    const service = new UserSessionService({ prisma: h.prisma, now: () => now, cacheTtlMs: 0 });
    const email = unique();
    created.push(email);

    const first = await service.findOrCreateUser({ email: email.toUpperCase(), name: 'Pessoa Fictícia' });
    assert.equal(first.email, email);
    now += 60_000;
    const again = await service.findOrCreateUser({ email });
    assert.equal(again.id, first.id);
    assert.equal(await h.prisma.user.count({ where: { email } }), 1, 'the unique e-mail prevents a second person');

    const created1 = await service.createSession(first.id, { userAgent: 'Celular', ip: '203.0.113.10' });
    const stored = await h.prisma.userSession.findUnique({ where: { id: created1.session.id } });
    assert.equal(stored?.tokenHash, hashSessionToken(created1.token));
    assert.ok(!JSON.stringify(stored).includes(created1.token), 'the token itself is never stored');
    assert.ok(stored!.expiresAt.getTime() > now);
    assert.equal(stored!.lastSeenAt!.getTime(), now);
    assert.equal(stored!.revokedAt, null);

    const resolved = await service.resolve(created1.token);
    assert.equal(resolved?.userId, first.id);
    assert.equal(resolved?.email, email);

    now += 5 * 60_000;
    await service.resolve(created1.token);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      (await h.prisma.userSession.findUnique({ where: { id: created1.session.id } }))!.lastSeenAt!.getTime(),
      stored!.lastSeenAt!.getTime(),
      'less than 10 minutes: lastSeenAt is not written',
    );

    now += 6 * 60_000;
    await service.resolve(created1.token);
    let touched = 0;
    for (let i = 0; i < 50; i++) {
      touched = (await h.prisma.userSession.findUnique({ where: { id: created1.session.id } }))!.lastSeenAt!.getTime();
      if (touched === now) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(touched, now, 'more than 10 minutes: lastSeenAt is written');

    const other = await service.createSession(first.id, { userAgent: 'Computador' });
    const own = await service.listSessions(first.id, other.session.id);
    assert.equal(own.length, 2);
    assert.equal(own.find((row) => row.current)?.id, other.session.id);
    const overview = await service.overview([email, 'nunca-entrou@exemplo.com']);
    assert.equal(overview.people.find((person) => person.email === email)?.activeSessions, 2);
    assert.equal(overview.people.find((person) => person.email === 'nunca-entrou@exemplo.com')?.loggedIn, false);

    assert.equal(await service.revokeSession(other.session.id, first.id), true);
    assert.equal(await service.resolve(other.token), null, 'revoked at once');
    assert.equal((await service.resolve(created1.token))?.email, email, 'the other session keeps working');

    await h.prisma.user.delete({ where: { id: first.id } });
    assert.equal(await h.prisma.userSession.count({ where: { userId: first.id } }), 0, 'sessions go with the person');
  });

  test('resolve refuses a live session when the access policy no longer allows the e-mail', async () => {
    const email = unique();
    created.push(email);
    let allow = true;
    const service = new UserSessionService({
      prisma: h.prisma,
      cacheTtlMs: 0,
      authorized: (value) => allow && value === email,
    });
    const user = await service.findOrCreateUser({ email });
    const session = await service.createSession(user.id);
    assert.equal((await service.resolve(session.token))?.email, email);

    allow = false;
    assert.equal(await service.resolve(session.token), null, 'feature off / e-mail removed from the allowlist');
    allow = true;
    assert.equal((await service.resolve(session.token))?.email, email, 'allowed again: the session works');
  });
});
