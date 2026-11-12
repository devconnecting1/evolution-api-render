/*
 * WhatsAI panel: "Plano e limites" > Cobrança (proposal X, manual billing and receipts).
 *
 * The operator is a pessoa física without a payment gateway: the administrator records each monthly charge by hand
 * and prints a receipt for each paid one. The client's code with the module "plano" only reads the history and opens
 * the receipts (the server refuses any write).
 *
 * This script renders into the panel that the bundle draws for the "Cobrança" tab (main.wu-page ->
 * [data-wa-billing]) and keeps itself there after each React render (MutationObserver), like client-portal.js.
 * API: GET/POST/PATCH/DELETE /usage/billing/:instance (src/api/routes/usage.router.ts).
 */
(function () {
  'use strict';

  var MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  var STATUS = { pago: ['Pago', 'ok'], pendente: ['Pendente', 'warn'], atrasado: ['Atrasado', 'bad'] };
  var METHODS = { pix: 'Pix', boleto: 'Boleto', transferencia: 'Transferência', outro: 'Outro' };

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

  // ------------------------------------------------------------------------------------------ dialogs
  function modal(title, body, actions) {
    var d = h('dialog', { class: 'wa-bm-dialog', 'aria-labelledby': 'wa-bm-dialog-t' });
    d.appendChild(h('h2', { id: 'wa-bm-dialog-t', class: 'wa-bm-dialog-title', text: title }));
    d.appendChild(body);
    d.appendChild(h('div', { class: 'wa-bm-dialog-actions' }, actions));
    d.addEventListener('close', function () { d.remove(); });
    d.addEventListener('click', function (e) { if (e.target === d) d.close(); });
    document.body.appendChild(d);
    d.showModal();
    return d;
  }
  function button(text, cls, onclick, type) {
    return h('button', { type: type || 'button', class: 'wa-bm-btn ' + (cls || ''), text: text, onclick: onclick });
  }

  function editDialog(ctx, entry) {
    var isNew = !entry;
    var today = new Date();
    var month = entry ? entry.period : today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0');
    var f = {
      period: h('input', { type: 'month', id: 'wa-bm-period', required: true, value: month }),
      amount: h('input', { type: 'text', id: 'wa-bm-amount', inputmode: 'decimal', required: true, placeholder: '437,00', value: entry ? (entry.amountCents / 100).toFixed(2).replace('.', ',') : '' }),
      status: h('select', { id: 'wa-bm-status' }, Object.keys(STATUS).map(function (k) { return h('option', { value: k, text: STATUS[k][0], selected: (entry ? entry.status : 'pendente') === k }); })),
      method: h('select', { id: 'wa-bm-method' }, [h('option', { value: '', text: 'Não informar' })].concat(Object.keys(METHODS).map(function (k) { return h('option', { value: k, text: METHODS[k], selected: entry && entry.method === k }); }))),
      paidAt: h('input', { type: 'date', id: 'wa-bm-paid', value: entry && entry.paidAt ? String(entry.paidAt).slice(0, 10) : '' }),
      note: h('textarea', { id: 'wa-bm-note', maxlength: '280', rows: '2', text: entry && entry.note ? entry.note : '' }),
    };
    var err = h('p', { class: 'wa-bm-error', role: 'alert' });
    var field = function (id, label, input, hint) {
      return h('div', { class: 'wa-bm-field' }, [h('label', { for: id, text: label }), input, hint ? h('p', { class: 'wa-bm-hint', text: hint }) : null]);
    };
    var form = h('form', { class: 'wa-bm-form', novalidate: true }, [
      h('div', { class: 'wa-bm-row' }, [field('wa-bm-period', 'Mês de referência', f.period), field('wa-bm-amount', 'Valor (R$)', f.amount)]),
      h('div', { class: 'wa-bm-row' }, [field('wa-bm-status', 'Situação', f.status), field('wa-bm-method', 'Forma de pagamento', f.method)]),
      field('wa-bm-paid', 'Pago em', f.paidAt, 'Vazio e marcado como pago: fica a data de hoje.'),
      field('wa-bm-note', 'Observação (aparece no recibo)', f.note),
      err,
    ]);
    var save = button(isNew ? 'Registrar' : 'Salvar', 'wa-bm-primary', null, 'submit');
    save.setAttribute('form', 'wa-bm-form');
    form.id = 'wa-bm-form';
    var d = modal(isNew ? 'Novo lançamento' : 'Editar cobrança', form, [button('Cancelar', 'wa-bm-ghost', function () { d.close(); }), save]);
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var cents = parseMoney(f.amount.value);
      if (!/^\d{4}-\d{2}$/.test(f.period.value)) { err.textContent = 'Escolha o mês de referência.'; f.period.focus(); return; }
      if (!cents) { err.textContent = 'Informe o valor, por exemplo 437,00.'; f.amount.focus(); return; }
      var body = { period: f.period.value, amountCents: cents, status: f.status.value, method: f.method.value || null, paidAt: f.paidAt.value || null, note: f.note.value };
      save.disabled = true;
      save.textContent = 'Salvando…';
      var call = isNew
        ? request('POST', '/usage/billing/' + encodeURIComponent(ctx.name), body)
        : request('PATCH', '/usage/billing/' + encodeURIComponent(ctx.name) + '/' + encodeURIComponent(entry.id), body);
      call.then(function () { d.close(); ctx.reload(); }, function (e) {
        err.textContent = e.message;
        save.disabled = false;
        save.textContent = isNew ? 'Registrar' : 'Salvar';
      });
    });
    f.period.focus();
  }

  function deleteDialog(ctx, entry) {
    var body = h('p', { class: 'wa-bm-text', text: 'Excluir a cobrança de ' + monthLabel(entry.period) + ' (' + money(entry.amountCents) + ')?' + (entry.receiptNumber ? ' O recibo nº ' + String(entry.receiptNumber).padStart(4, '0') + ' deixa de existir e o número não é reaproveitado.' : '') });
    var go = button('Excluir', 'wa-bm-danger');
    var d = modal('Excluir cobrança', body, [button('Cancelar', 'wa-bm-ghost', function () { d.close(); }), go]);
    go.addEventListener('click', function () {
      go.disabled = true;
      request('DELETE', '/usage/billing/' + encodeURIComponent(ctx.name) + '/' + encodeURIComponent(entry.id)).then(function () { d.close(); ctx.reload(); }, function (e) {
        body.textContent = e.message;
        go.disabled = false;
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
    var sheet = h('article', { class: 'wa-bm-receipt', 'aria-label': 'Recibo nº ' + number }, [
      h('header', { class: 'wa-bm-receipt-head' }, [h('h1', { text: 'Recibo' }), h('p', { class: 'wa-bm-receipt-no', text: 'Nº ' + number })]),
      h('p', { class: 'wa-bm-receipt-value', text: money(entry.amountCents) }),
      h('p', { class: 'wa-bm-receipt-body', text: 'Recebi de ' + payer + ' a importância de ' + money(entry.amountCents) + ' (' + moneyWords(entry.amountCents) + '), referente ao serviço WhatsAI (atendimento com inteligência artificial no WhatsApp), mensalidade de ' + monthLabel(entry.period) + method + paid + '.' }),
      entry.note ? h('p', { class: 'wa-bm-receipt-note', text: entry.note }) : null,
      place ? h('p', { class: 'wa-bm-receipt-place', text: place + '.' }) : null,
      provider.name || provider.doc
        ? h('div', { class: 'wa-bm-receipt-sign' }, [h('span', { class: 'wa-bm-receipt-line', 'aria-hidden': 'true' }), provider.name ? h('p', { text: provider.name }) : null, provider.doc ? h('p', { text: 'CPF ' + provider.doc }) : null])
        : null,
    ]);
    var overlay = h('div', { class: 'wa-bm-receipt-wrap', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Recibo' }, [
      h('div', { class: 'wa-bm-receipt-bar' }, [
        h('span', { text: 'Recibo nº ' + number }),
        h('span', { class: 'wa-bm-grow' }),
        button('Imprimir ou salvar em PDF', 'wa-bm-primary', function () { window.print(); }),
        button('Fechar', 'wa-bm-ghost', function () { close(); }),
      ]),
      !isClient() && !provider.configured
        ? h('p', { class: 'wa-bm-receipt-warn', text: 'Para o recibo sair com o seu nome, CPF e cidade, configure ' + provider.missing.join(', ') + ' no servidor (Render, Environment).' })
        : null,
      sheet,
    ]);
    function onKey(e) { if (e.key === 'Escape') close(); }
    function close() { document.removeEventListener('keydown', onKey); overlay.remove(); }
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    overlay.querySelector('.wa-bm-primary').focus();
  }

  // ------------------------------------------------------------------------------------------ sections
  function chip(status) {
    var s = STATUS[status] || [status, 'off'];
    return h('span', { class: 'wa-bm-chip', 'data-tone': s[1] }, [h('span', { class: 'wa-bm-dot', 'aria-hidden': 'true' }), s[0]]);
  }

  function summary(data) {
    var plan = data.plan || {};
    var totals = data.totals || {};
    var cards = [
      h('div', { class: 'wa-bm-summary-card' }, [
        h('span', { class: 'wa-bm-summary-label', text: 'Plano' }),
        h('strong', { class: 'wa-bm-summary-value', text: plan.name ? 'Plano ' + plan.name : 'Sem plano definido' }),
        h('span', { class: 'wa-bm-summary-meta', text: plan.monthlyResponses ? plan.monthlyResponses.toLocaleString('pt-BR') + ' respostas por mês' : 'Ajuste em Uso' }),
      ]),
      h('div', { class: 'wa-bm-summary-card' }, [
        h('span', { class: 'wa-bm-summary-label', text: 'Em aberto' }),
        h('strong', { class: 'wa-bm-summary-value', text: money((totals.pendingCents || 0) + (totals.overdueCents || 0)) }),
        h('span', { class: 'wa-bm-summary-meta', text: data.openPeriod ? 'Mês de ' + monthLabel(data.openPeriod) : 'Nada em aberto' }),
      ]),
      h('div', { class: 'wa-bm-summary-card' }, [
        h('span', { class: 'wa-bm-summary-label', text: 'Pago' }),
        h('strong', { class: 'wa-bm-summary-value', text: money(totals.paidCents || 0) }),
        h('span', { class: 'wa-bm-summary-meta', text: 'Recibos dos pagamentos' }),
      ]),
    ];
    if (totals.overdueCents) {
      cards.push(h('div', { class: 'wa-bm-summary-card', 'data-tone': 'bad' }, [
        h('span', { class: 'wa-bm-summary-label', text: 'Atrasado' }),
        h('strong', { class: 'wa-bm-summary-value', text: money(totals.overdueCents) }),
        h('span', { class: 'wa-bm-summary-meta', text: 'Cobranças vencidas' }),
      ]));
    }
    return h('div', { class: 'wa-bm-summary' }, cards);
  }

  function historyTable(ctx, data) {
    var entries = data.history || [];
    var provider = data.provider || { configured: false, missing: [] };
    var card = h('section', { class: 'wa-bm-card', 'aria-labelledby': 'wa-bm-history-title' }, [
      h('div', { class: 'wa-bm-card-head' }, [
        h('div', null, [
          h('h2', { id: 'wa-bm-history-title', class: 'wa-bm-card-title', text: 'Histórico mensal' }),
          h('p', { class: 'wa-bm-muted', text: isClient() ? 'Mensalidades e recibos dos pagamentos.' : 'Cada mês pode ter um lançamento. O recibo sai quando a cobrança fica paga.' }),
        ]),
      ]),
    ]);
    if (!entries.length) {
      card.appendChild(h('div', { class: 'wa-bm-empty' }, [
        h('strong', { text: 'Nenhuma cobrança registrada ainda.' }),
        h('span', { text: isClient() ? 'As mensalidades aparecem aqui quando forem registradas.' : 'Use "Novo lançamento" para registrar a primeira mensalidade.' }),
      ]));
      return card;
    }
    var rows = entries.map(function (e) {
      var acts = [];
      if (e.status === 'pago' && e.receiptNumber) acts.push(button('Recibo', 'wa-bm-ghost wa-bm-sm', function () { receipt(ctx, e, provider); }));
      if (!isClient()) {
        acts.push(button('Editar', 'wa-bm-ghost wa-bm-sm', function () { editDialog(ctx, e); }));
        acts.push(h('button', { type: 'button', class: 'wa-bm-btn wa-bm-ghost wa-bm-sm wa-bm-icon', 'aria-label': 'Excluir a cobrança de ' + monthLabel(e.period), title: 'Excluir', text: '×', onclick: function () { deleteDialog(ctx, e); } }));
      }
      return h('tr', null, [
        h('td', { 'data-label': 'Mês' }, [h('span', { class: 'wa-bm-month', text: monthLabel(e.period) }), e.note && !isClient() ? h('span', { class: 'wa-bm-sub', text: e.note }) : null]),
        h('td', { 'data-label': 'Valor', class: 'wa-bm-num', text: money(e.amountCents) }),
        h('td', { 'data-label': 'Situação' }, [chip(e.status)]),
        h('td', { 'data-label': 'Pagamento', text: [e.method ? METHODS[e.method] : '', dateLabel(e.paidAt)].filter(Boolean).join(' · ') || '—' }),
        h('td', { 'data-label': 'Recibo', class: 'wa-bm-num', text: e.receiptNumber ? 'nº ' + String(e.receiptNumber).padStart(4, '0') : '—' }),
        h('td', { class: 'wa-bm-actions' }, [h('div', { class: 'wa-bm-acts' }, acts)]),
      ]);
    });
    card.appendChild(h('div', { class: 'wa-bm-tablewrap' }, [
      h('table', { class: 'wa-bm-table' }, [
        h('thead', null, [h('tr', null, ['Mês', 'Valor', 'Situação', 'Pagamento', 'Recibo', ''].map(function (t, i) { return h('th', { scope: 'col', text: t, class: i === 5 ? 'wa-bm-actions' : null }); }))]),
        h('tbody', null, rows),
      ]),
    ]));
    return card;
  }

  function render(ctx, panel) {
    panel.classList.add('wa-bm');
    var body = panel.querySelector('.wa-bm-body');
    if (!body) {
      body = h('div', { class: 'wa-bm-body' });
      panel.appendChild(body);
    }
    body.setAttribute('aria-busy', 'true');
    body.textContent = '';
    body.appendChild(h('div', { class: 'wa-bm-head' }, [
      h('div', null, [
        h('h2', { class: 'wa-bm-title', text: 'Cobrança' }),
        h('p', { class: 'wa-bm-muted', text: isClient() ? 'Mensalidades registradas e os recibos dos pagamentos.' : 'Registre cada mensalidade e gere o recibo quando ela for paga. O cliente vê esta lista na área dele (módulo Plano).' }),
      ]),
      h('div', { class: 'wa-bm-head-actions' }, isClient() ? [] : [button('Novo lançamento', 'wa-bm-primary', function () { editDialog(ctx); })]),
    ]));
    var live = h('div', { class: 'wa-bm-live', 'aria-live': 'polite' }, [h('p', { class: 'wa-bm-muted', text: 'Carregando…' })]);
    body.appendChild(live);

    ctx.reload = function () {
      request('GET', '/usage/billing/' + encodeURIComponent(ctx.name)).then(function (data) {
        live.textContent = '';
        var provider = (data && data.provider) || { configured: false, missing: [] };
        if (!isClient() && !provider.configured) {
          live.appendChild(h('p', { class: 'wa-bm-note', text: 'Os recibos saem sem os seus dados até você configurar ' + provider.missing.join(', ') + ' no servidor.' }));
        }
        live.appendChild(summary(data || {}));
        live.appendChild(historyTable(ctx, data || {}));
        body.setAttribute('aria-busy', 'false');
      }, function (e) {
        live.textContent = '';
        body.setAttribute('aria-busy', 'false');
        live.appendChild(h('div', { class: 'wa-bm-error-block', role: 'alert' }, [
          h('p', { text: e.status === 403 ? 'Este acesso não inclui a cobrança.' : e.message }),
          e.status === 403 ? null : button('Tentar de novo', 'wa-bm-ghost', function () { ctx.reload(); }),
        ]));
      });
    };
    ctx.reload();
  }

  // ------------------------------------------------------------------------------------------ mount
  var names = {};
  function instanceName(id) {
    if (isClient()) {
      try {
        var st = JSON.parse(ls('wa-portal') || 'null');
        if (st && st.instanceId === id) return Promise.resolve({ name: st.instanceName, payer: st.instanceName });
      } catch (e) { /* ignore */ }
    }
    if (names[id]) return Promise.resolve(names[id]);
    return request('GET', '/instance/fetchInstances').then(function (list) {
      var inst = (list || []).filter(function (i) { return i && i.id === id; })[0];
      if (!inst) throw new Error('Instância não encontrada.');
      names[id] = { name: inst.name, payer: inst.profileName || inst.name };
      return names[id];
    });
  }

  var mounting = false;
  function mount() {
    var m = location.pathname.match(/^\/manager\/instance\/([^/]+)\/usage\/?$/);
    if (!m || mounting || !api() || !token()) return;
    var panel = document.querySelector('[data-wa-billing]');
    if (!panel || panel.querySelector('.wa-bm-body')) return;
    mounting = true;
    instanceName(m[1]).then(function (info) {
      mounting = false;
      var current = document.querySelector('[data-wa-billing]');
      if (!current || current.querySelector('.wa-bm-body')) return;
      render({ name: info.name, payer: info.payer }, current);
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
  }
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
