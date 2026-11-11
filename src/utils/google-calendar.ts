/**
 * Google Calendar ("Google Agenda") integration of the Agenda: pure helpers (no I/O), used by
 * src/api/services/google-calendar.service.ts and tested in test/unit/googleCalendar.test.ts.
 *
 * - OAuth state: "<payload>.<hmac>" (base64url JSON {i: instanceId, e: expiry ms, n: nonce} + HMAC-SHA256), so the
 *   public callback only accepts a code started by an authenticated "Conectar" of that instance, for 10 minutes.
 * - Refresh token at rest: AES-256-GCM ("v1.<iv>.<tag>.<ciphertext>", base64url), key derived from
 *   GOOGLE_TOKEN_KEY (or, when unset, from the global API key with a fixed prefix).
 * - Event ids: Google accepts a client-chosen id (base32hex: 0-9 a-v, 5 to 1024 characters; "w" is not allowed,
 *   so not "wa..."). The event of an appointment is "ag" + 40 hex characters of sha256(appointment id): the same
 *   appointment always maps to the same event, nothing has to be stored per appointment.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

import { Interval, localToUtc, MODE_LABELS, shortName } from './agenda';

export const GOOGLE_SCOPE_EVENTS = 'https://www.googleapis.com/auth/calendar.events';
export const GOOGLE_SCOPES = ['openid', 'email', GOOGLE_SCOPE_EVENTS];
export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
export const STATE_TTL_MS = 10 * 60_000;

const b64url = (buf: Buffer) => buf.toString('base64url');

/** 32-byte key for the state HMAC and the token encryption. */
export function deriveKey(secret: string, purpose: 'state' | 'token'): Buffer {
  return createHash('sha256').update(`whatsai-gcal:${purpose}:${secret}`).digest();
}

export function signState(instanceId: string, secret: string, now: number, nonce = b64url(randomBytes(9))): string {
  const payload = b64url(Buffer.from(JSON.stringify({ i: instanceId, e: now + STATE_TTL_MS, n: nonce })));
  const mac = b64url(createHmac('sha256', deriveKey(secret, 'state')).update(payload).digest());
  return `${payload}.${mac}`;
}

/** The instance id of a valid, unexpired state; null otherwise. */
export function verifyState(state: unknown, secret: string, now: number): string | null {
  const text = String(state ?? '');
  if (text.length > 600) return null;
  const [payload, mac, extra] = text.split('.');
  if (!payload || !mac || extra !== undefined) return null;
  const expected = createHmac('sha256', deriveKey(secret, 'state')).update(payload).digest();
  let given: Buffer;
  try {
    given = Buffer.from(mac, 'base64url');
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof data?.i !== 'string' || !data.i || typeof data?.e !== 'number' || data.e < now) return null;
    return data.i;
  } catch {
    return null;
  }
}

export function encryptToken(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret, 'token'), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', b64url(iv), b64url(cipher.getAuthTag()), b64url(data)].join('.');
}

/** null when the text was not produced with this secret (or was changed). */
export function decryptToken(sealed: unknown, secret: string): string | null {
  const [version, iv, tag, data] = String(sealed ?? '').split('.');
  if (version !== 'v1' || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret, 'token'), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function googleEventId(appointmentId: string): string {
  return 'ag' + createHash('sha256').update(String(appointmentId)).digest('hex').slice(0, 40);
}

/** E-mail of the account from the id_token of the token response (TLS from Google: no signature check needed). */
export function emailFromIdToken(idToken: unknown): string | null {
  const part = String(idToken ?? '').split('.')[1];
  if (!part) return null;
  try {
    const data = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return typeof data?.email === 'string' ? data.email.slice(0, 200) : null;
  } catch {
    return null;
  }
}

export function hasEventsScope(scope: unknown): boolean {
  return String(scope ?? '')
    .split(/\s+/)
    .includes(GOOGLE_SCOPE_EVENTS);
}

export function authUrl(params: { clientId: string; redirectUri: string; state: string; loginHint?: string | null }) {
  const query = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: params.state,
  });
  if (params.loginHint) query.set('login_hint', params.loginHint);
  return `${GOOGLE_AUTH_URL}?${query}`;
}

const GOOGLE_STATUS: Record<string, 'confirmed' | 'tentative'> = {
  pendente: 'tentative',
  agendado: 'confirmed',
  confirmado: 'confirmed',
  realizado: 'confirmed',
  faltou: 'confirmed',
};

/**
 * The Google event of an appointment. Same content as the ICS feed: type, short name, phone, mode, status;
 * never the internal notes (professional secrecy).
 */
export function eventBody(row: any, timeZone: string, location?: string | null) {
  const phone = String(row.remoteJid ?? '')
    .split('@')[0]
    .replace(/\D/g, '');
  const statusLabel: Record<string, string> = {
    pendente: 'aguardando aprovação da equipe',
    agendado: 'agendado',
    confirmado: 'confirmado pelo cliente',
    realizado: 'realizado',
    faltou: 'cliente faltou',
  };
  return {
    id: googleEventId(row.id),
    summary: [row.typeName, shortName(row.contactName)].filter(Boolean).join(' — ').slice(0, 200),
    description: [
      row.contactName ? `Cliente: ${row.contactName}` : null,
      phone ? `WhatsApp: +${phone}` : null,
      row.mode ? `Modo: ${MODE_LABELS[row.mode as keyof typeof MODE_LABELS] ?? row.mode}` : null,
      `Status: ${statusLabel[row.status] ?? row.status}`,
      'Criado pelo WhatsAI. Alterações feitas aqui no Google não mudam o agendamento: use o painel do WhatsAI.',
    ]
      .filter(Boolean)
      .join('\n'),
    location: location || undefined,
    start: { dateTime: new Date(row.startsAt).toISOString(), timeZone },
    end: { dateTime: new Date(row.endsAt).toISOString(), timeZone },
    status: GOOGLE_STATUS[row.status] ?? 'confirmed',
    transparency: 'opaque',
    extendedProperties: { private: { whatsai: '1', appointmentId: String(row.id) } },
  };
}

/**
 * Busy intervals from an events.list response: opaque, not cancelled, not created by WhatsAI (those are already
 * in the internal agenda). All-day events (start.date) block the whole local day only when marked busy.
 */
export function busyFromEvents(items: unknown, timeZone: string): Interval[] {
  const out: Interval[] = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || item.status === 'cancelled' || item.transparency === 'transparent') continue;
    if (item.extendedProperties?.private?.whatsai === '1') continue;
    let start: Date | null = null;
    let end: Date | null = null;
    if (item.start?.dateTime && item.end?.dateTime) {
      start = new Date(item.start.dateTime);
      end = new Date(item.end.dateTime);
    } else if (item.start?.date && item.end?.date) {
      start = localToUtc(String(item.start.date), 0, timeZone);
      end = localToUtc(String(item.end.date), 0, timeZone);
    }
    if (!start || !end || Number.isNaN(+start) || Number.isNaN(+end) || +end <= +start) continue;
    out.push({ id: `google:${String(item.id ?? '').slice(0, 80)}`, start, end });
  }
  return out;
}
