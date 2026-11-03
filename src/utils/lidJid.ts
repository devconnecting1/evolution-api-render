/**
 * WhatsApp addresses the same private chat either by phone number (`<number>@s.whatsapp.net`) or by LID
 * (`<id>@lid`). Baileys stores incoming messages under whichever one the server used and keeps the other in
 * `key.remoteJidAlt` (or `key.senderPn` / `key.senderLid`), while messages sent by the API are usually stored
 * under the phone JID: one conversation ends up split between two JIDs. These helpers pair the two addresses and
 * merge what was split, without touching what is stored.
 */

export type LidPnPair = { lid: string; pn: string };

export const isLidJid = (jid: unknown): jid is string => typeof jid === 'string' && jid.endsWith('@lid');

export const isPnJid = (jid: unknown): jid is string => typeof jid === 'string' && jid.endsWith('@s.whatsapp.net');

/** `5511999999999:12@s.whatsapp.net` -> `5511999999999@s.whatsapp.net` (the chat is per user, not per device). */
export function normalizeUserJid(jid: unknown): string | null {
  if (typeof jid !== 'string' || !jid.includes('@')) return null;

  const [user, server] = jid.split('@');
  const bareUser = user.split(':')[0];

  return bareUser && server ? `${bareUser}@${server}` : null;
}

/** The LID/phone pair of two addresses of one chat, whatever their order; null when they are not such a pair. */
export function toLidPnPair(a: unknown, b: unknown): LidPnPair | null {
  const first = normalizeUserJid(a);
  const second = normalizeUserJid(b);

  if (isLidJid(first) && isPnJid(second)) return { lid: first, pn: second };
  if (isPnJid(first) && isLidJid(second)) return { lid: second, pn: first };

  return null;
}

/** Every address of the chat of `jid` (itself first) according to the known pairs. Groups are never paired. */
export function equivalentJids(jid: string, pairs: LidPnPair[]): string[] {
  const jids = new Set<string>([jid]);
  const normalized = normalizeUserJid(jid);

  if (!isLidJid(normalized) && !isPnJid(normalized)) return [jid];

  for (const pair of pairs) {
    if (pair.lid === normalized || pair.pn === normalized) {
      jids.add(pair.lid);
      jids.add(pair.pn);
    }
  }

  return [...jids];
}

/** LID -> phone JID. A LID seen with more than one phone number (should not happen) keeps the first one. */
export function lidToPnMap(pairs: LidPnPair[]): Map<string, string> {
  const map = new Map<string, string>();

  for (const pair of pairs) {
    if (!map.has(pair.lid)) map.set(pair.lid, pair.pn);
  }

  return map;
}

/** Accepts `false`/`'false'`/`0`/`'0'` as "off"; anything else (including absent) keeps the default (on). */
export function parseMergeLid(...values: unknown[]): boolean {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    if (value === false || value === 0) return false;
    if (typeof value === 'string') return !['false', '0', 'no', 'off'].includes(value.trim().toLowerCase());
    return true;
  }

  return true;
}

export type ChatListItem = {
  id?: string | null;
  remoteJid: string;
  remoteJidAlt?: string;
  pushName?: string | null;
  profilePicUrl?: string | null;
  updatedAt?: Date | string | null;
  windowStart?: Date | string | null;
  windowExpires?: Date | string | null;
  windowActive?: boolean | null;
  lastMessage?: { messageTimestamp?: number | string | null; [key: string]: any } | undefined;
  unreadCount?: number | null;
  isSaved?: boolean;
  [key: string]: any;
};

const time = (value: Date | string | null | undefined): number => {
  if (value === null || value === undefined) return Number.NEGATIVE_INFINITY;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
};

const lastMessageTime = (chat: ChatListItem): number => {
  const timestamp = Number(chat.lastMessage?.messageTimestamp);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp * 1000 : time(chat.updatedAt);
};

/** Newest first, chats without a date last (the order of the chat list query). */
export function compareChatsByUpdatedAt(a: ChatListItem, b: ChatListItem): number {
  const ta = time(a.updatedAt);
  const tb = time(b.updatedAt);

  if (ta === tb) return 0;
  return tb > ta ? 1 : -1;
}

function mergePair(pnChat: ChatListItem | undefined, lidChat: ChatListItem | undefined, pn: string, lid: string) {
  // The phone row is the main one (sending to the phone JID always works); the LID row fills in the gaps
  const primary = pnChat ?? lidChat;
  const secondary = pnChat ? lidChat : undefined;
  const newest = secondary && lastMessageTime(secondary) > lastMessageTime(primary) ? secondary : primary;

  const unread = [pnChat?.unreadCount, lidChat?.unreadCount].filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );

  const updatedAt =
    secondary && time(secondary.updatedAt) > time(primary.updatedAt) ? secondary.updatedAt : primary.updatedAt;

  return {
    ...primary,
    id: primary.id ?? secondary?.id ?? null,
    remoteJid: pn,
    remoteJidAlt: lid,
    pushName: primary.pushName || secondary?.pushName || primary.pushName,
    profilePicUrl: primary.profilePicUrl || secondary?.profilePicUrl || primary.profilePicUrl,
    updatedAt,
    windowStart: primary.windowStart ?? secondary?.windowStart,
    windowExpires: primary.windowExpires ?? secondary?.windowExpires,
    windowActive: primary.windowActive ?? secondary?.windowActive,
    lastMessage: newest.lastMessage ?? primary.lastMessage ?? secondary?.lastMessage,
    unreadCount: unread.length ? unread.reduce((sum, value) => sum + value, 0) : primary.unreadCount,
    isSaved: !!(primary.isSaved || secondary?.isSaved),
  };
}

/**
 * One entry per contact: a `@lid` chat whose phone number is known is folded into the phone chat (or, when there
 * is no phone chat, shown under the phone JID), with the LID kept in `remoteJidAlt`. Groups, and LIDs whose phone
 * number is unknown, pass through untouched. The result is sorted like the chat list (newest `updatedAt` first).
 */
export function mergeLidChats<T extends ChatListItem>(
  chats: T[],
  pairs: LidPnPair[],
): (T & { remoteJidAlt?: string })[] {
  const pnOfLid = lidToPnMap(pairs);
  const groups = new Map<string, { pn?: T; lid?: T; lidJid?: string }>();
  const order: (T | string)[] = [];

  for (const chat of chats) {
    const jid = chat?.remoteJid;
    const pnFromLid = isLidJid(jid) ? pnOfLid.get(jid) : undefined;
    const canonical = pnFromLid ?? (isPnJid(jid) ? jid : undefined);

    if (!canonical) {
      order.push(chat);
      continue;
    }

    let group = groups.get(canonical);
    if (!group) {
      group = {};
      groups.set(canonical, group);
      order.push(canonical);
    }

    if (pnFromLid) {
      // Two LID rows for one phone (should not happen): keep the newest one
      if (!group.lid || lastMessageTime(chat) > lastMessageTime(group.lid)) {
        group.lid = chat;
        group.lidJid = jid;
      }
    } else if (!group.pn || lastMessageTime(chat) > lastMessageTime(group.pn)) {
      group.pn = chat;
    }
  }

  const merged = order.map((entry): T & { remoteJidAlt?: string } => {
    if (typeof entry !== 'string') return entry;

    const group = groups.get(entry);
    if (!group.lid) return group.pn;

    return mergePair(group.pn, group.lid, entry, group.lidJid) as T;
  });

  return merged.sort(compareChatsByUpdatedAt);
}
