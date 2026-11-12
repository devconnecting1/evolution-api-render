/*
 * WhatsAI panel: "Plano e limites" > Cobrança, recibos and "Exportar dados da instância" (proposal X).
 *
 * The operator is a pessoa física without a payment gateway: the administrator records each charge by hand
 * (GET/POST/PATCH/DELETE /billing/:instance, global key) and prints a receipt for each paid one. The client's code with
 * the module "plano" only reads the history and opens the receipts (the server refuses any write).
 * The export (GET /billing/:instance/export.zip, global key) downloads a ZIP with conversations, contacts, leads and
 * appointments, for the LGPD portability right.
 *
 * Renders into the page that the bundle draws (main.wu-page) and keeps itself there after each render (MutationObserver),
 * like client-portal.js. Plain DOM, no dependency; texts in PT-BR.
 */
(function () {
  'use strict';

  var MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  var STATUS = { pago: ['Pago', 'ok'], pendente: ['Pendente', 'warn'], cancelado: ['Cancelado', 'off'] };
  var METHODS = { pix: 'Pix', boleto: 'Boleto', transferencia: 'Transferência', cartao: 'Cartão', dinheiro: 'Dinheiro', outro: 'Outro' };

  function ls(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function api() { return (ls('apiUrl') || '').replace(/\/+$/, ''); }
  function token() { return ls('token') || ''; }
  function isClient() { return /^wac_/.test(token()); }

  function request(method, path, body) {
    return fetch(api() + path, {
      method: method,
      headers: Object.assign({ apikey: token() }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    }).then(function (r) {
      return r.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        if (!r.ok) {
          var m = data && data.response && data.response.message;
          var msg = [].concat(m || (data && data.message) || []).join(' ');
          var err = new Error(msg || (r.status >= 500 ? 'O servidor não respondeu agora. Tente de novo em alguns segundos.' : 'Não foi possível concluir.'));
          err.status = r.status;
          throw err;
        }
        return data;
      });
    });
  }

  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'text') el.textContent = v;
      else if (k === 'class') el.className = v;
      else if (k === 'onclick') el.addEventListener('click', v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    });
    (children || []).forEach(function (c) { if (c != null) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }

  // ------------------------------------------------------------------------------------------ formats
  function money(cents) {
    return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
  function monthLabel(period) {
    var p = String(period || '').split('-');
    var m = Number(p[1]);
    return m >= 1 && m <= 12 ? MONTHS[m - 1] + ' de ' + p[0] : String(period || '');
  }
  function dateLabel(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
  }
  function longDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.getUTCDate() + ' de ' + MONTHS[d.getUTCMonth()] + ' de ' + d.getUTCFullYear();
  }
  /** "437,00" or "437" or "1.437,50" -> 43700 cents; null when not a positive amount. */
  function parseMoney(text) {
    var s = String(text || '').replace(/[R$\s]/g, '');
    if (!s) return null;
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    var n = Number(s);
    if (!isFinite(n) || n <= 0) return null;
    return Math.round(n * 100);
  }

  // value in words (PT-BR), up to R$ 1.000.000,00, for the receipt
  var UNITS = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
  var TENS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  var HUNDREDS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
  function below1000(n) {
    if (n === 100) return 'cem';
    var out = [];
    var c = Math.floor(n / 100), r = n % 100;
    if (c) out.push(HUNDREDS[c]);
    if (r) out.push(r < 20 ? UNITS[r] : TENS[Math.floor(r / 10)] + (r % 10 ? ' e ' + UNITS[r % 10] : ''));
    return out.join(' e ');
  }
  function words(n) {
    if (n === 0) return 'zero';
    if (n >= 1000000) return n === 1000000 ? 'um milhão' : String(n);
    var th = Math.floor(n / 1000), rest = n % 1000;
    var parts = [];
    if (th) parts.push(th === 1 ? 'mil' : below1000(th) + ' mil');
    if (rest) parts.push(below1000(rest));
    if (parts.length < 2) return parts[0];
    return parts[0] + (rest < 100 || rest % 100 === 0 ? ' e ' : ' ') + parts[1];
  }
  function moneyWords(cents) {
    var reais = Math.floor(cents / 100), c = cents % 100;
    var out = [];
    if (reais) out.push(reais === 1 ? 'um real' : words(reais) + (reais === 1000000 ? ' de reais' : ' reais'));
    if (c) out.push(c === 1 ? 'um centavo' : words(c) + ' centavos');
    return out.join(' e ') || 'zero real';
  }
  window.WaBillingWords = moneyWords; // used by the harness checks

  // ------------------------------------------------------------------------------------------ dialogs
  function modal(title, body, actions) {
    var d = h('dialog', { class: 'wb-dialog', 'aria-labelledby': 'wb-dialog-t' });
    d.appendChild(h('h2', { id: 'wb-dialog-t', class: 'wb-dialog-title', text: title }));
    d.appendChild(body);
    d.appendChild(h('div', { class: 'wb-dialog-actions' }, actions));
    d.addEventListener('close', function () { d.remove(); });
    d.addEventListener('click', function (e) { if (e.target === d) d.close(); });
    document.body.appendChild(d);
    d.showModal();
    return d;
  }
  function button(text, cls, onclick, type) {
    return h('button', { type: type || 'button', class: 'wu-btn ' + (cls || ''), text: text, onclick: onclick });
  }

  function editDialog(ctx, entry) {
    var isNew = !entry;
    var today = new Date();
    var month = entry ? entry.period : today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0');
    var f = {
      period: h('input', { type: 'month', id: 'wb-period', required: true, value: month }),
      amount: h('input', { type: 'text', id: 'wb-amount', inputmode: 'decimal', required: true, placeholder: '437,00', value: entry ? (entry.amountCents / 100).toFixed(2).replace('.', ',') : '' }),
      status: h('select', { id: 'wb-status' }, Object.keys(STATUS).map(function (k) { return h('option', { value: k, text: STATUS[k][0], selected: (entry ? entry.status : 'pendente') === k }); })),
      method: h('select', { id: 'wb-method' }, [h('option', { value: '', text: 'Não informar' })].concat(Object.keys(METHODS).map(function (k) { return h('option', { value: k, text: METHODS[k], selected: entry && entry.method === k }); }))),
      paidAt: h('input', { type: 'date', id: 'wb-paid', value: entry && entry.paidAt ? String(entry.paidAt).slice(0, 10) : '' }),
      note: h('textarea', { id: 'wb-note', maxlength: '280', rows: '2', text: entry && entry.note ? entry.note : '' }),
    };
    var err = h('p', { class: 'wb-error', role: 'alert' });
    var field = function (id, label, input, hint) {
      return h('div', { class: 'wb-field' }, [h('label', { for: id, text: label }), input, hint ? h('p', { class: 'wb-hint', text: hint }) : null]);
    };
    var form = h('form', { class: 'wb-form', novalidate: true }, [
      h('div', { class: 'wb-row' }, [field('wb-period', 'Mês de referência', f.period), field('wb-amount', 'Valor (R$)', f.amount)]),
      h('div', { class: 'wb-row' }, [field('wb-status', 'Situação', f.status), field('wb-method', 'Forma de pagamento', f.method)]),
      field('wb-paid', 'Pago em', f.paidAt, 'Vazio e marcado como pago: fica a data de hoje.'),
      field('wb-note', 'Observação (aparece no recibo)', f.note),
      err,
    ]);
    var save = button(isNew ? 'Registrar' : 'Salvar', 'wu-btn-primary', null, 'submit');
    save.setAttribute('form', 'wb-form');
    form.id = 'wb-form';
    var d = modal(isNew ? 'Registrar cobrança' : 'Editar cobrança', form, [button('Cancelar', 'wu-btn-ghost', function () { d.close(); }), save]);
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var cents = parseMoney(f.amount.value);
      if (!/^\d{4}-\d{2}$/.test(f.period.value)) { err.textContent = 'Escolha o mês de referência.'; f.period.focus(); return; }
      if (!cents) { err.textContent = 'Informe o valor, por exemplo 437,00.'; f.amount.focus(); return; }
      var body = { period: f.period.value, amountCents: cents, status: f.status.value, method: f.method.value || null, paidAt: f.paidAt.value || null, note: f.note.value };
      save.disabled = true;
      save.textContent = 'Salvando…';
      var call = isNew ? request('POST', '/billing/' + encodeURIComponent(ctx.name), body) : request('PATCH', '/billing/' + encodeURIComponent(ctx.name) + '/' + encodeURIComponent(entry.id), body);
      call.then(function () { d.close(); ctx.reload(); }, function (e) {
        err.textContent = e.message;
        save.disabled = false;
        save.textContent = isNew ? 'Registrar' : 'Salvar';
      });
    });
    f.period.focus();
  }

  function deleteDialog(ctx, entry) {
    var body = h('p', { class: 'wb-text', text: 'Excluir a cobrança de ' + monthLabel(entry.period) + ' (' + money(entry.amountCents) + ')?' + (entry.receiptNumber ? ' O recibo nº ' + entry.receiptNumber + ' deixa de existir e o número não é reaproveitado.' : '') });
    var go = button('Excluir', 'wu-btn-danger');
    var d = modal('Excluir cobrança', body, [button('Cancelar', 'wu-btn-ghost', function () { d.close(); }), go]);
    go.addEventListener('click', function () {
      go.disabled = true;
      request('DELETE', '/billing/' + encodeURIComponent(ctx.name) + '/' + encodeURIComponent(entry.id)).then(function () { d.close(); ctx.reload(); }, function (e) {
        body.textContent = e.message;
        go.disabled = false;
      });
    });
  }

  function exportDialog(ctx) {
    var body = h('div', { class: 'wb-text' }, [
      h('p', { text: 'O arquivo ZIP traz o que esta instância guarda no banco do WhatsAI:' }),
      h('ul', { class: 'wb-list' }, ['Conversas e mensagens (as mídias vêm só como referência)', 'Contatos e lista de conversas', 'Leads, agendamentos e processos, quando usados'].map(function (t) { return h('li', { text: t }); })),
      h('p', { class: 'wb-hint', text: 'Não entram chaves, tokens, credenciais nem configurações. Em instâncias grandes pode levar alguns minutos; deixe esta aba aberta.' }),
    ]);
    var status = h('p', { class: 'wb-error', role: 'status' });
    body.appendChild(status);
    var go = button('Exportar', 'wu-btn-primary');
    var d = modal('Exportar dados da instância', body, [button('Cancelar', 'wu-btn-ghost', function () { d.close(); }), go]);
    go.addEventListener('click', function () {
      go.disabled = true;
      go.textContent = 'Preparando…';
      status.textContent = '';
      fetch(api() + '/billing/' + encodeURIComponent(ctx.name) + '/export.zip', { headers: { apikey: token() }, cache: 'no-store' })
        .then(function (r) {
          if (!r.ok) return r.json().catch(function () { return null; }).then(function (data) {
            var m = data && data.response && data.response.message;
            throw new Error([].concat(m || (data && data.message) || []).join(' ') || 'Não foi possível exportar agora. Tente de novo em alguns minutos.');
          });
          var cd = r.headers.get('Content-Disposition') || '';
          var name = (cd.match(/filename="([^"]+)"/) || [])[1] || 'dados-whatsai.zip';
          return r.blob().then(function (blob) {
            var url = URL.createObjectURL(blob);
            var a = h('a', { href: url, download: name });
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
            d.close();
          });
        })
        .catch(function (e) {
          status.textContent = e.message;
          go.disabled = false;
          go.textContent = 'Tentar de novo';
        });
    });
  }

  // ------------------------------------------------------------------------------------------ receipt
  function receipt(ctx, entry, provider) {
    var payer = ctx.payer || ctx.name;
    var method = entry.method ? ', por ' + METHODS[entry.method] : '';
    var paid = entry.paidAt ? ', em ' + dateLabel(entry.paidAt) : '';
    var number = String(entry.receiptNumber || '').padStart(4, '0');
    var place = [provider.city, entry.paidAt ? longDate(entry.paidAt) : ''].filter(Boolean).join(', ');
    var sheet = h('article', { class: 'wb-receipt', 'aria-label': 'Recibo nº ' + number }, [
      h('header', { class: 'wb-receipt-head' }, [h('h1', { text: 'Recibo' }), h('p', { class: 'wb-receipt-no', text: 'Nº ' + number })]),
      h('p', { class: 'wb-receipt-value', text: money(entry.amountCents) }),
      h('p', { class: 'wb-receipt-body', text: 'Recebi de ' + payer + ' a importância de ' + money(entry.amountCents) + ' (' + moneyWords(entry.amountCents) + '), referente ao serviço WhatsAI (atendimento com inteligência artificial no WhatsApp), mensalidade de ' + monthLabel(entry.period) + method + paid + '.' }),
      entry.note ? h('p', { class: 'wb-receipt-note', text: entry.note }) : null,
      place ? h('p', { class: 'wb-receipt-place', text: place + '.' }) : null,
      provider.name || provider.doc
        ? h('div', { class: 'wb-receipt-sign' }, [h('span', { class: 'wb-receipt-line', 'aria-hidden': 'true' }), provider.name ? h('p', { text: provider.name }) : null, provider.doc ? h('p', { text: 'CPF ' + provider.doc }) : null])
        : null,
    ]);
    var overlay = h('div', { class: 'wb-receipt-wrap', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Recibo' }, [
      h('div', { class: 'wb-receipt-bar' }, [
        h('span', { text: 'Recibo nº ' + number }),
        h('span', { class: 'wb-grow' }),
        button('Imprimir ou salvar em PDF', 'wu-btn-primary', function () { window.print(); }),
        button('Fechar', 'wu-btn-ghost', function () { close(); }),
      ]),
      !isClient() && !provider.configured
        ? h('p', { class: 'wb-receipt-warn', text: 'Para o recibo sair com o seu nome, CPF e cidade, configure ' + provider.missing.join(', ') + ' no servidor (Render, Environment).' })
        : null,
      sheet,
    ]);
    function onKey(e) { if (e.key === 'Escape') close(); }
    function close() { document.removeEventListener('keydown', onKey); overlay.remove(); document.documentElement.removeAttribute('data-wb-printing'); }
    document.addEventListener('keydown', onKey);
    document.documentElement.setAttribute('data-wb-printing', '');
    document.body.appendChild(overlay);
    overlay.querySelector('.wu-btn-primary').focus();
  }

  // ------------------------------------------------------------------------------------------ sections
  function chip(status) {
    var s = STATUS[status] || [status, 'off'];
    return h('span', { class: 'wu-chip wb-chip', 'data-tone': s[1] }, [h('span', { class: 'wu-dot', 'aria-hidden': 'true' }), s[0]]);
  }

  function billingSection(ctx) {
    var card = h('section', { class: 'wu-card wb-card', 'data-wa-billing': '', 'aria-labelledby': 'wb-title' });
    var list = h('div', { class: 'wb-body', 'aria-live': 'polite' }, [h('p', { class: 'wu-muted', text: 'Carregando…' })]);
    var actions = h('div', { class: 'wu-head-actions' }, isClient() ? [] : [button('Registrar cobrança', 'wu-btn-primary', function () { editDialog(ctx); })]);
    card.appendChild(h('div', { class: 'wu-card-head' }, [
      h('div', null, [
        h('h2', { id: 'wb-title', class: 'wu-card-title', text: 'Cobrança' }),
        h('p', { class: 'wu-muted', text: isClient() ? 'Mensalidades registradas e os recibos dos pagamentos.' : 'Registre cada mensalidade e gere o recibo quando ela for paga. O cliente vê esta lista na área dele (módulo Plano).' }),
      ]),
      actions,
    ]));
    card.appendChild(list);

    ctx.reload = function () {
      request('GET', '/billing/' + encodeURIComponent(ctx.name)).then(function (data) {
        list.textContent = '';
        var entries = (data && data.entries) || [];
        var provider = (data && data.provider) || { configured: false, missing: [] };
        if (!isClient() && !provider.configured) {
          list.appendChild(h('p', { class: 'wb-note', text: 'Os recibos saem sem os seus dados até você configurar ' + provider.missing.join(', ') + ' no servidor.' }));
        }
        if (!entries.length) {
          list.appendChild(h('p', { class: 'wu-muted wb-empty', text: isClient() ? 'Nenhuma cobrança registrada ainda.' : 'Nenhuma cobrança registrada ainda. Use "Registrar cobrança" para a primeira mensalidade.' }));
          return;
        }
        if (data.totals && (data.totals.pendingCents || data.totals.paidCents)) {
          list.appendChild(h('p', { class: 'wb-totals' }, [
            h('span', { text: 'Pago: ' + money(data.totals.paidCents) }),
            data.totals.pendingCents ? h('span', { class: 'wb-pending', text: 'Em aberto: ' + money(data.totals.pendingCents) }) : null,
          ]));
        }
        var table = h('table', { class: 'wb-table' }, [
          h('thead', null, [h('tr', null, ['Mês', 'Valor', 'Situação', 'Pagamento', 'Recibo', ''].map(function (t, i) { return h('th', { scope: 'col', text: t, class: i === 5 ? 'wb-c-act' : null }); }))]),
          h('tbody', null, entries.map(function (e) {
            var acts = [];
            if (e.status === 'pago' && e.receiptNumber) acts.push(button('Recibo', 'wu-btn-ghost wb-sm', function () { receipt(ctx, e, provider); }));
            if (!isClient()) {
              acts.push(button('Editar', 'wu-btn-ghost wb-sm', function () { editDialog(ctx, e); }));
              acts.push(h('button', { type: 'button', class: 'wu-btn wu-btn-ghost wb-sm wb-icon', 'aria-label': 'Excluir a cobrança de ' + monthLabel(e.period), title: 'Excluir', text: '×', onclick: function () { deleteDialog(ctx, e); } }));
            }
            return h('tr', null, [
              h('td', { 'data-label': 'Mês' }, [h('span', { class: 'wb-month', text: monthLabel(e.period) }), e.note && !isClient() ? h('span', { class: 'wb-sub', text: e.note }) : null]),
              h('td', { 'data-label': 'Valor', class: 'wb-num', text: money(e.amountCents) }),
              h('td', { 'data-label': 'Situação' }, [chip(e.status)]),
              h('td', { 'data-label': 'Pagamento', text: [e.method ? METHODS[e.method] : '', dateLabel(e.paidAt)].filter(Boolean).join(' · ') || '—' }),
              h('td', { 'data-label': 'Recibo', class: 'wb-num', text: e.receiptNumber ? 'nº ' + String(e.receiptNumber).padStart(4, '0') : '—' }),
              h('td', { class: 'wb-c-act' }, [h('div', { class: 'wb-acts' }, acts)]),
            ]);
          })),
        ]);
        list.appendChild(h('div', { class: 'wb-tablewrap' }, [table]));
      }, function (e) {
        list.textContent = '';
        list.appendChild(h('div', { class: 'wb-error-block', role: 'alert' }, [
          h('p', { text: e.status === 403 ? 'Este acesso não inclui a cobrança.' : e.message }),
          e.status === 403 ? null : button('Tentar de novo', 'wu-btn-ghost', function () { ctx.reload(); }),
        ]));
      });
    };
    ctx.reload();
    return card;
  }

  function exportSection(ctx) {
    return h('section', { class: 'wu-card wb-card', 'data-wa-export': '', 'aria-labelledby': 'wb-export-title' }, [
      h('div', { class: 'wu-card-head' }, [
        h('div', null, [
          h('h2', { id: 'wb-export-title', class: 'wu-card-title', text: 'Exportar dados da instância' }),
          h('p', { class: 'wu-muted', text: 'Um arquivo ZIP com conversas, contatos, leads e agendamentos desta instância, para atender a portabilidade da LGPD ou levar os dados para outro sistema.' }),
        ]),
        h('div', { class: 'wu-head-actions' }, [button('Exportar dados', 'wu-btn-ghost', function () { exportDialog(ctx); })]),
      ]),
    ]);
  }

  // ------------------------------------------------------------------------------------------ mount
  var names = {};
  function instanceName(id) {
    if (isClient()) {
      try { var st = JSON.parse(ls('wa-portal') || 'null'); if (st && st.instanceId === id) return Promise.resolve({ name: st.instanceName, payer: st.instanceName }); } catch (e) { /* ignore */ }
    }
    if (names[id]) return Promise.resolve(names[id]);
    return request('GET', '/instance/fetchInstances').then(function (list) {
      var inst = (list || []).filter(function (i) { return i && i.id === id; })[0];
      if (!inst) throw new Error('instance not found');
      names[id] = { name: inst.name, payer: inst.profileName || inst.name };
      return names[id];
    });
  }

  var mounting = false;
  function mount() {
    var m = location.pathname.match(/^\/manager\/instance\/([^/]+)\/usage\/?$/);
    if (!m || mounting || !api() || !token()) return;
    var page = document.querySelector('main.wu-page');
    if (!page || page.querySelector('[data-wa-billing]')) return;
    mounting = true;
    instanceName(m[1]).then(function (info) {
      mounting = false;
      var current = document.querySelector('main.wu-page');
      if (!current || current.querySelector('[data-wa-billing]')) return;
      var ctx = { name: info.name, payer: info.payer };
      current.appendChild(billingSection(ctx));
      if (!isClient()) current.appendChild(exportSection(ctx));
    }, function () { mounting = false; });
  }

  var queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    (window.requestAnimationFrame || setTimeout)(function () { queued = false; mount(); });
  }
  function start() {
    mount();
    if ('MutationObserver' in window) new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    else setInterval(mount, 1000);
  }
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
