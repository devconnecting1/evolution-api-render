/*
 * WhatsAI Manager: "Central de notificacoes" (window.WaNotif), proposal Y. Plain script, loaded before the bundle.
 *
 * The bell of every header (instance top bar, instances list, global shell) lists what asks for attention, in
 * order of urgency, with the shortcut to fix it: WhatsApp disconnected, new movements in monitored processes,
 * AI answers close to the plan limit and the agenda. It reads ONLY what the screens already request: the response
 * interceptor added by manager/patches/central-notificacoes.py feeds this store from
 * GET /instance/fetchInstances (connection state), /usage/summary/:instance, /processos/:instance(/badge) and
 * /agenda/:instance (today's appointments when the agenda page fetch covers today, and the pending count that
 * the Notificações sidebar item already loads on every instance page). No new request, no timer, no polling.
 *
 * State lives in memory only, so a hard reload starts empty until the first screen feeds it again (navigation
 * inside the panel keeps it). "Marcar como visto" is kept in localStorage (wa-notif-seen-v1), one value per item:
 * a connection state, the usage month, the process movement instant, the process/publication count or the agenda
 * day. A new event changes the value and the item comes back.
 *
 * Rendering lives in the WaNotif.Menu component of the patch (React/JSX); this file only builds the items.
 */
(function () {
  'use strict';

  var SEEN_KEY = 'wa-notif-seen-v1';
  var SEEN_MAX = 300;
  var state = { inst: {}, usage: {}, procs: {}, agenda: {} };
  var seen = {};
  var subs = [];

  try {
    seen = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') || {};
  } catch (e) {
    seen = {};
  }
  if (typeof seen !== 'object' || seen === null || Array.isArray(seen)) seen = {};

  function emit() {
    for (var i = 0; i < subs.length; i++) {
      try { subs[i](); } catch (e) {}
    }
    try { document.dispatchEvent(new CustomEvent('wa-notif:change')); } catch (e) {}
  }

  function saveSeen() {
    var keys = Object.keys(seen);
    if (keys.length > SEEN_MAX) {
      keys.sort();
      for (var i = 0; i < keys.length - SEEN_MAX; i++) delete seen[keys[i]];
    }
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch (e) {}
  }

  function path(url) {
    var s = String(url || '');
    var q = s.indexOf('?');
    if (q >= 0) s = s.slice(0, q);
    q = s.indexOf('#');
    if (q >= 0) s = s.slice(0, q);
    return s;
  }

  function dec(value) {
    try { return decodeURIComponent(value); } catch (e) { return value; }
  }

  function num(value) {
    var n = Number(value);
    return isFinite(n) ? n : 0;
  }

  function fmt(value) {
    try { return new Intl.NumberFormat('pt-BR').format(value); } catch (e) { return String(value); }
  }

  function parts(iso, tz) {
    try {
      var f = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz || 'America/Sao_Paulo',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      });
      var out = {};
      f.formatToParts(new Date(iso)).forEach(function (p) { out[p.type] = p.value; });
      var hour = String(out.hour) === '24' ? '00' : out.hour;
      return { day: out.year + '-' + out.month + '-' + out.day, hm: hour + ':' + out.minute };
    } catch (e) {
      return { day: String(iso || '').slice(0, 10), hm: '' };
    }
  }

  function monthKey() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function rel(ts) {
    var m = Math.max(0, Math.round((Date.now() - ts) / 60000));
    if (m < 1) return 'agora';
    if (m < 60) return 'há ' + m + ' min';
    var h = Math.round(m / 60);
    if (h < 24) return 'há ' + h + ' h';
    return 'há ' + Math.round(h / 24) + ' d';
  }

  function idOf(name) {
    var inst = state.inst[name];
    return inst && inst.id ? String(inst.id) : '';
  }

  function link(name, page) {
    var id = idOf(name);
    return id ? '/manager/instance/' + encodeURIComponent(id) + '/' + page : '';
  }

  function plural(n, one, many) {
    return (n === 1 ? '1 ' + one : fmt(n) + ' ' + many);
  }

  /* ------------------------------------------------------------------ feeds (existing requests only) */
  function ingest(url, data, config) {
    if (!data) return;
    if (config && config.method && String(config.method).toLowerCase() !== 'get') return;
    var u = path(url);
    var m;
    var changed = false;

    if (u === '/instance/fetchInstances') {
      var list = Array.isArray(data) ? data : (data.data && Array.isArray(data.data) ? data.data : [data]);
      for (var i = 0; i < list.length; i++) {
        var x = list[i];
        if (!x || !x.name) continue;
        var status = String(x.connectionStatus || x.connection || x.state || '');
        if (!status) continue;
        var old = state.inst[x.name];
        var since = old && old.status === status ? old.since : Date.now();
        var next = { id: x.id || (old && old.id) || '', name: x.name, status: status, since: since };
        if (!old || old.status !== status || String(old.id) !== String(next.id)) changed = true;
        state.inst[x.name] = next;
      }
    } else if ((m = u.match(/^\/usage\/summary\/([^/]+)$/))) {
      var nameU = dec(m[1]);
      var month = data.month || {};
      var limit = num(month.limit);
      var used = num(month.responses);
      state.usage[nameU] = {
        name: nameU,
        used: used,
        limit: limit,
        pct: limit > 0 ? Math.round((used / limit) * 100) : null,
        plan: (data.limits && data.limits.planName) || '',
        monthKey: monthKey(),
        at: Date.now(),
      };
      changed = true;
    } else if ((m = u.match(/^\/processos\/([^/]+)\/badge$/))) {
      var nameB = dec(m[1]);
      state.procs[nameB] = Object.assign({}, state.procs[nameB] || {}, {
        name: nameB,
        badgeTotal: num(data.total),
        badgeMovements: num(data.processesWithNews),
        badgePublications: num(data.unseenPublications),
        badgeAt: Date.now(),
      });
      changed = true;
    } else if ((m = u.match(/^\/processos\/([^/]+)$/))) {
      var params = (config && config.params) || {};
      if (params.view === 'archived' || params.tribunal || params.from || params.to || params.q) return;
      var nameP = dec(m[1]);
      var items = Array.isArray(data.items) ? data.items : [];
      var news = [];
      var movements = 0;
      for (var j = 0; j < items.length; j++) {
        var p = items[j] || {};
        var unseen = num(p.unseen);
        movements += unseen;
        if (unseen > 0) {
          var last = p.lastMovement || {};
          news.push({
            id: String(p.id || p.numeroCnj || p.numero || ''),
            numero: p.numeroCnj || p.numero || '',
            client: p.clientName || '',
            alias: p.apelido || '',
            unseen: unseen,
            occurredAt: last.occurredAt ? String(last.occurredAt) : '',
          });
        }
      }
      var counts = data.counts || {};
      state.procs[nameP] = Object.assign({}, state.procs[nameP] || {}, {
        name: nameP,
        listMovements: movements,
        listPublications: num(counts.unseenPublications),
        items: news,
        listAt: Date.now(),
      });
      changed = true;
    } else if ((m = u.match(/^\/agenda\/([^/]+)$/))) {
      var paramsA = (config && config.params) || {};
      /* the dashboard asks for one contact (limit 1); never count a contact's agenda as the whole one */
      if (paramsA.contact || paramsA.limit) return;
      var nameA = dec(m[1]);
      var appts = Array.isArray(data.appointments) ? data.appointments : [];
      var statusA = String(paramsA.status || '');
      if (paramsA.from && paramsA.to) {
        var tz = data.timezone || 'America/Sao_Paulo';
        var today = parts(new Date().toISOString(), tz).day;
        var fromDay = String(paramsA.from).slice(0, 10);
        var toDay = String(paramsA.to).slice(0, 10);
        /* a week other than today's must not erase today's count */
        if (!(today >= fromDay && today < toDay)) return;
        var todays = appts.filter(function (a) {
          if (!a || !a.startsAt) return false;
          var status = String(a.status || '');
          if (status === 'cancelado' || status === 'cancelled') return false;
          return parts(a.startsAt, tz).day === today;
        });
        todays.sort(function (a, b) { return String(a.startsAt).localeCompare(String(b.startsAt)); });
        var first = todays[0] || null;
        var curA = state.agenda[nameA] || { name: nameA };
        curA.date = today;
        curA.timezone = tz;
        curA.count = todays.length;
        curA.first = first ? { time: parts(first.startsAt, tz).hm, contact: first.contactName || '', type: first.typeName || '' } : null;
        curA.at = Date.now();
        state.agenda[nameA] = curA;
        changed = true;
      } else if (statusA.indexOf('pendente') >= 0) {
        var curP = state.agenda[nameA] || { name: nameA };
        curP.pending = appts.filter(function (a) {
          return a && String(a.status || '') === 'pendente';
        }).length;
        curP.pendingAt = Date.now();
        state.agenda[nameA] = curP;
        changed = true;
      }
    }

    if (changed) emit();
  }

  /* ------------------------------------------------------------------ items */
  function connItems(out) {
    Object.keys(state.inst).forEach(function (name) {
      var x = state.inst[name];
      if (!x || (x.status !== 'close' && x.status !== 'connecting')) return;
      var down = x.status === 'close';
      out.push({
        key: 'conn:' + name,
        value: x.status + ':' + x.since,
        kind: 'conn',
        urg: down ? 0 : 1,
        tone: down ? 'bad' : 'warn',
        icon: down ? 'unplug' : 'alert',
        title: down ? 'WhatsApp desconectado' : 'WhatsApp aguardando conexão',
        meta: name + ' · ' + rel(x.since),
        href: link(name, 'conexao'),
        action: 'Abrir conexão',
        at: x.since,
      });
    });
  }

  function usageItems(out) {
    Object.keys(state.usage).forEach(function (name) {
      var u = state.usage[name];
      if (!u || u.pct === null || u.pct < 85 || u.monthKey !== monthKey()) return;
      out.push({
        key: 'usage:' + name + ':' + u.monthKey,
        value: u.pct >= 100 ? 'full' : 'high',
        kind: 'usage',
        urg: 2,
        tone: 'warn',
        icon: 'gauge',
        title: u.pct + '% das respostas da IA usadas',
        meta: name + (u.plan ? ' · plano ' + u.plan : '') + ' · ' + fmt(u.used) + ' de ' + fmt(u.limit) + ' neste mês',
        href: link(name, 'usage'),
        action: 'Ver plano',
        at: u.at,
      });
    });
  }

  function procItems(out) {
    Object.keys(state.procs).forEach(function (name) {
      var p = state.procs[name];
      if (!p) return;
      /* the process list is richer and newer than the badge; when it was loaded, it is the total */
      var hasList = !!p.listAt;
      var total = hasList ? (p.listMovements || 0) + (p.listPublications || 0) : (p.badgeTotal || 0);
      if (total < 1) return;
      var items = p.items || [];
      for (var i = 0; i < items.length && i < 4; i++) {
        var x = items[i];
        out.push({
          key: 'proc:' + name + ':' + x.id,
          value: x.occurredAt || 'unseen:' + x.unseen,
          kind: 'proc',
          urg: 1,
          tone: 'warn',
          icon: 'book',
          title: 'Novo andamento no processo',
          meta: (x.numero || x.alias || 'processo') + (x.client ? ' · ' + x.client : '') + ' · ' + name,
          href: link(name, 'processos'),
          action: 'Ver processos',
          at: Date.parse(x.occurredAt || '') || p.listAt || Date.now(),
        });
      }
      if (p.listPublications > 0) {
        out.push({
          key: 'pub:' + name,
          value: String(p.listPublications),
          kind: 'proc',
          urg: 1,
          tone: 'warn',
          icon: 'list',
          title: plural(p.listPublications, 'nova publicação no DJEN', 'novas publicações no DJEN'),
          meta: name + ' · Processos',
          href: link(name, 'processos'),
          action: 'Ver processos',
          at: p.listAt || Date.now(),
        });
      }
      if (!hasList) {
        out.push({
          key: 'procbadge:' + name,
          value: String(total),
          kind: 'proc',
          urg: 1,
          tone: 'warn',
          icon: 'book',
          title: plural(total, 'novidade em processos', 'novidades em processos'),
          meta: name + ' · Processos',
          href: link(name, 'processos'),
          action: 'Ver processos',
          at: p.badgeAt || Date.now(),
        });
      }
    });
  }

  function agendaItems(out) {
    Object.keys(state.agenda).forEach(function (name) {
      var a = state.agenda[name];
      if (!a) return;
      var pending = a.pending === undefined ? 0 : a.pending;
      /* a page left open overnight must not keep saying "hoje" for yesterday */
      var today = parts(new Date().toISOString(), a.timezone || 'America/Sao_Paulo').day;
      var count = a.date === today ? a.count : 0;
      if (count > 0) {
        var meta = name;
        if (a.first) meta += ' · Primeiro às ' + a.first.time + (a.first.contact ? ' · ' + a.first.contact : '');
        if (pending > 0) meta += ' · ' + plural(pending, 'pendente', 'pendentes');
        out.push({
          key: 'agenda:' + name + ':' + a.date,
          value: String(count),
          kind: 'agenda',
          urg: 3,
          tone: 'info',
          icon: 'cal',
          title: plural(count, 'agendamento hoje', 'agendamentos hoje'),
          meta: meta,
          href: link(name, 'agenda'),
          action: 'Abrir agenda',
          at: a.at || Date.now(),
        });
      } else if (pending > 0) {
        out.push({
          key: 'agendapending:' + name,
          value: String(pending),
          kind: 'agenda',
          urg: 3,
          tone: 'info',
          icon: 'cal',
          title: plural(pending, 'agendamento pendente', 'agendamentos pendentes'),
          meta: name + ' · Aguardando aprovação da equipe',
          href: link(name, 'agenda'),
          action: 'Abrir agenda',
          at: a.pendingAt || Date.now(),
        });
      }
    });
  }

  function isSeen(item) {
    return String(seen[item.key] === undefined ? '' : seen[item.key]) === String(item.value);
  }

  function list(all) {
    var out = [];
    connItems(out);
    procItems(out);
    usageItems(out);
    agendaItems(out);
    out.forEach(function (item) { item.seen = isSeen(item); });
    out.sort(function (a, b) { return a.urg - b.urg || (b.at || 0) - (a.at || 0); });
    return all === true ? out : out.filter(function (item) { return !item.seen; });
  }

  function markSeen(item) {
    if (!item || !item.key) return;
    seen[item.key] = String(item.value);
    saveSeen();
    emit();
  }

  function markAllSeen() {
    var pending = list();
    for (var i = 0; i < pending.length; i++) seen[pending[i].key] = String(pending[i].value);
    saveSeen();
    emit();
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return function () {};
    subs.push(fn);
    return function () {
      var i = subs.indexOf(fn);
      if (i >= 0) subs.splice(i, 1);
    };
  }

  window.WaNotif = {
    ingest: ingest,
    list: list,
    count: function () { return list().length; },
    markSeen: markSeen,
    markAllSeen: markAllSeen,
    subscribe: subscribe,
  };
})();
