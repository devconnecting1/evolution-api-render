/*
 * WhatsAI: pagina publica de status.
 *
 * Le GET /status da API (sem chave) e desenha o estado atual, as faixas de 7 dias e os incidentes. O endpoint
 * agrega somente dados de sistema e WhatsApp, sem nomes, numeros, mensagens ou chaves. A pagina atualiza a cada
 * cinco minutos; nao ha timer no servidor.
 */
(function () {
  'use strict';

  var DEFAULT_API = 'https://evolution-api-x93o.onrender.com';
  var API_BASE = DEFAULT_API;
  var REFRESH_FALLBACK_MS = 60_000;
  var TIMEOUT_MS = 12_000;

  var STATES = {
    operational: 'Operacional',
    degraded: 'Degradado',
    outage: 'Indisponível',
    no_data: 'Sem dados',
  };

  var RECOMMENDATIONS = {
    operational: 'Nada a fazer: o atendimento está disponível.',
    degraded: 'A instabilidade está registrada. Se o seu WhatsApp não responder, fale com a equipe.',
    outage: 'O componente não está respondendo. Se o seu atendimento parou, fale com a equipe.',
    no_data: 'Ainda não há leitura dos componentes. Tente de novo em alguns minutos.',
  };

  var STATE_MEANING = {
    operational: 'A verificação encontrou o componente funcionando normalmente neste período.',
    degraded: 'Houve falha parcial ou lentidão neste período.',
    outage: 'O componente não respondeu neste período.',
    no_data: 'Não houve verificação neste período; não é possível afirmar se estava funcionando.',
  };

  var STATE_ACTION = {
    operational: 'Nada a fazer.',
    degraded: 'Se você notou instabilidade nesse horário, fale com a equipe.',
    outage: 'Se o atendimento parou nesse horário, fale com a equipe.',
    no_data: 'Nenhuma ação: o período ficou sem coleta.',
  };

  var hero = document.getElementById('st-hero');
  var title = document.getElementById('st-title');
  var summary = document.getElementById('st-summary');
  var updated = document.getElementById('st-updated');
  var cadence = document.getElementById('st-cadence');
  var alert = document.getElementById('st-alert');
  var groups = document.getElementById('st-groups');
  var incidents = document.getElementById('st-incidents');
  var heroDot = hero.querySelector('.st-state-dot');
  var heroStateLabel = document.getElementById('st-state-label');
  var recommendation = document.getElementById('st-recommendation');

  var lastData = null;
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

  function timeUTC(value) {
    var date = parseDate(value);
    if (!date) return '—';
    return date.toLocaleTimeString('pt-BR', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });
  }

  function dateUTC(value) {
    var date = parseDate(value);
    if (!date) return '—';
    return date.toLocaleDateString('pt-BR', { timeZone: 'UTC', day: '2-digit', month: 'short' }).replace('.', '');
  }

  function duration(seconds) {
    var value = Math.max(0, Number(seconds) || 0);
    if (value < 60) return value + ' s';
    var minutes = Math.round(value / 60);
    if (minutes < 60) return minutes + ' min';
    var hours = Math.floor(minutes / 60);
    var rest = minutes % 60;
    return hours + ' h' + (rest ? ' ' + rest + ' min' : '');
  }

  function bucketTitle(value) {
    var date = parseDate(value);
    if (!date) return 'Sem dados';
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function setHeroState(state) {
    hero.dataset.state = state;
    heroDot.dataset.state = state;
    if (heroStateLabel) heroStateLabel.textContent = stateLabel(state);
    if (recommendation) recommendation.textContent = RECOMMENDATIONS[state] || RECOMMENDATIONS.no_data;
  }

  function showAlert(message) {
    alert.textContent = '';
    alert.append(el('p', null, message));
    var retry = el('button', null, 'Tentar de novo');
    retry.type = 'button';
    retry.addEventListener('click', function () {
      load();
    });
    alert.append(retry);
    alert.hidden = false;
  }

  function hideAlert() {
    alert.hidden = true;
    alert.textContent = '';
  }

  function bucketRange(value) {
    var from = parseDate(value);
    if (!from) return 'Horário indisponível';
    var to = new Date(from.getTime() + 3 * 60 * 60 * 1000);
    var day = from.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    var fromTime = from.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    var toTime = to.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return day + ', ' + fromTime + '–' + toTime + ' · horário local';
  }

  function showBucket(detail, componentName, start, state) {
    detail.textContent = '';
    detail.dataset.state = state;
    var head = el('div', 'st-bar-detail-head');
    head.append(el('strong', null, componentName));
    var badge = el('span', 'st-bar-detail-state', stateLabel(state));
    badge.dataset.state = state;
    head.append(badge);
    detail.append(head);
    detail.append(el('p', 'st-bar-detail-time', bucketRange(start)));
    detail.append(el('p', 'st-bar-detail-text', STATE_MEANING[state] || STATE_MEANING.no_data));
    detail.append(el('p', 'st-bar-detail-action', STATE_ACTION[state] || STATE_ACTION.no_data));
    var close = el('button', 'st-bar-detail-close', 'Fechar');
    close.type = 'button';
    close.addEventListener('click', function () {
      detail.hidden = true;
      detail.textContent = '';
    });
    detail.append(close);
    detail.hidden = false;
  }

  function barsFor(componentId, componentName, history) {
    var slots = [];
    var counts = { operational: 0, degraded: 0, outage: 0, no_data: 0 };
    var list = Array.isArray(history) ? history : [];
    var detail = el('div', 'st-bar-detail');
    var detailId = 'st-detail-' + componentId;
    detail.id = detailId;
    detail.hidden = true;
    detail.setAttribute('aria-live', 'polite');

    for (var i = 0; i < 56; i++) {
      var bucket = list[i];
      var state = (bucket && bucket.components && bucket.components[componentId]) || 'no_data';
      if (!STATES[state]) state = 'no_data';
      counts[state]++;
      var slot = el('button', 'st-bar');
      slot.type = 'button';
      slot.dataset.state = state;
      slot.tabIndex = -1;
      slot.setAttribute('aria-pressed', 'false');
      slot.setAttribute('aria-controls', detailId);
      slot.title = bucketTitle(bucket && bucket.start) + ' · ' + stateLabel(state);
      slot.setAttribute('aria-label', slot.title);
      slots.push(slot);
    }

    var wrap = el('div', 'st-bars');
    var active = 55;

    function setActive(index, focus) {
      active = Math.max(0, Math.min(index, slots.length - 1));
      slots.forEach(function (slot, position) {
        slot.tabIndex = -1;
        slot.setAttribute('aria-pressed', position === active ? 'true' : 'false');
      });
      if (focus) slots[active].focus();
    }

    function activate(index) {
      setActive(index, false);
      var bucket = list[index];
      showBucket(detail, componentName, bucket && bucket.start, slots[index].dataset.state);
    }

    slots.forEach(function (slot, index) {
      slot.addEventListener('click', function () {
        activate(index);
      });
      slot.addEventListener('focus', function () {
        activate(index);
      });
      wrap.append(slot);
    });

    wrap.tabIndex = 0;
    wrap.setAttribute('role', 'group');
    wrap.addEventListener('focus', function () {
      if (document.activeElement === wrap) setActive(active, true);
    });
    wrap.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft' || event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        var next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? slots.length - 1
              : active + (event.key === 'ArrowRight' ? 1 : -1);
        setActive(next, true);
        activate(Math.max(0, Math.min(next, slots.length - 1)));
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activate(active);
      }
    });

    var parts = ['operational', 'degraded', 'outage', 'no_data']
      .filter(function (key) {
        return counts[key] > 0;
      })
      .map(function (key) {
        return counts[key] + ' ' + stateLabel(key).toLowerCase();
      });
    wrap.setAttribute(
      'aria-label',
      'Histórico de 7 dias de ' +
        componentName +
        ': ' +
        parts.join(', ') +
        '. Use as setas para escolher uma faixa e Enter para ver o detalhe.',
    );

    var result = { bars: wrap, detail: detail };
    return result;
  }

  function groupHeader(name) {
    var head = el('div', 'st-group-head');
    head.append(el('h2', null, name));
    var range = el('div', 'st-range');
    range.append(el('span', null, '7 dias atrás'), el('span', null, 'Agora'));
    head.append(range);
    return head;
  }

  function renderGroups(data) {
    groups.textContent = '';
    (data.groups || []).forEach(function (group) {
      var section = el('section', 'st-group');
      section.append(groupHeader(group.name || 'Componentes'));
      var list = el('ul', 'st-rows');

      (group.components || []).forEach(function (component) {
        var row = el('li', 'st-row');
        var name = el('div', 'st-row-name');
        name.append(el('h3', null, component.name || 'Componente'));
        if (component.description) name.append(el('p', null, component.description));

        var state = el('div', 'st-state');
        var dot = el('span', 'st-state-dot');
        dot.dataset.state = component.state || 'no_data';
        dot.setAttribute('aria-hidden', 'true');
        var text = el('span');
        text.append(el('strong', null, stateLabel(component.state || 'no_data')));
        if (component.detail) text.append(el('small', null, component.detail));
        state.append(dot, text);

        var bars = barsFor(component.id, component.name || 'Componente', data.history);
        row.append(name, bars.bars, state, bars.detail);
        list.append(row);
      });

      section.append(list);
      groups.append(section);
    });
    groups.setAttribute('aria-busy', 'false');
  }

  function renderIncidents(data) {
    incidents.textContent = '';
    if (lastFailed) {
      incidents.append(el('p', 'st-empty', 'Não foi possível carregar os incidentes agora.'));
      return;
    }
    var list = Array.isArray(data.incidents) ? data.incidents : [];
    if (!list.length) {
      incidents.append(
        el('p', 'st-empty', 'Nenhum incidente registrado desde o início do monitoramento. O histórico começa na primeira consulta ao status.'),
      );
      return;
    }

    list.forEach(function (incident) {
      var row = el('article', 'st-incident');
      row.dataset.state = incident.state === 'outage' ? 'outage' : 'degraded';
      row.append(el('span', 'st-incident-date', dateUTC(incident.start)));

      var main = el('div', 'st-incident-main');
      main.append(el('span', 'st-incident-mark', '!'));
      var body = el('div');
      body.append(el('p', 'st-incident-title', incident.title || 'Incidente'));
      var interval =
        timeUTC(incident.start) + '–' + (incident.end ? timeUTC(incident.end) : 'agora') + ' UTC';
      body.append(
        el('p', 'st-incident-meta', (incident.name ? incident.name + ' · ' : '') + interval),
      );
      main.append(body);
      row.append(main);
      row.append(
        el(
          'span',
          'st-incident-duration',
          incident.end ? duration(incident.durationSeconds) : 'em andamento',
        ),
      );
      incidents.append(row);
    });
  }

  function render(data) {
    lastData = data;
    lastFailed = false;
    hideAlert();
    setHeroState(data.state || 'no_data');
    title.textContent = data.title || 'Status do WhatsAI';
    summary.textContent = data.summary || '';
    updated.textContent = 'Atualizado ' + relative(data.checkedAt);
    if (data.nextCheckSeconds) {
      var minutes = Math.max(1, Math.round(data.nextCheckSeconds / 60));
      cadence.textContent = minutes + (minutes === 1 ? ' minuto' : ' minutos');
    }
    hero.setAttribute('aria-busy', 'false');
    renderGroups(data);
    renderIncidents(data);
    window.clearTimeout(refreshTimer);
    if (!document.hidden) {
      refreshTimer = window.setTimeout(
        load,
        Math.max(REFRESH_FALLBACK_MS, (Number(data.nextCheckSeconds) || 300) * 1000),
      );
    }
  }

  function renderFailure(error) {
    lastFailed = true;
    lastData = null;
    setHeroState('degraded');
    title.textContent = 'Não foi possível consultar o status';
    summary.textContent =
      'A página carregou, mas a API de status não respondeu. Pode ser uma falha da API ou da sua conexão.';
    updated.textContent = 'Falha na consulta';
    if (heroStateLabel) heroStateLabel.textContent = 'Sem leitura';
    if (recommendation) {
      recommendation.textContent =
        'Não foi possível ler o status agora. Tente de novo ou fale com a equipe se o seu atendimento parou.';
    }
    hero.setAttribute('aria-busy', 'false');
    showAlert('Tente de novo em alguns instantes. Se você é cliente e o WhatsApp parou, fale com a equipe.');

    var fallback = {
      groups: [
        {
          id: 'atendimento',
          name: 'Atendimento',
          components: [
            {
              id: 'whatsapp-web',
              name: 'WhatsApp Web',
              description: 'Conexão por QR code (Baileys e Evolution)',
              state: 'no_data',
              detail: 'Sem leitura das instâncias',
            },
            {
              id: 'whatsapp-cloud',
              name: 'API oficial da Meta',
              description: 'Cloud API para números oficiais',
              state: 'no_data',
              detail: 'Sem leitura das instâncias',
            },
          ],
        },
        {
          id: 'plataforma',
          name: 'Plataforma',
          components: [
            {
              id: 'api',
              name: 'API WhatsAI',
              description: 'Recepção, envio e automações',
              state: 'no_data',
              detail: 'Sem resposta da API de status',
            },
            {
              id: 'database',
              name: 'Banco de dados',
              description: 'Conversas, leads, agenda e configurações',
              state: 'no_data',
              detail: 'Sem leitura do banco',
            },
            {
              id: 'site',
              name: 'Site e painel',
              description: 'Landing, documentação e painel na Vercel',
              state: 'operational',
              detail: 'Esta página carregou',
            },
          ],
        },
      ],
      history: [],
      incidents: [],
      checkedAt: new Date().toISOString(),
      nextCheckSeconds: 60,
    };
    renderGroups(fallback);
    renderIncidents(fallback);
    if (error && window.console && console.warn) console.warn('Status indisponível:', error);
    window.clearTimeout(refreshTimer);
    if (!document.hidden) refreshTimer = window.setTimeout(load, REFRESH_FALLBACK_MS);
  }

  function load() {
    if (request) request.abort();
    var seq = ++requestSeq;
    request = new AbortController();
    var timer = window.setTimeout(function () {
      request.abort();
    }, TIMEOUT_MS);

    fetch(API_BASE + '/status', {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: request.signal,
    })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (data) {
        if (seq !== requestSeq) return;
        if (!data || !data.groups) throw new Error('Resposta inválida');
        render(data);
      })
      .catch(function (error) {
        if (seq !== requestSeq) return;
        if (error && error.name === 'AbortError' && lastData && !lastFailed) return;
        renderFailure(error);
      })
      .finally(function () {
        window.clearTimeout(timer);
      });
  }

  function updateRelative() {
    if (document.hidden || lastFailed) return;
    if (lastData && lastData.checkedAt) {
      updated.textContent = 'Atualizado ' + relative(lastData.checkedAt);
    }
  }

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
