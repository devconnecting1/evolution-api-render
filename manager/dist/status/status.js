/*
 * WhatsAI: pagina publica de status.
 *
 * Le GET /status da API (sem chave): estado atual, 90 dias por componente, faixas de 3 horas e incidentes. Quando a
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
  var BUCKET_MS = 3 * 60 * 60 * 1000;
  var DAY_MS = 24 * 60 * 60 * 1000;
  var RANGE_KEY = 'whatsai-status-range';

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

  var range = '90d';
  try {
    if (window.localStorage.getItem(RANGE_KEY) === '3d') range = '3d';
  } catch (error) {
    // preferencia opcional
  }

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
  function mergeMonitor(data, monitor) {
    if (!monitor || !Array.isArray(monitor.samples)) return data;
    var merged = JSON.parse(JSON.stringify(data));

    var buckets = {};
    var days = {};
    monitor.samples.forEach(function (sample) {
      if (!Array.isArray(sample) || sample.length < 4) return;
      var at = Number(sample[0]) * 1000;
      var key = Math.floor(at / BUCKET_MS) * BUCKET_MS;
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
      merged.coverage.last3d = Math.round(
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
    if (range === '3d') {
      (data.history || []).slice(-24).forEach(function (bucket) {
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
      while (slots.length < 24) slots.unshift({ state: 'no_data', label: 'Sem registro', lines: [STATE_MEANING.no_data] });
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
      if (focus) slots[active].focus();
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
      'Histórico de ' + (range === '3d' ? '3 dias' : '90 dias') + ' de ' + componentName + ': ' + parts.join(', ') +
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
    span.append(el('span', null, range === '3d' ? '3 dias atrás' : '90 dias atrás'), el('span', null, 'Agora'));
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
        range === '3d'
          ? 'Cada barra representa 3 horas e mostra o pior estado registrado. Clique em uma barra para ver o detalhe e a cobertura.'
          : 'Cada barra representa um dia (UTC) e mostra o pior estado registrado. Clique para ver o tempo no ar e a cobertura do dia.';
    }
  }

  function renderIncidents(data) {
    incidents.textContent = '';
    if (lastFailed && !data.incidents) {
      incidents.append(el('p', 'st-empty', 'Não foi possível carregar os incidentes agora.'));
      return;
    }
    var list = Array.isArray(data.incidents) ? data.incidents : [];
    if (!list.length) {
      var since = data.coverage && data.coverage.since ? ' desde ' + dateLocal(data.coverage.since) : '';
      incidents.append(el('p', 'st-empty', 'Nenhum incidente registrado' + since + '.'));
      return;
    }

    list.slice(0, 40).forEach(function (incident) {
      var row = el('article', 'st-incident');
      var severity = incident.severity || incident.state;
      row.dataset.state = severity === 'outage' ? 'outage' : severity === 'maintenance' ? 'maintenance' : 'degraded';
      row.append(el('span', 'st-incident-date', dateLocal(incident.start)));

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
      incidents.append(row);
    });
  }

  function renderCoverage(data) {
    if (!coverageNote) return;
    var coverage = data.coverage || {};
    var parts = [];
    if (range === '3d') parts.push('Dados de ' + percent(coverage.last3d || 0) + ' dos últimos 3 dias');
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
    renderCoverage(shown);
    renderGroups(shown);
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
    renderCoverage(shown);
    renderGroups(shown);
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
    range = next === '3d' ? '3d' : '90d';
    try {
      window.localStorage.setItem(RANGE_KEY, range);
    } catch (error) {
      // preferencia opcional
    }
    rangeButtons.forEach(function (button) {
      button.setAttribute('aria-pressed', button.dataset.range === range ? 'true' : 'false');
    });
    if (lastData) render(lastData);
  }

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
