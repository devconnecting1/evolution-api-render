import '../helpers/setup';

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { BaileysStartupService } from '@api/integrations/channel/whatsapp/whatsapp.baileys.service';
import { PrismaRepository } from '@api/repository/repository.service';
import { ChannelStartupService } from '@api/services/channel.service';
import { configService } from '@config/env.config';
import EventEmitter2 from 'eventemitter2';

import { nextId } from '../helpers/fakes';
import { migrateTestDatabase, SKIP_INTEGRATION } from '../helpers/integration';

/**
 * findMessages/findChats on a real PostgreSQL with the shape of production data: incoming messages of a contact
 * stored under its `@lid` (phone JID in `key.remoteJidAlt`), the messages sent to it under the phone JID, a
 * group, and a `@lid` contact whose phone number is unknown.
 */
describe(
  'findMessages/findChats: one conversation for a LID and its phone JID (integration)',
  { skip: SKIP_INTEGRATION },
  () => {
    const prisma = new PrismaRepository(configService);
    let instanceId: string;
    let base: ChannelStartupService;
    let baileys: BaileysStartupService;

    const suffix = String(Date.now()).slice(-8);
    const LID = `9${suffix}123456@lid`;
    const PN = `55119${suffix}@s.whatsapp.net`;
    const LID_ONLY = `8${suffix}654321@lid`;
    const OTHER_PN = `55219${suffix}@s.whatsapp.net`;
    const GROUP = `120363${suffix}0000@g.us`;

    // Timestamps of the split conversation: LID 1000/1002/1004 (with alt) and 1005 (without), phone 1001/1003/1006
    const SPLIT = [1006, 1005, 1004, 1003, 1002, 1001, 1000];

    const msg = (key: Record<string, any>, ts: number) => ({
      key: { id: `M${nextId()}`, fromMe: false, ...key },
      messageType: 'conversation',
      message: { conversation: `ts ${ts}` },
      messageTimestamp: ts,
      source: 'unknown' as const,
      instanceId,
    });

    before(async () => {
      migrateTestDatabase();
      await prisma.$connect();

      const instance = await prisma.instance.create({
        data: { name: `lid-${nextId()}`.toLowerCase(), integration: 'WHATSAPP-BAILEYS', connectionStatus: 'open' },
      });
      instanceId = instance.id;

      await prisma.message.createMany({
        data: [
          msg({ remoteJid: LID, remoteJidAlt: PN, addressingMode: 'lid', participant: '' }, 1000),
          msg({ remoteJid: PN, fromMe: true }, 1001),
          msg({ remoteJid: LID, remoteJidAlt: PN, addressingMode: 'lid' }, 1002),
          msg({ remoteJid: PN, fromMe: true }, 1003),
          msg({ remoteJid: LID, remoteJidAlt: PN, addressingMode: 'lid' }, 1004),
          msg({ remoteJid: LID }, 1005),
          msg({ remoteJid: PN, fromMe: true }, 1006),
          // Group: a member is the same contact, which must not pull the group into the private chat or vice versa
          msg({ remoteJid: GROUP, participant: LID, participantAlt: PN }, 1500),
          msg({ remoteJid: GROUP, participant: LID, participantAlt: PN }, 1501),
          // LID never seen with a phone number
          msg({ remoteJid: LID_ONLY }, 2000),
          msg({ remoteJid: LID_ONLY, fromMe: true }, 2001),
          msg({ remoteJid: OTHER_PN }, 900),
        ],
      });

      await prisma.chat.createMany({
        data: [
          { instanceId, remoteJid: PN, unreadMessages: 2 },
          { instanceId, remoteJid: LID, name: 'Maria', unreadMessages: 3 },
          { instanceId, remoteJid: GROUP, name: 'Grupo', unreadMessages: 1 },
        ],
      });
      await prisma.contact.create({ data: { instanceId, remoteJid: LID, pushName: 'Maria' } });

      base = new ChannelStartupService(configService, new EventEmitter2(), prisma, {} as any);
      base.setInstance({ instanceName: 'lid-base', instanceId } as any);

      const cache: any = { get: async () => null, set: async () => undefined, delete: async () => undefined };
      baileys = new BaileysStartupService(configService, new EventEmitter2(), prisma, cache, cache, cache, {} as any);
      baileys.setInstance({ instanceName: 'lid-baileys', instanceId, integration: 'WHATSAPP-BAILEYS' } as any);
    });

    after(async () => {
      if (instanceId) await prisma.instance.delete({ where: { id: instanceId } });
      await prisma.$disconnect();
    });

    const timestamps = (result: any) => result.messages.records.map((r: any) => r.messageTimestamp);
    const find = (svc: ChannelStartupService, remoteJid: string, extra: Record<string, any> = {}) =>
      svc.fetchMessages({ where: { key: { remoteJid } } as any, ...extra });

    for (const [name, svc] of [
      ['ChannelStartupService', () => base],
      ['BaileysStartupService', () => baileys],
    ] as const) {
      test(`${name}: the split conversation comes back whole and in order, from either JID`, async () => {
        for (const jid of [LID, PN]) {
          const result = await find(svc(), jid);
          assert.deepEqual(timestamps(result), SPLIT, jid);
          assert.equal(result.messages.total, 7);
          assert.equal(result.messages.pages, 1);
          assert.equal(result.messages.currentPage, 1);
        }
      });

      test(`${name}: pages of the merged conversation, with the right total`, async () => {
        const pages = [];
        for (const page of [1, 2, 3]) {
          const result = await find(svc(), PN, { offset: 3, page });
          assert.equal(result.messages.total, 7);
          assert.equal(result.messages.pages, 3);
          assert.equal(result.messages.currentPage, page);
          pages.push(timestamps(result));
        }
        assert.deepEqual(pages, [SPLIT.slice(0, 3), SPLIT.slice(3, 6), SPLIT.slice(6)]);
      });

      test(`${name}: mergeLid false keeps the old exact-JID behaviour`, async () => {
        assert.deepEqual(timestamps(await find(svc(), PN, { mergeLid: false })), [1006, 1003, 1001]);
        const lid = await find(svc(), LID, { mergeLid: false });
        assert.deepEqual(timestamps(lid), [1005, 1004, 1002, 1000]);
        assert.equal(lid.messages.total, 4);
      });

      test(`${name}: groups and LIDs without a phone number are not affected`, async () => {
        assert.deepEqual(timestamps(await find(svc(), GROUP)), [1501, 1500]);
        const lidOnly = await find(svc(), LID_ONLY);
        assert.deepEqual(timestamps(lidOnly), [2001, 2000]);
        assert.equal(lidOnly.messages.total, 2);
        assert.deepEqual(timestamps(await find(svc(), OTHER_PN)), [900]);
      });
    }

    test('findChats: one entry per contact, phone JID first, LID in remoteJidAlt', async () => {
      const chats: any[] = await base.fetchChats({});

      assert.deepEqual(
        chats.map((c) => c.remoteJid),
        [LID_ONLY, GROUP, PN, OTHER_PN],
      );

      const contact = chats.find((c) => c.remoteJid === PN);
      assert.equal(contact.remoteJidAlt, LID);
      assert.equal(contact.unreadCount, 5);
      assert.equal(contact.lastMessage.messageTimestamp, 1006);
      // Name and saved contact of the LID row fill in what the phone row lacks
      assert.equal(contact.pushName, 'Maria');
      assert.equal(contact.isSaved, true);
      assert.equal(new Date(contact.updatedAt).getTime(), 1006 * 1000);

      const group = chats.find((c) => c.remoteJid === GROUP);
      assert.equal(group.remoteJidAlt, undefined);
      assert.equal(group.unreadCount, 1);
      assert.equal(chats.find((c) => c.remoteJid === LID_ONLY).remoteJidAlt, undefined);
    });

    test('findChats: take/skip page the merged list', async () => {
      const first: any[] = await base.fetchChats({ take: 2, skip: 0 });
      const second: any[] = await base.fetchChats({ take: 2, skip: 2 });

      assert.deepEqual(
        [...first, ...second].map((c) => c.remoteJid),
        [LID_ONLY, GROUP, PN, OTHER_PN],
      );
    });

    test('findChats: a remoteJid filter by either JID returns the merged entry', async () => {
      for (const jid of [LID, PN]) {
        const chats: any[] = await base.fetchChats({ where: { remoteJid: jid } });
        assert.equal(chats.length, 1, jid);
        assert.equal(chats[0].remoteJid, PN);
        assert.equal(chats[0].remoteJidAlt, LID);
        assert.equal(chats[0].lastMessage.messageTimestamp, 1006);
      }
    });

    test('findChats: mergeLid false lists the LID and the phone JID apart, as before', async () => {
      const chats: any[] = await base.fetchChats({ mergeLid: false });

      assert.deepEqual(
        chats.map((c) => c.remoteJid),
        [LID_ONLY, GROUP, PN, LID, OTHER_PN],
      );
      assert.ok(chats.every((c) => c.remoteJidAlt === undefined));

      const limited: any[] = await base.fetchChats({ mergeLid: false, take: 2, skip: 1 });
      assert.deepEqual(
        limited.map((c) => c.remoteJid),
        [GROUP, PN],
      );
    });

    test('BaileysStartupService: LID mapping of the connection pairs a LID no stored message pairs', async () => {
      const lookups: string[] = [];
      (baileys as any).client = {
        signalRepository: {
          lidMapping: {
            getPNForLID: async (lid: string) => {
              lookups.push(lid);
              return lid === LID_ONLY ? OTHER_PN.replace('@', ':0@') : null;
            },
          },
        },
      };

      try {
        const result = await find(baileys, LID_ONLY);
        assert.deepEqual(lookups, [LID_ONLY]);
        assert.deepEqual(timestamps(result), [2001, 2000, 900]);
      } finally {
        (baileys as any).client = undefined;
      }
    });
  },
);
