/*
 * WhatsAI Manager: "Equipe" and "Registro de ações" (proposal V). Plain script, like client-portal.js.
 *
 * - Owner (global key or team key of the "dono" role): /manager/equipe lists the team keys (name, role, instances,
 *   last use), creates a key (shown once, with "Copiar") and revokes one; below, the client access codes of every
 *   instance, with "Revogar". /manager/registro lists who did what (filters, pages, CSV).
 * - Team key ("wat_..."): GET /team/me tells the role; <html data-wa-team-role="dono|equipe|leitura"> lets
 *   team-admin.css hide what the role cannot do and the pages here show a short "fica com o dono" notice. Hiding is
 *   only comfort: the server checks every request (src/utils/team-access.ts).
 *
 * Pages are filled into <div data-wa-team-page="..."> rendered by the routes of manager/patches/team-audit.py.
 */
(function () {
  'use strict';

  function ls(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function api() { return (ls('apiUrl') || '').replace(/\/+$/, ''); }
  // owner pages always use the login key (the instance token of the last opened instance is not the owner)
  function token() { return ls('token') || ''; }
  function isTeamToken() { return /^wat_/.test(token()); }

  function request(method, path, body, raw) {
    return fetch(api() + path, {
      method: method,
      headers: { apikey: token(), 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    }).then(function (r) {
      if (raw && r.ok) return r.blob();
      return r.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        if (!r.ok) {
          var msg = data && ((data.response && data.response.message) || data.message);
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

  function ask(opts) {
    if (window.WaPortal && window.WaPortal.ask) return window.WaPortal.ask(opts);
    return Promise.resolve(window.confirm(opts.title + (opts.text ? '\n\n' + opts.text : '')));
  }

  var DT = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  function when(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return isNaN(d.getTime()) ? '—' : DT.format(d);
  }
  function ago(iso) {
    if (!iso) return 'Nunca usada';
    var min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 2) return 'Agora há pouco';
    if (min < 60) return 'Há ' + min + ' min';
    if (min < 48 * 60) return 'Há ' + Math.round(min / 60) + ' h';
    return when(iso);
  }
  var ROLE = { dono: 'Dono', equipe: 'Equipe', leitura: 'Só leitura' };
  var ROLE_HINT = {
    dono: 'Dono: mesmo acesso da chave global, inclusive equipe e registro',
    equipe: 'Equipe: atende e configura as instâncias liberadas, sem exportar',
    leitura: 'Só leitura: vê e exporta, não muda nada',
  };

  function title(text, lead, actions) {
    var leadEl = lead ? h('p', { class: 'wa-team-lead', text: lead }) : null;
    var head = h('div', { class: 'wa-team-head' }, [
      h('div', null, [h('h1', { class: 'wa-page-title', text: text }), leadEl]),
      actions ? h('div', { class: 'wa-team-actions' }, actions) : null,
    ]);
    head.lead = leadEl;
    return head;
  }
  function fail(box, e, what) {
    box.removeAttribute('aria-busy');
    box.textContent = '';
    box.appendChild(h('p', { class: 'wa-team-error', role: 'alert', text: e.status === 401 || e.status === 403
      ? 'Só o dono do painel (chave global ou chave de papel Dono) vê ' + what + '.'
      : 'Não foi possível carregar: ' + e.message }));
  }
  function copy(text, btn) {
    var done = function () { btn.textContent = 'Copiado'; setTimeout(function () { btn.textContent = 'Copiar'; }, 2000); };
    try { navigator.clipboard.writeText(text).then(done, function () {}); } catch (e) { /* no clipboard */ }
  }

  // ------------------------------------------------------------------------------------------------ Equipe
  function renderEquipe(root) {
    var newBtn = h('button', { type: 'button', class: 'wa-portal-btn', text: 'Convidar pessoa' });
    root.appendChild(title('Equipe', 'Uma chave por pessoa, com papel e instâncias. A sua chave global continua sendo a do dono.', [newBtn]));
    var fresh = h('div', { class: 'wa-team-fresh', hidden: true, role: 'status' });
    var form = h('section', { class: 'wa-portal-card wa-team-form', hidden: true, 'aria-label': 'Chave nova de equipe' });
    var keys = h('section', { class: 'wa-portal-card wa-team-card', 'aria-busy': 'true' }, [h('p', { text: 'Carregando…' })]);
    var clients = h('section', { class: 'wa-portal-card wa-team-card', 'aria-busy': 'true' }, [h('p', { text: 'Carregando…' })]);
    root.appendChild(fresh);
    root.appendChild(form);
    root.appendChild(h('h2', { class: 'wa-team-h2', text: 'Chaves de equipe' }));
    root.appendChild(keys);
    root.appendChild(h('h2', { class: 'wa-team-h2', text: 'Códigos de acesso de clientes' }));
    root.appendChild(h('p', { class: 'wa-team-lead', text: 'Cada instância pode ter um código para o cliente, criado em "Acesso do cliente". Aqui dá para ver o último uso e revogar.' }));
    root.appendChild(clients);

    var instances = [];
    function loadKeys() {
      request('GET', '/team/keys').then(function (view) { drawKeys(keys, view); }, function (e) { fail(keys, e, 'a equipe'); });
    }
    request('GET', '/instance/fetchInstances').then(function (list) {
      instances = (list || []).map(function (i) { return i && i.name; }).filter(Boolean).sort();
      drawClients(clients, instances);
    }, function (e) { fail(clients, e, 'os códigos de clientes'); });
    loadKeys();

    newBtn.addEventListener('click', function () {
      form.hidden = !form.hidden;
      if (!form.hidden) drawForm();
    });

    function drawForm() {
      form.textContent = '';
      var name = h('input', { id: 'wa-team-name', class: 'wa-team-input', maxlength: '80', autocomplete: 'off', required: true });
      var role = h('select', { id: 'wa-team-role', class: 'wa-team-input' }, [
        h('option', { value: 'equipe', text: ROLE_HINT.equipe }),
        h('option', { value: 'leitura', text: ROLE_HINT.leitura }),
        h('option', { value: 'dono', text: ROLE_HINT.dono }),
      ]);
      var all = h('input', { type: 'checkbox', id: 'wa-team-all', checked: true });
      var boxes = instances.map(function (n, k) {
        return h('label', { class: 'wa-team-check' }, [h('input', { type: 'checkbox', value: n, 'data-inst': '1', id: 'wa-team-i' + k }), n]);
      });
      var list = h('div', { class: 'wa-team-checks', hidden: true }, boxes);
      all.addEventListener('change', function () { list.hidden = all.checked; });
      var err = h('p', { class: 'wa-team-error', role: 'alert' });
      var save = h('button', { type: 'submit', class: 'wa-portal-btn', text: 'Criar chave' });
      var cancel = h('button', { type: 'button', class: 'wa-portal-btn wa-portal-btn-line', text: 'Cancelar', onclick: function () { form.hidden = true; } });
      var f = h('form', { class: 'wa-team-grid', novalidate: true }, [
        h('label', { for: 'wa-team-name', class: 'wa-team-label', text: 'Nome da pessoa' }), name,
        h('label', { for: 'wa-team-role', class: 'wa-team-label', text: 'Papel' }), role,
        h('span', { class: 'wa-team-label', text: 'Instâncias' }),
        h('div', null, [h('label', { class: 'wa-team-check' }, [all, 'Todas (inclusive as que forem criadas depois)']), list]),
        err,
        h('div', { class: 'wa-team-actions' }, [cancel, save]),
      ]);
      f.addEventListener('submit', function (ev) {
        ev.preventDefault();
        err.textContent = '';
        var picked = all.checked ? null : boxes.map(function (b) { return b.firstChild; }).filter(function (i) { return i.checked; }).map(function (i) { return i.value; });
        if (!name.value.trim()) { err.textContent = 'Informe o nome da pessoa.'; name.focus(); return; }
        if (picked && !picked.length) { err.textContent = 'Marque pelo menos uma instância, ou deixe "Todas".'; return; }
        save.disabled = true;
        save.textContent = 'Criando…';
        request('POST', '/team/keys', { name: name.value.trim(), role: role.value, instances: picked }).then(function (created) {
          form.hidden = true;
          showFresh(created);
          loadKeys();
        }, function (e) {
          err.textContent = e.message;
          save.disabled = false;
          save.textContent = 'Criar chave';
        });
      });
      form.appendChild(h('h2', { class: 'wa-team-h2', text: 'Chave nova' }));
      form.appendChild(f);
      name.focus();
    }

    function showFresh(created) {
      fresh.textContent = '';
      var btn = h('button', { type: 'button', class: 'wa-portal-btn', text: 'Copiar' });
      btn.addEventListener('click', function () { copy(created.key, btn); });
      fresh.appendChild(h('p', { class: 'wa-team-fresh-title', text: 'Chave de ' + created.name + ' (' + (ROLE[created.role] || created.role) + ')' }));
      fresh.appendChild(h('div', { class: 'wa-team-fresh-row' }, [h('code', { class: 'wa-team-key', text: created.key }), btn]));
      fresh.appendChild(h('p', { class: 'wa-portal-hint', text: 'Copie e envie só para essa pessoa: a chave não aparece de novo. Ela entra no painel com esta chave no lugar da chave global.' }));
      fresh.appendChild(h('button', { type: 'button', class: 'wa-portal-btn wa-portal-btn-line', text: 'Já copiei', onclick: function () { fresh.hidden = true; fresh.textContent = ''; } }));
      fresh.hidden = false;
      btn.focus();
    }
  }

  function drawKeys(box, view) {
    box.removeAttribute('aria-busy');
    box.textContent = '';
    var rows = (view && view.keys) || [];
    if (!rows.length) {
      box.appendChild(h('p', { class: 'wa-team-empty', text: 'Nenhuma chave de equipe ainda. Crie uma para cada pessoa que usa o painel, em vez de passar a chave global.' }));
      return;
    }
    var table = h('table', { class: 'wa-team-table' }, [
      h('thead', null, [h('tr', null, ['Pessoa', 'Papel', 'Instâncias', 'Último uso', 'Chave', ''].map(function (t) { return h('th', { scope: 'col', text: t }); }))]),
      h('tbody', null, rows.map(function (k) {
        var revoke = h('button', { type: 'button', class: 'wa-team-link', text: 'Revogar' });
        revoke.addEventListener('click', function () {
          ask({ title: 'Revogar a chave de ' + k.name + '?', text: 'Ela para de funcionar na hora. Quem estiver com o painel aberto com essa chave sai na próxima ação.', action: 'Revogar', danger: true }).then(function (ok) {
            if (!ok) return;
            revoke.disabled = true;
            request('DELETE', '/team/keys/' + encodeURIComponent(k.id)).then(function () {
              var tr = revoke.closest('tr');
              if (tr) tr.remove();
            }, function (e) { revoke.disabled = false; window.alert(e.message); });
          });
        });
        return h('tr', null, [
          h('td', null, [h('strong', { text: k.name })]),
          h('td', null, [h('span', { class: 'wa-team-chip', 'data-role': k.role, text: ROLE[k.role] || k.role })]),
          h('td', { text: k.instances ? (k.instances.join(', ') || '—') : 'Todas' }),
          h('td', { text: ago(k.lastUsedAt) }),
          h('td', null, [h('code', { text: k.keyHint })]),
          h('td', { class: 'wa-team-td-act' }, [revoke]),
        ]);
      })),
    ]);
    box.appendChild(h('div', { class: 'wa-team-scroll', tabindex: '0', role: 'region', 'aria-label': 'Chaves de equipe' }, [table]));
  }

  function drawClients(box, names) {
    box.removeAttribute('aria-busy');
    box.textContent = '';
    if (!names.length) { box.appendChild(h('p', { class: 'wa-team-empty', text: 'Nenhuma instância ainda.' })); return; }
    var tbody = h('tbody');
    box.appendChild(h('div', { class: 'wa-team-scroll', tabindex: '0', role: 'region', 'aria-label': 'Códigos de clientes' }, [
      h('table', { class: 'wa-team-table' }, [
        h('thead', null, [h('tr', null, ['Instância', 'Situação', 'Último uso', 'Código', ''].map(function (t) { return h('th', { scope: 'col', text: t }); }))]),
        tbody,
      ]),
    ]));
    names.forEach(function (name) {
      var tr = h('tr', null, [h('td', null, [h('strong', { text: name })]), h('td', { colspan: '4', text: 'Carregando…' })]);
      tbody.appendChild(tr);
      request('GET', '/client-access/' + encodeURIComponent(name)).then(function (v) {
        while (tr.children.length > 1) tr.removeChild(tr.lastChild);
        var on = v && v.configured && v.enabled;
        var cell = h('td', { class: 'wa-team-td-act' });
        if (v && v.configured) {
          var revoke = h('button', { type: 'button', class: 'wa-team-link', text: 'Revogar' });
          revoke.addEventListener('click', function () {
            ask({ title: 'Revogar o código do cliente de ' + name + '?', text: 'O cliente sai da área do cliente e só entra de novo com um código novo, criado em "Acesso do cliente".', action: 'Revogar', danger: true }).then(function (ok) {
              if (!ok) return;
              revoke.disabled = true;
              request('DELETE', '/client-access/' + encodeURIComponent(name)).then(function () {
                tr.children[1].textContent = 'Sem código';
                tr.children[2].textContent = '—';
                tr.children[3].textContent = '—';
                revoke.remove();
              }, function (e) { revoke.disabled = false; window.alert(e.message); });
            });
          });
          cell.appendChild(revoke);
        }
        tr.appendChild(h('td', null, [h('span', { class: 'wa-team-chip', 'data-on': on ? '1' : '0', text: !v || !v.configured ? 'Sem código' : on ? 'Ativo' : 'Desligado' })]));
        tr.appendChild(h('td', { text: v && v.configured ? ago(v.lastUsedAt) : '—' }));
        tr.appendChild(h('td', null, [v && v.keyHint ? h('code', { text: v.keyHint }) : '—']));
        tr.appendChild(cell);
      }, function () {
        tr.lastChild.textContent = 'Não foi possível consultar.';
      });
    });
  }

  // ---------------------------------------------------------------------------------------- Registro de ações
  function renderRegistro(root) {
    var csv = h('button', { type: 'button', class: 'wa-portal-btn wa-portal-btn-line', text: 'Exportar CSV' });
    var head = title('Registro de ações', 'Quem pausou, apagou, exportou ou mudou configurações, quando e em qual instância. Sem conteúdo de mensagens. Guardado pelo prazo de retenção configurado (padrão de 180 dias).', [csv]);
    root.appendChild(head);
    var f = { instance: '', actor: '', type: '', from: '', to: '', page: 1 };
    var sel = function (label, key) {
      var s = h('select', { class: 'wa-team-input', 'aria-label': label }, [h('option', { value: '', text: label + ': todas' })]);
      s.addEventListener('change', function () { f[key] = s.value; f.page = 1; load(); });
      return s;
    };
    var sInst = sel('Instância', 'instance');
    var sActor = sel('Pessoa', 'actor');
    var sType = sel('Área', 'type');
    var date = function (label, key) {
      var d = h('input', { type: 'date', class: 'wa-team-input', 'aria-label': label });
      d.addEventListener('change', function () { f[key] = d.value; f.page = 1; load(); });
      return h('label', { class: 'wa-team-date' }, [label, d]);
    };
    root.appendChild(h('div', { class: 'wa-team-filters' }, [sInst, sActor, sType, date('De', 'from'), date('Até', 'to')]));
    var box = h('section', { class: 'wa-portal-card wa-team-card', 'aria-busy': 'true', 'aria-live': 'polite' }, [h('p', { text: 'Carregando…' })]);
    root.appendChild(box);
    var filled = false;

    function qs(extra) {
      var p = [];
      ['instance', 'actor', 'type', 'from', 'to'].forEach(function (k) { if (f[k]) p.push(k + '=' + encodeURIComponent(f[k])); });
      if (extra) p.push(extra);
      return p.length ? '?' + p.join('&') : '';
    }
    function fillSelect(s, values) {
      var cur = s.value;
      while (s.options.length > 1) s.remove(1);
      values.forEach(function (v) { s.appendChild(h('option', { value: v.id || v, text: v.label || v })); });
      s.value = cur;
    }
    function load() {
      box.setAttribute('aria-busy', 'true');
      request('GET', '/admin/audit' + qs('page=' + f.page)).then(function (data) {
        if (!filled) {
          fillSelect(sInst, data.instances || []);
          fillSelect(sActor, data.actors || []);
          fillSelect(sType, data.types || []);
          if (head.lead && data.retentionDays) {
            head.lead.textContent = 'Quem pausou, apagou, exportou ou mudou configurações, quando e em qual instância. Sem conteúdo de mensagens. Guardado por ' + data.retentionDays + ' dias.';
          }
          filled = true;
        }
        draw(data);
      }, function (e) { fail(box, e, 'o registro de ações'); });
    }
    function draw(data) {
      box.removeAttribute('aria-busy');
      box.textContent = '';
      var items = data.items || [];
      if (!items.length) {
        box.appendChild(h('p', { class: 'wa-team-empty', text: data.total ? 'Nada com esses filtros.' : 'Nenhuma ação registrada ainda. A partir de agora, pausas da IA, exclusões, exportações e mudanças de configuração aparecem aqui.' }));
        return;
      }
      box.appendChild(h('div', { class: 'wa-team-scroll', tabindex: '0', role: 'region', 'aria-label': 'Ações registradas' }, [
        h('table', { class: 'wa-team-table' }, [
          h('thead', null, [h('tr', null, ['Quando', 'Quem', 'Ação', 'Resultado', 'Instância', 'Alvo', 'IP'].map(function (t) { return h('th', { scope: 'col', text: t }); }))]),
          h('tbody', null, items.map(function (it) {
            return h('tr', null, [
              h('td', { class: 'wa-team-nowrap', text: when(it.at) }),
              h('td', null, [h('strong', { text: it.actor })]),
              h('td', null, [h('span', { class: 'wa-team-chip', text: it.typeLabel }), ' ', it.action]),
              h('td', { class: 'wa-team-nowrap', text: it.result || '—' }),
              h('td', { text: it.instance || '—' }),
              h('td', { text: it.target || '—' }),
              h('td', { class: 'wa-team-nowrap', text: it.ip || '—' }),
            ]);
          })),
        ]),
      ]));
      if (data.pages > 1) {
        var prev = h('button', { type: 'button', class: 'wa-portal-btn wa-portal-btn-line', text: 'Anterior', disabled: data.page <= 1 });
        var next = h('button', { type: 'button', class: 'wa-portal-btn wa-portal-btn-line', text: 'Próxima', disabled: data.page >= data.pages });
        prev.addEventListener('click', function () { f.page -= 1; load(); });
        next.addEventListener('click', function () { f.page += 1; load(); });
        box.appendChild(h('div', { class: 'wa-team-pager' }, [h('span', { text: 'Página ' + data.page + ' de ' + data.pages + ' · ' + data.total + ' ações' }), prev, next]));
      }
    }
    csv.addEventListener('click', function () {
      csv.disabled = true;
      request('GET', '/admin/audit/export.csv' + qs(), null, true).then(function (blob) {
        var a = h('a', { href: URL.createObjectURL(blob), download: 'registro-de-acoes.csv' });
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      }, function (e) { window.alert(e.message); }).then(function () { csv.disabled = false; });
    });
    load();
  }

  function renderDenied(root, page) {
    var what = page === 'registro' ? 'o registro de ações' : 'a equipe';
    root.appendChild(title('Acesso restrito', 'Esta página fica com o dono do painel.'));
    root.appendChild(h('section', { class: 'wa-portal-card wa-team-card' }, [
      h('p', { class: 'wa-team-empty', text: 'A sua chave não abre ' + what + '. Peça ao dono do painel uma chave de papel Dono se precisar desta página.' }),
    ]));
  }

  // --------------------------------------------------------------------------------------- mount and role
  var roleReady = null;
  var roleLoaded = false;
  var waiting = false;

  function role() { return document.documentElement.getAttribute('data-wa-team-role'); }

  function fillPages() {
    var nodes = document.querySelectorAll('[data-wa-team-page]');
    if (!nodes.length) return;
    var team = isTeamToken();
    if (team && !role() && !roleLoaded) {
      // a team key: wait for /team/me before drawing, so no API of an owner page is called for the wrong role
      if (roleReady && !waiting) {
        waiting = true;
        roleReady.then(function () { waiting = false; fillPages(); }, function () { waiting = false; });
      }
      return;
    }
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var page = el.getAttribute('data-wa-team-page');
      // React reuses the same div when going from Equipe to Registro and back (only the attribute changes), so
      // the marker stores the page: a boolean left the previous page's content in place.
      if (!page || el.getAttribute('data-wa-filled') === page) continue;
      if (el.getAttribute('data-wa-filled')) el.textContent = '';
      el.setAttribute('data-wa-filled', page);
      if (team && role() !== 'dono') renderDenied(el, page);
      else if (page === 'equipe') renderEquipe(el);
      else if (page === 'registro') renderRegistro(el);
    }
  }

  function markRole() {
    if (!isTeamToken() || !api()) { roleLoaded = true; roleReady = Promise.resolve(null); return roleReady; }
    roleReady = request('GET', '/team/me').then(function (me) {
      roleLoaded = true;
      if (me && me.team) {
        document.documentElement.setAttribute('data-wa-team-role', me.role);
        document.documentElement.setAttribute('data-wa-team-name', me.name);
      }
      return me && me.team ? me.role : null;
    }, function () { roleLoaded = true; return null; /* the server still decides */ });
    return roleReady;
  }

  function start() {
    markRole();
    fillPages();
    new MutationObserver(fillPages).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-wa-team-page'],
    });
  }
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
