/**
 * "Agenda" + Google Agenda: each instance can connect ONE Google account (the office calendar) with OAuth.
 *
 * - The WhatsAI agenda stays the source of truth (rules, overlaps, reminders, AI tools). Google gets a copy:
 *   every appointment created, rescheduled, confirmed or cancelled here is written to the connected calendar
 *   (event id derived from the appointment id, so a retry never duplicates).
 * - Busy times of the connected calendar (events the office already has there) block those slots for the AI and
 *   for the team. Fail-open: if Google does not answer, the agenda keeps working with its own appointments and the
 *   error shows up in the panel.
 * - The connection lives in GlobalSetting "gcal:<instanceId>" (control database, no migration): e-mail, calendar
 *   and the refresh token encrypted with AES-256-GCM. Access tokens stay in memory only.
 * - Scopes: openid, email and calendar.events (create/change the events and read the events to know busy times).
 *
 * Environment (Render): GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, optional GOOGLE_REDIRECT_URI (default
 * <SERVER_URL>/agenda/google/callback), GOOGLE_RETURN_URL (panel origin, default https://whatsaibr.vercel.app) and
 * GOOGLE_TOKEN_KEY (encryption key; default derived from the global API key). Without the client id/secret the
 * integration reports "não configurada" and nothing else changes.
 */
import { Interval } from '@utils/agenda';
import {
  authUrl,
  busyFromEvents,
  decryptToken,
  emailFromIdToken,
  encryptToken,
  eventBody,
  GOOGLE_CALENDAR_API,
  GOOGLE_REVOKE_URL,
  GOOGLE_TOKEN_URL,
  googleEventId,
  hasEventsScope,
  signState,
  verifyState,
} from '@utils/google-calendar';

export type GoogleFetch = (
  url: string,
  init?: any,
) => Promise<{ ok: boolean; status: number; json(): Promise<any>; text?(): Promise<string> }>;

export type GoogleCalendarOptions = {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  /** Origin of the panel, for the redirect after the Google consent screen. */
  returnUrl?: string;
  /** Secret for the state HMAC and the token encryption. */
  secret: string;
  fetchImpl?: GoogleFetch;
  now?: () => number;
  timeoutMs?: number;
  log?: (level: 'log' | 'warn' | 'error', message: string) => void;
};

export type GoogleLink = {
  email: string | null;
  calendarId: string;
  refresh: string;
  connectedAt: string;
  status: 'ok' | 'error';
  lastError: string | null;
  lastSyncAt: string | null;
};

export class GoogleCalendarError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'GoogleCalendarError';
  }
}

const LINK_TTL_MS = 10 * 60_000;
const BUSY_TTL_MS = 60_000;
const SYNC_FUTURE_MAX = 200;
const REVOKED =
  'A conexão com o Google Agenda expirou ou foi removida na conta Google. Clique em "Conectar Google Agenda" de novo.';

export class GoogleCalendarService {
  private readonly links = new Map<string, { at: number; link: GoogleLink | null }>();
  private readonly tokens = new Map<string, { token: string; until: number }>();
  private readonly busyCache = new Map<string, { at: number; from: number; to: number; items: Interval[] }>();

  constructor(
    private readonly prisma: any,
    private readonly options: GoogleCalendarOptions,
  ) {}

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private log(level: 'log' | 'warn' | 'error', message: string) {
    this.options.log?.(level, message);
  }

  /** The Google client id and secret are set (Render). */
  public available(): boolean {
    return !!(this.options.clientId && this.options.clientSecret && this.options.redirectUri);
  }

  private fetch(url: string, init: any = {}) {
    const impl: GoogleFetch = this.options.fetchImpl ?? (globalThis.fetch as any);
    return impl(url, { ...init, signal: AbortSignal.timeout(this.options.timeoutMs ?? 8_000) });
  }

  // ------------------------------------------------------------------------------------------ storage

  private key(instanceId: string) {
    return `gcal:${instanceId}`;
  }

  public async getLink(instanceId: string): Promise<GoogleLink | null> {
    const hit = this.links.get(instanceId);
    if (hit && this.now() - hit.at < LINK_TTL_MS) return hit.link;
    const row = await this.prisma.globalSetting
      .findUnique({ where: { key: this.key(instanceId) } })
      .catch((): any => null);
    const value = row?.value;
    const link: GoogleLink | null =
      value && typeof value === 'object' && typeof value.refresh === 'string' ? (value as GoogleLink) : null;
    this.links.set(instanceId, { at: this.now(), link });
    return link;
  }

  private async saveLink(instanceId: string, link: GoogleLink | null) {
    if (link) {
      await this.prisma.globalSetting.upsert({
        where: { key: this.key(instanceId) },
        create: { key: this.key(instanceId), value: link },
        update: { value: link },
      });
    } else {
      await this.prisma.globalSetting.deleteMany({ where: { key: this.key(instanceId) } });
    }
    this.links.set(instanceId, { at: this.now(), link });
    this.busyCache.delete(instanceId);
    if (!link) this.tokens.delete(instanceId);
  }

  /** Marks the link with an error (shown in the panel); no-op when it already says the same. */
  private async noteError(instanceId: string, link: GoogleLink, message: string | null) {
    const status = message ? 'error' : 'ok';
    if (link.status === status && link.lastError === message) return;
    await this.saveLink(instanceId, { ...link, status, lastError: message }).catch(() => undefined);
  }

  /** What the panel shows. Never the tokens. */
  public async status(instanceId: string) {
    const link = this.available() ? await this.getLink(instanceId) : null;
    return {
      available: this.available(),
      connected: !!link,
      email: link?.email ?? null,
      calendarId: link?.calendarId ?? null,
      status: link?.status ?? null,
      lastError: link?.lastError ?? null,
      lastSyncAt: link?.lastSyncAt ?? null,
      connectedAt: link?.connectedAt ?? null,
    };
  }

  // -------------------------------------------------------------------------------------------- OAuth

  /** URL of the Google consent screen for this instance (the state expires in 10 min). */
  public connectUrl(instanceId: string, loginHint?: string | null): string {
    if (!this.available())
      throw new GoogleCalendarError('A integração com o Google Agenda não está configurada no servidor.');
    return authUrl({
      clientId: this.options.clientId!,
      redirectUri: this.options.redirectUri!,
      state: signState(instanceId, this.options.secret, this.now()),
      loginHint,
    });
  }

  /** Instance of a still valid state (to send the browser back to the right page even when the exchange fails). */
  public instanceFromState(state: unknown): string | null {
    return verifyState(state, this.options.secret, this.now());
  }

  /** Where the browser goes after the callback. */
  public returnTo(instanceId: string | null, result: 'ok' | 'erro', message?: string): string {
    const base = (this.options.returnUrl || 'https://whatsaibr.vercel.app').replace(/\/+$/, '');
    const path = instanceId ? `/manager/instance/${encodeURIComponent(instanceId)}/agenda` : '/manager/';
    const query = new URLSearchParams({ google: result });
    if (message) query.set('msg', message.slice(0, 200));
    return `${base}${path}?${query}`;
  }

  /** Exchanges the code of the callback; returns the instance id. Throws GoogleCalendarError with a PT-BR message. */
  public async finishConnect(code: unknown, state: unknown): Promise<string> {
    if (!this.available())
      throw new GoogleCalendarError('A integração com o Google Agenda não está configurada no servidor.');
    const instanceId = verifyState(state, this.options.secret, this.now());
    if (!instanceId)
      throw new GoogleCalendarError('O link de conexão expirou. Clique em "Conectar Google Agenda" de novo.');
    const text = String(code ?? '');
    if (!text || text.length > 2048) throw new GoogleCalendarError('O Google não devolveu a autorização.');
    const response = await this.fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: text,
        client_id: this.options.clientId!,
        client_secret: this.options.clientSecret!,
        redirect_uri: this.options.redirectUri!,
        grant_type: 'authorization_code',
      }).toString(),
    }).catch(() => null);
    const data: any = response ? await response.json().catch(() => ({})) : {};
    if (!response?.ok || !data?.access_token) {
      this.log('warn', `Google token exchange failed: HTTP ${response?.status ?? 'sem resposta'} ${data?.error ?? ''}`);
      throw new GoogleCalendarError('O Google recusou a conexão. Tente de novo.');
    }
    if (!hasEventsScope(data.scope)) {
      throw new GoogleCalendarError(
        'Faltou a permissão da agenda. Conecte de novo e deixe marcada a opção de ver e editar eventos.',
      );
    }
    const previous = await this.getLink(instanceId);
    const refresh = data.refresh_token
      ? encryptToken(String(data.refresh_token), this.options.secret)
      : previous?.refresh;
    if (!refresh) throw new GoogleCalendarError('O Google não enviou o acesso permanente. Tente conectar de novo.');
    const link: GoogleLink = {
      email: emailFromIdToken(data.id_token) ?? previous?.email ?? null,
      calendarId: 'primary',
      refresh,
      connectedAt: new Date(this.now()).toISOString(),
      status: 'ok',
      lastError: null,
      lastSyncAt: null,
    };
    await this.saveLink(instanceId, link);
    this.tokens.set(instanceId, {
      token: String(data.access_token),
      until: this.now() + Math.max(60, Number(data.expires_in) || 3600) * 1000 - 60_000,
    });
    this.log('log', `Google Agenda conectado na instância ${instanceId}`);
    return instanceId;
  }

  public async disconnect(instanceId: string): Promise<void> {
    const link = await this.getLink(instanceId);
    if (!link) return;
    const token = decryptToken(link.refresh, this.options.secret);
    if (token) {
      await this.fetch(`${GOOGLE_REVOKE_URL}?${new URLSearchParams({ token })}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }).catch(() => null);
    }
    await this.saveLink(instanceId, null);
    this.log('log', `Google Agenda desconectado na instância ${instanceId}`);
  }

  private async accessToken(instanceId: string, link: GoogleLink): Promise<string> {
    const hit = this.tokens.get(instanceId);
    if (hit && hit.until > this.now()) return hit.token;
    const refresh = decryptToken(link.refresh, this.options.secret);
    if (!refresh) {
      await this.noteError(instanceId, link, REVOKED);
      throw new GoogleCalendarError(REVOKED);
    }
    const response = await this.fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.options.clientId!,
        client_secret: this.options.clientSecret!,
        refresh_token: refresh,
        grant_type: 'refresh_token',
      }).toString(),
    });
    const data: any = await response.json().catch(() => ({}));
    if (!response.ok || !data?.access_token) {
      if (data?.error === 'invalid_grant' || response.status === 400 || response.status === 401) {
        await this.noteError(instanceId, link, REVOKED);
        throw new GoogleCalendarError(REVOKED, response.status);
      }
      throw new GoogleCalendarError(`Google indisponível (HTTP ${response.status}).`, response.status);
    }
    const token = String(data.access_token);
    this.tokens.set(instanceId, {
      token,
      until: this.now() + Math.max(60, Number(data.expires_in) || 3600) * 1000 - 60_000,
    });
    return token;
  }

  /** Calendar API call with the access token of the instance (one retry with a fresh token on 401). */
  private async api(instanceId: string, link: GoogleLink, path: string, init: any = {}, retry = true): Promise<any> {
    const token = await this.accessToken(instanceId, link);
    const response = await this.fetch(`${GOOGLE_CALENDAR_API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    if (response.status === 401 && retry) {
      this.tokens.delete(instanceId);
      return this.api(instanceId, link, path, init, false);
    }
    return response;
  }

  // ---------------------------------------------------------------------------------------- busy times

  /** Busy intervals of the connected calendar in [from, to). [] when not connected or Google fails (fail-open). */
  public async busy(instanceId: string, from: Date, to: Date, timeZone: string): Promise<Interval[]> {
    if (!this.available()) return [];
    const link = await this.getLink(instanceId);
    if (!link) return [];
    const now = this.now();
    const hit = this.busyCache.get(instanceId);
    if (hit && now - hit.at < BUSY_TTL_MS && hit.from <= +from && hit.to >= +to) {
      return hit.items.filter((item) => +item.end > +from && +item.start < +to);
    }
    try {
      const items: any[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < 4; page++) {
        const query = new URLSearchParams({
          timeMin: from.toISOString(),
          timeMax: to.toISOString(),
          singleEvents: 'true',
          maxResults: '250',
          fields: 'items(id,status,transparency,start,end,extendedProperties),nextPageToken',
        });
        if (pageToken) query.set('pageToken', pageToken);
        const response = await this.api(
          instanceId,
          link,
          `/calendars/${encodeURIComponent(link.calendarId)}/events?${query}`,
        );
        const data: any = await response.json().catch(() => ({}));
        if (!response.ok)
          throw new GoogleCalendarError(`Google Agenda respondeu HTTP ${response.status}.`, response.status);
        items.push(...(Array.isArray(data.items) ? data.items : []));
        pageToken = data.nextPageToken;
        if (!pageToken) break;
      }
      const busy = busyFromEvents(items, timeZone);
      this.busyCache.set(instanceId, { at: now, from: +from, to: +to, items: busy });
      if (link.status === 'error' && link.lastError !== REVOKED) await this.noteError(instanceId, link, null);
      return busy;
    } catch (error) {
      this.log('warn', `Google Agenda (horários ocupados) da instância ${instanceId}: ${error?.message ?? error}`);
      if (!(error instanceof GoogleCalendarError) || error.message !== REVOKED) {
        await this.noteError(instanceId, link, 'Não consegui ler os horários ocupados do Google Agenda agora.');
      }
      return [];
    }
  }

  // ------------------------------------------------------------------------------------------- writing

  /** Writes one appointment to the connected calendar. Never throws (the agenda does not depend on Google). */
  public async syncAppointment(instanceId: string, row: any, timeZone: string, location?: string | null) {
    if (!this.available() || !row?.id) return;
    const link = await this.getLink(instanceId).catch((): null => null);
    if (!link) return;
    const path = `/calendars/${encodeURIComponent(link.calendarId)}/events`;
    const id = googleEventId(row.id);
    try {
      if (row.status === 'cancelado') {
        const response = await this.api(instanceId, link, `${path}/${id}?sendUpdates=none`, { method: 'DELETE' });
        if (!response.ok && response.status !== 404 && response.status !== 410) {
          throw new GoogleCalendarError(`HTTP ${response.status}`, response.status);
        }
      } else {
        const body = JSON.stringify(eventBody(row, timeZone, location));
        let response = await this.api(instanceId, link, `${path}/${id}?sendUpdates=none`, { method: 'PUT', body });
        // 404: first write of this appointment; 410: the event was deleted in Google (an id cannot be reused,
        // so a deleted event stays deleted: the appointment lives on in the WhatsAI agenda)
        if (response.status === 404) {
          response = await this.api(instanceId, link, `${path}?sendUpdates=none`, { method: 'POST', body });
        }
        if (!response.ok && response.status !== 409 && response.status !== 410) {
          throw new GoogleCalendarError(`HTTP ${response.status}`, response.status);
        }
      }
      this.busyCache.delete(instanceId);
      const fresh = await this.getLink(instanceId);
      if (fresh) {
        await this.saveLink(instanceId, {
          ...fresh,
          status: 'ok',
          lastError: null,
          lastSyncAt: new Date(this.now()).toISOString(),
        }).catch(() => undefined);
      }
    } catch (error) {
      this.log('warn', `Google Agenda (gravar ${row.id}) da instância ${instanceId}: ${error?.message ?? error}`);
      const fresh = await this.getLink(instanceId).catch((): null => null);
      if (fresh && fresh.lastError !== REVOKED) {
        await this.noteError(
          instanceId,
          fresh,
          'Um agendamento não foi copiado para o Google Agenda. Ele continua no WhatsAI.',
        );
      }
    }
  }

  /** After connecting: copies the future appointments (up to 200), one at a time. */
  public async syncFuture(
    instanceId: string,
    rows: any[],
    timeZone: string,
    locationOf: (row: any) => string | null = () => null,
  ): Promise<number> {
    let done = 0;
    for (const row of rows.slice(0, SYNC_FUTURE_MAX)) {
      await this.syncAppointment(instanceId, row, timeZone, locationOf(row));
      done++;
    }
    return done;
  }
}
