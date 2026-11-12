/*
 * WhatsAI Manager: "Visão Geral com o resultado do escritório".
 *
 * Fills the <div data-wa-overview="<instância>" data-wa-instance-id="<id>"> that manager/patches/
 * visao-geral-resultado.py puts on the first screen:
 *   - 7/30 day selector;
 *   - leads novos, aguardando equipe, agendamentos and respostas da IA, with the variation against the
 *     previous period (the waiting queue is a snapshot: no previous number, no invented comparison);
 *   - grouped bar chart of leads and appointments per day, with legend and a table view;
 *   - today's agenda;
 *   - alerts: court cases with news and leads waiting over 2 hours.
 *
 * Reads GET /overview/:instanceName?days=7|30 only when the screen opens and when the period changes. There is no
 * timer and no polling: this page never wakes the Neon database on its own. "1ª resposta" is not shown because the
 * API does not have that number (the leads only store the last human reply) - see the PR.
 *
 * Plain script (window.WaOverview), loaded before the bundle like client-portal.js. Tokens and URL come from the
 * same localStorage keys the panel uses (apiUrl, token).
 */
(function () {
  'use strict';

  var SVG = 'http://www.w3.org/2000/svg';
  var DAYS = [7, 30];
  var number = new Intl.NumberFormat('pt-BR');

  function ls(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function api() { return (ls('apiUrl') || '').replace(/\/+$/, ''); }
  function token() { return ls('token') || ''; }
  function fmt(value) { return number.format(Number(value) || 0); }

  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'class') el.className = attrs[k];
      else if (k === 'text') el.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] != null) el.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    }
    (children || []).forEach(function (c) {
      if (c != null) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }

  function request(path) {
    return fetch(api() + path, { headers: { apikey: token() }, cache: 'no-store' }).then(function (r) {
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

  function dayShort(day) { return day.slice(8, 10) + '/' + day.slice(5, 7); }
  function dayLong(day) {
    try {
      return new Date(day + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
    } catch (e) {
      return dayShort(day);
    }
  }

  // ------------------------------------------------------------------------------------------------ numbers
  function kpi(label, value, variation, hint, note) {
    var card = h('div', { class: 'wa-ov-kpi' }, [
      h('span', { class: 'wa-ov-kpi-label', text: label }),
      h('span', { class: 'wa-ov-kpi-value', text: fmt(value) }),
    ]);
    var foot = h('span', { class: 'wa-ov-kpi-foot' });
    if (variation && variation.percent !== null) {
      var percent = variation.percent;
      var tone = variation.delta > 0 ? 'up' : variation.delta < 0 ? 'down' : 'flat';
      foot.setAttribute('data-tone', tone);
      foot.textContent = (percent > 0 ? '+' : percent < 0 ? '−' : '') + fmt(Math.abs(percent)) + '% ' + hint;
    } else if (variation && variation.delta > 0) {
      foot.setAttribute('data-tone', 'up');
      foot.textContent = '+' + fmt(variation.delta) + ' ' + hint;
    } else {
      foot.setAttribute('data-tone', 'flat');
      foot.textContent = 'agora';
    }
    card.appendChild(foot);
    if (note) card.appendChild(h('span', { class: 'wa-ov-kpi-note', text: note }));
    return card;
  }

  function kpis(view) {
    var hint = 'vs. ' + view.period.days + ' dias anteriores';
    var plan = view.plan && view.plan.limit
      ? 'No mês: ' + fmt(view.plan.responses) + ' de ' + fmt(view.plan.limit) + ' (' + fmt(view.plan.percent) + '%)'
      : 'No mês: ' + fmt(view.plan ? view.plan.responses : 0);
    return h('div', { class: 'wa-ov-kpis' }, [
      kpi('Leads novos', view.totals.leadsNew, view.variation.leadsNew, hint),
      kpi('Aguardando equipe', view.totals.awaitingTeam, null, hint),
      kpi('Agendamentos', view.totals.appointments, view.variation.appointments, hint),
      kpi('Respostas da IA', view.totals.aiResponses, view.variation.aiResponses, hint, plan),
    ]);
  }

  // -------------------------------------------------------------------------------------------------- chart
  /** Round the top of the scale to a multiple of 4 so the middle tick is an integer. */
  function niceMax(max) {
    return max <= 4 ? 4 : Math.ceil(max / 4) * 4;
  }

  function barPath(x, y, w, height) {
    var r = Math.min(3, w / 2, height);
    return 'M' + x + ',' + (y + height) +
      'L' + x + ',' + (y + r) +
      'Q' + x + ',' + y + ' ' + (x + r) + ',' + y +
      'L' + (x + w - r) + ',' + y +
      'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) +
      'L' + (x + w) + ',' + (y + height) + 'Z';
  }

  function chartSvg(daily) {
    var plotW = Math.max(520, daily.length * (daily.length === 7 ? 64 : 30));
    var top = 10, plotH = 150, left = 34, right = 8, bottom = 26;
    var width = left + plotW + right, height = top + plotH + bottom;
    var max = 0;
    daily.forEach(function (d) { max = Math.max(max, d.leads, d.appointments); });
    var yMax = niceMax(max);
    var groupW = plotW / daily.length;
    var barW = Math.min(16, Math.max(4, Math.floor(groupW * 0.3)));
    var gap = 2;

    var svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('class', 'wa-ov-chart');
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('role', 'group');
    svg.setAttribute('aria-label', 'Leads novos e agendamentos por dia');

    function add(tag, attrs, parent) {
      var el = document.createElementNS(SVG, tag);
      for (var k in attrs) el.setAttribute(k, attrs[k]);
      (parent || svg).appendChild(el);
      return el;
    }
    function yOf(value) { return top + plotH - (value / yMax) * plotH; }

    [0, yMax / 2, yMax].forEach(function (value) {
      var y = yOf(value);
      add('line', {
        x1: left, x2: left + plotW, y1: y, y2: y,
        stroke: 'var(--m-border)', 'stroke-width': '1',
      });
      add('text', {
        x: left - 8, y: y + 3.5, 'text-anchor': 'end',
        fill: 'var(--m-text-3)', 'font-size': '10',
      }).textContent = fmt(value);
    });

    var every = Math.ceil(daily.length / 8);
    daily.forEach(function (d, i) {
      var center = left + groupW * i + groupW / 2;
      if (i % every === 0 || i === daily.length - 1) {
        add('text', {
          x: center, y: top + plotH + 16, 'text-anchor': 'middle',
          fill: 'var(--m-text-3)', 'font-size': '10',
        }).textContent = dayShort(d.day);
      }
      var leadsH = (d.leads / yMax) * plotH;
      var apptH = (d.appointments / yMax) * plotH;
      var x1 = center - gap / 2 - barW;
      var x2 = center + gap / 2;
      function bar(x, value, label, fill) {
        if (!value) return;
        var g = add('g', { tabindex: '0', role: 'img', 'aria-label': dayShort(d.day) + ': ' + label });
        add('title', {}, g).textContent = dayShort(d.day) + ': ' + label;
        add('path', {
          d: barPath(x, yOf(value), barW, (value / yMax) * plotH),
          fill: fill, class: 'wa-ov-bar',
        }, g);
      }
      bar(x1, d.leads, d.leads + (d.leads === 1 ? ' lead novo' : ' leads novos'), 'var(--m-chart-1)');
      bar(x2, d.appointments, d.appointments + (d.appointments === 1 ? ' agendamento' : ' agendamentos'), 'var(--m-chart-4)');
    });
    return svg;
  }

  function chartTable(daily) {
    var details = h('details', { class: 'wa-ov-data' });
    details.appendChild(h('summary', { text: 'Ver os números em tabela' }));
    var body = h('tbody');
    daily.forEach(function (d) {
      body.appendChild(h('tr', null, [
        h('td', { text: dayShort(d.day) }),
        h('td', { text: fmt(d.leads) }),
        h('td', { text: fmt(d.appointments) }),
        h('td', { text: fmt(d.aiResponses) }),
      ]));
    });
    details.appendChild(h('div', { class: 'wa-ov-tablewrap' }, [
      h('table', { class: 'wa-ov-table' }, [
        h('caption', { class: 'wa-ov-loading', text: 'Números por dia do período' }),
        h('thead', null, [h('tr', null, [
          h('th', { scope: 'col', text: 'Dia' }),
          h('th', { scope: 'col', text: 'Leads novos' }),
          h('th', { scope: 'col', text: 'Agendamentos' }),
          h('th', { scope: 'col', text: 'Respostas da IA' }),
        ])]),
        body,
      ]),
    ]));
    return details;
  }

  function chartCard(view) {
    return h('section', { class: 'wa-ov-card' }, [
      h('div', { class: 'wa-ov-cardhead' }, [
        h('h3', { class: 'wa-ov-cardtitle', text: 'Leads e agendamentos por dia' }),
        h('div', { class: 'wa-ov-legend' }, [
          h('span', null, [h('span', { class: 'wa-ov-swatch', 'data-series': 'leads', 'aria-hidden': 'true' }), 'Leads novos']),
          h('span', null, [h('span', { class: 'wa-ov-swatch', 'data-series': 'appointments', 'aria-hidden': 'true' }), 'Agendamentos']),
        ]),
      ]),
      h('div', { class: 'wa-ov-chartwrap' }, [chartSvg(view.daily)]),
      chartTable(view.daily),
    ]);
  }

  // ------------------------------------------------------------------------------------------------- agenda
  function todayCard(view) {
    var list = view.today.appointments || [];
    var card = h('div', { class: 'wa-ov-card' }, [
      h('div', { class: 'wa-ov-cardhead' }, [
        h('h3', { class: 'wa-ov-cardtitle', text: 'Agenda de hoje' }),
        h('span', { class: 'wa-ov-cardmeta', text: dayLong(view.today.day) }),
      ]),
    ]);
    if (!list.length) {
      card.appendChild(h('p', { class: 'wa-ov-empty', text: 'Nada marcado para hoje.' }));
      return card;
    }
    var ul = h('ul', { class: 'wa-ov-agenda' });
    list.forEach(function (item) {
      var meta = item.typeName || '';
      if (item.status && item.status !== 'agendado') meta += (meta ? ' · ' : '') + item.status;
      ul.appendChild(h('li', { class: 'wa-ov-agenda-item' }, [
        h('span', { class: 'wa-ov-agenda-time', text: item.time }),
        h('span', { class: 'wa-ov-agenda-who' }, [
          h('strong', { text: item.contactName || 'Contato sem nome' }),
          meta ? h('small', { text: meta }) : null,
        ]),
      ]));
    });
    card.appendChild(ul);
    return card;
  }

  // ------------------------------------------------------------------------------------------------- alerts
  function alertLink(href, title, note) {
    return h('a', { class: 'wa-ov-alert', href: href }, [
      h('strong', { text: title }),
      note ? h('small', { text: note }) : null,
    ]);
  }

  function alertsCard(view, base) {
    var alerts = view.alerts || {};
    var items = [];
    if (alerts.processesWithNews > 0) {
      items.push(alertLink(
        base + '/processos',
        alerts.processesWithNews + (alerts.processesWithNews === 1 ? ' processo com novidade' : ' processos com novidade'),
        alerts.unseenPublications > 0
          ? alerts.unseenPublications + (alerts.unseenPublications === 1 ? ' publicação nova' : ' publicações novas') + ' para ler'
          : 'Abra Processos para ver o que chegou.',
      ));
    }
    if (alerts.leadsWaitingOver2h > 0) {
      items.push(alertLink(
        base + '/leads',
        alerts.leadsWaitingOver2h + (alerts.leadsWaitingOver2h === 1 ? ' lead aguardando há mais de 2 horas' : ' leads aguardando há mais de 2 horas'),
        'A equipe ainda não respondeu estes contatos.',
      ));
    }
    var card = h('section', { class: 'wa-ov-card' }, [
      h('div', { class: 'wa-ov-cardhead' }, [h('h3', { class: 'wa-ov-cardtitle', text: 'Precisa de atenção' })]),
    ]);
    if (!items.length) {
      card.appendChild(h('p', { class: 'wa-ov-empty', text: 'Nada pedindo atenção agora.' }));
      return card;
    }
    var list = h('div', { class: 'wa-ov-alerts' });
    items.forEach(function (item) { list.appendChild(item); });
    card.appendChild(list);
    return card;
  }

  // -------------------------------------------------------------------------------------------------- mount
  function fill(root) {
    if (root.getAttribute('data-wa-filled') === '1') return;
    root.setAttribute('data-wa-filled', '1');

    var name = root.getAttribute('data-wa-overview');
    var instanceId = root.getAttribute('data-wa-instance-id') || '';
    var base = '/manager/instance/' + encodeURIComponent(instanceId);
    var days = DAYS[0];
    var seq = 0;

    var titleId = 'wa-ov-title-' + (instanceId || name);
    var titleEl = h('h2', { class: 'wa-ov-title', id: titleId, text: 'Como foi a semana?' });
    var body = h('div');
    var seg = h('div', { class: 'wa-ov-seg', role: 'group', 'aria-label': 'Período da visão geral' });
    var buttons = DAYS.map(function (value) {
      var button = h('button', {
        type: 'button',
        'aria-pressed': value === days ? 'true' : 'false',
        text: value + ' dias',
        onclick: function () {
          if (days === value) return;
          days = value;
          titleEl.textContent = value === 7 ? 'Como foi a semana?' : 'Como foi o mês?';
          buttons.forEach(function (other) {
            other.setAttribute('aria-pressed', other === button ? 'true' : 'false');
          });
          load();
        },
      });
      seg.appendChild(button);
      return button;
    });

    root.appendChild(h('section', { class: 'wa-ov', 'aria-labelledby': titleId }, [
      h('div', { class: 'wa-ov-head' }, [
        h('div', { class: 'wa-ov-headtext' }, [
          titleEl,
          h('p', { class: 'wa-ov-sub', text: 'Leads, agendamentos e respostas da IA deste escritório.' }),
        ]),
        seg,
      ]),
      body,
    ]));

    function loading() {
      body.setAttribute('aria-busy', 'true');
      body.textContent = '';
      var grid = h('div', { class: 'wa-ov-kpis' });
      for (var i = 0; i < 4; i++) grid.appendChild(h('div', { class: 'wa-ov-kpi wa-ov-skel', 'aria-hidden': 'true' }));
      body.appendChild(grid);
      body.appendChild(h('div', { class: 'wa-ov-card wa-ov-skel wa-ov-skel-chart', 'aria-hidden': 'true' }));
      body.appendChild(h('p', { class: 'wa-ov-loading', role: 'status', text: 'Carregando os números…' }));
    }

    function failure(error) {
      body.removeAttribute('aria-busy');
      body.textContent = '';
      var text = error && (error.status === 401 || error.status === 403)
        ? 'Sua sessão expirou. Entre de novo no painel para ver os números.'
        : 'Não foi possível carregar os números agora.';
      body.appendChild(h('div', { class: 'wa-ov-error', role: 'alert' }, [
        h('div', null, [h('strong', { text: 'Visão geral indisponível' }), h('p', { text: text })]),
        h('button', { type: 'button', class: 'wa-ov-btn', text: 'Tentar de novo', onclick: load }),
      ]));
    }

    function draw(view) {
      body.removeAttribute('aria-busy');
      body.textContent = '';
      body.appendChild(kpis(view));
      body.appendChild(chartCard(view));
      body.appendChild(h('div', { class: 'wa-ov-columns' }, [todayCard(view), alertsCard(view, base)]));
    }

    function load() {
      var mine = ++seq;
      loading();
      request('/overview/' + encodeURIComponent(name) + '?days=' + days).then(function (view) {
        if (mine === seq) draw(view);
      }, function (error) {
        if (mine === seq) failure(error);
      });
    }

    load();
  }

  function fillRoots() {
    var nodes = document.querySelectorAll('[data-wa-overview]');
    for (var i = 0; i < nodes.length; i++) fill(nodes[i]);
  }

  function start() {
    fillRoots();
    new MutationObserver(fillRoots).observe(document.body, { childList: true, subtree: true });
  }
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);

  window.WaOverview = { refresh: fillRoots };
})();
