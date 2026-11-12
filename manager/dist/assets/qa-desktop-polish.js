/* WhatsAI Manager: correcoes funcionais de desktop da auditoria de 12/11/2026 (manager/patches/qa-desktop-polish.py).
 * Reforcos de CSS ficam em qa-desktop-polish.css; aqui so o que depende do DOM ou da API:
 *   - trilha + H1 nas paginas globais Chaves e Retencao (Observabilidade ja tinha);
 *   - "chatBot" traduzido e chip Ligado/Desligado nos cards do Atendente IA;
 *   - erro 503 da Observabilidade em portugues;
 *   - "Nenhuma cobranca registrada ainda." repetido na Cobranca;
 *   - X nos dialogos de credencial e de confirmacao (aciona o mesmo Cancelar);
 *   - Marcar/Desmarcar Todos agrupados na barra de Eventos;
 *   - "Sair" no rodape da lateral do cliente;
 *   - role=switch no liga/desliga unico do Acesso do cliente.
 * Nada aqui consulta o banco em timer: a unica chamada extra e um GET /openai/find ao abrir a lista de atendentes.
 */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;
  var scheduled = false;
  var lastPath = '';
  var timer = 0;

  function text(element) {
    return (element && element.textContent ? element.textContent : '').replace(/\s+/g, ' ').trim();
  }

  function each(selector, callback, scope) {
    Array.prototype.forEach.call((scope || doc).querySelectorAll(selector), callback);
  }

  function ls(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function isClient() {
    return root.getAttribute('data-wa-portal') === 'client' || /^wac_/.test(ls('token') || '');
  }

  // ------------------------------------------------------------------------------------ trilha das paginas globais
  var CRUMB_TITLES = {
    '/manager/chaves': 'Chaves e credenciais',
    '/manager/retencao': 'Retenção das mensagens (LGPD)',
  };

  function addCrumbs() {
    var path = location.pathname.replace(/\/+$/, '') || '/manager';
    var title = CRUMB_TITLES[path];
    if (!title) return;
    var desktop = !window.matchMedia || window.matchMedia('(min-width: 1024px)').matches;
    if (!desktop) {
      each('.wa-page-crumbs', function (nav) { nav.parentNode.removeChild(nav); });
      return;
    }
    var heading = null;
    each('main h1, .wa-shell-body h1', function (h1) {
      if (!heading && h1.offsetParent !== null) heading = h1;
    });
    if (!heading) return;
    var head = heading.parentElement;
    if (!head || head.querySelector('.wa-page-crumbs')) return;
    var nav = doc.createElement('nav');
    nav.className = 'wo-crumbs wa-page-crumbs';
    nav.setAttribute('aria-label', 'Trilha de navegação');
    nav.innerHTML = '<ol><li><a href="/manager/">Instâncias</a></li><li aria-current="page"></li></ol>';
    nav.querySelector('[aria-current]').textContent = title;
    head.insertBefore(nav, head.firstChild);
  }

  // ------------------------------------------------------------------------- Cobranca: uma mensagem so no vazio
  function fixBillingEmpty() {
    each('.wc-empty span', function (span) {
      var value = text(span);
      var prefix = 'Nenhuma cobrança registrada ainda.';
      if (value.indexOf(prefix) !== 0) return;
      var rest = value.slice(prefix.length).replace(/^\s+/, '');
      if (rest) span.textContent = rest;
    });
  }

  // --------------------------------------------------------------------- erros em ingles -> portugues amigavel
  var ERROR_WORDS = [
    [/Service Unavailable/gi, 'Serviço temporariamente indisponível.'],
    [/Bad Gateway/gi, 'Serviço temporariamente indisponível.'],
    [/Gateway Timeout/gi, 'O serviço demorou demais para responder.'],
    [/Internal Server Error/gi, 'Erro interno no serviço.'],
    [/Failed to fetch/gi, 'Não foi possível falar com a API.'],
    [/Network Error/gi, 'Não foi possível falar com a API.'],
    [/Request failed with status code \d{3}/gi, 'Não foi possível falar com a API.'],
  ];

  function translateErrors() {
    each('.wo-callout p, .wv-callout p, [role="alert"] p', function (paragraph) {
      var original = paragraph.textContent;
      var value = original;
      ERROR_WORDS.forEach(function (pair) { value = value.replace(pair[0], pair[1]); });
      if (value !== original) paragraph.textContent = value;
    });
  }

  // --------------------------------------------------------------------- Atendente IA: tipo + chip de status
  var botState = { key: '', map: null, loading: false };

  function botRoute() {
    return /\/manager\/instance\/[^/]+\/openai\/?$/.test(location.pathname);
  }

  function applyBotCards() {
    each('main button', function (button) {
      var title = button.querySelector(':scope > h4');
      var type = button.querySelector(':scope > p');
      if (!title || !type) return;
      if (text(type) === 'chatBot') type.textContent = 'Chatbot';
      var name = text(title);
      var chip = button.querySelector('.wa-ai-bot-status');
      var known = botState.map && Object.prototype.hasOwnProperty.call(botState.map, name);
      if (!known) {
        if (chip) chip.parentNode.removeChild(chip);
        return;
      }
      var on = botState.map[name];
      if (!chip) {
        chip = doc.createElement('span');
        chip.className = 'wa-ai-bot-status';
        button.appendChild(chip);
      }
      var label = on ? 'Ligado' : 'Desligado';
      if (chip.textContent !== label) chip.textContent = label;
      var flag = on ? 'true' : 'false';
      if (chip.getAttribute('data-on') !== flag) chip.setAttribute('data-on', flag);
    });
  }

  function loadBotStatus() {
    if (!botRoute() || isClient()) return;
    var name = ls('instanceName');
    var token = ls('token') || ls('instanceToken') || '';
    var api = (ls('apiUrl') || '').replace(/\/+$/, '');
    if (!name || !token) return;
    var key = name + '|' + api;
    if (botState.key === key) {
      applyBotCards();
      return;
    }
    if (botState.loading) return;
    botState = { key: key, map: null, loading: true };
    fetch(api + '/openai/find/' + encodeURIComponent(name), {
      headers: { apikey: token },
      cache: 'no-store',
    })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (list) {
        var map = null;
        if (Array.isArray(list)) {
          map = {};
          list.forEach(function (bot) {
            if (bot && bot.name) map[bot.name] = bot.enabled !== false;
          });
        }
        botState = { key: key, map: map, loading: false };
        applyBotCards();
      })
      .catch(function () {
        botState = { key: key, map: null, loading: false };
        applyBotCards();
      });
  }

  // ----------------------------------------------- painel do contato: rotulos longos empilhados, sem quebra
  var STACK_LABELS = ['ia neste contato', 'próximo agendamento', 'primeira mensagem', 'última mensagem'];

  function stackLongFields() {
    each('.wa-tw-fields.wa-ut-props .wa-tw-field', function (field) {
      var label = field.querySelector(':scope > dt');
      if (!label) return;
      if (STACK_LABELS.indexOf(text(label).toLowerCase()) < 0) return;
      if (!field.classList.contains('wa-tw-field--stack')) field.classList.add('wa-tw-field--stack');
    });
  }

  // ------------------------------------------------------------------------------ Acesso do cliente: switch
  function markSwitches() {
    each('.wa-portal-switch input[type="checkbox"]', function (input) {
      if (input.getAttribute('role') !== 'switch') input.setAttribute('role', 'switch');
      var checked = input.checked ? 'true' : 'false';
      if (input.getAttribute('aria-checked') !== checked) input.setAttribute('aria-checked', checked);
      if (!input.__waSwitchBound) {
        input.__waSwitchBound = true;
        input.addEventListener('change', function () {
          input.setAttribute('aria-checked', input.checked ? 'true' : 'false');
        });
      }
    });
  }

  // ------------------------------------------------------- dialogos sem X: aciona o mesmo botao Cancelar
  function addDialogClose() {
    each('.wv-dialog, dialog.wa-ask', function (dialog) {
      if (dialog.querySelector('.wa-dialog-x')) return;
      var cancel = null;
      each('button', function (button) {
        if (!cancel && /^cancelar$/i.test(text(button))) cancel = button;
      }, dialog);
      if (!cancel) return;
      var close = doc.createElement('button');
      close.type = 'button';
      close.className = 'wa-dialog-x';
      close.setAttribute('aria-label', 'Fechar');
      close.title = 'Fechar';
      close.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
        + 'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
        + '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>';
      close.addEventListener('click', function () { cancel.click(); });
      dialog.appendChild(close);
    });
  }

  // ------------------------------------------------------------ Eventos: Marcar/Desmarcar Todos no mesmo lado
  function groupBulkActions() {
    each('button', function (button) {
      if (!/^(des)?marcar todos$/i.test(text(button))) return;
      var row = button.parentElement;
      if (!row || row.classList.contains('wa-bulk-actions')) return;
      var labels = [];
      each(':scope > button', function (sibling) { labels.push(text(sibling).toLowerCase()); }, row);
      if (labels.indexOf('marcar todos') >= 0 && labels.indexOf('desmarcar todos') >= 0) {
        row.classList.add('wa-bulk-actions');
      }
    });
  }

  // ------------------------------------------------------------------ portal do cliente: Sair na lateral
  function addClientLogout() {
    if (!isClient()) return;
    var nav = doc.querySelector('.wa-is-side [data-wa-nav]');
    if (!nav || nav.querySelector('.wa-client-logout')) return;
    var item = doc.createElement('li');
    item.className = 'wa-client-logout';
    var button = doc.createElement('button');
    button.type = 'button';
    button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
      + 'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
      + '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><path d="m16 17 5-5-5-5"></path><path d="M21 12H9"></path></svg>'
      + '<span>Sair</span>';
    button.addEventListener('click', function () {
      ['token', 'instanceToken'].forEach(function (key) {
        try { localStorage.removeItem(key); } catch (e) { /* modo privado */ }
      });
      // o guarda do portal manda quem perdeu o codigo para a entrada do cliente (/acesso)
      window.location.assign('/manager/login');
    });
    item.appendChild(button);
    nav.appendChild(item);
  }

  // --------------------------------------------------------------------------------------------- orquestracao
  function apply() {
    scheduled = false;
    timer = 0;
    var path = location.pathname;
    if (path !== lastPath) {
      lastPath = path;
      botState = { key: '', map: null, loading: false };
    }
    addCrumbs();
    translateErrors();
    fixBillingEmpty();
    stackLongFields();
    markSwitches();
    addDialogClose();
    groupBulkActions();
    addClientLogout();
    applyBotCards();
    loadBotStatus();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    // 60 ms: junta as varias mutacoes de uma renderizacao sem varrer o DOM a cada tecla do chat
    timer = window.setTimeout(apply, 60);
  }

  function start() {
    schedule();
    if (typeof MutationObserver !== 'undefined') {
      new MutationObserver(schedule).observe(doc.body, { childList: true, subtree: true });
    }
    window.addEventListener('popstate', schedule);
    window.addEventListener('hashchange', schedule);
    window.addEventListener('resize', schedule);
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
  else start();
})();
