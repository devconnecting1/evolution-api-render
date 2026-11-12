/*
 * WhatsAI Manager: leads waiting for the team inside the shared notifications store (proposals F and Y).
 * Loaded after central-notificacoes.js and before the bundle. Extends window.WaNotif, the single source read by
 * the bell, the sidebar counter and the Notificações page, with the count that the page loader already asks for:
 * GET /leads/:instance?status=aguardando&pageSize=1. No new request, no timer, no polling: this wrapper reads the
 * response that already passes through the interceptor of central-notificacoes.py and remembers the instance id
 * from GET /instance/fetchInstances to link to /leads?seg=aguardando.
 *
 * The base store keeps its own items, seen state and subscribe untouched; this file merges the waiting-lead item
 * into list()/count() and forwards markSeen/markAllSeen/subscribe. "Marcar como visto" keeps one value per item
 * (the waiting count) in localStorage wa-notif-seen-leads-v1, so a new lead brings the item back.
 */
(function () {
  'use strict';

  var base = window.WaNotif;
  if (!base || base.__waLeads) return;

  var SEEN_KEY = 'wa-notif-seen-leads-v1';
  var SEEN_MAX = 150;
  var leads = {};
  var ids = {};
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

  function plural(n, one, many) {
    return n === 1 ? '1 ' + one : fmt(n) + ' ' + many;
  }

  function link(name) {
    var id = ids[name];
    return id ? '/manager/instance/' + encodeURIComponent(id) + '/leads' : '';
  }

  function leadItems() {
    var out = [];
    Object.keys(leads).forEach(function (name) {
      var l = leads[name];
      if (!l || !(l.waiting > 0)) return;
      var href = link(name);
      out.push({
        key: 'leads:' + name,
        value: String(l.waiting),
        kind: 'leads',
        urg: 1,
        tone: 'warn',
        icon: 'users',
        title: plural(l.waiting, 'lead aguardando a equipe', 'leads aguardando a equipe'),
        meta: name + ' · mensagem do cliente sem resposta da equipe',
        href: href ? href + '?seg=aguardando' : '',
        action: 'Ver leads',
        at: l.at,
      });
    });
    out.forEach(function (item) {
      item.seen = String(seen[item.key] === undefined ? '' : seen[item.key]) === String(item.value);
    });
    return out;
  }

  function ingest(url, data, config) {
    if (data) {
      var u = path(url);
      var m;
      if (u === '/instance/fetchInstances') {
        var list = Array.isArray(data) ? data : (data.data && Array.isArray(data.data) ? data.data : [data]);
        for (var i = 0; i < list.length; i++) {
          var instance = list[i];
          if (instance && instance.name && instance.id) ids[instance.name] = instance.id;
        }
      } else if ((m = u.match(/^\/leads\/([^/]+)$/))) {
        var params = (config && config.params) || {};
        if (String(params.status || '') === 'aguardando' && Number(params.pageSize) === 1) {
          var name = dec(m[1]);
          var counts = data.counts || {};
          leads[name] = { waiting: num(counts.aguardando), at: Date.now() };
          emit();
        }
      }
    }
    return base.ingest.apply(base, arguments);
  }

  function list(all) {
    var merged = base.list(true).concat(leadItems());
    merged.sort(function (a, b) {
      return (a.urg || 0) - (b.urg || 0) || (b.at || 0) - (a.at || 0);
    });
    return all === true ? merged : merged.filter(function (item) { return !item.seen; });
  }

  function markSeen(item) {
    if (!item || !item.key) return;
    if (item.key.indexOf('leads:') === 0) {
      seen[item.key] = String(item.value);
      saveSeen();
      emit();
      return;
    }
    base.markSeen(item);
  }

  function markAllSeen() {
    var pending = list();
    var touched = false;
    for (var i = 0; i < pending.length; i++) {
      if (pending[i].key.indexOf('leads:') === 0) {
        seen[pending[i].key] = String(pending[i].value);
        touched = true;
      }
    }
    if (touched) saveSeen();
    base.markAllSeen();
    if (touched) emit();
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return function () {};
    var offBase = base.subscribe(fn);
    subs.push(fn);
    return function () {
      if (offBase) offBase();
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
    __waLeads: true,
  };
})();
/*whatsai-patch:painel-pendentes:leads-feed*/
