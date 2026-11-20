/*
 * WhatsAI: pagina publica de status.
 *
 * Le GET /status da API (sem chave): estado atual, 90 dias por componente, faixas de 12 horas (7 dias) e incidentes.
 * A pagina refaz as faixas de 12 horas (00h-12h e 12h-24h de Brasilia) a partir do que a API mandar: faixas de 3 horas
 * (versao anterior da API) ou de 12 horas, entao funciona durante a troca de versao. Quando a
 * meta tag "whatsai-status-monitor" tem o endereco do monitor externo (ops/status-monitor, Cloudflare Worker), a
 * pagina tambem le GET /history dele e junta as verificacoes externas: periodos em que a API estava fora do ar (e
 * nao podia registrar nada) passam a aparecer como indisponiveis, e a cobertura conta essas verificacoes.
 * Nada aqui inventa disponibilidade: o que ninguem observou aparece como "Sem dados".
 */
(function () {
  'use strict';

  var API_BASE = 'https://evolution-api-x93o.onrender.com';
  var REFRESH_FALLBACK_MS = 60_000;
  var TIMEOUT_MS = 15_000;
  var BUCKET_MS = 12 * 60 * 60 * 1000;
  /** Faixas de 12 h comecam as 00h e 12h de Brasilia (03h e 15h UTC). */
  var BUCKET_OFFSET_MS = 3 * 60 * 60 * 1000;
  var HISTORY_SLOTS = 14;
  var DAY_MS = 24 * 60 * 60 * 1000;
  var RANGE_KEY = 'whatsai-status-range';
  var CAL_KEY = 'whatsai-status-calendar';
  /** Meses mostrados de uma vez no calendario (como o Uptime do GitHub Status). */
  var CAL_MONTHS = 3;
  var CAL_DAYS = 90;
  /** Incidentes mostrados antes de "Mostrar mais". */
  var INC_PAGE = 8;

  var monitorMeta = document.querySelector('meta[name="whatsai-status-monitor"]');
  var MONITOR_URL = monitorMeta && /^https:\/\/[^\s"'<>]+$/.test(monitorMeta.content || '') ? monitorMeta.content.replace(/\/$/, '') : '';

  var STATES = {
    operational: 'Operacional',
    degraded: 'Degradado',
    outage: 'Indisponível',
    maintenance: 'Manutenção',
    no_data: 'Sem dados',
  };
  var RANK = { no_data: 0, operational: 1, maintenance: 2, degraded: 3, outage: 4 };

  var RECOMMENDATIONS = {
    operational: 'Nada a fazer: o atendimento está disponível.',
    maintenance: 'Manutenção em andamento. O atendimento volta sozinho; se demorar, fale com a equipe.',
    degraded: 'A instabilidade está registrada. Se o seu WhatsApp não responder, fale com a equipe.',
    outage: 'O componente não está respondendo. Se o seu atendimento parou, fale com a equipe.',
    no_data: 'Ainda não há leitura dos componentes. Tente de novo em alguns minutos.',
  };

  var STATE_MEANING = {
    operational: 'As verificações registradas neste período encontraram o componente funcionando.',
    maintenance: 'Houve manutenção ou reinício neste período.',
    degraded: 'Houve falha parcial ou lentidão neste período.',
    outage: 'O componente não respondeu em parte deste período.',
    no_data: 'Não houve verificação neste período; não é possível afirmar se estava funcionando.',
  };

  var TYPE_LABEL = {
    deploy_failed: 'Deploy',
    restart_oom: 'Reinício',
    restart_deploy: 'Reinício',
    restart_unknown: 'Reinício',
    db_suspended_quota: 'Banco',
    db_quota_risk: 'Banco',
    whatsapp_disconnected: 'WhatsApp',
    ai_errors: 'IA',
    site_down: 'Site',
    upstream_incident: 'Terceiros',
    api_unreachable: 'API',
  };

  var hero = document.getElementById('st-hero');
  var title = document.getElementById('st-title');
  var summary = document.getElementById('st-summary');
  var updated = document.getElementById('st-updated');
  var cadence = document.getElementById('st-cadence');
  var coverageNote = document.getElementById('st-coverage');
  var alertBox = document.getElementById('st-alert');
  var groups = document.getElementById('st-groups');
  var incidents = document.getElementById('st-incidents');
  var heroDot = hero.querySelector('.st-state-dot');
  var heroStateLabel = document.getElementById('st-state-label');
  var recommendation = document.getElementById('st-recommendation');
  var legendNote = document.getElementById('st-legend-note');
  var rangeButtons = Array.prototype.slice.call(document.querySelectorAll('[data-range]'));
  var calendarBox = document.getElementById('st-calendar');
  var calSelect = document.getElementById('st-cal-component');
  var calPrev = document.getElementById('st-cal-prev');
  var calNext = document.getElementById('st-cal-next');
  var calPeriod = document.getElementById('st-cal-period');
  var calMonths = document.getElementById('st-cal-months');
  var calDetail = document.getElementById('st-cal-detail');
  var incCount = document.getElementById('st-incidents-count');
  var incFilterBox = document.getElementById('st-inc-filter');
  var incFilterButtons = Array.prototype.slice.call(document.querySelectorAll('[data-inc-filter]'));

  var range = '7d';
  var calComponent = 'api';
  try {
    var savedRange = window.localStorage.getItem(RANGE_KEY);
    if (savedRange === '90d' || savedRange === 'cal') range = savedRange;
    calComponent = window.localStorage.getItem(CAL_KEY) || 'api';
  } catch (error) {
    // preferencia opcional
  }
  /** 0 = a janela termina no mes atual; 1 = um mes antes, e assim por diante. */
  var calOffset = 0;
  var calOptionsKey = '';
  var incFilter = 'all';
  var incLimit = INC_PAGE;
  var lastShown = null;

  var lastData = null;
  var lastMonitor = null;
  var lastFailed = false;
  var refreshTimer = null;
  var relativeTimer = null;
  var request = null;
  var requestSeq = 0;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function stateLabel(state) {
    return STATES[state] || STATES.no_data;
  }

  function validState(state) {
    return STATES[state] ? state : 'no_data';
  }

  function parseDate(value) {
    var date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function relative(value) {
    var date = parseDate(value);
    if (!date) return 'agora';
    var seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
    if (seconds < 45) return 'agora';
    var minutes = Math.round(seconds / 60);
    if (minutes < 60) return 'há ' + minutes + ' min';
    var hours = Math.round(minutes / 60);
    if (hours < 24) return 'há ' + hours + ' h';
    var days = Math.round(hours / 24);
    return 'há ' + days + (days === 1 ? ' dia' : ' dias');
  }

  function percent(value) {
    var number = Number(value) || 0;
    var digits = number >= 99 && number < 100 ? 2 : number < 10 ? 1 : 0;
    return number.toLocaleString('pt-BR', { maximumFractionDigits: digits }) + '%';
  }

  function timeLocal(value) {
    var date = parseDate(value);
    if (!date) return '—';
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function dateLocal(value) {
    var date = parseDate(value);
    if (!date) return '—';
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
  }

  function duration(seconds) {
    var value = Math.max(0, Number(seconds) || 0);
    if (value < 60) return value + ' s';
    var minutes = Math.round(value / 60);
    if (minutes < 60) return minutes + ' min';
    var hours = Math.floor(minutes / 60);
    var rest = minutes % 60;
    if (hours >= 48) return Math.round(hours / 24) + ' dias';
    return hours + ' h' + (rest ? ' ' + rest + ' min' : '');
  }

  function setHeroState(state) {
    hero.dataset.state = state;
    heroDot.dataset.state = state;
    if (heroStateLabel) heroStateLabel.textContent = stateLabel(state);
    if (recommendation) recommendation.textContent = RECOMMENDATIONS[state] || RECOMMENDATIONS.no_data;
  }

  function showAlert(message) {
    alertBox.textContent = '';
    alertBox.append(el('p', null, message));
    var retry = el('button', null, 'Tentar de novo');
    retry.type = 'button';
    retry.addEventListener('click', function () {
      load();
    });
    alertBox.append(retry);
    alertBox.hidden = false;
  }

  function hideAlert() {
    alertBox.hidden = true;
    alertBox.textContent = '';
  }

  // --------------------------------------------------------------------------------------- monitor externo

  /**
   * Junta o historico do monitor externo ao da API. So preenche ou piora: um periodo que a API registrou como
   * operacional e o monitor viu fora fica "Indisponivel"; um periodo sem registro da API ganha o que o monitor viu.
   */
  function bucketStart(ms) {
    return Math.floor((ms - BUCKET_OFFSET_MS) / BUCKET_MS) * BUCKET_MS + BUCKET_OFFSET_MS;
  }

  /**
   * As faixas da API (3 h na versao anterior, 12 h na atual) viram 14 faixas de 12 h: pior estado visto e a
   * cobertura somada. Faixa sem nada registrado fica "Sem dados".
   */
  function twelveHourHistory(history, sourceMs, now) {
    var current = bucketStart(now);
    var slots = [];
    var byStart = {};
    for (var i = HISTORY_SLOTS - 1; i >= 0; i--) {
      var start = current - i * BUCKET_MS;
      var slot = { start: new Date(start).toISOString(), coverage: 0, components: {}, covered: 0 };
      slots.push(slot);
      byStart[start] = slot;
    }
    (history || []).forEach(function (bucket) {
      var from = parseDate(bucket.start);
      if (!from) return;
      var slot = byStart[bucketStart(from.getTime())];
      if (!slot) return;
      var span = Math.max(0, Math.min(sourceMs, now - from.getTime()));
      slot.covered += ((Number(bucket.coverage) || 0) / 100) * span;
      Object.keys(bucket.components || {}).forEach(function (id) {
        var state = validState(bucket.components[id]);
        if (state === 'no_data') return;
        if (!slot.components[id] || RANK[state] > RANK[slot.components[id]]) slot.components[id] = state;
      });
    });
    slots.forEach(function (slot) {
      var span = Math.max(1, Math.min(BUCKET_MS, now - new Date(slot.start).getTime()));
      slot.coverage = Math.round(Math.min(100, (slot.covered / span) * 100) * 10) / 10;
      delete slot.covered;
    });
    return slots;
  }

  function withTwelveHours(data) {
    var copy = JSON.parse(JSON.stringify(data));
    var sourceMs = Number(copy.historyDays) === 3 ? 3 * 60 * 60 * 1000 : BUCKET_MS;
    copy.history = twelveHourHistory(copy.history, sourceMs, Date.now());
    copy.coverage = copy.coverage || {};
    if (Number(copy.historyDays) !== 7 || typeof copy.coverage.last7d !== 'number') {
      copy.coverage.last7d = Math.round(
        (copy.history.reduce(function (total, bucket) { return total + bucket.coverage; }, 0) / copy.history.length) * 10,
      ) / 10;
    }
    return copy;
  }

  function mergeMonitor(data, monitor) {
    var merged = withTwelveHours(data);
    if (!monitor || !Array.isArray(monitor.samples)) return merged;

    var buckets = {};
    var days = {};
    monitor.samples.forEach(function (sample) {
      if (!Array.isArray(sample) || sample.length < 4) return;
      var at = Number(sample[0]) * 1000;
      var key = bucketStart(at);
      var bucket = buckets[key] || (buckets[key] = { n: 0, apiDown: 0, siteDown: 0 });
      bucket.n++;
      if (!sample[1]) bucket.apiDown++;
      if (!sample[3]) bucket.siteDown++;
    });
    Object.keys(monitor.days || {}).forEach(function (key) {
      var cell = monitor.days[key];
      if (Array.isArray(cell) && cell.length === 4) days[key] = cell;
    });

    function worse(current, next) {
      return RANK[next] > RANK[validState(current)] ? next : current;
    }

    (merged.history || []).forEach(function (bucket) {
      var start = parseDate(bucket.start);
      if (!start) return;
      var seen = buckets[start.getTime()];
      if (!seen) return;
      bucket.components = bucket.components || {};
      bucket.components.api = worse(bucket.components.api, seen.apiDown ? (seen.apiDown >= 2 ? 'outage' : 'degraded') : 'operational');
      bucket.components.site = worse(bucket.components.site, seen.siteDown ? (seen.siteDown >= 2 ? 'outage' : 'degraded') : 'operational');
      var span = Math.min(BUCKET_MS, Date.now() - start.getTime()) / 1000;
      var monitorCoverage = Math.min(100, ((seen.n * 300) / Math.max(1, span)) * 100);
      bucket.coverage = Math.max(Number(bucket.coverage) || 0, Math.round(monitorCoverage * 10) / 10);
    });

    (merged.days || []).forEach(function (day) {
      var cell = days[day.date];
      if (!cell) return;
      day.components = day.components || {};
      var start = parseDate(day.date + 'T00:00:00Z');
      var span = start ? Math.min(DAY_MS, Date.now() - start.getTime()) / 1000 : 86400;
      [['api', cell[0], cell[1]], ['site', cell[2], cell[3]]].forEach(function (item) {
        var up = item[1];
        var total = item[2];
        if (!total) return;
        var down = total - up;
        var own = day.components[item[0]];
        var coverage = Math.min(100, Math.round(((total * 300) / Math.max(1, span)) * 1000) / 10);
        var uptime = Math.round((up / total) * 10000) / 100;
        var state = down >= 1 ? (down * 300 >= 300 && down > 1 ? 'outage' : 'degraded') : 'operational';
        if (!own || coverage > own.coverage) {
          day.components[item[0]] = { state: own ? worse(own.state, state) : state, uptime: uptime, coverage: coverage };
        } else if (RANK[state] > RANK[own.state]) {
          own.state = state;
        }
      });
      day.coverage = Math.max(Number(day.coverage) || 0, day.components.api ? day.components.api.coverage : 0);
    });

    // Incidentes que a API nao consegue ver de dentro (ela fora do ar) ou que o monitor viu primeiro
    var existing = merged.incidents || [];
    (Array.isArray(monitor.incidents) ? monitor.incidents : []).forEach(function (incident) {
      var overlaps = existing.some(function (other) {
        return other.type === incident.type && other.component === incident.component &&
          Math.abs(new Date(other.start).getTime() - new Date(incident.start).getTime()) < 30 * 60 * 1000;
      });
      if (!overlaps) {
        existing.push(Object.assign({ name: incident.component === 'api' ? 'API WhatsAI' : incident.component === 'site' ? 'Site e painel' : '', state: incident.severity, external: true }, incident));
      }
    });
    existing.sort(function (a, b) {
      return new Date(b.start).getTime() - new Date(a.start).getTime();
    });
    merged.incidents = existing;

    var history = merged.history || [];
    if (history.length) {
      merged.coverage = merged.coverage || {};
      merged.coverage.last7d = Math.round(
        (history.reduce(function (total, bucket) { return total + (Number(bucket.coverage) || 0); }, 0) / history.length) * 10,
      ) / 10;
    }
    merged.monitor = { updatedAt: monitor.updatedAt || null };
    return merged;
  }

  // ------------------------------------------------------------------------------------------- barras

  function showDetail(detail, componentName, heading, state, lines) {
    detail.textContent = '';
    detail.dataset.state = state;
    var head = el('div', 'st-bar-detail-head');
    head.append(el('strong', null, componentName));
    var badge = el('span', 'st-bar-detail-state', stateLabel(state));
    badge.dataset.state = state;
    head.append(badge);
    detail.append(head);
    detail.append(el('p', 'st-bar-detail-time', heading));
    lines.forEach(function (line) {
      detail.append(el('p', 'st-bar-detail-text', line));
    });
    var close = el('button', 'st-bar-detail-close', 'Fechar');
    close.type = 'button';
    close.addEventListener('click', function () {
      detail.hidden = true;
      detail.textContent = '';
    });
    detail.append(close);
    detail.hidden = false;
  }

  function slotsFor(componentId, data) {
    var slots = [];
    if (range === '7d') {
      (data.history || []).slice(-HISTORY_SLOTS).forEach(function (bucket) {
        var state = validState(bucket.components && bucket.components[componentId]);
        var from = parseDate(bucket.start);
        var to = from ? new Date(from.getTime() + BUCKET_MS) : null;
        var heading = from
          ? from.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ', ' + timeLocal(from) + '–' + timeLocal(to) + ' · horário local'
          : 'Horário indisponível';
        slots.push({
          state: state,
          label: heading,
          lines: [STATE_MEANING[state], 'Dados de ' + percent(bucket.coverage || 0) + ' do período (todos os componentes).'],
        });
      });
      while (slots.length < HISTORY_SLOTS) slots.unshift({ state: 'no_data', label: 'Sem registro', lines: [STATE_MEANING.no_data] });
      return slots;
    }
    (data.days || []).slice(-90).forEach(function (day) {
      var cell = day.components && day.components[componentId];
      var state = validState(cell && cell.state);
      var heading = parseDate(day.date + 'T12:00:00Z')
        ? new Date(day.date + 'T12:00:00Z').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' })
        : day.date;
      var lines = [STATE_MEANING[state]];
      if (cell) lines.push(percent(cell.uptime) + ' no ar no tempo observado · dados de ' + percent(cell.coverage) + ' do dia.');
      slots.push({ state: state, label: heading + ' (UTC)', lines: lines });
    });
    while (slots.length < 90) slots.unshift({ state: 'no_data', label: 'Sem registro', lines: [STATE_MEANING.no_data] });
    return slots;
  }

  function barsFor(component, data) {
    var componentId = component.id;
    var componentName = component.name || 'Componente';
    var items = slotsFor(componentId, data);
    var detail = el('div', 'st-bar-detail');
    var detailId = 'st-detail-' + componentId;
    detail.id = detailId;
    detail.hidden = true;
    detail.setAttribute('aria-live', 'polite');

    var wrap = el('div', 'st-bars');
    wrap.dataset.range = range;
    var counts = { operational: 0, maintenance: 0, degraded: 0, outage: 0, no_data: 0 };
    var slots = items.map(function (item) {
      counts[item.state]++;
      var slot = el('button', 'st-bar');
      slot.type = 'button';
      slot.dataset.state = item.state;
      slot.tabIndex = -1;
      slot.setAttribute('aria-pressed', 'false');
      slot.setAttribute('aria-controls', detailId);
      slot.title = item.label + ' · ' + stateLabel(item.state);
      slot.setAttribute('aria-label', slot.title);
      return slot;
    });
    var active = slots.length - 1;

    function setActive(index, focus) {
      active = Math.max(0, Math.min(index, slots.length - 1));
      slots.forEach(function (slot, position) {
        slot.setAttribute('aria-pressed', position === active ? 'true' : 'false');
      });
      if (focus) slots[active].focus({ preventScroll: true });
    }

    function activate(index) {
      setActive(index, false);
      var item = items[index];
      showDetail(detail, componentName, item.label, item.state, item.lines);
    }

    slots.forEach(function (slot, index) {
      slot.addEventListener('click', function () {
        activate(index);
      });
      wrap.append(slot);
    });

    wrap.tabIndex = 0;
    wrap.setAttribute('role', 'group');
    wrap.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft' || event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        var next = event.key === 'Home' ? 0 : event.key === 'End' ? slots.length - 1 : active + (event.key === 'ArrowRight' ? 1 : -1);
        setActive(next, true);
        activate(Math.max(0, Math.min(next, slots.length - 1)));
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activate(active);
      }
    });

    var parts = ['operational', 'maintenance', 'degraded', 'outage', 'no_data']
      .filter(function (key) { return counts[key] > 0; })
      .map(function (key) { return counts[key] + ' ' + stateLabel(key).toLowerCase(); });
    wrap.setAttribute(
      'aria-label',
      'Histórico de ' + (range === '7d' ? '7 dias' : '90 dias') + ' de ' + componentName + ': ' + parts.join(', ') +
        '. Use as setas para escolher um período e Enter para ver o detalhe.',
    );
    return { bars: wrap, detail: detail };
  }

  function rowMeta(component, data) {
    var parts = [];
    if (range === '90d' && component.uptime90 !== null && component.uptime90 !== undefined) {
      parts.push(percent(component.uptime90) + ' no ar');
    }
    if (range === '90d') {
      var monitorDays = (data.days || []).map(function (day) { return day.components && day.components[component.id]; }).filter(Boolean);
      var coverage = component.coverage90 || 0;
      if (monitorDays.length && (component.id === 'api' || component.id === 'site')) {
        coverage = Math.max(coverage, monitorDays.reduce(function (total, cell) { return total + (cell.coverage || 0); }, 0) / Math.max(1, monitorDays.length));
      }
      parts.push('dados de ' + percent(coverage) + ' do período');
    }
    if (component.checkedAt) parts.push('verificado ' + relative(component.checkedAt));
    return parts.join(' · ');
  }

  function groupHeader(name) {
    var head = el('div', 'st-group-head');
    head.append(el('h2', null, name));
    var span = el('div', 'st-range');
    span.append(el('span', null, range === '7d' ? '7 dias atrás' : '90 dias atrás'), el('span', null, 'Agora'));
    head.append(span);
    return head;
  }

  function renderGroups(data) {
    groups.textContent = '';
    (data.groups || []).forEach(function (group) {
      var section = el('section', 'st-group');
      section.dataset.group = group.id || '';
      section.append(groupHeader(group.name || 'Componentes'));
      var list = el('ul', 'st-rows');

      (group.components || []).forEach(function (component) {
        var row = el('li', 'st-row');
        var name = el('div', 'st-row-name');
        var heading = el('h3');
        if (component.link && /^https:\/\//.test(component.link)) {
          var link = el('a', null, component.name || 'Componente');
          link.href = component.link;
          link.rel = 'noopener';
          link.target = '_blank';
          heading.append(link);
        } else {
          heading.textContent = component.name || 'Componente';
        }
        name.append(heading);
        if (component.description) name.append(el('p', null, component.description));
        var meta = rowMeta(component, data);
        if (meta) name.append(el('p', 'st-row-meta', meta));

        var state = el('div', 'st-state');
        var dot = el('span', 'st-state-dot');
        dot.dataset.state = validState(component.state);
        dot.setAttribute('aria-hidden', 'true');
        var text = el('span');
        text.append(el('strong', null, stateLabel(validState(component.state))));
        if (Array.isArray(component.incidents) && component.incidents.length) {
          component.incidents.forEach(function (incident) {
            if (incident.url && /^https:\/\//.test(incident.url)) {
              var a = el('a', 'st-upstream-link', incident.name);
              a.href = incident.url;
              a.rel = 'noopener';
              a.target = '_blank';
              text.append(a);
            } else {
              text.append(el('small', null, incident.name));
            }
          });
        } else if (component.detail) {
          text.append(el('small', null, component.detail));
        }
        state.append(dot, text);

        var bars = barsFor(component, data);
        row.append(name, bars.bars, state, bars.detail);
        list.append(row);
      });

      section.append(list);
      groups.append(section);
    });
    groups.setAttribute('aria-busy', 'false');
    if (legendNote) {
      legendNote.textContent =
        range === '7d'
          ? 'Cada barra representa 12 horas (00h–12h e 12h–24h, horário de Brasília) e mostra o pior estado registrado. Clique em uma barra para ver o detalhe e a cobertura.'
          : 'Cada barra representa um dia (UTC) e mostra o pior estado registrado. Clique para ver o tempo no ar e a cobertura do dia.';
    }
  }

  function isMaintenance(incident) {
    return (incident.severity || incident.state) === 'maintenance';
  }

  function dayHeading(value) {
    var date = parseDate(value);
    if (!date) return 'Data indisponível';
    var today = new Date();
    var yesterday = new Date(today.getTime() - DAY_MS);
    var label = date.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }).replace(/\./g, '');
    if (date.toDateString() === today.toDateString()) return 'Hoje · ' + label;
    if (date.toDateString() === yesterday.toDateString()) return 'Ontem · ' + label;
    return label;
  }

  function incidentRow(incident) {
    var row = el('article', 'st-incident');
    var severity = incident.severity || incident.state;
    row.dataset.state = severity === 'outage' ? 'outage' : severity === 'maintenance' ? 'maintenance' : 'degraded';
    row.append(el('span', 'st-incident-date', timeLocal(incident.start)));

    var main = el('div', 'st-incident-main');
    main.append(el('span', 'st-incident-mark', severity === 'maintenance' ? 'i' : '!'));
    var body = el('div');
    var head = el('p', 'st-incident-title');
    var kind = el('span', 'st-incident-type', TYPE_LABEL[incident.type] || 'Incidente');
    head.append(kind, document.createTextNode(incident.title || 'Incidente'));
    body.append(head);
    if (incident.detail) body.append(el('p', 'st-incident-detail', incident.detail));
    var interval = timeLocal(incident.start) + '–' + (incident.end ? timeLocal(incident.end) : 'agora') + ' (horário local)';
    var source = incident.external ? ' · registrado pelo monitor externo' : '';
    body.append(el('p', 'st-incident-meta', (incident.name ? incident.name + ' · ' : '') + interval + source));
    main.append(body);
    row.append(main);
    row.append(el('span', 'st-incident-duration', incident.end ? duration(incident.durationSeconds) : 'em andamento'));
    return row;
  }

  function renderIncidents(data) {
    incidents.textContent = '';
    if (lastFailed && !data.incidents) {
      if (incFilterBox) incFilterBox.hidden = true;
      incidents.append(el('p', 'st-empty', 'Não foi possível carregar os incidentes agora.'));
      return;
    }
    var all = Array.isArray(data.incidents) ? data.incidents.slice() : [];
    var problems = all.filter(function (incident) { return !isMaintenance(incident); }).length;
    var counts = { all: all.length, problems: problems, maintenance: all.length - problems };
    if (incCount) {
      incCount.textContent = 'Últimos 90 dias · ' + all.length + (all.length === 1 ? ' registro' : ' registros');
    }
    if (incFilterBox) {
      incFilterBox.hidden = all.length < 2 || !counts.problems || !counts.maintenance;
      incFilterButtons.forEach(function (button) {
        var key = button.dataset.incFilter;
        var name = key === 'problems' ? 'Falhas' : key === 'maintenance' ? 'Manutenções' : 'Todos';
        button.textContent = name + ' (' + counts[key] + ')';
        button.setAttribute('aria-pressed', key === incFilter ? 'true' : 'false');
      });
      if (incFilterBox.hidden) incFilter = 'all';
    }
    if (!all.length) {
      var since = data.coverage && data.coverage.since ? ' desde ' + dateLocal(data.coverage.since) : '';
      incidents.append(el('p', 'st-empty', 'Nenhum incidente registrado' + since + '.'));
      return;
    }

    var list = all.filter(function (incident) {
      if (incFilter === 'problems') return !isMaintenance(incident);
      if (incFilter === 'maintenance') return isMaintenance(incident);
      return true;
    });
    // Em andamento primeiro; depois do mais recente para o mais antigo
    list.sort(function (a, b) {
      var openA = a.end ? 0 : 1;
      var openB = b.end ? 0 : 1;
      if (openA !== openB) return openB - openA;
      return (parseDate(b.start) || 0) - (parseDate(a.start) || 0);
    });

    var open = list.filter(function (incident) { return !incident.end; });
    var closed = list.filter(function (incident) { return incident.end; });
    if (open.length) {
      var openGroup = el('section', 'st-inc-day');
      openGroup.dataset.open = 'true';
      openGroup.append(el('h3', 'st-inc-day-title', 'Em andamento'));
      open.forEach(function (incident) { openGroup.append(incidentRow(incident)); });
      incidents.append(openGroup);
    }

    var visible = closed.slice(0, Math.max(0, incLimit - open.length));
    var currentDay = '';
    var group = null;
    visible.forEach(function (incident) {
      var date = parseDate(incident.start);
      var key = date ? date.toDateString() : '?';
      if (key !== currentDay) {
        currentDay = key;
        group = el('section', 'st-inc-day');
        group.append(el('h3', 'st-inc-day-title', dayHeading(incident.start)));
        incidents.append(group);
      }
      group.append(incidentRow(incident));
    });

    var hidden = closed.length - visible.length;
    if (hidden > 0) {
      var more = el('button', 'st-inc-more', 'Mostrar mais (' + hidden + (hidden === 1 ? ' restante)' : ' restantes)'));
      more.type = 'button';
      more.addEventListener('click', function () {
        var firstNew = visible.length;
        incLimit += INC_PAGE * 2;
        renderIncidents(lastShown || data);
        // leva o foco para o primeiro incidente que apareceu, sem rolar a página
        var rows = incidents.querySelectorAll('.st-incident');
        var target = rows[open.length + firstNew];
        if (target) {
          target.tabIndex = -1;
          target.focus({ preventScroll: true });
        }
      });
      incidents.append(more);
    } else if (!list.length) {
      incidents.append(el('p', 'st-empty', 'Nenhum registro deste tipo nos últimos 90 dias.'));
    }
  }

  // ------------------------------------------------------------------------------------------- calendário

  function utcDayStart(ms) {
    var date = new Date(ms);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }

  function isoDay(ms) {
    return new Date(ms).toISOString().slice(0, 10);
  }

  function monthName(year, month) {
    return new Date(Date.UTC(year, month, 15)).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }

  function calendarComponents(data) {
    var out = [];
    (data.groups || []).forEach(function (group) {
      (group.components || []).forEach(function (component) {
        if (component && component.id) out.push({ id: component.id, name: component.name || component.id, group: group.name || '' });
      });
    });
    return out;
  }

  function fillCalendarSelect(components) {
    var key = components.map(function (item) { return item.id + ':' + item.name; }).join('|');
    if (key !== calOptionsKey) {
      calOptionsKey = key;
      calSelect.textContent = '';
      var byGroup = {};
      var order = [];
      components.forEach(function (item) {
        if (!byGroup[item.group]) {
          byGroup[item.group] = el('optgroup');
          byGroup[item.group].label = item.group || 'Componentes';
          order.push(item.group);
        }
        var option = el('option', null, item.name);
        option.value = item.id;
        byGroup[item.group].append(option);
      });
      order.forEach(function (name) { calSelect.append(byGroup[name]); });
    }
    if (!components.some(function (item) { return item.id === calComponent; })) {
      calComponent = components.length ? components[0].id : '';
    }
    calSelect.value = calComponent;
  }

  function incidentsOnDay(data, componentId, dayMs) {
    var dayEnd = dayMs + DAY_MS;
    return (Array.isArray(data.incidents) ? data.incidents : []).filter(function (incident) {
      if (incident.component !== componentId) return false;
      var start = parseDate(incident.start);
      var end = incident.end ? parseDate(incident.end) : new Date();
      if (!start || !end) return false;
      return start.getTime() < dayEnd && end.getTime() >= dayMs;
    });
  }

  function renderCalendar(data) {
    if (!calendarBox) return;
    var components = calendarComponents(data);
    fillCalendarSelect(components);
    var component = components.filter(function (item) { return item.id === calComponent; })[0];
    var componentName = component ? component.name : 'Componente';

    var cells = {};
    (data.days || []).forEach(function (day) {
      if (day && day.date && day.components && day.components[calComponent]) cells[day.date] = day.components[calComponent];
    });

    var today = utcDayStart(Date.now());
    var first = today - (CAL_DAYS - 1) * DAY_MS;
    var firstDate = new Date(first);
    var todayDate = new Date(today);
    var totalMonths = (todayDate.getUTCFullYear() - firstDate.getUTCFullYear()) * 12 + todayDate.getUTCMonth() - firstDate.getUTCMonth() + 1;
    var maxOffset = Math.max(0, totalMonths - CAL_MONTHS);
    calOffset = Math.max(0, Math.min(calOffset, maxOffset));
    calPrev.disabled = calOffset >= maxOffset;
    calNext.disabled = calOffset <= 0;

    var months = [];
    for (var k = CAL_MONTHS - 1; k >= 0; k--) {
      var back = calOffset + k;
      var year = todayDate.getUTCFullYear();
      var month = todayDate.getUTCMonth() - back;
      while (month < 0) {
        month += 12;
        year -= 1;
      }
      months.push({ year: year, month: month });
    }
    var firstName = monthName(months[0].year, months[0].month);
    var lastName = monthName(months[months.length - 1].year, months[months.length - 1].month);
    calPeriod.textContent = months[0].year === months[months.length - 1].year
      ? firstName.replace(/ de \d+$/, '') + ' a ' + lastName
      : firstName + ' a ' + lastName;

    calMonths.textContent = '';
    calDetail.hidden = true;
    calDetail.textContent = '';
    var allButtons = [];

    months.forEach(function (info) {
      var section = el('section', 'st-cal-month');
      var headId = 'st-cal-m-' + info.year + '-' + info.month;
      section.setAttribute('aria-labelledby', headId);
      var head = el('div', 'st-cal-month-head');
      var name = monthName(info.year, info.month);
      var heading = el('h3', null, name.charAt(0).toUpperCase() + name.slice(1));
      heading.id = headId;
      head.append(heading);

      var monthStart = Date.UTC(info.year, info.month, 1);
      var daysInMonth = new Date(Date.UTC(info.year, info.month + 1, 0)).getUTCDate();
      var weighted = 0;
      var observed = 0;
      var inWindow = 0;
      for (var d = 0; d < daysInMonth; d++) {
        var ms = monthStart + d * DAY_MS;
        if (ms < first || ms > today) continue;
        inWindow++;
        var cell = cells[isoDay(ms)];
        if (cell && cell.coverage > 0 && cell.uptime !== null && cell.uptime !== undefined) {
          weighted += cell.uptime * cell.coverage;
          observed += cell.coverage;
        }
      }
      var summaryText = observed ? percent(weighted / observed) + ' no ar' : 'Sem dados';
      var summary = el('span', 'st-cal-month-uptime', summaryText);
      summary.title = observed
        ? summaryText + ' no tempo observado · dados de ' + percent(observed / Math.max(1, inWindow)) + ' dos dias do mês'
        : 'Nenhuma verificação registrada neste mês';
      head.append(summary);
      section.append(head);

      var grid = el('div', 'st-cal-grid');
      ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].forEach(function (letter) {
        var wd = el('span', 'st-cal-wd', letter);
        wd.setAttribute('aria-hidden', 'true');
        grid.append(wd);
      });
      var lead = new Date(monthStart).getUTCDay();
      for (var b = 0; b < lead; b++) grid.append(el('span', 'st-cal-pad'));

      var monthButtons = [];
      for (var day = 0; day < daysInMonth; day++) {
        var dayMs = monthStart + day * DAY_MS;
        var label = new Date(dayMs).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).replace(/\./g, '');
        if (dayMs > today || dayMs < first) {
          var off = el('span', 'st-cal-day');
          off.dataset.state = dayMs > today ? 'future' : 'outside';
          off.title = label + (dayMs > today ? ' · ainda não chegou' : ' · fora dos 90 dias guardados');
          grid.append(off);
          continue;
        }
        var dayCell = cells[isoDay(dayMs)];
        var state = validState(dayCell && dayCell.state);
        var button = el('button', 'st-cal-day');
        button.type = 'button';
        button.dataset.state = state;
        if (dayMs === today) button.dataset.today = 'true';
        button.tabIndex = -1;
        button.setAttribute('aria-pressed', 'false');
        button.setAttribute('aria-controls', 'st-cal-detail');
        button.title = label + ' · ' + stateLabel(state);
        button.setAttribute('aria-label', label + (dayMs === today ? ' (hoje)' : '') + ': ' + stateLabel(state));
        button._st = { day: dayMs, label: label, state: state, cell: dayCell };
        monthButtons.push(button);
        allButtons.push(button);
        grid.append(button);
      }
      grid.setAttribute('role', 'group');
      grid.setAttribute('aria-label', 'Dias de ' + name + ' para ' + componentName + '. Use as setas para escolher um dia e Enter para ver o detalhe.');
      section.append(grid);
      calMonths.append(section);
    });

    var active = allButtons.length - 1;
    function setActive(index, focus) {
      if (!allButtons.length) return;
      active = Math.max(0, Math.min(index, allButtons.length - 1));
      allButtons.forEach(function (button, position) {
        button.tabIndex = position === active ? 0 : -1;
      });
      if (focus) allButtons[active].focus({ preventScroll: true });
    }
    function activate(index) {
      setActive(index, false);
      allButtons.forEach(function (button, position) {
        button.setAttribute('aria-pressed', position === active ? 'true' : 'false');
      });
      var info = allButtons[active]._st;
      var lines = [STATE_MEANING[info.state]];
      if (info.cell) lines.push(percent(info.cell.uptime) + ' no ar no tempo observado · dados de ' + percent(info.cell.coverage) + ' do dia.');
      var found = incidentsOnDay(data, calComponent, info.day);
      if (found.length) {
        found.forEach(function (incident) {
          lines.push(
            (TYPE_LABEL[incident.type] || 'Incidente') + ': ' + (incident.title || 'Incidente') + ' · ' + timeLocal(incident.start) + '–' +
              (incident.end ? timeLocal(incident.end) : 'agora') + ' (horário local)',
          );
        });
      } else if (info.state !== 'no_data') {
        lines.push('Nenhum incidente registrado neste dia.');
      }
      showDetail(calDetail, componentName, info.label + ' (UTC)', info.state, lines);
    }
    allButtons.forEach(function (button, index) {
      button.addEventListener('click', function () {
        activate(index);
      });
      button.addEventListener('keydown', function (event) {
        var step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 }[event.key];
        if (step || event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          var next = event.key === 'Home' ? 0 : event.key === 'End' ? allButtons.length - 1 : index + step;
          setActive(next, true);
          activate(active);
        }
      });
    });
    setActive(active, false);
    if (legendNote) {
      legendNote.textContent =
        'Cada quadrado é um dia (UTC) de ' + componentName + ' e mostra o pior estado registrado. Toque em um dia para ver o tempo no ar, a cobertura e os incidentes.';
    }
  }

  function renderHistory(shown) {
    var calendar = range === 'cal' && calendarBox;
    groups.hidden = !!calendar;
    if (calendarBox) calendarBox.hidden = !calendar;
    if (calendar) {
      renderCalendar(shown);
      groups.setAttribute('aria-busy', 'false');
    } else {
      renderGroups(shown);
    }
  }

  function renderCoverage(data) {
    if (!coverageNote) return;
    var coverage = data.coverage || {};
    var parts = [];
    if (range === '7d') parts.push('Dados de ' + percent(coverage.last7d || 0) + ' dos últimos 7 dias');
    else parts.push('Dados de ' + percent(coverage.last90d || 0) + ' do período registrado');
    if (coverage.since) parts.push('registro desde ' + dateLocal(coverage.since));
    parts.push(data.monitor ? 'com o monitor externo' : 'sem monitor externo');
    coverageNote.textContent = parts.join(' · ') + '.';
  }

  function render(data) {
    lastData = data;
    lastFailed = false;
    hideAlert();
    var shown = mergeMonitor(data, lastMonitor);
    setHeroState(validState(shown.state));
    title.textContent = shown.title || 'Status do WhatsAI';
    summary.textContent = shown.summary || '';
    updated.textContent = 'Atualizado ' + relative(shown.checkedAt);
    if (shown.nextCheckSeconds) {
      var minutes = Math.max(1, Math.round(shown.nextCheckSeconds / 60));
      cadence.textContent = minutes + (minutes === 1 ? ' minuto' : ' minutos');
    }
    hero.setAttribute('aria-busy', 'false');
    lastShown = shown;
    renderCoverage(shown);
    renderHistory(shown);
    renderIncidents(shown);
    window.clearTimeout(refreshTimer);
    if (!document.hidden) {
      refreshTimer = window.setTimeout(load, Math.max(REFRESH_FALLBACK_MS, (Number(shown.nextCheckSeconds) || 300) * 1000));
    }
  }

  /** API sem resposta: mostra o que o monitor externo viu (se houver) e nunca afirma que algo esta no ar. */
  function renderFailure(error) {
    lastFailed = true;
    lastData = null;
    var monitor = lastMonitor;
    var monitorSaysDown = monitor && Array.isArray(monitor.samples) && monitor.samples.length && !monitor.samples[monitor.samples.length - 1][1];
    setHeroState(monitorSaysDown ? 'outage' : 'degraded');
    title.textContent = monitorSaysDown ? 'API sem resposta' : 'Não foi possível consultar o status';
    summary.textContent = monitorSaysDown
      ? 'O monitor externo também não recebe resposta da API desde ' + relative(new Date(monitor.samples[monitor.samples.length - 1][0] * 1000)) + '.'
      : 'A página carregou, mas a API de status não respondeu. Pode ser uma falha da API ou da sua conexão.';
    updated.textContent = 'Falha na consulta';
    if (heroStateLabel) heroStateLabel.textContent = monitorSaysDown ? 'Indisponível' : 'Sem leitura';
    hero.setAttribute('aria-busy', 'false');
    showAlert('Tente de novo em alguns instantes. Se você é cliente e o WhatsApp parou, fale com a equipe.');

    var fallback = {
      checkedAt: new Date().toISOString(),
      groups: [
        {
          id: 'plataforma',
          name: 'Plataforma',
          components: [
            { id: 'api', name: 'API WhatsAI', description: 'Recepção, envio e automações (Render)', state: monitorSaysDown ? 'outage' : 'no_data', detail: 'Sem resposta da API de status' },
            { id: 'site', name: 'Site e painel', description: 'Landing, documentação e painel (Vercel)', state: 'operational', detail: 'Esta página carregou agora' },
          ],
        },
      ],
      history: [],
      days: [],
      incidents: monitor ? undefined : [],
      nextCheckSeconds: 60,
    };
    var shown = mergeMonitor(fallback, monitor);
    lastShown = shown;
    renderCoverage(shown);
    renderHistory(shown);
    renderIncidents(shown);
    if (error && window.console && console.warn) console.warn('Status indisponível:', error);
    window.clearTimeout(refreshTimer);
    if (!document.hidden) refreshTimer = window.setTimeout(load, REFRESH_FALLBACK_MS);
  }

  function fetchJson(url, signal) {
    return fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' }, signal: signal }).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    });
  }

  function load() {
    if (request) request.abort();
    var seq = ++requestSeq;
    request = new AbortController();
    var controller = request;
    var timer = window.setTimeout(function () {
      controller.abort();
    }, TIMEOUT_MS);

    var monitorPromise = MONITOR_URL
      ? fetchJson(MONITOR_URL + '/history', controller.signal).then(
          function (data) {
            lastMonitor = data && Array.isArray(data.samples) ? data : lastMonitor;
          },
          function () {
            return undefined;
          },
        )
      : Promise.resolve();

    Promise.all([fetchJson(API_BASE + '/status', controller.signal), monitorPromise])
      .then(function (results) {
        if (seq !== requestSeq) return;
        var data = results[0];
        if (!data || !data.groups) throw new Error('Resposta inválida');
        render(data);
      })
      .catch(function (error) {
        if (seq !== requestSeq) return;
        if (error && error.name === 'AbortError' && lastData && !lastFailed) return;
        monitorPromise.then(function () {
          if (seq === requestSeq) renderFailure(error);
        });
      })
      .finally(function () {
        window.clearTimeout(timer);
      });
  }

  function updateRelative() {
    if (document.hidden || lastFailed) return;
    if (lastData && lastData.checkedAt) updated.textContent = 'Atualizado ' + relative(lastData.checkedAt);
  }

  function setRange(next) {
    range = next === '90d' || next === 'cal' ? next : '7d';
    try {
      window.localStorage.setItem(RANGE_KEY, range);
    } catch (error) {
      // preferencia opcional
    }
    rangeButtons.forEach(function (button) {
      button.setAttribute('aria-pressed', button.dataset.range === range ? 'true' : 'false');
    });
    if (lastData) render(lastData);
    else if (lastShown) {
      renderCoverage(lastShown);
      renderHistory(lastShown);
    }
  }

  if (calSelect) {
    calSelect.addEventListener('change', function () {
      calComponent = calSelect.value;
      try {
        window.localStorage.setItem(CAL_KEY, calComponent);
      } catch (error) {
        // preferencia opcional
      }
      if (lastShown) renderCalendar(lastShown);
    });
    calPrev.addEventListener('click', function () {
      calOffset += 1;
      if (lastShown) renderCalendar(lastShown);
      if (calPrev.disabled) calNext.focus({ preventScroll: true });
    });
    calNext.addEventListener('click', function () {
      calOffset = Math.max(0, calOffset - 1);
      if (lastShown) renderCalendar(lastShown);
      if (calNext.disabled) calPrev.focus({ preventScroll: true });
    });
  }

  incFilterButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      incFilter = button.dataset.incFilter || 'all';
      incLimit = INC_PAGE;
      if (lastShown) renderIncidents(lastShown);
    });
  });

  rangeButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      setRange(button.dataset.range);
    });
    button.setAttribute('aria-pressed', button.dataset.range === range ? 'true' : 'false');
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      window.clearTimeout(refreshTimer);
      window.clearInterval(relativeTimer);
      return;
    }
    window.clearInterval(relativeTimer);
    relativeTimer = window.setInterval(updateRelative, 30_000);
    window.clearTimeout(refreshTimer);
    var checked = lastData ? parseDate(lastData.checkedAt) : null;
    var elapsed = checked ? Date.now() - checked.getTime() : Infinity;
    if (!checked || elapsed > 5 * 60_000) {
      load();
      return;
    }
    var cadenceMs = (Number(lastData.nextCheckSeconds) || 300) * 1000;
    refreshTimer = window.setTimeout(load, Math.max(REFRESH_FALLBACK_MS, cadenceMs - elapsed));
  });

  relativeTimer = window.setInterval(updateRelative, 30_000);
  load();
})();
