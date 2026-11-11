/*
 * WhatsAI Manager: "Acesso do cliente" (window.WaPortal). Plain script, loaded before the bundle.
 *
 * - Client (token "wac_..."): the menu keeps only his modules (WaPortal.nav, used by the patched sidebar), any
 *   other screen redirects to his first module, and "Conexão" shows the WhatsApp state and the QR code. The
 *   server applies the same list to every request (src/utils/client-access.ts); hiding here is only comfort.
 * - Administrator (global key): "Acesso do cliente" page of the instance: turn on, pick the modules, create a
 *   new code (shown once), remove. "Conexão" is hidden (the administrator has the full panel).
 * Everyone with Conversas: "Contatos da IA" page (list of the AI sessions, pause/resume one or many contacts).
 * Administrator: "Retenção (LGPD)" page (/manager/retencao) with the deadline of every instance.
 * Every tab: checks for a new version of the panel and reloads (hidden tab) or offers "Atualizar".
 * Pages are filled into <div data-wa-portal-page="..."> rendered by the routes of manager/patches/client-portal.py.
 */
(function () {
  'use strict';

  var STATE_KEY = 'wa-portal';
  var NAV_OF = { conversas: ['chat', 'contatos-ia'], leads: 'leads', agenda: 'agenda', processos: 'processos', plano: 'usage', conexao: 'conexao' };
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


  // Confirmation dialog in the panel's own style (both themes) instead of the browser's grey confirm().
  // Native <dialog>: focus trap, Esc and the backdrop come from the browser. Resolves true only on the action.
  function ask(opts) {
    return new Promise(function (resolve) {
      if (typeof HTMLDialogElement === 'undefined') { resolve(window.confirm(opts.title + (opts.text ? '\n\n' + opts.text : ''))); return; }
      var id = 'wa-ask-' + Date.now();
      var cancel = h('button', { type: 'button', class: 'wa-portal-btn wa-portal-btn-line', text: opts.cancel || 'Cancelar' });
      var ok = h('button', { type: 'button', class: 'wa-portal-btn' + (opts.danger ? ' wa-portal-btn-danger-solid' : ''), text: opts.action || 'Confirmar' });
      var d = h('dialog', { class: 'wa-ask', 'aria-labelledby': id + '-t', 'aria-describedby': opts.text ? id + '-d' : null }, [
        h('h2', { class: 'wa-ask-title', id: id + '-t', text: opts.title }),
        opts.text ? h('p', { class: 'wa-ask-text', id: id + '-d', text: opts.text }) : null,
        h('div', { class: 'wa-ask-actions' }, [cancel, ok]),
      ]);
      var answer = false;
      cancel.addEventListener('click', function () { d.close(); });
      ok.addEventListener('click', function () { answer = true; d.close(); });
      d.addEventListener('click', function (e) { if (e.target === d) d.close(); });
      d.addEventListener('close', function () { d.remove(); resolve(answer); });
      document.body.appendChild(d);
      d.showModal();
      (opts.danger ? cancel : ok).focus();
    });
  }

  // -------------------------------------------------------------------------------------------- client
  var client = isClient();
  var current = client ? state() : null;

  function allowedPaths() {
    var mods = (current && current.modules) || [];
    return mods.reduce(function (all, m) { return all.concat(NAV_OF[m] || []); }, []);
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

  // Conexão (client): state, QR code, pairing code.
  // The server answers the first "connect" before WhatsApp has produced a QR code (it waits only 2 s), and WhatsApp
  // replaces the code every ~20 s, so while the client is pairing the page asks again every 5 s and swaps the image.
  // Stops after 3 minutes (the code stops being renewed); "Mostrar QR code" starts again.
  function renderConexao(root) {
    var name = current && current.instanceName;
    var status = h('p', { class: 'wa-portal-status', role: 'status', 'aria-live': 'polite', text: 'Verificando…' });
    var qrBox = h('div', { class: 'wa-portal-qr' });
    var button = h('button', { type: 'button', class: 'wa-portal-btn', text: 'Mostrar QR code', hidden: true });
    var timer = null;
    var pairingSince = 0; // > 0 while the client asked for a QR code
    var shown = '';

    function note(text) {
      qrBox.textContent = '';
      shown = '';
      if (text) qrBox.appendChild(h('p', { class: 'wa-portal-hint', text: text }));
    }
    function stopPairing(text) {
      pairingSince = 0;
      button.disabled = false;
      note(text);
    }
    function showCode(d) {
      var key = (d.base64 || '') + '|' + (d.pairingCode || '');
      if (key === shown) return;
      qrBox.textContent = '';
      shown = key;
      if (d.base64) {
        qrBox.appendChild(h('img', { src: d.base64, alt: 'QR code para conectar o WhatsApp', width: '264', height: '264' }));
        qrBox.appendChild(h('p', { class: 'wa-portal-hint', text: 'No celular: WhatsApp > Aparelhos conectados > Conectar um aparelho, e aponte para o código. O código muda sozinho a cada poucos segundos; esta tela acompanha.' }));
      }
      if (d.pairingCode) qrBox.appendChild(h('p', { class: 'wa-portal-hint', text: 'Ou use o código de pareamento: ' + d.pairingCode }));
    }
    function fetchCode() {
      if (!pairingSince) return;
      if (Date.now() - pairingSince > 3 * 60 * 1000) { stopPairing('O QR code expirou. Clique em "Mostrar QR code" para gerar outro.'); return; }
      request('GET', '/instance/connect/' + encodeURIComponent(name)).then(function (d) {
        if (!pairingSince) return;
        if (d && d.instance && d.instance.state === 'open') { setState('open'); return; }
        if (d && (d.base64 || d.pairingCode)) { showCode(d); return; }
        if (d && d.error) { stopPairing('Não foi possível gerar o QR code agora. Tente de novo em alguns segundos.'); return; }
        if (!shown) note('Gerando o QR code…');
      }, function (e) {
        stopPairing(e.status === 403 ? 'Este acesso não inclui reconectar o WhatsApp.' : 'Não foi possível gerar o QR code agora. Tente de novo em alguns segundos.');
      });
    }
    function setState(state) {
      var open = state === 'open';
      status.textContent = open ? 'WhatsApp conectado.' : pairingSince ? 'Aguardando a leitura do QR code…' : state === 'connecting' ? 'Conectando…' : 'WhatsApp desconectado.';
      status.setAttribute('data-state', open ? 'ok' : 'bad');
      button.hidden = open;
      if (open && pairingSince) stopPairing('');
      else if (open) note('');
    }
    function check() {
      if (!document.body.contains(root)) { clearInterval(timer); return; }
      if (document.hidden) return;
      request('GET', '/instance/connectionState/' + encodeURIComponent(name)).then(function (d) {
        setState(d && d.instance && d.instance.state);
        if (pairingSince && !(d && d.instance && d.instance.state === 'open')) fetchCode();
      }, function () { status.textContent = 'Não foi possível consultar o servidor agora.'; });
    }
    button.addEventListener('click', function () {
      button.disabled = true;
      pairingSince = Date.now();
      note('Gerando o QR code…');
      status.textContent = 'Aguardando a leitura do QR code…';
      fetchCode();
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

    // the link the client opens (always visible, with copy): the same for every client, the code is what differs
    var link = location.origin + '/acesso';
    function copyButton(label, text) {
      var b = h('button', { type: 'button', class: 'wa-portal-btn wa-portal-btn-line', text: label });
      b.addEventListener('click', function () {
        (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () {
          b.textContent = 'Copiado';
          setTimeout(function () { b.textContent = label; }, 2000);
        }, function () { b.textContent = 'Selecione e copie'; });
      });
      return b;
    }
    card.appendChild(h('div', { class: 'wa-portal-link' }, [
      h('span', { class: 'wa-portal-link-label', text: 'Link de acesso do cliente' }),
      h('code', { class: 'wa-portal-code', text: link }),
      copyButton('Copiar link', link),
    ]));

    if (freshKey) {
      var message = 'Olá! Este é o seu acesso ao painel do WhatsAI.\n\n' +
        '1. Abra: ' + link + '\n' +
        '2. Entre com o código: ' + freshKey + '\n' +
        '3. Para usar como app: no computador ou no Android, toque em "Instalar app"; no iPhone, Compartilhar > "Adicionar à Tela de Início".\n\n' +
        'Guarde o código como uma senha e não compartilhe.';
      card.appendChild(h('div', { class: 'wa-portal-fresh', role: 'alert' }, [
        h('strong', { text: 'Código do cliente (aparece só agora):' }),
        h('code', { class: 'wa-portal-code', text: freshKey }),
        h('div', { class: 'wa-portal-fresh-actions' }, [copyButton('Copiar mensagem para o cliente', message), copyButton('Copiar só o código', freshKey)]),
        h('p', { class: 'wa-portal-hint', text: 'A mensagem já traz o link, o código e como instalar o app: cole no WhatsApp ou no e-mail do cliente. O código anterior deixou de funcionar.' }),
      ]));
    }

    var actions = h('div', { class: 'wa-portal-actions' }, [
      h('button', { type: 'button', class: 'wa-portal-btn', text: view.configured ? 'Salvar' : 'Criar acesso', onclick: function () { save(); } }),
      view.configured ? h('button', { type: 'button', class: 'wa-portal-btn wa-portal-btn-line', text: 'Gerar novo código', onclick: function () {
        ask({ title: 'Gerar um novo código?', text: 'O código atual para de funcionar na hora; o cliente precisa entrar de novo com o novo código.', action: 'Gerar novo código' }).then(function (yes) { if (yes) save({ newKey: true }); });
      } }) : null,
      view.configured ? h('button', { type: 'button', class: 'wa-portal-btn wa-portal-btn-danger', text: 'Remover acesso', onclick: function () {
        ask({ title: 'Remover o acesso do cliente?', text: 'O código para de funcionar na hora e o cliente sai do painel.', action: 'Remover acesso', danger: true }).then(function (yes) {
          if (!yes) return;
          request('DELETE', path).then(function (next) { draw(card, name, next, null); }, function (e) { msg.textContent = e.message; });
        });
      } }) : null,
    ]);
    card.appendChild(actions);
    card.appendChild(msg);
  }

  // Contatos da IA: every contact with an AI session, Twenty-like list (search, views, bulk pause/resume).
  // Same API as the old "Sessões" dialog: GET /openai/fetchSessions/all/:instance (all bots, with humanPause) and
  // POST /openai/changeStatus/:instance {remoteJid, status: paused|opened}. Allowed to a client with Conversas.
  var CI_VIEWS = [['todos', 'Todos'], ['ativa', 'IA ativa'], ['pausada', 'Pausados']];
  function ciPhone(jid) {
    var d = String(jid || '').split('@')[0].replace(/\D/g, '');
    if (/@g\.us$/.test(jid || '')) return 'Grupo';
    if (/@lid$/.test(jid || '')) return 'Contato do WhatsApp';
    if (d.length >= 12 && d.slice(0, 2) === '55') {
      var ddd = d.slice(2, 4), n = d.slice(4);
      return '(' + ddd + ') ' + (n.length === 9 ? n.slice(0, 5) + '-' + n.slice(5) : n.slice(0, 4) + '-' + n.slice(4));
    }
    return d ? '+' + d : '';
  }
  function ciAgo(iso) {
    var t = Date.parse(iso || ''); if (!t) return '—';
    var min = Math.round((Date.now() - t) / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return 'há ' + min + ' min';
    var h = Math.round(min / 60); if (h < 24) return 'há ' + h + ' h';
    var dd = Math.round(h / 24); return dd === 1 ? 'ontem' : 'há ' + dd + ' dias';
  }
  function ciTime(iso) {
    var d = new Date(iso); if (isNaN(d)) return '';
    var today = new Date().toDateString() === d.toDateString();
    return (today ? '' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ') + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  function ciState(s) {
    var hp = s.humanPause;
    if (s.status === 'closed') return { key: 'encerrada', tone: 'muted', label: 'Encerrada', hint: 'A IA responde de novo na próxima mensagem' };
    if (!hp && s.status !== 'paused') return { key: 'ativa', tone: 'ok', label: 'IA ativa', hint: '' };
    if (hp && hp.reason === 'human') return { key: 'pausada', tone: 'warn', label: 'Equipe assumiu', hint: hp.resumesAt ? 'IA volta ' + ciTime(hp.resumesAt) : 'Só volta quando você retomar' };
    return { key: 'pausada', tone: 'bad', label: 'Pausada', hint: 'Só volta quando você retomar' };
  }

  function renderContatosIa(root) {
    var instanceName = client && current ? current.instanceName : null;
    var head = title('Contatos da IA', 'Em quais conversas a IA está respondendo. Pause para a sua equipe atender, ou retome quando quiser. Nada é enviado ao contato.');
    var view = 'todos', q = '', sel = {}, rows = [], busy = false;
    var tabs = h('div', { class: 'wa-ci-views', role: 'tablist', 'aria-label': 'Filtrar contatos' });
    var search = h('input', { type: 'search', class: 'wa-ci-search', placeholder: 'Buscar por nome ou número', 'aria-label': 'Buscar contatos' });
    var refresh = h('button', { type: 'button', class: 'wa-ci-ibtn', 'aria-label': 'Atualizar', title: 'Atualizar', text: '↻' });
    var bulk = h('div', { class: 'wa-ci-bulk', hidden: true });
    var list = h('div', { class: 'wa-ci-list', 'aria-busy': 'true' }, [h('p', { class: 'wa-portal-hint', text: 'Carregando…' })]);
    var msg = h('p', { class: 'wa-portal-msg', role: 'status', 'aria-live': 'polite' });
    root.appendChild(head);
    root.appendChild(h('section', { class: 'wa-ci' }, [
      h('div', { class: 'wa-ci-bar' }, [tabs, h('div', { class: 'wa-ci-tools' }, [search, refresh])]),
      bulk, list, msg,
    ]));

    function counts() {
      var c = { todos: rows.length, ativa: 0, pausada: 0 };
      rows.forEach(function (r) { if (r.st.key === 'ativa') c.ativa++; else if (r.st.key === 'pausada') c.pausada++; });
      return c;
    }
    function visible() {
      var term = q.trim().toLowerCase(), digits = term.replace(/\D/g, '');
      return rows.filter(function (r) {
        if (view !== 'todos' && r.st.key !== view) return false;
        if (!term) return true;
        return (r.name || '').toLowerCase().indexOf(term) >= 0 || (digits && r.jid.replace(/\D/g, '').indexOf(digits) >= 0);
      });
    }
    function drawTabs() {
      var c = counts(); tabs.textContent = '';
      CI_VIEWS.forEach(function (v) {
        tabs.appendChild(h('button', { type: 'button', role: 'tab', class: 'wa-ci-view', 'aria-selected': view === v[0] ? 'true' : 'false', onclick: function () { view = v[0]; sel = {}; draw(); } }, [
          v[1], h('span', { class: 'wa-ci-n', text: String(c[v[0]]) }),
        ]));
      });
    }
    function drawBulk() {
      var ids = Object.keys(sel).filter(function (k) { return sel[k]; });
      bulk.hidden = !ids.length; bulk.textContent = '';
      if (!ids.length) return;
      bulk.appendChild(h('span', { text: ids.length + (ids.length === 1 ? ' selecionado' : ' selecionados') }));
      var many = function (status) {
        if (ids.length < 2) { change(ids, status); return; }
        var pause = status === 'paused';
        ask(pause
          ? { title: 'Pausar a IA em ' + ids.length + ' contatos?', text: 'A IA para de responder nessas conversas até alguém retomar. A sua equipe responde pelo WhatsApp.', action: 'Pausar IA' }
          : { title: 'Retomar a IA em ' + ids.length + ' contatos?', text: 'A IA volta a responder nessas conversas na próxima mensagem, inclusive onde a equipe está atendendo agora.', action: 'Retomar IA' }
        ).then(function (yes) { if (yes) change(ids, status); });
      };
      bulk.appendChild(h('button', { type: 'button', class: 'wa-portal-btn wa-portal-btn-line', text: 'Pausar IA', onclick: function () { many('paused'); } }));
      bulk.appendChild(h('button', { type: 'button', class: 'wa-portal-btn wa-portal-btn-line', text: 'Retomar IA', onclick: function () { many('opened'); } }));
      bulk.appendChild(h('button', { type: 'button', class: 'wa-ci-link', text: 'Limpar', onclick: function () { sel = {}; draw(); } }));
    }
    function drawList() {
      var items = visible(); list.textContent = ''; list.removeAttribute('aria-busy');
      if (!rows.length) { list.appendChild(h('div', { class: 'wa-ci-empty' }, [h('strong', { text: 'Nenhuma conversa com a IA ainda' }), h('p', { text: 'Quando um contato falar com a IA, ele aparece aqui.' })])); return; }
      if (!items.length) { list.appendChild(h('div', { class: 'wa-ci-empty' }, [h('strong', { text: 'Nada encontrado' }), h('p', { text: 'Mude a busca ou o filtro.' })])); return; }
      var all = items.every(function (r) { return sel[r.jid]; });
      var table = h('table', { class: 'wa-ci-table' });
      var allBox = h('input', { type: 'checkbox', class: 'wa-ci-check', 'aria-label': 'Selecionar todos', checked: all && items.length > 0, onchange: function (e) { items.forEach(function (r) { sel[r.jid] = e.target.checked; }); draw(); } });
      table.appendChild(h('thead', null, [h('tr', null, [
        h('th', { class: 'wa-ci-c-check', scope: 'col' }, [allBox]),
        h('th', { scope: 'col', text: 'Contato' }), h('th', { scope: 'col', text: 'IA' }),
        h('th', { scope: 'col', class: 'wa-ci-c-when', text: 'Última atividade' }), h('th', { scope: 'col', class: 'wa-ci-c-act' }, [h('span', { class: 'sr-only', text: 'Ação' })]),
      ])]));
      var body = h('tbody');
      items.forEach(function (r) {
        var box = h('input', { type: 'checkbox', class: 'wa-ci-check', 'aria-label': 'Selecionar ' + (r.name || r.phone), checked: !!sel[r.jid], onchange: function (e) { sel[r.jid] = e.target.checked; drawBulk(); } });
        var paused = r.st.key !== 'ativa';
        body.appendChild(h('tr', { 'data-state': r.st.key }, [
          h('td', { class: 'wa-ci-c-check' }, [box]),
          h('td', { class: 'wa-ci-c-name' }, [h('span', { class: 'wa-ci-person' }, [
            h('span', { class: 'wa-ci-avatar', 'aria-hidden': 'true', text: r.name ? r.name.trim().charAt(0).toUpperCase() : '#' }),
            h('span', { class: 'wa-ci-who' }, [h('strong', { text: r.name || r.phone || 'Sem nome' }), r.name ? h('small', { text: r.phone }) : null]),
          ])]),
          h('td', { class: 'wa-ci-c-state' }, [h('span', { class: 'wa-ci-chip', 'data-tone': r.st.tone }, [h('i', { 'aria-hidden': 'true' }), r.st.label]), r.st.hint ? h('small', { class: 'wa-ci-hint', text: r.st.hint }) : null]),
          h('td', { class: 'wa-ci-c-when', text: ciAgo(r.updatedAt) }),
          h('td', { class: 'wa-ci-c-act' }, [h('button', { type: 'button', class: 'wa-portal-btn ' + (paused ? '' : 'wa-portal-btn-line'), text: paused ? 'Retomar IA' : 'Pausar IA', disabled: busy, onclick: function () { change([r.jid], paused ? 'opened' : 'paused'); } })]),
        ]));
      });
      table.appendChild(body);
      list.appendChild(h('div', { class: 'wa-ci-tablewrap' }, [table]));
    }
    function draw() { drawTabs(); drawBulk(); drawList(); }

    function load() {
      list.setAttribute('aria-busy', 'true');
      return request('GET', '/openai/fetchSessions/all/' + encodeURIComponent(instanceName)).then(function (data) {
        var byJid = {};
        (data || []).forEach(function (s) {
          var prev = byJid[s.remoteJid];
          if (!prev || Date.parse(s.updatedAt) > Date.parse(prev.updatedAt)) byJid[s.remoteJid] = s;
        });
        rows = Object.keys(byJid).map(function (jid) {
          var s = byJid[jid];
          return { jid: jid, name: s.pushName && s.pushName !== jid ? s.pushName : '', phone: ciPhone(jid), updatedAt: s.updatedAt, st: ciState(s) };
        }).sort(function (a, b) { return Date.parse(b.updatedAt) - Date.parse(a.updatedAt); });
        draw();
      }, function (e) {
        list.removeAttribute('aria-busy'); list.textContent = '';
        list.appendChild(h('div', { class: 'wa-ci-empty' }, [h('strong', { text: 'Não foi possível carregar' }), h('p', { text: e.status === 400 ? 'O bot de IA não está ligado nesta instância.' : e.message })]));
      });
    }
    function change(jids, status) {
      if (busy || !jids.length) return;
      busy = true; msg.textContent = status === 'paused' ? 'Pausando…' : 'Retomando…';
      var done = 0, failed = 0;
      var next = function (i) {
        if (i >= jids.length) return Promise.resolve();
        return request('POST', '/openai/changeStatus/' + encodeURIComponent(instanceName), { remoteJid: jids[i], status: status })
          .then(function () { done++; }, function () { failed++; }).then(function () { return next(i + 1); });
      };
      next(0).then(function () {
        busy = false; sel = {};
        msg.textContent = (status === 'paused' ? 'IA pausada em ' : 'IA retomada em ') + done + (done === 1 ? ' contato' : ' contatos') + (failed ? '; ' + failed + ' com erro, tente de novo.' : '.');
        return load();
      });
    }
    search.addEventListener('input', function () { q = search.value; drawList(); });
    refresh.addEventListener('click', function () { msg.textContent = ''; load(); });

    var start = instanceName ? Promise.resolve() : request('GET', '/instance/fetchInstances').then(function (listData) {
      var id = instanceIdFromPath();
      var inst = (listData || []).filter(function (i) { return i && i.id === id; })[0];
      if (!inst) throw new Error('Instância não encontrada.');
      instanceName = inst.name;
    });
    start.then(load, function (e) { list.textContent = 'Não foi possível carregar: ' + e.message; });
  }

  // Retenção (LGPD), administrator only: one deadline for every instance, preview per instance, "Apagar agora".
  var PRESETS = [[0, 'Desligada'], [90, '90 dias'], [180, '180 dias'], [365, '1 ano']];
  function fmtN(n) { return n == null ? '—' : Number(n).toLocaleString('pt-BR'); }
  function renderRetencao(root) {
    root.appendChild(title('Retenção das mensagens (LGPD)', 'Apaga do banco do WhatsAI, em todas as instâncias, as mensagens mais antigas que o prazo. Nada é apagado no WhatsApp: o celular do escritório e o do contato guardam tudo.'));
    var card = h('section', { class: 'wa-portal-card', 'aria-busy': 'true' }, [h('p', { text: 'Carregando…' })]);
    root.appendChild(card);
    request('GET', '/admin/retention').then(function (view) { drawRet(card, view); }, function (e) {
      card.removeAttribute('aria-busy');
      card.textContent = e.status === 401 || e.status === 403 ? 'Só o administrador (chave global) muda a retenção.' : 'Não foi possível carregar: ' + e.message;
    });
  }

  function drawRet(card, view) {
    card.textContent = '';
    card.removeAttribute('aria-busy');
    var min = view.min || 7, max = view.max || 3650;
    var isPreset = PRESETS.some(function (p) { return p[0] === view.days; });
    var other = h('input', { type: 'number', class: 'wa-portal-num', id: 'wa-ret-other', min: String(min), max: String(max), step: '1', inputmode: 'numeric', value: isPreset ? '' : String(view.days), 'aria-label': 'Outro prazo, em dias' });
    var radios = PRESETS.map(function (p) {
      return h('label', { class: 'wa-portal-mod wa-portal-opt', for: 'wa-ret-' + p[0] }, [
        h('input', { type: 'radio', name: 'wa-ret', id: 'wa-ret-' + p[0], value: String(p[0]), checked: isPreset && view.days === p[0] }),
        h('span', null, [h('strong', { text: p[1] }), p[0] === 90 ? h('small', { text: 'Recomendado: o prazo do termo de tratamento e do site' }) : p[0] === 0 ? h('small', { text: 'Nada é apagado automaticamente' }) : null]),
      ]);
    });
    radios.push(h('label', { class: 'wa-portal-mod wa-portal-opt', for: 'wa-ret-x' }, [
      h('input', { type: 'radio', name: 'wa-ret', id: 'wa-ret-x', value: 'x', checked: !isPreset }),
      h('span', null, [h('strong', { text: 'Outro' }), h('span', { class: 'wa-portal-inline' }, [other, h('small', { text: 'dias (' + min + ' a ' + fmtN(max) + ')' })])]),
    ]));
    var msg = h('p', { class: 'wa-portal-msg', role: 'status', 'aria-live': 'polite' });
    var prev = h('div', { class: 'wa-portal-prev' });

    function chosen() {
      var r = card.querySelector('input[name="wa-ret"]:checked');
      if (!r) return null;
      if (r.value !== 'x') return Number(r.value);
      var n = Number(other.value);
      return Number.isInteger(n) && n >= min && n <= max ? n : null;
    }
    var seq = 0;
    function drawPreview(p) {
      prev.textContent = '';
      if (!p || !p.days) {
        prev.appendChild(h('p', { class: 'wa-portal-hint', text: 'Com a retenção desligada, nenhuma mensagem é apagada automaticamente.' }));
        return;
      }
      prev.appendChild(h('p', { class: 'wa-portal-hint' }, [h('strong', { text: fmtN(p.total) }), ' mensagem(ns) têm mais de ' + p.days + ' dias e sairiam com este prazo:']));
      var rows = (p.instances || []).map(function (i) {
        return h('tr', null, [h('td', { text: i.instance }), h('td', { class: 'wa-portal-n', text: i.older == null ? 'sem acesso ao banco' : fmtN(i.older) })]);
      });
      prev.appendChild(h('div', { class: 'wa-portal-tablewrap' }, [h('table', { class: 'wa-portal-table' }, [
        h('thead', null, [h('tr', null, [h('th', { scope: 'col', text: 'Instância' }), h('th', { scope: 'col', class: 'wa-portal-n', text: 'Mensagens que sairiam' })])]),
        h('tbody', null, rows),
      ])]));
    }
    function preview() {
      var d = chosen();
      if (d === null) { prev.textContent = ''; prev.appendChild(h('p', { class: 'wa-portal-hint', text: 'Digite um número de ' + min + ' a ' + fmtN(max) + ' dias.' })); return; }
      if (d === view.days) { drawPreview(view.preview); return; }
      var mine = ++seq;
      prev.setAttribute('aria-busy', 'true');
      request('GET', '/admin/retention?days=' + d).then(function (v) { if (mine === seq) drawPreview(v.preview); }, function (e) { if (mine === seq) msg.textContent = e.message; })
        .then(function () { prev.removeAttribute('aria-busy'); });
    }
    card.addEventListener('change', function (e) { if (e.target && e.target.name === 'wa-ret') { if (e.target.value === 'x') other.focus(); preview(); } });
    other.addEventListener('input', function () { var x = card.querySelector('#wa-ret-x'); if (x) x.checked = true; preview(); });

    var src = view.source === 'painel' ? 'salvo neste painel' + (view.updatedAt ? ' em ' + new Date(view.updatedAt).toLocaleString('pt-BR') : '')
      : view.source === 'variavel' ? 'da variável MESSAGE_RETENTION_DAYS do Render (salve aqui para mudar)' : 'padrão';
    card.appendChild(h('p', { class: 'wa-portal-status', 'data-state': view.enabled ? 'ok' : 'bad', text: (view.enabled ? 'Ligada: mensagens com mais de ' + view.days + ' dias saem do banco' : 'Desligada') + ' (' + src + ').' }));
    card.appendChild(h('fieldset', { class: 'wa-portal-mods wa-portal-opts' }, [h('legend', { text: 'Prazo para todas as instâncias' })].concat(radios)));
    card.appendChild(prev);

    function save() {
      var d = chosen();
      if (d === null) { msg.textContent = 'Escolha um prazo válido.'; return; }
      if (d === view.days && view.source === 'painel') { msg.textContent = 'Esse já é o prazo em vigor.'; return; }
      var go = function () {
        msg.textContent = 'Salvando…';
        request('POST', '/admin/retention', { days: d }).then(function (next) { drawRet(card, next); card.querySelector('.wa-portal-msg').textContent = 'Salvo.'; }, function (e) { msg.textContent = e.message; });
      };
      if (d && (!view.enabled || d < view.days)) {
        ask({ title: 'Guardar mensagens por ' + d + ' dias?', text: 'A partir de hoje, as mensagens mais antigas que isso saem do banco do WhatsAI em todas as instâncias, sem volta. No WhatsApp nada muda.', action: 'Salvar prazo', danger: true }).then(function (yes) { if (yes) go(); });
      } else go();
    }
    function runNow(btn) {
      ask({ title: 'Apagar agora?', text: 'Saem do banco do WhatsAI, em todas as instâncias, as mensagens com mais de ' + view.days + ' dias. Não tem volta. No WhatsApp nada muda.', action: 'Apagar agora', danger: true }).then(function (yes) { if (yes) doRun(btn); });
    }
    function doRun(btn) {
      btn.disabled = true;
      msg.textContent = 'Apagando…';
      request('POST', '/admin/retention/run').then(function (r) {
        return request('GET', '/admin/retention').then(function (next) { drawRet(card, next); card.querySelector('.wa-portal-msg').textContent = fmtN(r.removed) + ' mensagem(ns) apagada(s).'; });
      }, function (e) { msg.textContent = e.message; btn.disabled = false; });
    }
    var total = view.preview && view.preview.total;
    card.appendChild(h('div', { class: 'wa-portal-actions' }, [
      h('button', { type: 'button', class: 'wa-portal-btn', text: 'Salvar prazo', onclick: save }),
      view.enabled ? h('button', { type: 'button', class: 'wa-portal-btn wa-portal-btn-danger', text: 'Apagar agora', disabled: !total, title: total ? '' : 'Nada passou do prazo', onclick: function (e) { runNow(e.currentTarget); } }) : null,
    ]));
    card.appendChild(msg);
    card.appendChild(h('p', { class: 'wa-portal-hint', text: 'Roda sozinho uma vez por dia em cada instância, na primeira resposta da IA do dia (não acorda o banco), em lotes. Saem a mensagem, as atualizações de status e a mídia dela; conversas, contatos, leads, agenda e processos ficam. Faça um backup antes de ligar pela primeira vez.' }));
    drawPreview(view.preview);
  }

  // New version of the panel: index.html is revalidated, but an open tab keeps the old bundle in memory.
  // Checks every 5 minutes and when the tab comes back; reloads a hidden tab, offers "Atualizar" to a visible one.
  function bundleVersion(text) {
    var m = /index-[a-z0-9]+\.js\?v=(\d+)/.exec(text || '');
    return m ? m[1] : null;
  }
  var loadedVersion = null;
  function checkVersion() {
    if (!loadedVersion || !window.fetch) return;
    fetch('/manager/', { cache: 'no-store', credentials: 'same-origin' }).then(function (r) { return r.ok ? r.text() : ''; }).then(function (html) {
      var latest = bundleVersion(html);
      if (!latest || latest === loadedVersion) return;
      if (document.hidden) { location.reload(); return; }
      if (document.querySelector('.wa-portal-update')) return;
      var bar = h('div', { class: 'wa-portal-update', role: 'status' }, [
        h('span', { text: 'Nova versão do painel disponível.' }),
        h('button', { type: 'button', class: 'wa-portal-btn', text: 'Atualizar', onclick: function () { location.reload(); } }),
        h('button', { type: 'button', class: 'wa-portal-x', 'aria-label': 'Depois', text: '×', onclick: function () { bar.remove(); } }),
      ]);
      document.body.appendChild(bar);
    }).catch(function () {});
  }
  function watchVersion() {
    var tag = document.querySelector('script[src*="/assets/index-"]');
    loadedVersion = tag ? bundleVersion(tag.getAttribute('src')) : null;
    if (!loadedVersion) return;
    setInterval(checkVersion, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) checkVersion(); });
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
      } else if (page === 'contatos-ia') {
        renderContatosIa(el);
      } else if (page === 'retencao') {
        if (client) location.replace(home());
        else renderRetencao(el);
      }
    }
  }

  function start() {
    fillPages();
    watchVersion();
    new MutationObserver(fillPages).observe(document.body, { childList: true, subtree: true });
  }
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);

  window.WaPortal = {
    client: client,
    /** Styled confirmation (Promise<boolean>), for pages outside the Radix dialogs. */
    ask: ask,
    labels: LABELS,
    /** Sidebar filter: a client keeps only his modules; the administrator does not see "Conexão". */
    nav: function (item) {
      if (!item) return false;
      if (!client) return item.id !== 'conexao';
      return allowedPaths().indexOf(item.path) >= 0;
    },
  };
})();
