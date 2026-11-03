import '../helpers/setup';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ChannelStartupService } from '@api/services/channel.service';
import { configService } from '@config/env.config';
import { equivalentJids, mergeLidChats, normalizeUserJid, parseMergeLid, toLidPnPair } from '@utils/lidJid';
import EventEmitter2 from 'eventemitter2';

/**
 * A private chat may be stored under its `@lid` and under its phone JID at the same time: findMessages reads both
 * and findChats shows one entry per contact. Pure helpers plus the service with a fake Prisma (no database).
 */
const LID = '123456789012345@lid';
const PN = '5511988887777@s.whatsapp.net';
const GROUP = '120363000000000000@g.us';

describe('LID/phone helpers', () => {
  test('pairs a LID with its phone JID in any order, ignoring the device', () => {
    assert.deepEqual(toLidPnPair(LID, PN), { lid: LID, pn: PN });
    assert.deepEqual(toLidPnPair('5511988887777:3@s.whatsapp.net', '123456789012345:3@lid'), { lid: LID, pn: PN });
    assert.equal(toLidPnPair(LID, LID), null);
    assert.equal(toLidPnPair(GROUP, PN), null);
    assert.equal(toLidPnPair(LID, null), null);
    assert.equal(normalizeUserJid('5511988887777:12@s.whatsapp.net'), PN);
  });

  test('equivalentJids: the JID itself first, then its pair; groups never paired', () => {
    const pairs = [{ lid: LID, pn: PN }];
    assert.deepEqual(equivalentJids(LID, pairs), [LID, PN]);
    assert.deepEqual(equivalentJids(PN, pairs), [PN, LID]);
    assert.deepEqual(equivalentJids('999@lid', pairs), ['999@lid']);
    assert.deepEqual(equivalentJids(GROUP, pairs), [GROUP]);
  });

  test('parseMergeLid: on by default, off only when asked', () => {
    assert.equal(parseMergeLid(), true);
    assert.equal(parseMergeLid(undefined, undefined), true);
    assert.equal(parseMergeLid(true), true);
    assert.equal(parseMergeLid(false), false);
    assert.equal(parseMergeLid(undefined, 'false'), false);
    assert.equal(parseMergeLid(undefined, '0'), false);
    assert.equal(parseMergeLid(undefined, 'true'), true);
    // The body wins over the query string
    assert.equal(parseMergeLid(true, 'false'), true);
  });
});

describe('mergeLidChats', () => {
  const chat = (remoteJid: string, ts: number, extra: Record<string, any> = {}) => ({
    id: null,
    remoteJid,
    pushName: null,
    profilePicUrl: null,
    updatedAt: new Date(ts * 1000),
    lastMessage: { id: `m-${remoteJid}-${ts}`, messageTimestamp: ts },
    unreadCount: 0,
    isSaved: false,
    ...extra,
  });

  test('folds the LID chat into the phone chat: newest message, summed unread, LID kept in remoteJidAlt', () => {
    const merged = mergeLidChats(
      [
        chat(LID, 300, { unreadCount: 3, pushName: 'Maria', id: 'contact-lid', isSaved: true }),
        chat(GROUP, 250, { unreadCount: 1 }),
        chat(PN, 200, { unreadCount: 2 }),
      ],
      [{ lid: LID, pn: PN }],
    );

    assert.equal(merged.length, 2);
    const contact = merged[0];
    assert.equal(contact.remoteJid, PN);
    assert.equal(contact.remoteJidAlt, LID);
    assert.equal(contact.unreadCount, 5);
    assert.equal(contact.lastMessage.messageTimestamp, 300);
    assert.equal((contact.updatedAt as Date).getTime(), 300_000);
    assert.equal(contact.pushName, 'Maria');
    assert.equal(contact.id, 'contact-lid');
    assert.equal(contact.isSaved, true);
    assert.equal(merged[1].remoteJid, GROUP);
    assert.equal(merged[1].remoteJidAlt, undefined);
  });

  test('a LID-only chat with a known phone is shown under the phone JID', () => {
    const [only] = mergeLidChats([chat(LID, 100, { unreadCount: null })], [{ lid: LID, pn: PN }]);
    assert.equal(only.remoteJid, PN);
    assert.equal(only.remoteJidAlt, LID);
    assert.equal(only.unreadCount, null);
  });

  test('LIDs without a known phone, groups and unrelated chats pass through, sorted newest first', () => {
    const chats = [chat('999@lid', 10), chat(GROUP, 30), chat(PN, 20)];
    const merged = mergeLidChats(chats, []);
    assert.deepEqual(
      merged.map((c) => c.remoteJid),
      [GROUP, PN, '999@lid'],
    );
    assert.ok(merged.every((c) => c.remoteJidAlt === undefined));
  });
});

describe('ChannelStartupService.fetchMessages with a fake Prisma', () => {
  function service(pairRows: { jid: string; alt: string }[]) {
    const calls = { count: [] as any[], findMany: [] as any[], raw: 0 };
    const prisma: any = {
      message: {
        count: async (args: any) => {
          calls.count.push(args);
          return 0;
        },
        findMany: async (args: any) => {
          calls.findMany.push(args);
          return [];
        },
      },
      $queryRaw: async () => {
        calls.raw++;
        return pairRows;
      },
    };
    const svc = new ChannelStartupService(configService, new EventEmitter2(), prisma, {} as any);
    svc.setInstance({ instanceName: 'unit', instanceId: 'inst-unit' } as any);
    return { svc, calls };
  }

  const remoteJidsOf = (where: any): string[] => {
    const filter = where.AND[2];
    const list = filter.OR ?? [filter];
    return list.map((f: any) => f.key.equals);
  };

  test('reads the LID and the phone JID of the chat, with the same filter for count and page', async () => {
    const { svc, calls } = service([{ jid: LID, alt: PN }]);
    const result = await svc.fetchMessages({ where: { key: { remoteJid: PN } } as any });

    assert.equal(calls.raw, 1);
    assert.deepEqual(remoteJidsOf(calls.findMany[0].where), [PN, LID]);
    assert.deepEqual(calls.count[0].where, calls.findMany[0].where);
    assert.deepEqual(calls.findMany[0].orderBy, [{ messageTimestamp: 'desc' }, { id: 'desc' }]);
    assert.deepEqual(result.messages, { total: 0, pages: 0, currentPage: 1, records: [] });
  });

  test('mergeLid: false keeps the exact JID and skips the lookup', async () => {
    const { svc, calls } = service([{ jid: LID, alt: PN }]);
    await svc.fetchMessages({ where: { key: { remoteJid: PN } } as any, mergeLid: false });

    assert.equal(calls.raw, 0);
    assert.deepEqual(remoteJidsOf(calls.findMany[0].where), [PN]);
  });

  test('groups are never looked up nor merged', async () => {
    const { svc, calls } = service([{ jid: LID, alt: PN }]);
    await svc.fetchMessages({ where: { key: { remoteJid: GROUP } } as any });

    assert.equal(calls.raw, 0);
    assert.deepEqual(remoteJidsOf(calls.findMany[0].where), [GROUP]);
  });

  test('a failing lookup falls back to the exact JID', async () => {
    const { svc, calls } = service([]);
    (svc as any).prismaRepository.$queryRaw = async () => {
      throw new Error('boom');
    };
    await svc.fetchMessages({ where: { key: { remoteJid: LID } } as any });

    assert.deepEqual(remoteJidsOf(calls.findMany[0].where), [LID]);
  });
});
