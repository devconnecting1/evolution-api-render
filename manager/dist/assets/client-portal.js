/*
 * WhatsAI Manager: "Acesso do cliente" (window.WaPortal). Plain script, loaded before the bundle.
 *
 * - Client (token "wac_..."): the menu keeps only his modules (WaPortal.nav, used by the patched sidebar), any
 *   other screen redirects to his first module, and "Conexão" shows the WhatsApp state and the QR code. The
 *   server applies the same list to every request (src/utils/client-access.ts); hiding here is only comfort.
 * - Administrator (global key): "Acesso do cliente" page of the instance: turn on, pick the modules, create a
 *   new code (shown once), remove. "Conexão" is hidden (the administrator has the full panel).
 * Pages are filled into <div data-wa-portal-page="..."> rendered by the routes of manager/patches/client-portal.py.
 */
(function () {
  'use strict';

  var STATE_KEY = 'wa-portal';
  var NAV_OF = { conversas: 'chat', leads: 'leads', agenda: 'agenda', processos: 'processos', plano: 'usage', conexao: 'conexao' };
  var LABELS = {
    conversas: 'Conversas',
    leads: 'Leads',
    agenda: 'Agenda',
    processos: 'Processos',
    plano: 'Plano e uso',
    conexao: 'Conexão',
  };

  function ls(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }
  function lsDel(key) {
    try { localStorage.removeItem(key); } catch (e) {}
  }
  function api() { return (ls('apiUrl') || '').replace(/\/+$/, ''); }
  function token() { return ls('token') || ''; }
  function isClient() { return /^wac_/.test(token()); }
  function state() {
    try { return JSON.parse(ls(STATE_KEY) || 'null'); } catch (e) { return null; }
  }

  function request(method, path, body) {
    return fetch(api() + path, {
      method: method,
      headers: { apikey: token(), 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    }).then(function (r) {
      return r.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        if (!r.ok) {
          var msg = data && (data.response && data.response.message || data.message);
          var err = new Error(Array.isArray(msg) ? msg.join(' ') : msg || 'HTTP ' + r.status);
          err.status = r.status;
          throw err;
        }
        return data;
      });
    });
  }

  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'class') el.className = attrs[k];
      else if (k === 'text') el.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] != null) el.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    }
    (children || []).forEach(function (c) { if (c != null) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }

  // -------------------------------------------------------------------------------------------- client
  var client = isClient();
  var current = client ? state() : null;

  function allowedPaths() {
    var mods = (current && current.modules) || [];
    return mods.map(function (m) { return NAV_OF[m]; }).filter(Boolean);
  }
  function home() {
    if (!current) return null;
    var first = allowedPaths()[0] || 'conexao';
    return '/manager/instance/' + current.instanceId + '/' + first;
  }

  function guardRoute() {
    if (!client) {
      // a client that logged out lands on the administrator login: send him to his own entry page
      if (location.pathname.replace(/\/+$/, '') === '/manager/login' && state() && !token()) location.replace('/acesso');
      return;
    }
    if (!current) return;
    var m = location.pathname.match(/^\/manager\/instance\/([^/]+)\/([^/]+)/);
    var ok = m && m[1] === current.instanceId && allowedPaths().indexOf(m[2]) >= 0;
    if (!ok && location.pathname.replace(/\/+$/, '') !== '/manager/login') {
      var target = home();
      if (target && target !== location.pathname) location.replace(target);
    }
  }

  function refreshClient() {
    if (!client || !api()) return;
    request('GET', '/client-access/me').then(function (me) {
      if (!me || !me.client) return;
      var next = { instanceId: me.instance.id, instanceName: me.instance.name, modules: me.modules };
      var changed = !current || JSON.stringify(current.modules) !== JSON.stringify(next.modules) || current.instanceId !== next.instanceId;
      lsSet(STATE_KEY, JSON.stringify(next));
      current = next;
      if (changed) location.replace(home());
    }, function (error) {
      // code removed, turned off or replaced: back to the entry page
      if (error.status === 401 || error.status === 403) {
        ['token', 'apiUrl', 'version', 'clientName', 'instanceId'].forEach(lsDel);
        location.replace('/acesso?saiu=1');
      }
    });
  }

  if (client) {
    document.documentElement.setAttribute('data-wa-portal', 'client');
    guardRoute();
    refreshClient();
    setInterval(guardRoute, 250);
    setInterval(refreshClient, 5 * 60 * 1000);
  } else {
    guardRoute();
  }

  // ------------------------------------------------------------------------------------------ pages
  function filled(el) { return el.getAttribute('data-wa-filled') === '1'; }

  function instanceIdFromPath() {
    var m = location.pathname.match(/^\/manager\/instance\/([^/]+)\//);
    return m ? m[1] : null;
  }

  function title(text, lead) {
    return h('div', { class: 'wa-portal-head' }, [h('h1', { class: 'wa-page-title', text: text }), lead ? h('p', { class: 'wa-portal-lead', text: lead }) : null]);
  }

  // Conexão (client): state, QR code, pairing code
  function renderConexao(root) {
    var name = current && current.instanceName;
    var status = h('p', { class: 'wa-portal-status', role: 'status', 'aria-live': 'polite', text: 'Verificando…' });
    var qrBox = h('div', { class: 'wa-portal-qr' });
    var button = h('button', { type: 'button', class: 'wa-portal-btn', text: 'Mostrar QR code', hidden: true });
    var timer = null;

    function setState(state) {
      var open = state === 'open';
      status.textContent = open ? 'WhatsApp conectado.' : state === 'connecting' ? 'Conectando…' : 'WhatsApp desconectado.';
      status.setAttribute('data-state', open ? 'ok' : 'bad');
      button.hidden = open;
      if (open) qrBox.textContent = '';
    }
    function check() {
      if (!document.body.contains(root)) { clearInterval(timer); return; }
      request('GET', '/instance/connectionState/' + encodeURIComponent(name)).then(function (d) {
        setState(d && d.instance && d.instance.state);
      }, function () { status.textContent = 'Não foi possível consultar o servidor agora.'; });
    }
    button.addEventListener('click', function () {
      button.disabled = true;
      request('GET', '/instance/connect/' + encodeURIComponent(name)).then(function (d) {
        qrBox.textContent = '';
        if (d && d.base64) {
          qrBox.appendChild(h('img', { src: d.base64, alt: 'QR code para conectar o WhatsApp', width: '264', height: '264' }));
          qrBox.appendChild(h('p', { class: 'wa-portal-hint', text: 'No celular: WhatsApp > Aparelhos conectados > Conectar um aparelho, e aponte para o código.' }));
        }
        if (d && d.pairingCode) qrBox.appendChild(h('p', { class: 'wa-portal-hint', text: 'Ou use o código de pareamento: ' + d.pairingCode }));
        if (!d || (!d.base64 && !d.pairingCode)) qrBox.appendChild(h('p', { class: 'wa-portal-hint', text: 'O WhatsApp já está conectado ou conectando.' }));
      }, function (e) {
        qrBox.textContent = e.status === 403 ? 'Este acesso não inclui reconectar o WhatsApp.' : 'Não foi possível gerar o QR code agora.';
      }).then(function () { button.disabled = false; });
    });

    root.appendChild(title('Conexão', 'Estado do WhatsApp deste número.'));
    root.appendChild(h('section', { class: 'wa-portal-card' }, [status, button, qrBox]));
    check();
    timer = setInterval(check, 5000);
  }

  // Acesso do cliente (administrator)
  function renderAcesso(root) {
    root.appendChild(title('Acesso do cliente', 'O cliente entra com um código próprio e vê só os módulos marcados. Bot, prompt, integrações e configurações continuam só com você.'));
    var card = h('section', { class: 'wa-portal-card' }, [h('p', { text: 'Carregando…' })]);
    root.appendChild(card);
    var id = instanceIdFromPath();
    request('GET', '/instance/fetchInstances').then(function (list) {
      var inst = (list || []).filter(function (i) { return i && i.id === id; })[0];
      if (!inst) throw new Error('Instância não encontrada.');
      return request('GET', '/client-access/' + encodeURIComponent(inst.name)).then(function (view) { draw(card, inst.name, view, null); });
    }).catch(function (e) {
      card.textContent = e.status === 403 ? 'Só o administrador (chave global) configura o acesso do cliente.' : 'Não foi possível carregar: ' + e.message;
    });
  }

  function draw(card, name, view, freshKey) {
    card.textContent = '';
    var path = '/client-access/' + encodeURIComponent(name);
    var enabled = h('input', { type: 'checkbox', id: 'wa-ca-on', checked: view.configured ? view.enabled : true });
    var boxes = view.catalog.map(function (m) {
      var input = h('input', { type: 'checkbox', name: 'mod', value: m.id, id: 'wa-ca-' + m.id, checked: view.modules.indexOf(m.id) >= 0 });
      return h('label', { class: 'wa-portal-mod', for: 'wa-ca-' + m.id }, [input, h('span', null, [h('strong', { text: m.label }), h('small', { text: m.description })])]);
    });
    var msg = h('p', { class: 'wa-portal-msg', role: 'status', 'aria-live': 'polite' });

    function chosen() {
      return Array.prototype.slice.call(card.querySelectorAll('input[name="mod"]:checked')).map(function (i) { return i.value; });
    }
    function save(extra) {
      var mods = chosen();
      if (!mods.length) { msg.textContent = 'Marque pelo menos um módulo.'; return; }
      msg.textContent = 'Salvando…';
      var body = { enabled: enabled.checked, modules: mods };
      for (var k in extra || {}) body[k] = extra[k];
      request('POST', path, body).then(function (next) { draw(card, name, next, next.key || null); }, function (e) { msg.textContent = e.message; });
    }

    card.appendChild(h('label', { class: 'wa-portal-switch', for: 'wa-ca-on' }, [enabled, h('span', { text: 'Acesso do cliente ligado' })]));
    card.appendChild(h('fieldset', { class: 'wa-portal-mods' }, [h('legend', { text: 'O que o cliente vê' })].concat(boxes)));

    var info = [];
    if (view.configured) {
      info.push('Código atual: ' + (view.keyHint || '—') + '.');
      info.push(view.lastUsedAt ? 'Último uso: ' + new Date(view.lastUsedAt).toLocaleString('pt-BR') + '.' : 'Ainda não usado.');
    } else {
      info.push('Ainda não há código. Ao salvar, um código é criado e mostrado uma única vez.');
    }
    card.appendChild(h('p', { class: 'wa-portal-hint', text: info.join(' ') }));

    if (freshKey) {
      var code = h('code', { class: 'wa-portal-code', text: freshKey });
      var copy = h('button', { type: 'button', class: 'wa-portal-btn wa-portal-btn-line', text: 'Copiar código' });
      copy.addEventListener('click', function () {
        (navigator.clipboard ? navigator.clipboard.writeText(freshKey) : Promise.reject()).then(function () { copy.textContent = 'Copiado'; }, function () { copy.textContent = 'Selecione e copie'; });
      });
      card.appendChild(h('div', { class: 'wa-portal-fresh', role: 'alert' }, [
        h('strong', { text: 'Código do cliente (aparece só agora):' }),
        code,
        copy,
        h('p', { class: 'wa-portal-hint', text: 'Envie ao cliente com o link ' + location.origin + '/acesso . No computador ou no celular ele abre o link, entra com o código e pode instalar o app pelo navegador (Instalar app / Adicionar à tela inicial). O código anterior deixou de funcionar.' }),
      ]));
    }

    var actions = h('div', { class: 'wa-portal-actions' }, [
      h('button', { type: 'button', class: 'wa-portal-btn', text: view.configured ? 'Salvar' : 'Criar acesso', onclick: function () { save(); } }),
      view.configured ? h('button', { type: 'button', class: 'wa-portal-btn wa-portal-btn-line', text: 'Gerar novo código', onclick: function () {
        if (confirm('Gerar um novo código? O código atual para de funcionar na hora.')) save({ newKey: true });
      } }) : null,
      view.configured ? h('button', { type: 'button', class: 'wa-portal-btn wa-portal-btn-danger', text: 'Remover acesso', onclick: function () {
        if (!confirm('Remover o acesso do cliente? O código para de funcionar na hora.')) return;
        request('DELETE', path).then(function (next) { draw(card, name, next, null); }, function (e) { msg.textContent = e.message; });
      } }) : null,
    ]);
    card.appendChild(actions);
    card.appendChild(msg);
  }

  function fillPages() {
    var nodes = document.querySelectorAll('[data-wa-portal-page]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (filled(el)) continue;
      el.setAttribute('data-wa-filled', '1');
      var page = el.getAttribute('data-wa-portal-page');
      if (page === 'conexao') {
        if (client) renderConexao(el);
        else el.appendChild(title('Conexão', 'Para o administrador, o estado e o QR code ficam na lista de instâncias e na Visão Geral.'));
      } else if (page === 'acesso-cliente') {
        if (client) location.replace(home());
        else renderAcesso(el);
      }
    }
  }

  function start() {
    fillPages();
    new MutationObserver(fillPages).observe(document.body, { childList: true, subtree: true });
  }
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);

  window.WaPortal = {
    client: client,
    labels: LABELS,
    /** Sidebar filter: a client keeps only his modules; the administrator does not see "Conexão". */
    nav: function (item) {
      if (!item) return false;
      if (!client) return item.id !== 'conexao';
      return allowedPaths().indexOf(item.path) >= 0;
    },
  };
})();
